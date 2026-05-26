"""Real chat sender for zaoyoe_bridge.py inside xianyu-auto-reply-fix.

Enable it with:
    ZAOYOE_BRIDGE_CHAT_SENDER=zaoyoe_sender_example:send_message
"""

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import HTTPException

logger = logging.getLogger("zaoyoe_sender_example")


async def send_message(payload: Dict[str, Any]) -> Dict[str, Any]:
    content = str(payload.get("content") or "").strip()
    order = payload.get("order") or {}
    buyer_id = str(payload.get("buyer_id") or order.get("buyerId") or "").strip()
    order_id = str(payload.get("external_order_id") or order.get("orderId") or "").strip()
    item = order.get("item") if isinstance(order.get("item"), dict) else {}
    item_id = str(
        payload.get("item_id")
        or order.get("itemId")
        or order.get("item_id")
        or item.get("itemId")
        or item.get("id")
        or ""
    ).strip()
    chat_id = normalize_chat_id(
        payload.get("chat_id")
        or payload.get("sid")
        or order.get("chatId")
        or order.get("chat_id")
        or order.get("sid")
    )
    cookie_id = str(
        payload.get("cookie_id")
        or order.get("cookie_id")
        or order.get("cookieId")
        or order.get("account_id")
        or ""
    ).strip()
    message_role = str(payload.get("message_role") or "delivery_content").strip()
    message_sequence = payload.get("message_sequence") or ""

    if not content:
        return {
            "success": False,
            "message": "content is required",
        }
    if not buyer_id:
        raise HTTPException(status_code=400, detail="buyer_id is required for Xianyu chat send")
    if not chat_id and not item_id:
        raise HTTPException(status_code=400, detail="chat_id/sid or item_id is required for Xianyu chat send")

    live_instance = resolve_live_instance(cookie_id)
    if not live_instance:
        raise HTTPException(status_code=400, detail=f"Xianyu account is not running: {cookie_id or 'auto'}")

    logger.info(
        "xianyu_bridge_send_start order_id=%s role=%s sequence=%s buyer_id=%s chat_id=%s item_id=%s content_length=%s",
        order_id,
        message_role,
        message_sequence,
        buyer_id,
        chat_id,
        item_id,
        len(content),
    )

    if chat_id and is_live_websocket_ready(live_instance):
        await run_on_manager_loop(
            getattr(live_instance, "cookie_id", cookie_id),
            lambda: send_via_live_chat(live_instance, chat_id, buyer_id, content),
            timeout=15,
        )
        send_mode = "existing_chat"
    else:
        chat_id = await run_on_manager_loop(
            getattr(live_instance, "cookie_id", cookie_id),
            lambda: send_via_temporary_chat(live_instance, buyer_id, item_id, content, chat_id=chat_id),
            timeout=45,
        )
        send_mode = "temporary_chat"

    logger.info(
        "xianyu_bridge_send_done order_id=%s role=%s sequence=%s buyer_id=%s chat_id=%s item_id=%s send_mode=%s",
        order_id,
        message_role,
        message_sequence,
        buyer_id,
        chat_id,
        item_id,
        send_mode,
    )

    return {
        "success": True,
        "order_id": order_id,
        "cookie_id": getattr(live_instance, "cookie_id", cookie_id),
        "chat_id": chat_id,
        "buyer_id": buyer_id,
        "item_id": item_id,
        "send_mode": send_mode,
        "message_role": message_role,
        "message_sequence": message_sequence,
        "content_length": len(content),
    }


def normalize_chat_id(value: Any) -> str:
    text = str(value or "").strip()
    if "@" in text:
        text = text.split("@", 1)[0].strip()
    return text


def resolve_live_instance(cookie_id: str = ""):
    from XianyuAutoAsync import XianyuLive

    if cookie_id:
        live_instance = XianyuLive.get_instance(cookie_id)
        if live_instance:
            return live_instance

        try:
            import cookie_manager

            manager = getattr(cookie_manager, "manager", None)
            live_instance = getattr(manager, "live_instances", {}).get(cookie_id) if manager else None
            if live_instance:
                return live_instance
        except Exception:
            pass

    instances = XianyuLive.get_all_instances()
    connected = [
        instance
        for instance in instances.values()
        if str(getattr(getattr(instance, "connection_state", None), "value", "")) == "connected"
        and getattr(instance, "ws", None)
    ]
    if len(connected) == 1:
        return connected[0]

    return None


def is_live_websocket_ready(live_instance) -> bool:
    connection_state = getattr(live_instance, "connection_state", None)
    if str(getattr(connection_state, "value", connection_state)) != "connected":
        return False

    websocket = getattr(live_instance, "ws", None)
    if not websocket:
        return False
    if getattr(websocket, "closed", False):
        return False
    return True


async def send_via_live_chat(live_instance, chat_id: str, buyer_id: str, content: str) -> bool:
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required for live chat send")
    if not is_live_websocket_ready(live_instance):
        raise HTTPException(status_code=400, detail="Xianyu account WebSocket is not ready")

    await live_instance.send_msg(live_instance.ws, chat_id, buyer_id, content)
    await asyncio.sleep(2.5)
    return True


