"""
FastAPI bridge router for GuDong2003/xianyu-auto-reply-fix.

Copy this file into the root of xianyu-auto-reply-fix and include the router
from reply_server.py:

    from zaoyoe_bridge import router as zaoyoe_bridge_router
    app.include_router(zaoyoe_bridge_router)

The router exposes:
    GET  /zaoyoe/orders/paid
    POST /zaoyoe/chat/send
"""

import asyncio
import importlib
import inspect
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel


DEFAULT_PAID_STATUSES = {
    "pending_ship",
    "paid",
    "trade_buyer_paid",
    "wait_seller_send_goods",
    "seller_wait_send_goods",
    "待发货",
    "待卖家发货",
    "买家已付款",
    "已付款",
    "已支付",
}

DEFAULT_BLOCKED_STATUS_FRAGMENTS = (
    "待付款",
    "未付款",
    "退款",
    "取消",
    "关闭",
    "cancel",
    "closed",
    "refund",
    "processing",
    "shipped",
    "completed",
    "已发货",
    "已完成",
    "交易成功",
)

ORDER_TABLE_CANDIDATES = (
    "orders",
    "order_details",
    "order_records",
    "xianyu_orders",
)

BRIDGE_PREFIX = os.getenv("ZAOYOE_BRIDGE_PREFIX", "/zaoyoe")
BRIDGE_TOKEN = os.getenv("ZAOYOE_BRIDGE_TOKEN", "")
DB_PATH = os.getenv("DB_PATH", "data/xianyu_data.db")
ORDER_SYNC_INTERVAL_SECONDS = max(0, int(os.getenv("ZAOYOE_ORDER_SYNC_INTERVAL_SECONDS", "20") or "20"))

_last_order_api_sync_at = 0.0
_last_order_api_sync_summary: Dict[str, Any] = {}
_order_api_sync_lock = asyncio.Lock()

router = APIRouter(prefix=BRIDGE_PREFIX, tags=["zaoyoe-bridge"])


class ChatSendPayload(BaseModel):
    external_order_id: str = ""
    buyer_id: str = ""
    buyer_name: str = ""
    chat_id: str = ""
    sid: str = ""
    cookie_id: str = ""
    item_id: str = ""
    content: str
    usage_instructions: str = ""
    order: Dict[str, Any] = {}
    marketplace_response: Dict[str, Any] = {}


def sanitize_text(value: Any, max_length: int = 500) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max(0, max_length)]


def verify_bridge_token(authorization: str = Header(default="")) -> None:
    if not BRIDGE_TOKEN:
        return

    expected = f"Bearer {BRIDGE_TOKEN}"
    if sanitize_text(authorization, 5000) != expected:
        raise HTTPException(status_code=401, detail="Invalid Zaoyoe bridge token")


def get_db_path() -> Path:
    return Path(os.getenv("DB_PATH", DB_PATH))


