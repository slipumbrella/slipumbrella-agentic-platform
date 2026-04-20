"""Image generation tool using OpenRouter AI models."""

import base64
import json
import logging
import uuid

import boto3
import httpx
from pydantic import BaseModel, Field

from agent.configs.settings import settings
from agent.services.tools.artifact_context import resolve_artifact_context, save_image_artifact
from agent_framework import tool

save_r2_image_artifact = save_image_artifact

logger = logging.getLogger(__name__)

_IMAGE_MODEL = "bytedance-seed/seedream-4.5"


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


class GenerateImageInput(BaseModel):
    prompt: str = Field(description="Text prompt describing the image to generate")
    width: int = Field(default=1024, description="Image width in pixels")
    height: int = Field(default=1024, description="Image height in pixels")


@tool(
    name="generate_image",
    description=(
        "Generate an image from a text prompt using AI. "
        "Stores the image in cloud storage and saves it as a team artifact. "
        "After generating, include `![Generated Image]({url})` in your response "
        "to display the image inline in the chat."
    ),
    schema=GenerateImageInput,
    max_invocations=5,
)
async def generate_image_tool(prompt: str, width: int = 1024, height: int = 1024, **kwargs) -> str:
    session = kwargs.get("session")
    context = await resolve_artifact_context(session)
    if context is None:
        return "Error: team_id could not be resolved for this session"
    team_id = context.team_id

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{settings.OPENROUTER_BASE_URL}/images/generations",
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _IMAGE_MODEL,
                    "prompt": prompt,
                    "n": 1,
                    "size": f"{width}x{height}",
                    "response_format": "b64_json",
                },
            )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        return f"Error calling image generation API: {exc}"

    try:
        image_data = data["data"][0]
        if "b64_json" in image_data:
            image_bytes = base64.b64decode(image_data["b64_json"])
        elif "url" in image_data:
            async with httpx.AsyncClient(timeout=30.0) as client:
                dl = await client.get(image_data["url"])
                dl.raise_for_status()
                image_bytes = dl.content
        else:
            return "Error: unexpected image response format from API"
    except Exception as exc:
        return f"Error extracting image data: {exc}"

    key = f"generated-images/{team_id}/{uuid.uuid4()}.png"
    try:
        s3 = _r2_client()
        s3.put_object(
            Bucket=settings.R2_BUCKET,
            Key=key,
            Body=image_bytes,
            ContentType="image/png",
            ACL="public-read",
        )
    except Exception as exc:
        return f"Error uploading image to storage: {exc}"

    public_url = f"{settings.R2_PUBLIC_URL.rstrip('/')}/{key}"
    try:
        artifact_id = await save_r2_image_artifact(
            session,
            key=key,
            title=prompt[:100],
            public_url=public_url,
            tool_name="generate_image",
        )
    except Exception as exc:
        logger.warning("generate_image: artifact save failed: %s", exc)
        artifact_id = ""

    return json.dumps({
        "url": public_url,
        "artifact_id": artifact_id,
        "markdown": f"![Generated Image]({public_url})",
    })
