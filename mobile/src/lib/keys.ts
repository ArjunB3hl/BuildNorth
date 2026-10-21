/** Random alphanumeric key for idempotent requests (proposal accepts, plan adds, change sets). */
export function newKey(length = 20): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = Date.now().toString(36);
  while (key.length < length) key += alphabet[Math.floor(Math.random() * alphabet.length)];
  return key.slice(0, Math.max(length, 8));
}
