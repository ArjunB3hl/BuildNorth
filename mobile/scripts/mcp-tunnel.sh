#!/bin/sh
# Development only: give the local backend a public HTTPS address so ChatGPT and Claude can reach /mcp.
# Anyone can then reach the backend's address, but every app route and /mcp still require sign-in.
#
# One-time setup (needs your ngrok account):
#   ngrok config add-authtoken <your-ngrok-authtoken>
#   Claim your free static domain in the ngrok dashboard (Domains), e.g. your-name.ngrok-free.app
#
# Usage:  scripts/mcp-tunnel.sh your-name.ngrok-free.app   (or no argument for a temporary URL)
# Then set MCP_PUBLIC_URL=https://your-name.ngrok-free.app/mcp in backend/.env and restart the backend.
# A static domain matters: the MCP_PUBLIC_URL must equal the URL entered in ChatGPT/Claude exactly.
set -e
PORT="${PORT:-8000}"
if [ -z "$1" ]; then
  echo "No static domain given: ngrok assigns a temporary URL that changes every run."
  echo "Read it at http://127.0.0.1:4040 and set MCP_PUBLIC_URL=https://<that-host>/mcp in backend/.env."
  exec ngrok http "$PORT"
fi
echo "Tunnel: https://$1 -> http://localhost:$PORT"
echo "MCP URL for ChatGPT/Claude: https://$1/mcp  (backend/.env must have MCP_PUBLIC_URL=https://$1/mcp)"
exec ngrok http "$PORT" --url "https://$1"
