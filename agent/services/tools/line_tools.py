"""LINE Messaging API agent tools."""

import json
import httpx
from pydantic import BaseModel, Field

from agent_framework import tool


def _get_session_meta(kwargs: dict) -> dict:
    session = kwargs.get("session")
    if session and hasattr(session, "metadata") and session.metadata:
        return session.metadata
    return {}


def _get_session(kwargs: dict):
    return kwargs.get("session")


async def save_line_message(
    session,
    team_id: str,
    line_user_id: str,
    content: str,
    message_type: str = "text",
    display_name: str = "",
) -> None:
    await session.repositories.line_messages.save_line_message(
        team_id=team_id,
        line_user_id=line_user_id,
        content=content,
        message_type=message_type,
        display_name=display_name,
    )


class SendLineMessageInput(BaseModel):
    recipient_id: str = Field(description="LINE user ID to send message to")
    message: str = Field(description="Text message to send")


@tool(
    name="send_line_message",
    description="Send a text message to a LINE user via LINE Messaging API",
    schema=SendLineMessageInput,
    max_invocations=10,
)
async def send_line_message_tool(recipient_id: str, message: str, **kwargs) -> str:
    session = _get_session(kwargs)
    meta = _get_session_meta(kwargs)
    token = meta.get("line_channel_access_token", "")
    team_id = meta.get("team_id", "")
    if not token:
        return "Error: LINE channel access token not configured for this team"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/push",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "to": recipient_id,
                    "messages": [{"type": "text", "text": message}],
                },
            )
        if resp.status_code == 200:
            # Log the bot's reply in the line_messages history
            if team_id and session:
                try:
                    await save_line_message(
                        session=session,
                        team_id=team_id,
                        line_user_id=recipient_id,
                        content=message,
                        display_name="[BOT REPLY]",
                    )
                except Exception as db_exc:
                    print(f"Warning: Failed to log bot reply to DB: {db_exc}")
            return f"Message sent successfully to {recipient_id}"
        return f"Error sending message: {resp.status_code} {resp.text}"
    except Exception as exc:
        return f"Error sending LINE message: {exc}"


class ReadLineMessagesInput(BaseModel):
    limit: int = Field(default=10, description="Number of recent messages to fetch (max 50)")
    line_user_id: str = Field(default="", description="Filter history to a specific LINE user ID. Pass the user ID from the current message to get that user's conversation thread.")


@tool(
    name="read_line_messages",
    description="Read recent LINE messages received by this team's LINE bot. Pass line_user_id to get the conversation history for a specific user.",
    schema=ReadLineMessagesInput,
    max_invocations=5,
)
async def read_line_messages_tool(limit: int = 10, line_user_id: str = "", **kwargs) -> str:
    session = _get_session(kwargs)
    meta = _get_session_meta(kwargs)
    team_id = meta.get("team_id", "")
    if not team_id:
        return "Error: team_id not configured for this session"
    if not session:
        return "Error: session not available"

    limit = min(max(1, limit), 50)
    user_filter = line_user_id.strip() or None

    try:
        messages = await session.repositories.line_messages.get_line_messages_by_team(
            team_id,
            limit,
            line_user_id=user_filter,
        )
        if not messages:
            return "No LINE messages found"

        lines = []
        for msg in messages:
            user_id = msg.get("line_user_id", "unknown")
            user_name = msg.get("display_name", "")
            content = msg.get("content", "")
            msg_type = msg.get("message_type", "text")
            received = msg.get("received_at", "")
            
            identifier = f"{user_name} ({user_id})" if user_name else user_id
            lines.append(f"[{received}] {identifier} ({msg_type}): {content}")

        return "\n".join(lines)
    except Exception as exc:
        return f"Error reading LINE messages from DB: {exc}"


class SendLineImageInput(BaseModel):
    recipient_id: str = Field(description="LINE user ID to send image to")
    image_url: str = Field(description="Public URL of the image to send")
    preview_url: str = Field(default="", description="Preview image URL shown in chat list (defaults to image_url)")


