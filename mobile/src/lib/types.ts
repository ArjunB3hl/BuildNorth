// Types mirroring the backend API (camelCase JSON).

export type TimeSlot = 'morning' | 'midday' | 'evening';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export type Profile = {
  preferredName: string | null;
  goals: string[];
  dietaryPreferences: string[];
  equipment: string[];
  experienceLevel: ExperienceLevel | null;
  routineTimes: TimeSlot[];
  onboardingCompleted: boolean;
};

export type PreferenceSource = 'app' | 'coach' | 'planner' | 'assistant';

export type Preference = {
  id: string;
  text: string;
  memoryStatus: 'synced' | 'pending';
  /** Who last set this text; `sourceDetail` names the assistant connection for 'assistant'. */
  source: PreferenceSource | string;
  sourceDetail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryHit = { text: string; kind: string; score: number | null };

export type Ingredient = { name: string; quantity: number | null; unit: string | null; note?: string | null };
export type Step = { text: string; timerSeconds: number | null };
export type Nutrition = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  isEstimate: true;
};

export type RecipeInput = {
  title: string;
  servings: number;
  description?: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags?: string[];
  notes?: string | null;
  source?: 'manual' | 'pasted' | 'coach' | 'assistant';
  nutrition?: Nutrition | null;
};

export type Recipe = RecipeInput & {
  id: string;
  tags: string[];
  notes: string | null;
  source: string;
  nutrition: Nutrition | null;
  createdAt: string;
  updatedAt: string;
};

export type RecipeDraft = Omit<RecipeInput, 'tags' | 'notes' | 'source'>;

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  recipeId: string | null;
};

export type Exercise = {
  name: string;
  sets?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  weight?: number | null;
  weightUnit?: 'kg' | 'lb' | null;
  restSeconds?: number | null;
  notes?: string | null;
};

export type RoutineInput = { name: string; notes?: string | null; exercises: Exercise[] };
export type Routine = RoutineInput & { id: string; notes: string | null; createdAt: string; updatedAt: string };

export type SetResult = { reps?: number | null; weight?: number | null; durationSeconds?: number | null; completed: boolean };
export type SessionEntry = { name: string; weightUnit?: 'kg' | 'lb' | null; sets: SetResult[]; skipped: boolean };
export type SessionInput = {
  routineId: string | null;
  routineName: string;
  localDate: string;
  startedAt: string;
  finishedAt: string;
  entries: SessionEntry[];
  notes?: string | null;
  planItemId?: string | null;
};
export type ActivitySession = SessionInput & { id: string; durationSeconds: number };

export type CheckIn = { date: string; energy: number; mood: number; sleepHours: number | null; note: string | null };

export type PlanItem = {
  id: string;
  date: string;
  kind: 'meal' | 'activity';
  title: string;
  timeSlot: TimeSlot | null;
  recipeId: string | null;
  routineId: string | null;
  status: 'planned' | 'done' | 'skipped';
  completedAt: string | null;
  minutes: number | null;
  note: string | null;
  source: 'manual' | 'planner' | string;
};

export type PlanItemInput = Pick<PlanItem, 'date' | 'kind' | 'title'> &
  Partial<Pick<PlanItem, 'timeSlot' | 'recipeId' | 'routineId' | 'minutes' | 'note'>> & {
    /** Idempotency key: repeating a create with the same key returns the first item. */
    clientKey?: string;
  };

export type Today = { date: string; items: PlanItem[]; checkIn: CheckIn | null };

export type ProgressWindow = {
  days: number;
  sessionsCompleted: number;
  activeMinutes: number;
  planDone: number;
  planSkipped: number;
  checkIns: number;
  averageEnergy: number | null;
  averageMood: number | null;
  averageSleepHours: number | null;
};

export type Progress = {
  today: string;
  week: ProgressWindow;
  month: ProgressWindow;
  streakDays: number;
  last7: { date: string; sessions: number; activeMinutes: number; energy: number | null; mood: number | null }[];
};

export type Suggestion = { type: 'recipe' | 'routine' | 'preference'; title: string; content: string };

/** What a coach reply was built from. `memory` says whether long-term memory was actually checked. */
export type CoachContext = {
  calendarEntries?: number;
  memory: 'ok' | 'unavailable' | 'not_configured';
  topics: string[];
  preferences: number;
  recalled: number;
  memoryNotes: number;
  recipes: number;
  routines: number;
  planItems: number;
  /** Apple Watch days used (only while health sharing is on); missing on replies from before watch support. */
  healthDays?: number;
};

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions: Suggestion[];
  context?: CoachContext | null;
  createdAt: string;
};

