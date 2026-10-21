// Consent copy for Apple Watch health sharing: who receives the summaries while it's on. No imports, so
// src/lib/health-sharing.test.mjs can run it under plain Node.

/** The Coach's AI, named from GET /status `aiProvider` (undefined while it loads or when it can't be reached). */
export function coachAiService(aiProvider: string | undefined): string {
  switch (aiProvider) {
    case 'openai':
      return "the Coach's AI service (OpenAI)";
    case 'anthropic':
      return "the Coach's AI service (Anthropic)";
    case 'ollama':
      return "the Coach's AI, which runs on BuildNorth's own server";
    default:
      return "the Coach's AI service (possibly a third party such as OpenAI or Anthropic)";
  }
}

/** Where summaries go while sharing is on; each line completes "your daily summaries, including today so far, are…". */
export function sharingRecipients(aiProvider: string | undefined): string[] {
  return [
    `sent to ${coachAiService(aiProvider)}`,
    "stored in BuildNorth's long-term memory service (hosted by SurrealDB Cloud) once each day is over",
    'readable by AI assistants you connect, such as ChatGPT or Claude',
  ];
}

export const SHARING_OFF =
  "When off, none of them see your summaries, and anything already in BuildNorth's memory is erased. Summaries are still stored in BuildNorth and shown here and on your watch.";

/** The confirmation shown before sharing is turned on. */
export function shareConfirmation(aiProvider: string | undefined): string {
  const [coach, memory, assistants] = sharingRecipients(aiProvider);
  return (
    'Your daily Apple Watch summaries (sleep, resting heart rate, HRV, steps, active energy and workouts), including ' +
    `today so far, will be ${coach}; ${memory}; and ${assistants}.\n\n` +
    "You can turn this off at any time; that erases them from BuildNorth's memory."
  );
}
