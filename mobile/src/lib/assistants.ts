/** A readable name for the assistant connection the backend records (an OAuth client ID or a named connection token). */
export function assistantName(client: string | null | undefined): string {
  if (!client) return 'an AI assistant';
  const token = client.match(/^Connection token “(.+)”$/);
  if (token) return token[1];
  if (/https:\/\/(claude\.ai|claude\.com)\//.test(client)) return 'Claude';
  if (/https:\/\/chatgpt\.com\//.test(client)) return 'ChatGPT';
  return client.replace(/^OAuth client /, '');
}
