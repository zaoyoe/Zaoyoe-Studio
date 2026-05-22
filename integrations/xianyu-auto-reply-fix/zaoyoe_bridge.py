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
            if normalized:
                orders.append(normalized)
            if len(orders) >= max(1, min(200, int(limit or 50))):
                break
        return orders


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


@router.get("/orders/paid")
async def list_paid_orders(
    limit: int = 50,
    _authorized: None = Depends(verify_bridge_token),
):
    orders = load_paid_orders_from_db(limit=limit)
    return {
        "success": True,
        "orders": orders,
    }


@router.post("/chat/send")
async def send_chat_message(
    payload: ChatSendPayload,
    _authorized: None = Depends(verify_bridge_token),
):
    data = payload.dict()
    result = await dispatch_chat_message(data)
    return {
        "success": True,
        **result,
    }


@router.get("/health")
async def bridge_health(_authorized: None = Depends(verify_bridge_token)):
    return {
        "success": True,
        "service": "zaoyoe-xianyu-bridge",
        "db_path": str(get_db_path()),
        "has_chat_sender": bool(os.getenv("ZAOYOE_BRIDGE_CHAT_SENDER")),
        "has_outbox_file": bool(os.getenv("ZAOYOE_BRIDGE_OUTBOX_FILE")),
    }