"""Export the actual registered MCP schemas without starting a server or opening a database."""

import argparse
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from app.config import load_settings
from app.rhythm.mcp import build
from app.rhythm.config import RhythmSettings

NAMES = {
    "connect_rhythm", "get_interests", "get_selected_page", "create_video_task", "list_video_tasks",
    "get_task_status", "add_selected_video", "shortlist_videos", "get_video_transcript", "search_videos",
    "show_recommendations", "remember_interest", "record_feedback", "request_forget",
}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    settings = load_settings()
    server, _ = build(SimpleNamespace(state=SimpleNamespace()), settings, None, RhythmSettings.load())
    tools = await server.list_tools()
    exported = [tool.model_dump(mode="json", by_alias=True, exclude_none=True) for tool in tools if tool.name in NAMES]
    assert {tool["name"] for tool in exported} == NAMES
    args.output.write_text(json.dumps({"tools": exported}, indent=2) + "\n")
    print(f"Exported {len(exported)} registered tool schemas to {args.output}")


if __name__ == "__main__":
    asyncio.run(main())
