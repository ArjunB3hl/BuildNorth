"""Run one isolated Claude Code turn with the local speech reply MCP tool."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def is_logged_in():
    cli = shutil.which('claude') or str(Path.home() / '.local/bin/claude')
    if not Path(cli).is_file():
        return False
    env = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDECODE')}
    env['PATH'] = str(Path(cli).parent) + os.pathsep + env.get('PATH', '')
    try:
        result = subprocess.run([cli, 'auth', 'status', '--json'], text=True, capture_output=True, env=env, timeout=8)
        status = json.loads(result.stdout)
        return result.returncode == 0 and status.get('loggedIn') is True and status.get('authMethod') == 'claude.ai'
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return False


def reply(text):
    if not isinstance(text, str) or not 0 < len(text) <= 4000:
        raise ValueError('Invalid transcript')
    cli = shutil.which('claude') or str(Path.home() / '.local/bin/claude')
    if not Path(cli).is_file():
        raise RuntimeError('Claude Code is not installed')
    env = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDECODE')}
    env['PATH'] = str(Path(cli).parent) + os.pathsep + env.get('PATH', '')
    with tempfile.TemporaryDirectory(prefix='rhythm-voice-') as tmp:
        config = Path(tmp) / 'mcp.json'
        config.write_text(json.dumps({'mcpServers': {'rhythm_voice': {'command': sys.executable, 'args': [str(Path(__file__).with_name('reply_mcp.py'))]}}}))
        cmd = [cli, '-p', '--model', 'haiku', '--tools', '', '--allowedTools', 'mcp__rhythm_voice__speak_reply',
               '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', str(config),
               '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
               '--output-format', 'stream-json', '--verbose',
               '--system-prompt', 'You are Rhythm, a friendly health coach. Respond concisely to the user. Call the speak_reply tool exactly once with your answer. Do not call other tools.']
        try:
            result = subprocess.run(cmd, input=text, text=True, capture_output=True, cwd=tmp, env=env, timeout=100)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Claude Code took too long to respond.') from None
    if result.returncode:
        raise RuntimeError('Claude Code could not respond. Check your Claude Code sign-in and usage limits.')
    calls = {}
    succeeded = set()
    for line in result.stdout.splitlines():
        try:
            event = json.loads(line)
            for item in event.get('message', {}).get('content', []):
                if item.get('type') == 'tool_use' and item.get('name') == 'mcp__rhythm_voice__speak_reply':
                    answer, identifier = item.get('input', {}).get('text'), item.get('id')
                    if isinstance(answer, str) and 0 < len(answer) <= 600 and isinstance(identifier, str):
                        calls[identifier] = answer
                elif item.get('type') == 'tool_result' and not item.get('is_error'):
                    succeeded.add(item.get('tool_use_id'))
        except (ValueError, TypeError, AttributeError):
            continue
    for identifier, answer in calls.items():
        if identifier in succeeded:
            return answer
    raise RuntimeError('Claude did not complete the local voice MCP tool.')
