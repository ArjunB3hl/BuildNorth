"""Throwaway stdio MCP server with one tool, speak_reply: Claude gives the voice coach's answer by calling it, and the
helper reads the answer from Claude Code's output. It exposes nothing else (no files, no Rhythm data, no network) and
keeps nothing. Started by Claude Code for a single turn (claude_mcp.py)."""
import json
import sys

MAX_REPLY = 600


def write(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle(message):
    method, ident = message.get("method"), message.get("id")
    if ident is None:
        return None                                       # a notification (initialized, cancelled): nothing to answer
    if method == "initialize":
        return {"protocolVersion": message.get("params", {}).get("protocolVersion", "2025-03-26"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "rhythm-voice", "version": "1.0"}}
    if method == "tools/list":
        return {"tools": [{"name": "speak_reply", "description": "Give Rhythm's voice coach the short reply to speak.",
                           "inputSchema": {"type": "object",
                                           "properties": {"text": {"type": "string", "maxLength": MAX_REPLY}},
                                           "required": ["text"], "additionalProperties": False}}]}
    if method == "tools/call" and message.get("params", {}).get("name") == "speak_reply":
        text = message["params"].get("arguments", {}).get("text")
        ok = isinstance(text, str) and 0 < len(text) <= MAX_REPLY
        return {"content": [{"type": "text", "text": "Reply delivered." if ok else "Invalid reply."}], "isError": not ok}
    if method == "ping":
        return {}
    raise LookupError(method)


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                continue
            try:
                result = handle(message)
            except LookupError:
                write({"jsonrpc": "2.0", "id": message.get("id"),
                       "error": {"code": -32601, "message": "Method not found"}})
                continue
            if result is not None:
                write({"jsonrpc": "2.0", "id": message["id"], "result": result})
        except (ValueError, TypeError, KeyError):
            continue


if __name__ == "__main__":
    main()
