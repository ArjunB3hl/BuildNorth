// Expo CLI inlines process.env.EXPO_PUBLIC_* at bundle time (src/config.ts); Node's types aren't in this project.
declare const process: { env: Record<string, string | undefined> };