export type ServiceStatus = {
  status: 'ok';
  clerkConfigured: boolean;
  memoryConfigured: boolean;
  aiAvailable: boolean;
  aiProvider: string;
  aiUnavailableReason: string | null;
};

export type DeleteDataResult = {
  deletedRecords: Record<string, number>;
  memoryStatus: 'erased' | 'failed' | 'not_configured';
  memoryDetail: string;
};

// --- weekly planner ---------------------------------------------------------------------------

export type PlannerRequest = {
  startDate: string;
  days: number;
  mealSlots: TimeSlot[];
  activityDays: number;
  minutesPerDay: number | null;
  recipeIds: string[];
  routineIds: string[];
  equipment?: string[] | null;
  note?: string | null;
};

export type PlanFact = { id: string; label: string; source: 'profile' | 'preference' | 'request' | 'recipe' | 'routine' | 'memory' };

export type ProposalItem = {
  key: string;
  date: string;
  kind: 'meal' | 'activity';
  title: string;
  timeSlot: TimeSlot | null;
  recipeId: string | null;
  routineId: string | null;
  minutes: number | null;
  idea: string | null;
  reasons: string[];
  warnings: string[];
};

export type Proposal = {
  proposalId: string;
  startDate: string;
  days: number;
  summary: string;
  items: ProposalItem[];
  facts: PlanFact[];
  /** Whether long-term memory was checked for this draft. */
  memory?: 'ok' | 'unavailable' | 'not_configured' | null;
  notes: string[];
};

export type AcceptResult = { items: PlanItem[]; created: number; alreadySaved: number };

export type ChangeItemView = {
  date: string;
  kind: 'meal' | 'activity';
  title: string;
  timeSlot: TimeSlot | null;
  recipeId: string | null;
  routineId: string | null;
  minutes: number | null;
  note: string | null;
};

export type PlanChange = {
  op: 'move' | 'replace' | 'remove' | 'add';
  targetKey: string | null;
  before: ChangeItemView | null;
  after: ChangeItemView | null;
  description: string;
  warnings: string[];
};

export type ChangePreview = {
  changeSetId: string;
  summary: string;
  changes: PlanChange[];
  rejected: string[];
  /** True when the request was for this time only; it is never remembered. */
  temporary: boolean;
  /** A lasting preference the user may choose to remember (never saved without confirmation). */
  preferenceSuggestion: string | null;
};

export type ChangeRequest = {
  message: string;
  today: string;
  startDate: string;
  days: number;
  scope: 'plan' | 'proposal';
  draftItems?: (Pick<ProposalItem, 'key' | 'date' | 'kind' | 'title' | 'timeSlot' | 'recipeId' | 'routineId' | 'minutes' | 'idea'>)[];
  focusKey?: string | null;
};

export type ReviewDay = {
  date: string;
  hasRecords: boolean;
  checkIn: CheckIn | null;
  plannedActivities: number;
  doneActivities: number;
  skippedActivities: number;
  openActivities: number;
  plannedMeals: number;
  doneMeals: number;
  skippedMeals: number;
  openMeals: number;
  sessions: number;
  activeMinutes: number;
};

export type ReviewTotals = {
  sessions: number;
  activeMinutes: number;
  plannedActivities: number;
  doneActivities: number;
  skippedActivities: number;
  openActivities: number;
  plannedMeals: number;
  doneMeals: number;
  skippedMeals: number;
  openMeals: number;
  checkInDays: number;
  daysWithoutRecords: number;
};

export type PlannerPreset = { activityDays: number | null; minutesPerDay: number | null; mealSlots: TimeSlot[] | null };

export type WeeklyReview = {
  start: string;
  end: string;
  days: ReviewDay[];
  totals: ReviewTotals;
  observations: string[];
  adjustments: { id: string; label: string; description: string; preset: PlannerPreset }[];
};

// --- external assistants (MCP) ---------------------------------------------------------------

export type ConnectionToken = {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
};

export type ConnectionsInfo = {
  mcpUrl: string;
  oauthAuthorizationServer: string | null;
  tokens: ConnectionToken[];
};

export type ClaudeConnection = {
  configured: boolean;
  storageAvailable: boolean;
  usable: boolean;
  hint: string | null;
  model: string;
  scope: 'coach';
};

