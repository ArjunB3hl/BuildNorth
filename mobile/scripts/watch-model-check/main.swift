// Checks for the watch app's Foundation-only sources (targets/watch). Built and run on a Mac by
// scripts/check-watch-models.sh; not part of the watch target. Exits non-zero when any check fails.
import Foundation

var checks = 0
var failures = 0

func check(_ condition: @autoclosure () -> Bool, _ message: String, line: UInt = #line) {
  checks += 1
  if !condition() {
    failures += 1
    print("  FAIL (main.swift:\(line)) \(message)")
  }
}

func section(_ name: String, _ body: () throws -> Void) {
  print(name)
  do {
    try body()
  } catch {
    failures += 1
    print("  FAIL threw \(error)")
  }
}

/// The JSON object `value` encodes to, parsed back with JSONSerialization (so nulls are NSNull, not missing).
func object(_ value: some Encodable) throws -> [String: Any] {
  let data = try JSONEncoder().encode(value)
  guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    throw NSError(domain: "check", code: 1, userInfo: [NSLocalizedDescriptionKey: "not a JSON object"])
  }
  return object
}

func parse(_ json: String) throws -> [String: Any] {
  guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
    throw NSError(domain: "check", code: 2, userInfo: [NSLocalizedDescriptionKey: "not a JSON object"])
  }
  return object
}

func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
  try JSONDecoder().decode(type, from: Data(json.utf8))
}

func isNull(_ value: Any?) -> Bool { value is NSNull }

func isJSONBool(_ value: Any?) -> Bool {
  guard let number = value as? NSNumber else { return false }
  return CFGetTypeID(number) == CFBooleanGetTypeID()
}

func same(_ a: [String: Any], _ b: [String: Any]) -> Bool {
  NSDictionary(dictionary: a).isEqual(to: b)
}

// MARK: - Request bodies (contract §2: input models are extra="forbid", missing metrics are null, never 0)

let healthDayKeys: Set<String> = [
  "sleepMinutes", "restingHeartRateBpm", "hrvSdnnMs", "steps", "activeEnergyKcal", "workouts", "complete",
]
let workoutKeys: Set<String> = [
  "externalId", "activityType", "startedAt", "durationMinutes", "energyKcal", "distanceMeters",
  "averageHeartRateBpm",
]

section("HealthDayIn / HealthWorkout encode the exact contract keys with explicit nulls") {
  let empty = try object(HealthDayIn(workouts: [], complete: false))
  check(Set(empty.keys) == healthDayKeys, "HealthDayIn keys: \(empty.keys.sorted())")
  for key in ["sleepMinutes", "restingHeartRateBpm", "hrvSdnnMs", "steps", "activeEnergyKcal"] {
    check(isNull(empty[key]), "\(key) nil must encode as null, got \(String(describing: empty[key]))")
  }
  check((empty["workouts"] as? [Any])?.isEmpty == true, "no workouts must encode as []")
  check(isJSONBool(empty["complete"]) && empty["complete"] as? Bool == false, "complete must be the JSON boolean false")

  let bare = HealthWorkout(
    externalId: "6F1C2B9E-0D3A-4E57-9C11-2B7A5D8E4F10", activityType: "traditional_strength_training",
    startedAt: "2026-10-20T18:05:00Z", durationMinutes: 45, energyKcal: nil, distanceMeters: nil,
    averageHeartRateBpm: nil)
  let workout = try object(bare)
  check(Set(workout.keys) == workoutKeys, "HealthWorkout keys: \(workout.keys.sorted())")
  for key in ["energyKcal", "distanceMeters", "averageHeartRateBpm"] {
    check(isNull(workout[key]), "workout \(key) nil must encode as null")
  }
  check(workout["durationMinutes"] as? Double == 45, "durationMinutes")

  // The spec's example body, field for field.
  let spec = try parse(
    """
    {"sleepMinutes": 412, "restingHeartRateBpm": 58, "hrvSdnnMs": 42.5, "steps": 8412, "activeEnergyKcal": 510.2,
     "workouts": [{"externalId": "HK-UUID", "activityType": "running", "startedAt": "2026-10-20T07:12:00Z",
                   "durationMinutes": 32.0, "energyKcal": 310.0, "distanceMeters": 5100.0, "averageHeartRateBpm": 148.0}],
     "complete": true}
    """)
  let day = HealthDayIn(
    sleepMinutes: 412, restingHeartRateBpm: 58, hrvSdnnMs: 42.5, steps: 8412, activeEnergyKcal: 510.2,
    workouts: [
      HealthWorkout(
        externalId: "HK-UUID", activityType: "running", startedAt: "2026-10-20T07:12:00Z", durationMinutes: 32,
        energyKcal: 310, distanceMeters: 5100, averageHeartRateBpm: 148)
    ],
    complete: true)
  let encoded = try object(day)
  check(same(encoded, spec), "spec example body differs: \(encoded)")
  check(isJSONBool(encoded["complete"]), "complete must be a JSON boolean")
  check(Set((encoded["workouts"] as? [[String: Any]])?.first.map { Array($0.keys) } ?? []) == workoutKeys, "workout keys")
  check(!day.isEmpty && HealthDayIn(workouts: [], complete: true).isEmpty, "isEmpty")
  check(!HealthDayIn(steps: 0, workouts: [], complete: false).isEmpty, "a measured 0 is data, not empty")
}

