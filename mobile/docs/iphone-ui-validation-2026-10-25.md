# iPhone simulator validation — 25 October 2026

Tested the native app in Device Hub on iPhone 17 / iOS 26.5, using the installed
development binary with JavaScript from the current integration plus the startup
fix in this change. Metro ran on port 8084 and the isolated preview API on 8001.
The phone kept its existing signed-in test account.

## Fixed startup failure

The root layout rendered `expo-router/head` on iOS. Its native Handoff integration
threw an error because no hosted origin was configured, preventing the app from
opening. Page title and description metadata now render only on web. The native
app opened normally after the fix; no native rebuild was needed for this change.

## Observed results

- Today and Profile opened, with Rhythm branding and the demo label.
- Calendar opened in week view and switched to month view without an error.
- The Sleep filter showed only the selected day's Watch sleep entry and changed
  the date-cell counts accordingly.
- Existing Watch simulator samples appeared after the normal refresh: two sleep
  nights and two workout entries, including average workout heart rate.
- The monthly report expanded successfully, showed two Watch workouts / 2.9
  minutes, and used the one completed night for its 6 h 45 min sleep average.
  Today's partial 6 h 25 min night remained visible separately.
- Missing sleep stages/timing were described as unavailable rather than filled
  with invented values. Missing daily health readings remained "Not recorded."
- Coach showed the connection gate for the unlinked account. Its setup button
  opened AI connections, where the Claude and ElevenLabs forms were reachable,
  the API-key fields were secure inputs, and empty submissions were disabled.
- Apple Watch settings detected the paired companion and left health sharing off.
- Inspected Calendar, report, connection forms and native navigation visually;
  no clipped controls or horizontal overflow were observed on this simulator.

## Data and limits

The preview initially had no Watch data. Copied only the two existing health rows
from the previous Watch simulator test into the isolated preview database, using
a read-only connection to the original database. No credentials or Watch tokens
were copied, and the original database and Watch connection were unchanged.
These are simulator samples, not real health measurements.

The installed Watch binary was not rebuilt during this iPhone check. Its older
uploads do not contain the new sleep stages or min/max heart-rate fields, so this
run verifies their missing-data behavior, not a fresh upload of those fields.
Physical sensors, a paid AI conversation, new API-key verification, native release
builds, and a fresh Watch sign-in were not exercised. Camera remains website-only.

`npm run typecheck`, `npm run lint`, iOS Metro bundling and `git diff --check`
passed. The only app runtime warning observed after startup was Clerk's expected
development-key notice.