def connect_db() -> sqlite3.Connection:
    db_path = get_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=503, detail=f"Xianyu database not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def get_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
    return [row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def find_order_table(conn: sqlite3.Connection) -> str:
    for table_name in ORDER_TABLE_CANDIDATES:
        if table_exists(conn, table_name):
            return table_name
    return ""


def pick_column(columns: List[str], candidates: List[str]) -> str:
    lowered = {column.lower(): column for column in columns}
    for candidate in candidates:
        matched = lowered.get(candidate.lower())
        if matched:
            return matched
    return ""


def parse_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_nested_value(source: Dict[str, Any], path: str, fallback: Any = "") -> Any:
    current: Any = source
    for segment in str(path or "").split("."):
        if not segment:
            continue
        if not isinstance(current, dict):
            return fallback
        current = current.get(segment)
        if current is None:
            return fallback
    return current


def get_value(row: sqlite3.Row, column: str, fallback: Any = "") -> Any:
    if not column:
        return fallback
    try:
        value = row[column]
    except Exception:
        return fallback
    return fallback if value is None else value


def status_looks_paid(status: str) -> bool:
    normalized = sanitize_text(status, 200).lower()
    if not normalized:
        return True
    if any(fragment.lower() in normalized for fragment in DEFAULT_BLOCKED_STATUS_FRAGMENTS):
        return False
    return normalized in {status.lower() for status in DEFAULT_PAID_STATUSES} or any(
        status_token.lower() in normalized for status_token in DEFAULT_PAID_STATUSES
    )


def has_local_delivery_evidence(conn: sqlite3.Connection, order_id: str) -> bool:
    normalized_order_id = sanitize_text(order_id, 180)
    if not normalized_order_id:
        return False

    try:
        if table_exists(conn, "delivery_finalization_states"):
            row = conn.execute(
                """
                SELECT 1
                FROM delivery_finalization_states
                WHERE order_id = ? AND status IN ('sent', 'finalized')
                LIMIT 1
                """,
                (normalized_order_id,),
            ).fetchone()
            if row:
                return True

        if table_exists(conn, "delivery_logs"):
            row = conn.execute(
                """
                SELECT 1
                FROM delivery_logs
                WHERE order_id = ? AND status = 'success'
                LIMIT 1
                """,
                (normalized_order_id,),
            ).fetchone()
            if row:
                return True
    except Exception:
        return False

    return False


def resolve_bridge_delivery_unit_index(data: Dict[str, Any]) -> int:
    for value in (
        data.get("delivery_unit_index"),
        get_nested_value(data, "order.delivery_unit_index"),
        get_nested_value(data, "marketplace_response.meta.delivery_unit_index"),
        get_nested_value(data, "marketplace_response.data.delivery_unit_index"),
    ):
        try:
            parsed = int(value or 0)
        except Exception:
            parsed = 0
        if parsed > 0:
            return min(parsed, 999)
    return 1


def build_bridge_delivery_meta(data: Dict[str, Any]) -> Dict[str, Any]:
    response = data.get("marketplace_response") if isinstance(data.get("marketplace_response"), dict) else {}
    meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
    response_data = response.get("data") if isinstance(response.get("data"), dict) else {}

    return {
        "success": True,
        "source": "zaoyoe_bridge",
        "delivery_unit_index": resolve_bridge_delivery_unit_index(data),
        "external_order_id": sanitize_text(data.get("external_order_id"), 180),
        "marketplace_order_id": sanitize_text(meta.get("order_id") or response_data.get("order_id"), 180),
        "marketplace_delivery_status": sanitize_text(meta.get("delivery_status") or response_data.get("delivery_status"), 120),
        "product_id": sanitize_text(meta.get("product_id") or response_data.get("product_id"), 180),
        "product_name": sanitize_text(meta.get("product_name") or response_data.get("product_name"), 500),
        "quantity": meta.get("quantity") or response_data.get("quantity") or get_nested_value(data, "order.quantity", 1),
        "channel_key": sanitize_text(meta.get("channel_key"), 80),
        "channel_account_key": sanitize_text(meta.get("channel_account_key"), 80),
        "duplicate": response.get("duplicate") is True,
    }


def normalize_bridge_delivery_state(data: Dict[str, Any], status: str, last_error: str = "") -> Dict[str, Any]:
    return {
        "order_id": sanitize_text(
            data.get("external_order_id")
            or get_nested_value(data, "marketplace_response.normalized_order.external_order_id")
            or get_nested_value(data, "marketplace_response.request.external_order_id"),
            180,
        ),
        "unit_index": resolve_bridge_delivery_unit_index(data),
        "cookie_id": sanitize_text(data.get("cookie_id") or get_nested_value(data, "order.cookie_id"), 180),
        "item_id": sanitize_text(data.get("item_id") or get_nested_value(data, "order.item.itemId") or get_nested_value(data, "order.item_id"), 180),
        "buyer_id": sanitize_text(data.get("buyer_id") or get_nested_value(data, "order.buyerId") or get_nested_value(data, "order.buyer_id"), 180),
        "channel": "bridge",
        "status": sanitize_text(status, 40) or "sent",
        "delivery_meta": build_bridge_delivery_meta(data),
        "last_error": sanitize_text(last_error, 1000) or None,
    }


def bridge_delivery_state_payload(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "order_id": row["order_id"],
        "unit_index": row["unit_index"],
        "cookie_id": row["cookie_id"],
        "item_id": row["item_id"],
        "buyer_id": row["buyer_id"],
        "channel": row["channel"],
        "status": row["status"],
        "delivery_meta": parse_json_object(row["delivery_meta"]),
        "last_error": row["last_error"],
        "sent_at": row["sent_at"],
        "finalized_at": row["finalized_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_bridge_delivery_state(conn: sqlite3.Connection, order_id: str, unit_index: int = 1) -> Optional[Dict[str, Any]]:
    if not order_id or not table_exists(conn, "delivery_finalization_states"):
        return None

    row = conn.execute(
        """
        SELECT order_id, unit_index, cookie_id, item_id, buyer_id, channel, status,
               delivery_meta, last_error, sent_at, finalized_at, created_at, updated_at
        FROM delivery_finalization_states
        WHERE order_id = ? AND unit_index = ?
        """,
        (order_id, unit_index),
    ).fetchone()
    return bridge_delivery_state_payload(row) if row else None


def upsert_bridge_delivery_state(data: Dict[str, Any], status: str, last_error: str = "") -> bool:
    state = normalize_bridge_delivery_state(data, status, last_error)
    if not state["order_id"]:
        return False

    try:
        with connect_db() as conn:
            if not table_exists(conn, "delivery_finalization_states"):
                return False

            sent_at_value = "CURRENT_TIMESTAMP" if state["status"] in ("sent", "finalized") else "NULL"
            finalized_at_value = "CURRENT_TIMESTAMP" if state["status"] == "finalized" else "NULL"
            conn.execute(
                f"""
                INSERT INTO delivery_finalization_states (
                    order_id, unit_index, cookie_id, item_id, buyer_id, channel,
                    status, delivery_meta, last_error, sent_at, finalized_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, {sent_at_value}, {finalized_at_value})
                ON CONFLICT(order_id, unit_index) DO UPDATE SET
                    cookie_id = excluded.cookie_id,
                    item_id = excluded.item_id,
                    buyer_id = excluded.buyer_id,
                    channel = excluded.channel,
                    status = CASE
                        WHEN delivery_finalization_states.status IN ('sent', 'finalized')
                             AND excluded.status NOT IN ('finalized')
                            THEN delivery_finalization_states.status
                        ELSE excluded.status
                    END,
                    delivery_meta = CASE
                        WHEN delivery_finalization_states.status IN ('sent', 'finalized')
                             AND excluded.status NOT IN ('finalized')
                            THEN delivery_finalization_states.delivery_meta
                        ELSE excluded.delivery_meta
                    END,
                    last_error = CASE
                        WHEN delivery_finalization_states.status IN ('sent', 'finalized')
                             AND excluded.status NOT IN ('finalized')
                            THEN delivery_finalization_states.last_error
                        ELSE excluded.last_error
                    END,
                    sent_at = CASE
                        WHEN delivery_finalization_states.status IN ('sent', 'finalized')
                             AND excluded.status NOT IN ('finalized')
                            THEN delivery_finalization_states.sent_at
                        WHEN excluded.status = 'sent'
                            THEN COALESCE(delivery_finalization_states.sent_at, CURRENT_TIMESTAMP)
                        ELSE delivery_finalization_states.sent_at
                    END,
                    finalized_at = CASE
                        WHEN delivery_finalization_states.status IN ('sent', 'finalized')
                             AND excluded.status NOT IN ('finalized')
                            THEN delivery_finalization_states.finalized_at
                        WHEN excluded.status = 'finalized'
                            THEN COALESCE(delivery_finalization_states.finalized_at, CURRENT_TIMESTAMP)
                        ELSE delivery_finalization_states.finalized_at
                    END,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    state["order_id"],
                    state["unit_index"],
                    state["cookie_id"],
                    state["item_id"],
                    state["buyer_id"],
                    state["channel"],
                    state["status"],
                    json.dumps(state["delivery_meta"], ensure_ascii=False),
                    state["last_error"],
                ),
            )
            conn.commit()
            return True
    except Exception:
        return False


def reserve_bridge_delivery_send(data: Dict[str, Any]) -> Dict[str, Any]:
    state = normalize_bridge_delivery_state(data, "sending")
    if not state["order_id"]:
        return {"reserved": True, "status": "no_order_id"}

    try:
        with connect_db() as conn:
            if not table_exists(conn, "delivery_finalization_states"):
                return {"reserved": True, "status": "state_table_missing"}

            existing = get_bridge_delivery_state(conn, state["order_id"], state["unit_index"])
            if existing and existing.get("status") in {"sent", "finalized"}:
                return {
                    "reserved": False,
                    "status": existing.get("status"),
                    "state": existing,
                }
            if existing and existing.get("status") == "sending":
                fresh = conn.execute(
                    """
                    SELECT datetime(COALESCE(updated_at, created_at)) >= datetime('now', '-10 minutes')
                    FROM delivery_finalization_states
                    WHERE order_id = ? AND unit_index = ?
                    """,
                    (state["order_id"], state["unit_index"]),
                ).fetchone()
                if bool((fresh or [0])[0]):
                    return {
                        "reserved": False,
                        "status": "sending",
                        "state": existing,
                    }

            delivery_meta_json = json.dumps(state["delivery_meta"], ensure_ascii=False)
            if existing:
                conn.execute(
                    """
                    UPDATE delivery_finalization_states
                    SET cookie_id = ?, item_id = ?, buyer_id = ?, channel = ?, status = 'sending',
                        delivery_meta = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE order_id = ? AND unit_index = ?
                    """,
                    (
                        state["cookie_id"],
                        state["item_id"],
                        state["buyer_id"],
                        state["channel"],
                        delivery_meta_json,
                        state["order_id"],
                        state["unit_index"],
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO delivery_finalization_states (
                        order_id, unit_index, cookie_id, item_id, buyer_id, channel,
                        status, delivery_meta, last_error
                    ) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, NULL)
                    """,
                    (
                        state["order_id"],
                        state["unit_index"],
                        state["cookie_id"],
                        state["item_id"],
                        state["buyer_id"],
                        state["channel"],
                        delivery_meta_json,
                    ),
                )
            conn.commit()
            return {"reserved": True, "status": "sending"}
    except Exception as exc:
        return {
            "reserved": True,
            "status": "state_reservation_failed",
            "warning": sanitize_text(exc, 500),
        }


def normalize_order_row(row: sqlite3.Row, columns: List[str]) -> Optional[Dict[str, Any]]:
    order_id_col = pick_column(columns, ["order_id", "biz_order_id", "bizOrderId", "external_order_id", "id"])
    status_col = pick_column(columns, ["status", "order_status", "trade_status", "delivery_status"])
    buyer_id_col = pick_column(columns, ["buyer_id", "buyer_user_id", "send_user_id", "user_id"])
    buyer_name_col = pick_column(columns, ["buyer_name", "buyer_nick", "send_user_name", "buyer"])
    sid_col = pick_column(columns, ["sid", "session_id", "sessionId", "conversation_id", "conversationId"])
    chat_id_col = pick_column(columns, ["chat_id", "chatId", "cid", "conversation_id", "conversationId", "sid"])
    item_id_col = pick_column(columns, ["item_id", "goods_id", "auction_id", "product_id"])
    item_title_col = pick_column(columns, ["item_title", "goods_title", "title", "item_name"])
    sku_col = pick_column(columns, ["sku_text", "sku", "spec_value", "spec_name"])
    quantity_col = pick_column(columns, ["quantity", "qty", "count", "buy_amount"])
    pay_amount_col = pick_column(columns, ["pay_amount", "price_paid", "actual_pay", "amount"])
    total_amount_col = pick_column(columns, ["total_amount", "total_price", "order_amount", "price"])
    created_at_col = pick_column(columns, ["created_at", "create_time", "pay_time", "platform_create_time"])
    cookie_id_col = pick_column(columns, ["cookie_id", "account_id", "seller_id"])
    raw_col = pick_column(columns, ["raw", "raw_data", "extra", "ext_json", "order_detail"])

    order_id = sanitize_text(get_value(row, order_id_col), 180)
    if not order_id:
        return None

    status = sanitize_text(get_value(row, status_col, "买家已付款"), 180)
    if not status_looks_paid(status):
        return None

    raw = parse_json_object(get_value(row, raw_col))
    quantity = get_value(row, quantity_col, 1)

    try:
        quantity = max(1, int(quantity or 1))
    except Exception:
        quantity = 1

    item_id = sanitize_text(get_value(row, item_id_col) or raw.get("itemId") or raw.get("item_id"), 180)
    item_title = sanitize_text(get_value(row, item_title_col) or raw.get("title") or raw.get("itemTitle"), 500)
    sid = sanitize_text(
        get_value(row, sid_col)
        or raw.get("sid")
        or raw.get("sessionId")
        or raw.get("session_id")
        or raw.get("conversationId")
        or raw.get("conversation_id"),
        180,
    )
    chat_id = sanitize_text(
        get_value(row, chat_id_col)
        or raw.get("chatId")
        or raw.get("chat_id")
        or sid,
        180,
    )
    if "@" in chat_id:
        chat_id = chat_id.split("@", 1)[0]

    return {
        "orderId": order_id,
        "status": status or "买家已付款",
        "buyerId": sanitize_text(get_value(row, buyer_id_col) or raw.get("buyerId") or raw.get("buyer_id"), 180),
        "buyerNick": sanitize_text(get_value(row, buyer_name_col) or raw.get("buyerNick") or raw.get("buyer_name"), 180),
        "chatId": chat_id,
        "sid": sid,
        "item": {
            "itemId": item_id,
            "title": item_title,
            "skuText": sanitize_text(get_value(row, sku_col) or raw.get("skuText") or raw.get("sku_text"), 500),
        },
        "quantity": quantity,
        "payAmount": sanitize_text(get_value(row, pay_amount_col) or raw.get("payAmount") or raw.get("pay_amount"), 80),
        "totalAmount": sanitize_text(get_value(row, total_amount_col) or raw.get("totalAmount") or raw.get("total_amount"), 80),
        "createdAt": sanitize_text(get_value(row, created_at_col) or raw.get("createdAt") or raw.get("created_at"), 120),
        "cookie_id": sanitize_text(get_value(row, cookie_id_col), 180),
        "raw": {
            **raw,
            "chatId": chat_id,
            "sid": sid,
            "source": "xianyu-auto-reply-fix",
        },
    }


def load_paid_orders_from_db(limit: int = 50) -> List[Dict[str, Any]]:
    with connect_db() as conn:
        table_name = find_order_table(conn)
        if not table_name:
            return []

        columns = get_columns(conn, table_name)
        created_at_col = pick_column(columns, ["updated_at", "created_at", "create_time", "pay_time"])

        order_clause = f"ORDER BY {created_at_col} DESC" if created_at_col else ""
        sql = f"SELECT * FROM {table_name} {order_clause} LIMIT ?"
        params = [max(10, min(500, int(limit or 50) * 5))]

        rows = conn.execute(sql, params).fetchall()
        orders = []
        for row in rows:
            normalized = normalize_order_row(row, columns)
            if normalized and has_local_delivery_evidence(conn, normalized.get("orderId", "")):
                continue
            if normalized:
                orders.append(normalized)
            if len(orders) >= max(1, min(200, int(limit or 50))):
                break
        return orders


def clamp_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def save_history_candidate_to_db(db_manager: Any, cookie_id: str, candidate: Dict[str, Any]) -> bool:
    order_id = sanitize_text(candidate.get("order_id"), 180)
    if not order_id:
        return False

    return bool(db_manager.insert_or_update_order(
        order_id=order_id,
        item_id=sanitize_text(candidate.get("item_id"), 180) or None,
        buyer_id=sanitize_text(candidate.get("buyer_id"), 180) or None,
        buyer_nick=sanitize_text(candidate.get("buyer_nick"), 180) or None,
        sid=sanitize_text(candidate.get("sid"), 180) or None,
        amount=sanitize_text(candidate.get("amount"), 80) or None,
        order_status=sanitize_text(candidate.get("order_status"), 80) or None,
        cookie_id=cookie_id,
        platform_created_at=sanitize_text(candidate.get("platform_created_at"), 120) or None,
        platform_paid_at=sanitize_text(candidate.get("platform_paid_at"), 120) or None,
        platform_completed_at=sanitize_text(candidate.get("platform_completed_at"), 120) or None,
    ))


async def sync_recent_orders_from_order_api(limit: int = 50, force: bool = False) -> Dict[str, Any]:
    global _last_order_api_sync_at, _last_order_api_sync_summary

    now = time.time()
    if not force and ORDER_SYNC_INTERVAL_SECONDS and now - _last_order_api_sync_at < ORDER_SYNC_INTERVAL_SECONDS:
        return {
            **_last_order_api_sync_summary,
            "skipped": True,
            "reason": "sync_interval",
            "last_synced_at": _last_order_api_sync_at,
        }

    async with _order_api_sync_lock:
        now = time.time()
        if not force and ORDER_SYNC_INTERVAL_SECONDS and now - _last_order_api_sync_at < ORDER_SYNC_INTERVAL_SECONDS:
            return {
                **_last_order_api_sync_summary,
                "skipped": True,
                "reason": "sync_interval",
                "last_synced_at": _last_order_api_sync_at,
            }

        summary: Dict[str, Any] = {
            "skipped": False,
            "accounts": 0,
            "scanned": 0,
            "saved": 0,
            "errors": [],
        }

        try:
            from db_manager import db_manager
            from utils.order_history_sync import OrderHistoryPageFetcher

            cookies = db_manager.get_all_cookies()
            summary["accounts"] = len(cookies)
            max_orders = clamp_int(limit, 50, 1, 100) * 2

            for cookie_id, cookie_value in cookies.items():
                fetcher = OrderHistoryPageFetcher(
                    cookie_value,
                    cookie_id_for_log=str(cookie_id),
                    headless=True,
                )
                try:
                    result = await fetcher.fetch_recent_orders(max_orders=max_orders)
                    candidates = list(result.get("orders") or [])
                    summary["scanned"] += int(result.get("scanned_count") or len(candidates) or 0)
                    for candidate in candidates:
                        if save_history_candidate_to_db(db_manager, str(cookie_id), candidate):
                            summary["saved"] += 1
                except Exception as exc:
                    summary["errors"].append({
                        "cookie_id": str(cookie_id),
                        "message": sanitize_text(exc, 500),
                    })
                finally:
                    await fetcher.close()
        except Exception as exc:
            summary["errors"].append({
                "cookie_id": "",
                "message": sanitize_text(exc, 500),
            })

        _last_order_api_sync_at = time.time()
        summary["last_synced_at"] = _last_order_api_sync_at
        _last_order_api_sync_summary = dict(summary)
        return summary


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def load_custom_sender():
    sender_spec = sanitize_text(os.getenv("ZAOYOE_BRIDGE_CHAT_SENDER"), 500)
    if not sender_spec:
        return None
    if ":" not in sender_spec:
        raise HTTPException(status_code=500, detail="ZAOYOE_BRIDGE_CHAT_SENDER must be module:function")

    module_name, function_name = sender_spec.split(":", 1)
    module = importlib.import_module(module_name)
    sender = getattr(module, function_name, None)
    if not callable(sender):
        raise HTTPException(status_code=500, detail=f"Chat sender is not callable: {sender_spec}")
    return sender


async def append_outbox(payload: Dict[str, Any]) -> Dict[str, Any]:
    outbox_file = sanitize_text(os.getenv("ZAOYOE_BRIDGE_OUTBOX_FILE"), 1000)
    if not outbox_file:
        return {}

    outbox_path = Path(outbox_file)
    outbox_path.parent.mkdir(parents=True, exist_ok=True)
    with outbox_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return {
        "success": True,
        "mode": "outbox_file",
        "outbox_file": str(outbox_path),
    }


async def dispatch_chat_message(payload: Dict[str, Any]) -> Dict[str, Any]:
    sender = load_custom_sender()
    if sender:
        result = await maybe_await(sender(payload))
        if isinstance(result, dict):
            return {"success": result.get("success", True), "mode": "custom_sender", **result}
        return {"success": True, "mode": "custom_sender", "result": result}

    outbox_result = await append_outbox(payload)
    if outbox_result:
        return outbox_result

    raise HTTPException(
        status_code=501,
        detail=(
            "Chat sender is not configured. Set ZAOYOE_BRIDGE_CHAT_SENDER=module:function "
            "or ZAOYOE_BRIDGE_OUTBOX_FILE for dry-run."
        ),
    )


def build_delivery_chat_messages(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = sanitize_text(data.get("content"), 20_000)
    usage_instructions = sanitize_text(data.get("usage_instructions"), 4000)
    messages: List[Dict[str, Any]] = []

    if usage_instructions:
        instruction_payload = {
            **data,
            "content": usage_instructions,
            "message_role": "usage_instructions",
            "message_sequence": 1,
        }
        messages.append(instruction_payload)

    if content:
        delivery_payload = {
            **data,
            "content": content,
            "message_role": "delivery_content",
            "message_sequence": len(messages) + 1,
        }
        messages.append(delivery_payload)

    return messages


async def dispatch_delivery_chat_messages(data: Dict[str, Any]) -> Dict[str, Any]:
    messages = build_delivery_chat_messages(data)
    if not messages:
        raise HTTPException(status_code=400, detail="content is required")

    results: List[Dict[str, Any]] = []
    for message in messages:
        result = await dispatch_chat_message(message)
        if isinstance(result, dict) and result.get("success") is False:
            raise HTTPException(
                status_code=502,
                detail=sanitize_text(result.get("message") or result.get("error"), 1000) or "Chat message send failed",
            )
        results.append(result)

    first_result = results[0] if results else {}
    return {
        "success": all(result.get("success", True) for result in results),
        "mode": first_result.get("mode", "multi_message"),
        "message_count": len(messages),
        "messages": results,
    }


def is_bridge_auto_confirm_enabled(cookie_id: str) -> bool:
    normalized_cookie_id = sanitize_text(cookie_id, 180)
    if not normalized_cookie_id:
        return False

    try:
        from db_manager import db_manager
        return bool(db_manager.get_auto_confirm(normalized_cookie_id))
    except Exception:
        return False


def resolve_bridge_live_instance(cookie_id: str = ""):
    try:
        from XianyuAutoAsync import XianyuLive
    except Exception:
        return None

    normalized_cookie_id = sanitize_text(cookie_id, 180)
    if normalized_cookie_id:
        try:
            live_instance = XianyuLive.get_instance(normalized_cookie_id)
            if live_instance:
                return live_instance
        except Exception:
            pass

        try:
            import cookie_manager

            manager = getattr(cookie_manager, "manager", None)
            live_instance = getattr(manager, "live_instances", {}).get(normalized_cookie_id) if manager else None
            if live_instance:
                return live_instance
        except Exception:
            pass

    try:
        instances = XianyuLive.get_all_instances()
    except Exception:
        instances = {}

    connected = [
        instance
        for instance in instances.values()
        if str(getattr(getattr(instance, "connection_state", None), "value", "")) == "connected"
        and getattr(instance, "ws", None)
    ]
    return connected[0] if len(connected) == 1 else None


async def run_on_xianyu_manager_loop(live_instance, coroutine):
    try:
        import cookie_manager

        manager = getattr(cookie_manager, "manager", None)
        target_loop = getattr(manager, "loop", None)
    except Exception:
        target_loop = None

    if not target_loop:
        return await coroutine()
    if hasattr(target_loop, "is_closed") and target_loop.is_closed():
        raise RuntimeError("Xianyu account event loop is closed")

    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if current_loop is target_loop:
        return await coroutine()
    if not target_loop.is_running():
        cookie_id = sanitize_text(getattr(live_instance, "cookie_id", ""), 180)
        raise RuntimeError(f"Xianyu account event loop is not running: {cookie_id or 'unknown'}")

    thread_future = asyncio.run_coroutine_threadsafe(coroutine(), target_loop)
    return await asyncio.wait_for(asyncio.wrap_future(thread_future), timeout=45)


async def finalize_bridge_delivery_after_send(data: Dict[str, Any]) -> Dict[str, Any]:
    state = normalize_bridge_delivery_state(data, "sent")
    order_id = state.get("order_id")
    item_id = state.get("item_id")
    cookie_id = state.get("cookie_id")

    if not order_id:
        return {
            "success": True,
            "status": "skipped",
            "reason": "order_id_missing",
        }

    live_instance = resolve_bridge_live_instance(cookie_id)
    if not live_instance:
        return {
            "success": False,
            "status": "confirm_skipped",
            "reason": "xianyu_account_not_running",
        }

    resolved_cookie_id = sanitize_text(getattr(live_instance, "cookie_id", cookie_id), 180) or cookie_id
    if not is_bridge_auto_confirm_enabled(resolved_cookie_id):
        return {
            "success": True,
            "status": "auto_confirm_disabled",
            "cookie_id": resolved_cookie_id,
        }

    delivery_meta = {
        **(state.get("delivery_meta") or {}),
        "success": True,
        "source": "zaoyoe_bridge",
    }

    async def do_finalize():
        if hasattr(live_instance, "_finalize_delivery_after_send"):
            return await live_instance._finalize_delivery_after_send(
                delivery_meta=delivery_meta,
                order_id=order_id,
                item_id=item_id,
            )

        if hasattr(live_instance, "auto_confirm"):
            return await live_instance.auto_confirm(order_id, item_id)

        return {
            "success": False,
            "error": "Xianyu live instance does not support auto_confirm",
        }

    try:
        result = await run_on_xianyu_manager_loop(live_instance, do_finalize)
    except Exception as exc:
        error_message = sanitize_text(exc, 1000) or "自动确认发货异常"
        upsert_bridge_delivery_state(data, "sent", error_message)
        return {
            "success": False,
            "status": "confirm_failed",
            "cookie_id": resolved_cookie_id,
            "error": error_message,
        }

    if isinstance(result, dict) and result.get("success"):
        upsert_bridge_delivery_state(data, "finalized")
        return {
            "success": True,
            "status": "finalized",
            "cookie_id": resolved_cookie_id,
        }

    error_message = sanitize_text(
        result.get("error") if isinstance(result, dict) else result,
        1000,
    ) or "自动确认发货失败"
    upsert_bridge_delivery_state(data, "sent", error_message)
    return {
        "success": False,
        "status": "confirm_failed",
        "cookie_id": resolved_cookie_id,
        "error": error_message,
    }


@router.get("/orders/paid")
async def list_paid_orders(
    limit: int = 50,
    refresh: bool = True,
    _authorized: None = Depends(verify_bridge_token),
):
    sync_summary = await sync_recent_orders_from_order_api(limit=limit, force=False) if refresh else {
        "skipped": True,
        "reason": "disabled_by_request",
    }
    orders = load_paid_orders_from_db(limit=limit)
    return {
        "success": True,
        "orders": orders,
        "sync": sync_summary,
    }


@router.post("/chat/send")
async def send_chat_message(
    payload: ChatSendPayload,
    _authorized: None = Depends(verify_bridge_token),
):
    data = payload.dict()
    reservation = reserve_bridge_delivery_send(data)
    if not reservation.get("reserved"):
        if reservation.get("status") in {"sent", "finalized"}:
            return {
                "success": True,
                "skipped": True,
                "reason": "delivery_already_recorded",
                "bridge_delivery_state": reservation,
            }
        raise HTTPException(status_code=409, detail="Bridge delivery send is already in progress")

    try:
        result = await dispatch_delivery_chat_messages(data)
    except Exception as exc:
        upsert_bridge_delivery_state(data, "failed", sanitize_text(exc, 1000))
        raise

    upsert_bridge_delivery_state(data, "sent")
    finalization = await finalize_bridge_delivery_after_send(data)
    return {
        "success": True,
        **result,
        "bridge_finalization": finalization,
    }


@router.get("/health")
async def bridge_health(_authorized: None = Depends(verify_bridge_token)):
    return {
        "success": True,
        "service": "zaoyoe-xianyu-bridge",
        "db_path": str(get_db_path()),
        "has_chat_sender": bool(os.getenv("ZAOYOE_BRIDGE_CHAT_SENDER")),
        "has_outbox_file": bool(os.getenv("ZAOYOE_BRIDGE_OUTBOX_FILE")),
        "order_sync_interval_seconds": ORDER_SYNC_INTERVAL_SECONDS,
        "last_order_sync": _last_order_api_sync_summary,
    }
