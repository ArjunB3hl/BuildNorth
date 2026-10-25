# Unified Calendar

Calendar replaces the Meals and Activity tabs on iPhone/Android and the website sidebar. Recipes and workout routines are still available from the two library buttons inside Calendar. Their existing `/meals/*` and `/activity/*` URLs are preserved by a pathless Expo Router `(calendar)` group. The camera coach remains web-only.

The month/week grid and selected-day timeline combine:

- Saved activity sessions, including camera recordings after **Finish and save**, using their original start time.
- Completed planned meals, using their completion timestamp (labelled **logged**).
- Apple Watch HealthKit workout uploads, using measured start time.
- Meals/workouts explicitly reported as completed in Coach. The existing structured model response extracts date, time, duration and a verbatim evidence clause. Suggestions, future plans, questions, negations, and events unsupported by the current message do not become entries. The server additionally checks evidence, bounds, dates and timezone. Titles cannot substitute a food absent from the evidence; numeric times and durations must appear in the report. Unstated dates mean today. This conservative English completion gate can miss informal phrasing; manual logging is always available.
- Manual entries, and guided cooking's explicit **Ate this · log meal** action. Finishing cooking without logging does not claim the user ate it.

When Coach has no stated time, the entry shows **Time not specified** and can be corrected. Its internal ordering time is approximate; editing only the title preserves that flag. The UI only confirms a calendar save after the server commits it. Calendar logging does not save suggested recipes/routines or change preferences. Clearing chat leaves journal entries intact.

## Storage and auth

Migration `0010` adds `calendar_entries`. UTC timestamps are converted/filtered in the caller's IANA timezone; calendar days handle daylight saving. The API derives ownership from the signed-in Clerk account and rejects client `userId` fields. Account data deletion includes the new table. Watch tokens can only read their owner's `/watch/calendar`; revocation still applies.

`GET /calendar?start=YYYY-MM-DD&days=42&timezone=America/Toronto` returns a combined feed. `POST /calendar` takes `kind`, `title`, `occurredAt`, optional `durationMinutes`/`notes`, and a caller-generated `clientKey`. Repeating a key does not create another journal entry. `PUT /calendar/{id}` and `DELETE /calendar/{id}` change only owned journal entries. Projected sessions, plans and Watch workouts remain authoritative in their source records.

Coach requests carry a stable client key through retries. Journal entries use that key plus their position, so a retry after a lost response does not duplicate them. The pre-existing Coach chat endpoint itself is not a deduplicated conversation API.

## Demo

**Load demo week** creates a reproducible, explicitly labelled sample week only for the currently signed-in account. There are no production account IDs in source and no automatic seeding for all users. Repeating the seed is idempotent; **Remove demo entries** removes only demo rows. Demo entries do not contribute to daily logged totals.

Mac stays offline in demo mode. Its calendar uses locally persisted sample entries, with month navigation, category filters, editing and manual logging. Marking a local plan item done also adds a timestamped demo entry. No sign-in or network sync is added. Older local stores receive the calendar sample field without losing saved app data.

The Watch gains a compact day timeline and previous/next-day navigation from Today. It reads the same authenticated backend and clears loaded entries on unlink.

## Verification

- Backend: `cd backend && .venv/bin/python -m pytest -q` (or use an existing environment with backend requirements installed).
- Website/phone: `npm run typecheck && npm run lint`; `node scripts/check-calendar.cjs` checks date rollover, DST and input validation.
- Watch: `bash scripts/check-watch-models.sh` checks JSON contracts and typechecks the target when the watchOS SDK is installed.
- Mac: `npx tsc --noEmit && npm test -- --runInBand && npm run lint` from `mac/`.

Local review uses the isolated checkout's backend on port 8001 and website on 8083. Its database is an isolated snapshot of the existing local database, so demo/UI testing does not modify the original running backend's data. Point a phone development build's `EXPO_PUBLIC_API_URL` to this backend (using the Mac's LAN address and a suitable development bind) to test the same account across devices; localhost on a physical phone points to the phone. This preview has not been deployed.