@tool(
    name="send_line_image",
    description="Send an image to a LINE user via LINE Messaging API",
    schema=SendLineImageInput,
    max_invocations=10,
)
async def send_line_image_tool(recipient_id: str, image_url: str, preview_url: str = "", **kwargs) -> str:
    session = _get_session(kwargs)
    meta = _get_session_meta(kwargs)
    token = meta.get("line_channel_access_token", "")
    team_id = meta.get("team_id", "")
    if not token:
        return "Error: LINE channel access token not configured for this team"

    effective_preview = preview_url.strip() or image_url
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/push",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "to": recipient_id,
                    "messages": [{
                        "type": "image",
                        "originalContentUrl": image_url,
                        "previewImageUrl": effective_preview,
                    }],
                },
            )
        if resp.status_code == 200:
            if team_id and session:
                try:
                    await save_line_message(
                        session=session,
                        team_id=team_id,
                        line_user_id=recipient_id,
                        content=image_url,
                        message_type="image",
                        display_name="[BOT REPLY]",
                    )
                except Exception as db_exc:
                    print(f"Warning: Failed to log bot image reply to DB: {db_exc}")
            return f"Image sent successfully to {recipient_id}"
        return f"Error sending image: {resp.status_code} {resp.text}"
    except Exception as exc:
        return f"Error sending LINE image: {exc}"


class BroadcastLineMessageInput(BaseModel):
    message: str = Field(description="Text message to broadcast to all LINE bot followers")


@tool(
    name="broadcast_line_message",
    description="Broadcast a text message to all followers of this team's LINE bot",
    schema=BroadcastLineMessageInput,
    max_invocations=5,
)
async def broadcast_line_message_tool(message: str, **kwargs) -> str:
    session = _get_session(kwargs)
    meta = _get_session_meta(kwargs)
    token = meta.get("line_channel_access_token", "")
    team_id = meta.get("team_id", "")
    if not token:
        return "Error: LINE channel access token not configured for this team"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/broadcast",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"messages": [{"type": "text", "text": message}]},
            )
        if resp.status_code == 200:
            if team_id and session:
                try:
                    await save_line_message(
                        session=session,
                        team_id=team_id,
                        line_user_id="__broadcast__",
                        content=message,
                        message_type="text",
                        display_name="[BOT BROADCAST]",
                    )
                except Exception as db_exc:
                    print(f"Warning: Failed to log broadcast to DB: {db_exc}")
            return "Message broadcast successfully to all followers"
        return f"Error broadcasting message: {resp.status_code} {resp.text}"
    except Exception as exc:
        return f"Error broadcasting LINE message: {exc}"


class SendLineFlexMessageInput(BaseModel):
    recipient_id: str = Field(description="LINE user ID to send flex message to")
    alt_text: str = Field(description="Alternative text shown in notifications and older LINE clients")
    flex_content: dict = Field(description="Full LINE Flex Message container JSON object")


@tool(
    name="send_line_flex_message",
    description="Send a raw LINE Flex Message to a specific user. Provide the complete flex container JSON in flex_content.",
    schema=SendLineFlexMessageInput,
    max_invocations=10,
)
async def send_line_flex_message_tool(recipient_id: str, alt_text: str, flex_content: dict, **kwargs) -> str:
    session = _get_session(kwargs)
    meta = _get_session_meta(kwargs)
    token = meta.get("line_channel_access_token", "")
    team_id = meta.get("team_id", "")
    if not token:
        return "Error: LINE channel access token not configured for this team"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/push",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "to": recipient_id,
                    "messages": [{
                        "type": "flex",
                        "altText": alt_text,
                        "contents": flex_content,
                    }],
                },
            )
        if resp.status_code == 200:
            if team_id and session:
                try:
                    await save_line_message(
                        session=session,
                        team_id=team_id,
                        line_user_id=recipient_id,
                        content=json.dumps(flex_content)[:500],
                        message_type="flex",
                        display_name="[BOT REPLY]",
                    )
                except Exception as db_exc:
                    print(f"Warning: Failed to log flex message to DB: {db_exc}")
            return f"Flex message sent successfully to {recipient_id}"
        return f"Error sending flex message: {resp.status_code} {resp.text}"
    except Exception as exc:
        return f"Error sending LINE flex message: {exc}"
