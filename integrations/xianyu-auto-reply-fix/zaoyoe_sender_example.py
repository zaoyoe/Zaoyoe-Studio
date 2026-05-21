"""
Example custom chat sender for zaoyoe_bridge.py.

Copy this file into xianyu-auto-reply-fix only as a starting point, then bind
send_message() to the project's real live-account/message sending method.

Enable it with:
    ZAOYOE_BRIDGE_CHAT_SENDER=zaoyoe_sender_example:send_message
"""

from typing import Any, Dict


async def send_message(payload: Dict[str, Any]) -> Dict[str, Any]:
    content = str(payload.get("content") or "").strip()
    order = payload.get("order") or {}
    buyer_id = str(payload.get("buyer_id") or order.get("buyerId") or "").strip()
    order_id = str(payload.get("external_order_id") or order.get("orderId") or "").strip()

    if not content:
        return {
            "success": False,
            "message": "content is required",
        }

    # TODO:
    # Replace this block with xianyu-auto-reply-fix's real message sender.
    # The ideal implementation should:
    # 1. Locate the active account/session by order["cookie_id"] or buyer_id.
    # 2. Send `content` to the buyer's chat.
    # 3. Return {"success": True}.
    #
    # Keeping this as an explicit exception is safer than silently pretending
    # that the delivery message was sent.
    raise NotImplementedError(
        f"Bind zaoyoe_sender_example.send_message to the real Xianyu sender first. "
        f"order_id={order_id}, buyer_id={buyer_id}"
    )