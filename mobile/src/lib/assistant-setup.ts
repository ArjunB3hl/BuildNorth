/** A reachability hint, never a claim that a remote service has actually connected. */
export function isPublicConnectorUrl(value: string): boolean {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && host.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
      && !/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}

export function secretTransportAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export const ASSISTANT_SETUP = [
  {
    name: 'ChatGPT', url: 'https://chatgpt.com/plugins', action: 'Open ChatGPT setup',
    steps: 'Open Plugins → + → Add custom MCP server. Name it BuildNorth, paste the address, and select OAuth. Create and install it, sign in with your BuildNorth account, then select BuildNorth in a new chat.',
  },
  {
    name: 'Claude', url: 'https://claude.ai/customize/connectors', action: 'Open Claude connectors',
    steps: 'Open Customize → Connectors → Add → Custom → Web. Name it BuildNorth and paste the address. Use Sign in now and Claude’s published identity, then sign in with your BuildNorth account. Enable BuildNorth in your conversation.',
  },
] as const;
