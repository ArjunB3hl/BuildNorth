// Random version-4 UUIDs. Hermes has no crypto.randomUUID and expo-crypto has no Windows
// implementation; these only name items in the local sample store, so Math.random is enough.
export function randomUUID(): string {
  const hex = (min: number, max: number) =>
    (min + Math.floor(Math.random() * (max - min))).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c =>
    // The variant digit (y) is 8, 9, a or b.
    c === 'x' ? hex(0, 16) : hex(8, 12),
  );
}