async def send_via_temporary_chat(
    live_instance,
    buyer_id: str,
    item_id: str,
    content: str,
    *,
    chat_id: str = "",
) -> str:
    import certifi
    import ssl
    import websockets

    if not chat_id and not item_id:
        raise HTTPException(status_code=400, detail="item_id is required when chat_id is missing")

    headers = live_instance._build_websocket_headers()
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        async with websockets.connect(
            live_instance.base_url,
            extra_headers=headers,
            ssl=ssl_context,
            close_timeout=5,
        ) as websocket:
            return await create_or_send_on_temporary_chat(live_instance, websocket, buyer_id, item_id, content, chat_id)
    except TypeError as error:
        if "extra_headers" not in str(error):
            raise
        async with websockets.connect(
            live_instance.base_url,
            additional_headers=headers,
            ssl=ssl_context,
            close_timeout=5,
        ) as websocket:
            return await create_or_send_on_temporary_chat(live_instance, websocket, buyer_id, item_id, content, chat_id)


async def create_or_send_on_temporary_chat(live_instance, websocket, buyer_id: str, item_id: str, content: str, chat_id: str = "") -> str:
    await live_instance.init(websocket)

    resolved_chat_id = normalize_chat_id(chat_id)
    if not resolved_chat_id:
        await live_instance.create_chat(websocket, buyer_id, item_id)
        resolved_chat_id = await wait_for_created_chat_id(websocket)

    if not resolved_chat_id:
        raise HTTPException(status_code=502, detail="Xianyu chat create failed")

    await live_instance.send_msg(websocket, resolved_chat_id, buyer_id, content)
    await wait_for_send_settle(websocket, timeout=3.0)
    return resolved_chat_id


async def resolve_chat_id_via_new_chat(live_instance, buyer_id: str, item_id: str) -> str:
    import certifi
    import ssl
    import websockets

    headers = live_instance._build_websocket_headers()
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        async with websockets.connect(
            live_instance.base_url,
            extra_headers=headers,
            ssl=ssl_context,
            close_timeout=5,
        ) as websocket:
            result = await create_chat_and_wait_for_id(live_instance, websocket, buyer_id, item_id)
    except TypeError as error:
        if "extra_headers" not in str(error):
            raise
        async with websockets.connect(
            live_instance.base_url,
            additional_headers=headers,
            ssl=ssl_context,
            close_timeout=5,
        ) as websocket:
            result = await create_chat_and_wait_for_id(live_instance, websocket, buyer_id, item_id)

    if not result:
        raise HTTPException(status_code=502, detail="Xianyu chat create failed")
    return result


async def create_chat_and_wait_for_id(live_instance, websocket, buyer_id: str, item_id: str) -> str:
    await live_instance.init(websocket)
    await live_instance.create_chat(websocket, buyer_id, item_id)
    return await wait_for_created_chat_id(websocket)


async def wait_for_created_chat_id(websocket, timeout: float = 30) -> str:
    import json
    import time

    start_time = time.time()

    async for message in websocket:
        if time.time() - start_time > timeout:
            break

        try:
            parsed = json.loads(message)
            cid = parsed["body"]["singleChatConversation"]["cid"]
            return normalize_chat_id(cid)
        except Exception:
            continue

    return ""


async def wait_for_send_settle(websocket, timeout: float = 3.0) -> None:
    import time

    start_time = time.time()
    while time.time() - start_time < timeout:
        remaining = timeout - (time.time() - start_time)
        try:
            await asyncio.wait_for(websocket.recv(), timeout=max(0.1, remaining))
        except asyncio.TimeoutError:
            break
        except Exception:
            break


async def run_on_manager_loop(
    cookie_id: str,
    coroutine_factory: Callable[[], Awaitable[Any]],
    *,
    timeout: Optional[float] = None,
) -> Any:
    try:
        import cookie_manager

        manager = getattr(cookie_manager, "manager", None)
        target_loop = getattr(manager, "loop", None)
    except Exception:
        target_loop = None

    if not target_loop:
        return await coroutine_factory()
    if hasattr(target_loop, "is_closed") and target_loop.is_closed():
        raise HTTPException(status_code=500, detail="Xianyu account event loop is closed")

    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if current_loop is target_loop:
        return await coroutine_factory()
    if not target_loop.is_running():
        raise HTTPException(status_code=500, detail=f"Xianyu account event loop is not running: {cookie_id}")

    thread_future = asyncio.run_coroutine_threadsafe(coroutine_factory(), target_loop)
    wrapped_future = asyncio.wrap_future(thread_future)

    try:
        if timeout and timeout > 0:
            return await asyncio.wait_for(wrapped_future, timeout=timeout)
        return await wrapped_future
    except asyncio.TimeoutError:
        thread_future.cancel()
        raise HTTPException(status_code=504, detail="Xianyu chat send timed out")
