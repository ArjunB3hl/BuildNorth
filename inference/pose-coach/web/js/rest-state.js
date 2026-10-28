// A pause after a counted rep is a possible rest, even before the tracker closes the set.
// The camera cannot infer the user's intention from a missing pose, so avoid treating that as a request for advice.
export const REST_PAUSE_MS = 3000;

export function isResting(auto, t) {
  if (!auto) return false;
  const active = auto.active;
  if (!active) return (auto.sets?.length ?? 0) > 0;
  return !!active.asking || (Number.isFinite(t) && Number.isFinite(active.lastRepT) && t - active.lastRepT >= REST_PAUSE_MS);
}
