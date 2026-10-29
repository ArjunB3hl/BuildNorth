"""Ephemeral stdio MCP tool: Claude returns one voice reply; no other tools."""
import json
import sys


def write(obj):
    print(json.dumps(obj, separators=(',', ':')), flush=True)


for line in sys.stdin:
    try:
        message = json.loads(line)
        method, ident = message.get('method'), message.get('id')
        if ident is None:
            continue
        if method == 'initialize':
            result = {'protocolVersion': message.get('params', {}).get('protocolVersion', '2025-03-26'),
                      'capabilities': {'tools': {}}, 'serverInfo': {'name': 'rhythm-voice', 'version': '1.0'}}
        elif method == 'tools/list':
            result = {'tools': [{'name': 'speak_reply', 'description': 'Return the short reply to Rhythm voice coach.',
                                 'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string', 'maxLength': 600}},
                                                 'required': ['text'], 'additionalProperties': False}}]}
        elif method == 'tools/call' and message.get('params', {}).get('name') == 'speak_reply':
            text = message['params'].get('arguments', {}).get('text')
            result = {'content': [{'type': 'text', 'text': 'Reply delivered.'}], 'isError': False} if isinstance(text, str) and 0 < len(text) <= 600 else {'content': [{'type': 'text', 'text': 'Invalid reply.'}], 'isError': True}
        elif method == 'ping':
            result = {}
        else:
            write({'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32601, 'message': 'Method not found'}})
            continue
        write({'jsonrpc': '2.0', 'id': ident, 'result': result})
    except (ValueError, TypeError, KeyError):
        continue
