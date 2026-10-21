type MaybeClerkError = {
  message?: string;
  longMessage?: string;
  errors?: { message?: string; longMessage?: string }[];
};

/** Turns Clerk, API and network errors into a single user-facing sentence. */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as MaybeClerkError;
    const first = e.errors?.[0];
    const message = first?.longMessage ?? first?.message ?? e.longMessage ?? e.message;
    if (message) return message;
  }
  return 'Something went wrong. Please try again.';
}