section("CheckInPatch leaves sleepHours out, sends a value or an explicit null, never note; PlanStatusPatch") {
  let kept = try object(CheckInPatch(energy: 4, mood: 3, sleep: .keep))
  check(same(kept, ["energy": 4, "mood": 3]), "keep must leave sleepHours out (the stored value stays): \(kept)")
  let cleared = try object(CheckInPatch(energy: 4, mood: 3, sleep: .clear))
  check(Set(cleared.keys) == ["energy", "mood", "sleepHours"], "CheckInPatch keys: \(cleared.keys.sorted())")
  check(isNull(cleared["sleepHours"]), "clear must encode sleepHours as null (clears the stored value)")
  check(kept["note"] == nil && cleared["note"] == nil, "CheckInPatch must never encode note")
  check(cleared["energy"] as? Int == 4 && cleared["mood"] as? Int == 3, "energy/mood values")

  let slept = try object(CheckInPatch(energy: 5, mood: 2, sleep: .hours(7.5)))
  let expected = try parse(#"{"energy":5,"mood":2,"sleepHours":7.5}"#)
  check(same(slept, expected), "CheckInPatch with sleep: \(slept)")

  for status in [PlanStatus.planned, .done, .skipped] {
    let body = try object(PlanStatusPatch(status: status))
    check(same(body, ["status": status.rawValue]), "PlanStatusPatch \(status): \(body)")
  }
}

// MARK: - Check-in form (CheckInDraft: the health-sharing gate and what the sleep page sends)

section("CheckInDraft: HealthKit sleep is pre-filled only while health sharing is on") {
  let date = "2026-10-21"
  func today(checkIn: String = "null", share: Bool) throws -> WatchToday {
    try decode(
      WatchToday.self,
      #"{"date":"2026-10-21","items":[],"checkIn":\#(checkIn),"health":null,"shareHealth":\#(share)}"#)
  }

  var off = CheckInDraft(today: try today(share: false), date: date)
  check(!off.shareHealth && !off.wantsHealthSleep, "sharing off: HealthKit is not asked")
  off.prefillSleep(fromHealth: 6.9)
  check(!off.recordSleep && off.sleepSource == .none, "sharing off: HealthKit sleep is never pre-filled")
  check(off.sleepChange == .keep, "sharing off, nothing saved: sleepHours left out")
  off.setRecordSleep(true)
  off.sleep = 6.5
  check(off.sleepChange == .hours(6.5), "sharing off: the user can still enter sleep")
  check(CheckInDraft(today: nil, date: date).wantsHealthSleep == false, "no Today yet: sharing unknown, so off")

  var on = CheckInDraft(today: try today(share: true), date: date)
  check(on.shareHealth && on.wantsHealthSleep, "sharing on, nothing saved: HealthKit is asked")
  on.prefillSleep(fromHealth: 6.8)
  check(on.recordSleep && on.sleepSource == .health && on.sleep == 7, "pre-filled from HealthKit, in half hours")
  check(on.sleepChange == .hours(7) && !on.wantsHealthSleep, "a HealthKit pre-fill is sent")
  on.prefillSleep(fromHealth: 5)
  check(on.sleep == 7, "pre-filled once")
  on.sleep = 7.74
  check(on.sleepChange == .hours(7.5), "sent in half hours")

  var none = CheckInDraft(today: try today(share: true), date: date)
  none.prefillSleep(fromHealth: nil)
  check(!none.recordSleep && none.sleepChange == .keep, "no HealthKit sleep: nothing pre-filled, left out")
  var capped = CheckInDraft(today: try today(share: true), date: date)
  capped.prefillSleep(fromHealth: 25.2)
  check(capped.sleep == 24, "at most 24 h")

  // The user acted while HealthKit was answering: the pre-fill never overwrites that.
  var added = CheckInDraft(today: try today(share: true), date: date)
  added.setRecordSleep(true)
  added.sleep = 8
  added.prefillSleep(fromHealth: 6)
  check(added.sleep == 8 && added.sleepSource == .none && added.sleepChange == .hours(8), "added sleep is kept")
  var removed = CheckInDraft(today: try today(share: true), date: date)
  removed.setRecordSleep(true)
  removed.setRecordSleep(false)
  removed.prefillSleep(fromHealth: 6)
  check(!removed.recordSleep && removed.sleepChange == .keep, "added then removed: no pre-fill, left out")

  let saved = #"{"date":"2026-10-21","energy":4,"mood":2,"sleepHours":7.25,"note":"from the phone"}"#
  var stored = CheckInDraft(today: try today(checkIn: saved, share: true), date: date)
  check(stored.energy == 4 && stored.mood == 2 && stored.sleep == 7.25, "starts from today's saved check-in")
  check(stored.sleepSource == .stored && stored.recordSleep && !stored.wantsHealthSleep, "saved sleep wins")
  stored.prefillSleep(fromHealth: 5)
  check(stored.sleep == 7.25, "HealthKit never replaces saved sleep")
  let storedBody = try object(stored.patch)
  check(same(storedBody, ["energy": 4, "mood": 2, "sleepHours": 7.5]), "saved sleep is sent: \(storedBody)")

  var storedOff = CheckInDraft(today: try today(checkIn: saved, share: false), date: date)
  check(storedOff.sleepSource == .stored && storedOff.sleepChange == .hours(7.5), "saved sleep shows with sharing off")
  storedOff.setRecordSleep(false)
  check(storedOff.sleepChange == .clear, "\"Don't record sleep\" on saved sleep clears it")
  let clearedBody = try object(storedOff.patch)
  check(isNull(clearedBody["sleepHours"]), "cleared: explicit null")
  storedOff.setRecordSleep(true)
  check(storedOff.sleepChange == .hours(7.5), "added back")
}

section("CheckInDraft: sleepHours is only sent for sleep the page showed or the user changed") {
  let date = "2026-10-21"
  func draft(_ checkIn: String, share: Bool) throws -> CheckInDraft {
    let json = #"{"date":"2026-10-21","items":[],"checkIn":\#(checkIn),"health":null,"shareHealth":\#(share)}"#
    return CheckInDraft(today: try decode(WatchToday.self, json), date: date)
  }
  let noSleep = #"{"date":"2026-10-21","energy":5,"mood":4,"sleepHours":null,"note":null}"#

  // Today was loaded before sleep was saved on the phone (a cached or still-refreshing Today), and HealthKit has
  // nothing: saving energy and mood must not wipe that sleep.
  var stale = try draft(noSleep, share: false)
  check(stale.energy == 5 && stale.mood == 4 && !stale.recordSleep, "saved check-in without sleep")
  stale.mood = 2
  let staleBody = try object(stale.patch)
  check(same(staleBody, ["energy": 5, "mood": 2]), "untouched sleep page: sleepHours left out: \(staleBody)")

  var healthDismissed = try draft(noSleep, share: true)
  check(healthDismissed.wantsHealthSleep, "saved check-in without sleep, sharing on: HealthKit is asked")
  healthDismissed.prefillSleep(fromHealth: 6)
  healthDismissed.setRecordSleep(false)
  check(healthDismissed.sleepChange == .keep, "removing a HealthKit pre-fill has nothing saved to clear")
  let dismissedBody = try object(healthDismissed.patch)
  check(same(dismissedBody, ["energy": 5, "mood": 4]), "left out, not null: \(dismissedBody)")

  var other = try draft(#"{"date":"2026-10-20","energy":1,"mood":1,"sleepHours":9,"note":null}"#, share: true)
  check(other.energy == 3 && other.mood == 3 && other.sleepSource == .none, "another day's check-in is ignored")
  check(other.sleepChange == .keep, "and its sleep is not sent")
  other.setRecordSleep(true)
  check(other.sleepChange == .hours(7), "Add sleep sends the picker's value")
}

// MARK: - Backend responses (shapes of app/schemas.py: WatchTodayOut, PlanItemOut, CheckInOut, HealthDayOut)

let planItemJSON = """
  {"id":"3f2a9c1d8e7b4a60b1c2d3e4f5a6b7c8","date":"2026-10-21","kind":"activity","title":"Easy run",
   "timeSlot":"morning","recipeId":null,"routineId":"9a8b7c6d5e4f40312a1b2c3d4e5f6a7b","status":"done",
   "completedAt":"2026-10-21T12:41:07.512340Z","minutes":30,"note":"Zone 2","source":"planner"}
  """

let healthDayJSON = """
  {"date":"2026-10-20","sleepMinutes":412,"restingHeartRateBpm":58,"hrvSdnnMs":42.5,"steps":8412,
   "activeEnergyKcal":510.2,
   "workouts":[{"externalId":"HK-UUID","activityType":"running","startedAt":"2026-10-20T07:12:00Z",
                "durationMinutes":32.0,"energyKcal":310.0,"distanceMeters":5100.0,"averageHeartRateBpm":148.0},
               {"externalId":"HK-2","activityType":"yoga","startedAt":"2026-10-20T19:00:00",
                "durationMinutes":20.5,"energyKcal":null,"distanceMeters":null,"averageHeartRateBpm":null}],
   "complete":true,"source":"apple_watch","memoryStatus":"pending","updatedAt":"2026-10-21T08:03:11.482913"}
  """

let todayJSON = """
  {"date":"2026-10-21",
   "items":[\(planItemJSON),
            {"id":"b1","date":"2026-10-21","kind":"meal","title":"Overnight oats","timeSlot":null,
             "recipeId":"r1","routineId":null,"status":"planned","completedAt":null,"minutes":null,"note":null,
             "source":"manual"}],
   "checkIn":{"date":"2026-10-21","energy":4,"mood":3,"sleepHours":7,"note":"Slept well"},
   "health":\(healthDayJSON.replacingOccurrences(of: "\"date\":\"2026-10-20\"", with: "\"date\":\"2026-10-21\"")),
   "shareHealth":true}
  """

section("GET /watch/today decodes") {
  let today = try decode(WatchToday.self, todayJSON)
  check(today.date == "2026-10-21" && today.shareHealth, "date / shareHealth")
  check(today.items.count == 2, "items count")
  let run = today.items[0]
  check(run.status == .done && run.completedAt == "2026-10-21T12:41:07.512340Z", "done item")
  check(run.timeSlot == "morning" && run.minutes == 30 && run.note == "Zone 2" && run.source == "planner", "item fields")
  check(today.items[1].status == .planned && today.items[1].timeSlot == nil && today.items[1].minutes == nil, "item 2")
  check(today.checkIn?.sleepHours == 7 && today.checkIn?.note == "Slept well", "checkIn (integer sleepHours)")
  check(today.health?.date == "2026-10-21" && today.health?.workouts.count == 2, "health")

  let empty = try decode(
    WatchToday.self, #"{"date":"2026-10-21","items":[],"checkIn":null,"health":null,"shareHealth":false}"#)
  check(empty.items.isEmpty && empty.checkIn == nil && empty.health == nil && !empty.shareHealth, "empty day")

  // AppModel caches Today with JSONEncoder/JSONDecoder.
  let again = try JSONDecoder().decode(WatchToday.self, from: JSONEncoder().encode(today))
  check(again == today, "cache round trip")
}

section("PATCH /watch/plan (PlanItemOut), PATCH /watch/checkins (CheckInOut), PUT /watch/health (HealthDayOut)") {
  let item = try decode(PlanItem.self, planItemJSON)
  check(item.id == "3f2a9c1d8e7b4a60b1c2d3e4f5a6b7c8" && item.kind == "activity" && item.title == "Easy run", "item")
  check(item.routineId == "9a8b7c6d5e4f40312a1b2c3d4e5f6a7b" && item.recipeId == nil, "item ids")
  let skipped = try decode(
    PlanItem.self,
    #"{"id":"x","date":"2026-10-21","kind":"meal","title":"Soup","timeSlot":"evening","recipeId":null,"routineId":null,"status":"skipped","completedAt":null,"minutes":null,"note":null,"source":"manual"}"#
  )
  check(skipped.status == .skipped && skipped.completedAt == nil, "skipped item")

  let cleared = try decode(CheckIn.self, #"{"date":"2026-10-21","energy":2,"mood":5,"sleepHours":null,"note":null}"#)
  check(cleared.energy == 2 && cleared.mood == 5 && cleared.sleepHours == nil && cleared.note == nil, "check-in")
  let slept = try decode(CheckIn.self, #"{"date":"2026-10-21","energy":3,"mood":3,"sleepHours":6.75,"note":"x"}"#)
  check(slept.sleepHours == 6.75, "fractional sleepHours")

  let day = try decode(HealthDay.self, healthDayJSON)
  check(day.date == "2026-10-20" && day.sleepMinutes == 412 && day.restingHeartRateBpm == 58, "health day")
  check(day.hrvSdnnMs == 42.5 && day.steps == 8412 && day.activeEnergyKcal == 510.2, "health metrics")
  check(day.complete && day.source == "apple_watch" && day.memoryStatus == "pending", "health status")
  check(day.workouts[0].distanceMeters == 5100 && day.workouts[1].energyKcal == nil, "workouts")
  let nulls = try decode(
    HealthDay.self,
    #"{"date":"2026-10-21","sleepMinutes":null,"restingHeartRateBpm":null,"hrvSdnnMs":null,"steps":1200,"activeEnergyKcal":null,"workouts":[],"complete":false,"source":"apple_watch","memoryStatus":"not_mirrored","updatedAt":"2026-10-21T09:00:00Z"}"#
  )
  check(nulls.sleepMinutes == nil && nulls.steps == 1200 && nulls.workouts.isEmpty && !nulls.complete, "null metrics")
}

// MARK: - Link messages (WatchConnectivity applicationContext from the phone)

let base = URL(string: "https://bn-api.example.test")!

section("LinkMessage parsing") {
  let link = LinkMessage(context: ["apiUrl": "https://bn-api.example.test", "token": "bnw_abc", "linkedAt": 1_761_000_000_123.0])
  check(link == .link(WatchLinkInfo(apiURL: base, token: "bnw_abc"), stamp: 1_761_000_000_123), "link: \(String(describing: link))")
  let intStamp = LinkMessage(context: ["apiUrl": "http://192.168.1.20:8000", "token": "bnw_abc", "linkedAt": 42])
  check(intStamp?.stamp == 42, "an integer linkedAt counts")
  check(LinkMessage(context: ["apiUrl": "https://bn-api.example.test", "token": "bnw_abc"])?.stamp == 0, "no linkedAt → 0")
  check(
    LinkMessage(context: ["apiUrl": "https://bn-api.example.test", "token": "bnw_abc", "linkedAt": "soon"])?.stamp == 0,
    "a non-number linkedAt → 0")

  check(LinkMessage(context: ["unlink": true, "at": 1_761_000_500_000.0]) == .unlink(stamp: 1_761_000_500_000), "unlink")
  check(LinkMessage(context: ["unlink": NSNumber(value: true)]) == .unlink(stamp: 0), "unlink without at")
  check(
    LinkMessage(context: ["unlink": true, "apiUrl": "https://bn-api.example.test", "token": "bnw_abc", "at": 5])
      == .unlink(stamp: 5), "unlink wins over link fields")
  check(
    LinkMessage(context: ["unlink": false, "apiUrl": "https://bn-api.example.test", "token": "bnw_abc", "linkedAt": 7])?
      .stamp == 7, "unlink: false is a link")

  check(LinkMessage(context: [:]) == nil, "empty context")
  check(LinkMessage(context: ["apiUrl": "https://bn-api.example.test"]) == nil, "missing token")
  check(LinkMessage(context: ["apiUrl": "https://bn-api.example.test", "token": ""]) == nil, "empty token")
  check(LinkMessage(context: ["apiUrl": "https://bn-api.example.test", "token": 12]) == nil, "non-string token")
  check(LinkMessage(context: ["token": "bnw_abc"]) == nil, "missing apiUrl")
  check(LinkMessage(context: ["apiUrl": "", "token": "bnw_abc"]) == nil, "empty apiUrl")
  check(LinkMessage(context: ["apiUrl": "ftp://bn-api.example.test", "token": "bnw_abc"]) == nil, "ftp scheme")
  check(LinkMessage(context: ["apiUrl": "httpx://bn-api.example.test", "token": "bnw_abc"]) == nil, "httpx scheme")
  check(LinkMessage(context: ["apiUrl": "bn-api.example.test", "token": "bnw_abc"]) == nil, "no scheme")
  check(LinkMessage(context: ["apiUrl": "HTTPS://bn-api.example.test", "token": "bnw_abc"]) != nil, "scheme case")
}

section("LinkMessage stamp ordering") {
  let info = WatchLinkInfo(apiURL: base, token: "bnw_new")
  check(LinkMessage.link(info, stamp: 10).isNewer(than: nil), "first message counts")
  check(LinkMessage.link(info, stamp: 11).isNewer(than: 10), "newer counts")
  check(!LinkMessage.link(info, stamp: 10).isNewer(than: 10), "the same context redelivered is skipped")
  check(!LinkMessage.link(info, stamp: 9).isNewer(than: 10), "older is skipped")
  check(LinkMessage.link(info, stamp: 0).isNewer(than: 10), "no stamp can't be ordered, so it counts")
  check(LinkMessage.unlink(stamp: 0).isNewer(than: 10), "unlink without stamp counts")

  // What AppModel.receive does: apply newer messages, store the stamp only once applied (a failed Keychain save
  // leaves it unhandled so the redelivered context is tried again).
  var handled: Double? = nil
  var applied: [String] = []
  func receive(_ message: LinkMessage, saves: Bool = true) {
    guard message.isNewer(than: handled) else { return }
    if case .link = message, !saves { return }
    applied.append(message == .unlink(stamp: message.stamp) ? "unlink@\(message.stamp)" : "link@\(message.stamp)")
    handled = message.stamp
  }
  receive(.link(info, stamp: 100), saves: false)  // Keychain write failed
  check(handled == nil && applied.isEmpty, "a failed save leaves the message unhandled")
  receive(.link(info, stamp: 100))  // redelivered at the next activation
  receive(.link(info, stamp: 100))  // and again
  receive(.unlink(stamp: 200))
  receive(.link(info, stamp: 100))  // a stale context must not re-link
  receive(.link(info, stamp: 300))
  check(applied == ["link@100.0", "unlink@200.0", "link@300.0"], "sequence: \(applied)")
  check(handled == 300, "last handled stamp")
}

// MARK: - Sleep (SleepNight: window 18:00 previous day → 12:00, overlaps merged)

section("SleepNight window and merge") {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "America/Toronto")!
  func at(_ text: String) -> Date {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.date(from: text)!
  }

  guard let window = SleepNight.window(endingOn: at("2026-10-21 15:30:00"), calendar: calendar) else {
    return check(false, "no window")
  }
  check(window.start == at("2026-10-20 18:00:00") && window.end == at("2026-10-21 12:00:00"), "window: \(window)")
  check(SleepNight.window(endingOn: at("2026-10-21 00:00:00"), calendar: calendar) == window, "any time of the day")
  // DST ends in Toronto on 2026-11-01: that night's window is 19 hours long.
  check(SleepNight.window(endingOn: at("2026-11-01 09:00:00"), calendar: calendar)?.duration == 19 * 3600, "DST night")

  func minutes(_ pairs: [(String, String)]) -> Int? {
    SleepNight.asleepMinutes(pairs.map { (start: at("2026-10-\($0.0)"), end: at("2026-10-\($0.1)")) }, in: window)
  }
  check(minutes([]) == nil, "no samples → nil, not 0")
  check(minutes([("20 23:00:00", "21 07:00:00")]) == 480, "one night")
  check(minutes([("20 23:00:00", "21 03:00:00"), ("21 01:00:00", "21 05:00:00")]) == 360, "overlapping sources")
  check(minutes([("21 01:00:00", "21 05:00:00"), ("20 23:00:00", "21 03:00:00")]) == 360, "unsorted input")
  check(minutes([("20 23:00:00", "21 01:00:00"), ("21 01:00:00", "21 02:00:00")]) == 180, "touching samples")
  check(minutes([("20 22:00:00", "21 06:00:00"), ("21 00:00:00", "21 01:00:00")]) == 480, "nested sample")
  check(minutes([("20 23:00:00", "21 01:00:00"), ("21 02:00:00", "21 03:30:00")]) == 210, "gap is not counted")
  check(minutes([("20 17:00:00", "20 19:00:00")]) == 60, "clipped at 18:00")
  check(minutes([("21 11:00:00", "21 13:00:00")]) == 60, "clipped at 12:00")
  check(minutes([("20 12:00:00", "20 17:59:00"), ("21 12:00:00", "21 14:00:00")]) == nil, "outside the window")
  check(minutes([("21 03:00:00", "21 03:00:00")]) == nil, "zero-length sample")
  check(minutes([("21 03:00:00", "21 02:00:00")]) == nil, "end before start is ignored")
  check(minutes([("21 03:00:00", "21 03:01:30")]) == 2, "rounded to whole minutes")
  let wide = DateInterval(start: at("2026-10-01 00:00:00"), end: at("2026-10-05 00:00:00"))
  check(
    SleepNight.asleepMinutes([(start: at("2026-10-01 00:00:00"), end: at("2026-10-03 00:00:00"))], in: wide) == 1440,
    "capped at 1440")
}

section("LocalDay") {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "America/Vancouver")!
  let instant = Date(timeIntervalSince1970: 1_792_548_000)  // 2026-10-21T02:00:00Z = Oct 20, 19:00 in Vancouver
  check(LocalDay.string(from: instant, calendar: calendar) == "2026-10-20", "local date, not UTC")
  let start = LocalDay.date(from: "2026-10-20", calendar: calendar)
  check(start == calendar.startOfDay(for: instant), "date(from:) is the local start of day")
  check(LocalDay.date(from: "2026-13-01", calendar: calendar) == nil, "invalid date")
}

// MARK: - Health sync days (HealthBackfill: finished days after the last complete upload, then today)

section("HealthBackfill: which days a sync uploads") {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "America/Toronto")!
  func at(_ text: String, in calendar: Calendar = calendar) -> Date {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.date(from: text)!
  }
  let now = at("2026-10-21 09:30:00")  // a Wednesday
  func plan(_ last: String?, now: Date = now) -> [String] {
    HealthBackfill.days(after: last, now: now, calendar: calendar).map { $0.complete ? $0.date : "\($0.date) so far" }
  }
  let latest = ["2026-10-20", "2026-10-21 so far"]

  check(plan(nil) == latest, "first sync: yesterday, then today: \(plan(nil))")
  check(plan("2026-10-20") == latest, "caught up: yesterday again (late samples), then today")
  check(plan("2026-10-19") == latest, "the day before yesterday was sent")
  check(plan("2026-10-21") == latest && plan("2026-11-02") == latest, "a last day after yesterday (clock change)")
  check(plan("soon") == latest, "an unreadable last day counts as a first sync")
  check(plan("2026-10-18") == ["2026-10-19", "2026-10-20", "2026-10-21 so far"], "backfill, oldest first")
  let week = (14...20).map { "2026-10-\($0)" } + ["2026-10-21 so far"]
  check(plan("2026-10-13") == week, "seven missed days: \(plan("2026-10-13"))")
  check(plan("2026-10-12") == week && plan("2026-09-01") == week, "capped at the newest seven finished days")

  let days = HealthBackfill.days(after: "2026-10-18", now: now, calendar: calendar)
  guard days.count == 3 else { return check(false, "Monday, Tuesday and today: \(days.map(\.date))") }
  check(days.map(\.daysAgo) == [2, 1, 0] && days.map(\.complete) == [true, true, false], "daysAgo / complete")
  check(days.map(\.start) == ["2026-10-19", "2026-10-20", "2026-10-21"].map { at("\($0) 00:00:00") }, "local starts")
  // DST ends in Toronto on 2026-11-01.
  check(
    plan("2026-10-30", now: at("2026-11-02 08:00:00")) == ["2026-10-31", "2026-11-01", "2026-11-02 so far"],
    "across the DST change")
  // In Santiago DST skips midnight on 2026-09-06, which starts at 01:00; the days around it start at 00:00.
  var chile = Calendar(identifier: .gregorian)
  chile.timeZone = TimeZone(identifier: "America/Santiago")!
  let skipped = HealthBackfill.days(after: "2026-09-03", now: at("2026-09-06 12:00:00", in: chile), calendar: chile)
  check(skipped.map(\.date) == ["2026-09-04", "2026-09-05", "2026-09-06"], "Santiago dates: \(skipped.map(\.date))")
  check(
    skipped.map(\.start) == [at("2026-09-04 00:00:00", in: chile), at("2026-09-05 00:00:00", in: chile),
      at("2026-09-06 01:00:00", in: chile)], "each day's own start")

  let (older, yesterday, today) = (days[0], days[1], days[2])
  check(HealthBackfill.lastComplete(nil, afterSending: older) == "2026-10-19", "first complete day")
  check(HealthBackfill.lastComplete("2026-10-19", afterSending: yesterday) == "2026-10-20", "moves forward")
  check(HealthBackfill.lastComplete("2026-10-20", afterSending: older) == "2026-10-20", "never goes back")
  check(HealthBackfill.lastComplete("2026-10-20", afterSending: today) == "2026-10-20", "today (so far) doesn't count")
  check(HealthBackfill.lastComplete(nil, afterSending: today) == nil, "only today sent: nothing complete yet")

  // What AppModel.upload does: the app was opened Monday evening (Monday sent so far), then not until Wednesday.
  var last: String? = nil
  for day in HealthBackfill.days(after: last, now: at("2026-10-19 20:00:00"), calendar: calendar) {
    last = HealthBackfill.lastComplete(last, afterSending: day)
  }
  check(last == "2026-10-18", "Monday evening: Sunday complete, Monday so far")
  check(plan(last) == ["2026-10-19", "2026-10-20", "2026-10-21 so far"], "Wednesday: Monday is sent again, complete")
  // An upload failing on Tuesday keeps Monday's progress, and the next sync resumes from Tuesday.
  for day in HealthBackfill.days(after: last, now: now, calendar: calendar) {
    if day.date == "2026-10-20" { break }
    last = HealthBackfill.lastComplete(last, afterSending: day)
  }
  check(last == "2026-10-19" && plan(last) == latest, "resumes after a failure: \(String(describing: last))")

  check(HealthBackfill.sentMessage([yesterday, today]) == "Sent yesterday and today.", "message: yesterday and today")
  check(HealthBackfill.sentMessage(days) == "Sent 2 past days and today.", "message: \(HealthBackfill.sentMessage(days))")
  check(HealthBackfill.sentMessage([older, today]) == "Sent 1 past day and today.", "message: one older day")
  check(HealthBackfill.sentMessage([yesterday]) == "Sent yesterday.", "message: yesterday only")
  check(HealthBackfill.sentMessage([today]) == "Sent today.", "message: today only")
}

// MARK: - APIClient (URL building, no on-disk cache)

section("APIClient") {
  func url(_ base: String, _ path: [String], _ query: [URLQueryItem] = []) -> String {
    APIClient(link: WatchLinkInfo(apiURL: URL(string: base)!, token: "bnw_x")).url(path, query: query).absoluteString
  }
  let date = [URLQueryItem(name: "date", value: "2026-10-21")]
  check(
    url("http://192.168.1.20:8000", ["watch", "today"], date) == "http://192.168.1.20:8000/watch/today?date=2026-10-21",
    "plain base")
  check(
    url("https://bn.example.test/", ["watch", "health", "2026-10-21"]) == "https://bn.example.test/watch/health/2026-10-21",
    "trailing slash: \(url("https://bn.example.test/", ["watch", "health", "2026-10-21"]))")
  check(
    url("https://bn.example.test/api", ["watch", "plan", "a/b c"]) == "https://bn.example.test/api/watch/plan/a%2Fb%20c",
    "base path and encoded segment: \(url("https://bn.example.test/api", ["watch", "plan", "a/b c"]))")

  let config = APIClient.session.configuration
  check(config.urlCache == nil, "no URL cache")
  check(config.httpCookieStorage !== HTTPCookieStorage.shared, "ephemeral session (no shared cookie store)")
  // 15 s per request; the session allows 30 s so a health upload can outlast the backend's 20 s memory timeout.
  check(config.timeoutIntervalForRequest == 15 && config.timeoutIntervalForResource == 30, "15 s request / 30 s upload timeouts")
  check(config.requestCachePolicy == .reloadIgnoringLocalCacheData && !config.waitsForConnectivity, "cache policy")
}

section("Calendar entries decode") {
  let data = Data("""
    [{"id":"demo-one","kind":"meal","title":"Oats","localDate":"2026-10-25","localTime":"08:15","durationMinutes":null,"source":"demo","timeEstimated":false},
     {"id":"session:one","kind":"activity","title":"Strength","localDate":"2026-10-25","localTime":"17:40","durationMinutes":32,"source":"session","timeEstimated":true}]
    """.utf8)
  let entries = try JSONDecoder().decode([CalendarEntry].self, from: data)
  check(entries.count == 2 && entries[0].source == "demo", "demo label retained")
  check(entries[0].durationMinutes == nil && entries[1].durationMinutes == 32, "optional duration")
  check(entries[1].timeEstimated && entries[0].localTime == "08:15", "time and precision")
}

print(failures == 0 ? "OK: \(checks) checks passed" : "FAILED: \(failures) of \(checks) checks")
exit(failures == 0 ? 0 : 1)
