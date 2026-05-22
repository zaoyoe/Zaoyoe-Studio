"""Real chat sender for zaoyoe_bridge.py inside xianyu-auto-reply-fix.

Enable it with:
    ZAOYOE_BRIDGE_CHAT_SENDER=zaoyoe_sender_example:send_message
"""

import asyncio
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import HTTPException


async def send_message(payload: Dict[str, Any]) -> Dict[str, Any]:
    content = str(payload.get("content") or "").strip()
    order = payload.get("order") or {}
    buyer_id = str(payload.get("buyer_id") or order.get("buyerId") or "").strip()
    order_id = str(payload.get("external_order_id") or order.get("orderId") or "").strip()
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

    if not content:
        return {
            "success": False,
            "message": "content is required",
        }
    if not buyer_id:
        raise HTTPException(status_code=400, detail="buyer_id is required for Xianyu chat send")
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id or sid is required for Xianyu chat send")

    live_instance = resolve_live_instance(cookie_id)
    if not live_instance:
        raise HTTPException(status_code=400, detail=f"Xianyu account is not running: {cookie_id or 'auto'}")

    connection_state = getattr(live_instance, "connection_state", None)
    if str(getattr(connection_state, "value", connection_state)) != "connected":
        raise HTTPException(status_code=400, detail=f"Xianyu account WebSocket is not connected: {cookie_id or getattr(live_instance, 'cookie_id', '')}")
    if not getattr(live_instance, "ws", None):
        raise HTTPException(status_code=400, detail="Xianyu account WebSocket is not ready")

    await run_on_manager_loop(
        getattr(live_instance, "cookie_id", cookie_id),
        lambda: live_instance.send_msg(live_instance.ws, chat_id, buyer_id, content),
        timeout=15,
    )

    return {
        "success": True,
        "order_id": order_id,
        "cookie_id": getattr(live_instance, "cookie_id", cookie_id),
        "chat_id": chat_id,
        "buyer_id": buyer_id,
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