export type AssistantProposal = {
  id: string;
  kind: 'plan_changes' | 'recipe' | 'preference' | 'preference_update' | 'preference_delete';
  status: 'pending' | 'applied' | 'rejected' | 'stale' | 'expired';
  summary: string;
  changes: { description: string; warnings: string[] }[];
  rejected: string[];
  details: Record<string, unknown> | null;
  client: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedVia: string | null;
  result: Record<string, unknown> | null;
  nextStep: string;
};

// --- Apple Watch ------------------------------------------------------------------------------

export type WatchToken = {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

/** POST /watch/tokens. `token` is the plaintext, returned once: hand it to the watch and drop it. */
export type CreatedWatchToken = Pick<WatchToken, 'id' | 'label' | 'hint' | 'createdAt' | 'expiresAt'> & { token: string };

export type WatchSettings = { shareHealth: boolean };

export type HealthWorkout = {
  externalId: string;
  activityType: string;
  startedAt: string;
  durationMinutes: number;
  energyKcal: number | null;
  distanceMeters: number | null;
  averageHeartRateBpm: number | null;
  minHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
};

/** One local day of device-measured data. Missing metrics are null, never 0. */
export type HealthDayInput = {
  /** Asleep time for the night that ended on this date. */
  sleepMinutes: number | null;
  sleepPattern?: SleepPattern | null;
  restingHeartRateBpm: number | null;
  hrvSdnnMs: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  workouts: HealthWorkout[];
  /** True once the day is over. */
  complete: boolean;
};

export type HealthDay = HealthDayInput & {
  date: string;
  source: 'apple_watch';
  /** Whether the day's summary is in long-term memory; only complete days are mirrored, and only while sharing is on. */
  memoryStatus: 'synced' | 'pending' | 'not_mirrored';
  updatedAt: string;
};

export type WatchToday = Today & { health: HealthDay | null; shareHealth: boolean };

/** PATCH /watch/checkins/{date} merges: omitted keys keep their stored values. A new day needs energy and mood. */
export type CheckInPatch = Partial<Pick<CheckIn, 'energy' | 'mood' | 'sleepHours' | 'note'>>;

export type CalendarEntry = {
  id: string;
  kind: 'meal' | 'activity' | 'sleep';
  title: string;
  occurredAt: string;
  localDate: string;
  localTime: string;
  durationMinutes: number | null;
  notes: string | null;
  source: 'manual' | 'coach' | 'demo' | 'session' | 'plan' | 'watch';
  timeEstimated: boolean;
  editable: boolean;
  sessionId: string | null;
  workout?: HealthWorkout | null;
  sleepPattern?: SleepPattern | null;
  partial?: boolean;
};
export type CalendarInput = Pick<CalendarEntry, 'title' | 'occurredAt' | 'durationMinutes' | 'notes'> & { kind: 'meal' | 'activity' };

export type SleepPattern = {
  startedAt: string | null; endedAt: string | null;
  coreMinutes: number | null; deepMinutes: number | null; remMinutes: number | null;
  awakeMinutes: number | null; unspecifiedMinutes: number | null;
};
export type ReportMetric = { average: number | null; min: number | null; max: number | null; samples: number };
export type MonthlyReport = {
  month: string; through: string; reportDate: string; timezone: string; status: 'monthEnded' | 'inProgress'; generatedAt: string;
  recordedDays: number; daysInPeriod: number; demoEntriesExcluded: number;
  meals: number; appWorkouts: number; appMinutes: number; recordedSets: number;
  watchWorkouts: number; watchMinutes: number; watchDays: number; completeWatchDays: number;
  workoutTypes: { type: string; count: number; minutes: number; heartRate: ReportMetric }[];
  sleep: ReportMetric; restingHeartRate: ReportMetric; hrv: ReportMetric; steps: ReportMetric; activeEnergy: ReportMetric;
  checkIns: number; energy: ReportMetric; mood: ReportMetric; reportedSleep: ReportMetric;
  plans: { total: number; done: number; skipped: number }; healthDays: HealthDay[]; notes: string[];
};
export type AIAccess = { linked: boolean; claude: boolean; elevenlabs: boolean; textChat: boolean; camera: boolean };
export type ElevenLabsConnection = { configured: boolean; usable: boolean; storageAvailable: boolean; hint: string | null; agentName: string | null };
