// Same shapes as the BuildNorth backend API (src/lib/types.ts in the Expo project),
// so these screens can switch from sample data to the real API without changes.

export type TimeSlot = 'morning' | 'midday' | 'evening';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export type Profile = {
  preferredName: string | null;
  goals: string[];
  dietaryPreferences: string[];
  equipment: string[];
  experienceLevel: ExperienceLevel | null;
  routineTimes: TimeSlot[];
};

export type PreferenceSource = 'app' | 'coach' | 'planner' | 'assistant';

export type Preference = {
  id: string;
  text: string;
  memoryStatus: 'synced' | 'pending';
  source: PreferenceSource;
  updatedAt: string;
};

export type Ingredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
};
export type Step = { text: string; timerSeconds: number | null };

export type Recipe = {
  id: string;
  title: string;
  servings: number;
  description: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
};

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
};

export type Routine = {
  id: string;
  name: string;
  notes: string | null;
  exercises: Exercise[];
};

export type SetResult = {
  reps?: number | null;
  weight?: number | null;
  durationSeconds?: number | null;
  completed: boolean;
};
export type SessionEntry = {
  name: string;
  weightUnit?: 'kg' | 'lb' | null;
  sets: SetResult[];
  skipped: boolean;
};
export type ActivitySession = {
  id: string;
  routineId: string | null;
  routineName: string;
  localDate: string;
  durationSeconds: number;
  entries: SessionEntry[];
};

export type CheckIn = {
  date: string;
  energy: number;
  mood: number;
  sleepHours: number | null;
  note: string | null;
};

export type PlanItem = {
  id: string;
  date: string;
  kind: 'meal' | 'activity';
  title: string;
  timeSlot: TimeSlot | null;
  recipeId: string | null;
  routineId: string | null;
  status: 'planned' | 'done' | 'skipped';
  minutes: number | null;
  note: string | null;
};

export type Suggestion = {
  type: 'recipe' | 'routine' | 'preference';
  title: string;
  content: string;
};

export type CoachContext = {
  memory: 'ok' | 'unavailable' | 'not_configured';
  preferences: number;
  recalled: number;
  recipes: number;
  routines: number;
  planItems: number;
};

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions: Suggestion[];
  context?: CoachContext | null;
};

export type ProgressWindow = {
  sessionsCompleted: number;
  activeMinutes: number;
  planDone: number;
  checkIns: number;
  averageEnergy: number | null;
  averageMood: number | null;
  averageSleepHours: number | null;
};

export type Progress = {
  week: ProgressWindow;
  month: ProgressWindow;
  streakDays: number;
  last7: { date: string; activeMinutes: number }[];
};
