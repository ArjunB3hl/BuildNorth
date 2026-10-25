import { demoCalendar, type DemoCalendarEntry } from './calendar';
import { addDays, localDate } from '../lib/dates';
import type {
  ActivitySession,
  CheckIn,
  CoachMessage,
  PlanItem,
  Preference,
  Profile,
  Recipe,
  Routine,
  ShoppingItem,
} from './types';

// Sample data so every screen has something to show until the Mac app is connected to
// the BuildNorth backend. Dates are relative to today.

export type SampleData = {
  calendarEntries: DemoCalendarEntry[];
  profile: Profile;
  preferences: Preference[];
  recipes: Recipe[];
  shopping: ShoppingItem[];
  routines: Routine[];
  sessions: ActivitySession[];
  plan: PlanItem[];
  checkIns: CheckIn[];
  coach: CoachMessage[];
};

const recipes: Recipe[] = [
  {
    id: 'r-curry',
    title: 'Chickpea and spinach curry',
    servings: 4,
    description: 'A one-pan weeknight curry. Freezes well.',
    tags: ['vegetarian', 'batch cook'],
    ingredients: [
      { name: 'chickpeas, drained', quantity: 800, unit: 'g' },
      { name: 'baby spinach', quantity: 200, unit: 'g' },
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'onion', quantity: 1, unit: null },
      { name: 'garlic cloves', quantity: 3, unit: null },
      { name: 'curry powder', quantity: 2, unit: 'tbsp' },
      { name: 'basmati rice', quantity: 300, unit: 'g' },
    ],
    steps: [
      { text: 'Rinse the rice and start it cooking.', timerSeconds: 900 },
      {
        text: 'Soften the chopped onion and garlic in a little oil.',
        timerSeconds: 360,
      },
      { text: 'Stir in the curry powder for one minute.', timerSeconds: 60 },
      {
        text: 'Add chickpeas and coconut milk, then simmer.',
        timerSeconds: 600,
      },
      {
        text: 'Fold in the spinach until wilted. Serve with rice.',
        timerSeconds: null,
      },
    ],
  },
  {
    id: 'r-oats',
    title: 'Greek yogurt overnight oats',
    servings: 1,
    description: 'Make the night before; ready when you wake up.',
    tags: ['breakfast', 'no cook'],
    ingredients: [
      { name: 'rolled oats', quantity: 50, unit: 'g' },
      { name: 'Greek yogurt', quantity: 120, unit: 'g' },
      { name: 'milk', quantity: 100, unit: 'ml' },
      { name: 'mixed berries', quantity: 80, unit: 'g' },
      { name: 'honey', quantity: 1, unit: 'tsp' },
    ],
    steps: [
      { text: 'Mix oats, yogurt and milk in a jar.', timerSeconds: null },
      { text: 'Refrigerate overnight.', timerSeconds: null },
      { text: 'Top with berries and honey before eating.', timerSeconds: null },
    ],
  },
  {
    id: 'r-salmon',
    title: 'Lemon herb salmon with greens',
    servings: 2,
    description: null,
    tags: ['high protein'],
    ingredients: [
      { name: 'salmon fillets', quantity: 2, unit: null },
      { name: 'lemon', quantity: 1, unit: null },
      { name: 'broccoli', quantity: 250, unit: 'g' },
      { name: 'olive oil', quantity: 1, unit: 'tbsp' },
      { name: 'fresh dill', quantity: 1, unit: 'tbsp' },
    ],
    steps: [
      { text: 'Heat the oven to 200 °C.', timerSeconds: null },
      {
        text: 'Season salmon with lemon, dill and oil; roast with the broccoli.',
        timerSeconds: 840,
      },
      {
        text: 'Squeeze over the remaining lemon to serve.',
        timerSeconds: null,
      },
    ],
  },
  {
    id: 'r-noodles',
    title: 'Peanut noodle bowl',
    servings: 2,
    description: 'Fast lunch with whatever vegetables you have.',
    tags: ['vegetarian', '20 minutes'],
    ingredients: [
      { name: 'wholewheat noodles', quantity: 180, unit: 'g' },
      { name: 'peanut butter', quantity: 3, unit: 'tbsp' },
      { name: 'soy sauce', quantity: 2, unit: 'tbsp' },
      { name: 'lime', quantity: 1, unit: null },
      { name: 'carrots', quantity: 2, unit: null },
      { name: 'edamame', quantity: 150, unit: 'g' },
    ],
    steps: [
      { text: 'Cook the noodles.', timerSeconds: 360 },
      {
        text: 'Whisk peanut butter, soy sauce and lime with a splash of hot water.',
        timerSeconds: null,
      },
      { text: 'Toss everything together.', timerSeconds: null },
    ],
  },
];

const routines: Routine[] = [
  {
    id: 'rt-full',
    name: 'Full body at home',
    notes: 'No equipment. Keep the rests short.',
    exercises: [
      { name: 'Bodyweight squats', sets: 3, reps: 12, restSeconds: 60 },
      { name: 'Push-ups', sets: 3, reps: 10, restSeconds: 60 },
      { name: 'Glute bridges', sets: 3, reps: 12, restSeconds: 45 },
      { name: 'Plank', sets: 3, durationSeconds: 40, restSeconds: 45 },
    ],
  },
  {
    id: 'rt-upper',
    name: '20-minute dumbbell upper body',
    notes: null,
    exercises: [
      {
        name: 'Dumbbell rows',
        sets: 3,
        reps: 10,
        weight: 12,
        weightUnit: 'kg',
        restSeconds: 60,
      },
      {
        name: 'Shoulder press',
        sets: 3,
        reps: 10,
        weight: 10,
        weightUnit: 'kg',
        restSeconds: 60,
      },
      {
        name: 'Bicep curls',
        sets: 3,
        reps: 12,
        weight: 8,
        weightUnit: 'kg',
        restSeconds: 45,
      },
    ],
  },
  {
    id: 'rt-run',
    name: 'Easy run and mobility',
    notes: 'Conversational pace.',
    exercises: [
      { name: 'Easy run', sets: 1, durationSeconds: 1500 },
      { name: 'Hip openers', sets: 2, durationSeconds: 45 },
      { name: 'Hamstring stretch', sets: 2, durationSeconds: 45 },
    ],
  },
];

function completedSets(count: number, set: Omit<SetResultInput, 'completed'>) {
  return Array.from({ length: count }, () => ({ ...set, completed: true }));
}
type SetResultInput = {
  reps?: number;
  weight?: number;
  durationSeconds?: number;
  completed: boolean;
};

export function createSampleData(today: string = localDate()): SampleData {
  const day = (offset: number) => addDays(today, offset);
  const updated = (offset: number) => `${day(offset)}T09:00:00Z`;

  const sessions: ActivitySession[] = [
    {
      id: 's-1',
      routineId: 'rt-full',
      routineName: 'Full body at home',
      localDate: day(-1),
      durationSeconds: 1680,
      entries: [
        {
          name: 'Bodyweight squats',
          sets: completedSets(3, { reps: 12 }),
          skipped: false,
        },
        {
          name: 'Push-ups',
          sets: completedSets(3, { reps: 10 }),
          skipped: false,
        },
        {
          name: 'Glute bridges',
          sets: completedSets(3, { reps: 12 }),
          skipped: false,
        },
        {
          name: 'Plank',
          sets: completedSets(3, { durationSeconds: 40 }),
          skipped: false,
        },
      ],
    },
    {
      id: 's-2',
      routineId: 'rt-run',
      routineName: 'Easy run and mobility',
      localDate: day(-3),
      durationSeconds: 1920,
      entries: [
        {
          name: 'Easy run',
          sets: completedSets(1, { durationSeconds: 1500 }),
          skipped: false,
        },
        {
          name: 'Hip openers',
          sets: completedSets(2, { durationSeconds: 45 }),
          skipped: false,
        },
        { name: 'Hamstring stretch', sets: [], skipped: true },
      ],
    },
    {
      id: 's-3',
      routineId: 'rt-upper',
      routineName: '20-minute dumbbell upper body',
      localDate: day(-5),
      durationSeconds: 1260,
      entries: [
        {
          name: 'Dumbbell rows',
          weightUnit: 'kg',
          sets: completedSets(3, { reps: 10, weight: 12 }),
          skipped: false,
        },
        {
          name: 'Shoulder press',
          weightUnit: 'kg',
          sets: completedSets(3, { reps: 10, weight: 10 }),
          skipped: false,
        },
        {
          name: 'Bicep curls',
          weightUnit: 'kg',
          sets: completedSets(3, { reps: 12, weight: 8 }),
          skipped: false,
        },
      ],
    },
  ];

  const plan: PlanItem[] = [
    {
      id: 'p-1',
      date: today,
      kind: 'meal',
      title: 'Greek yogurt overnight oats',
      timeSlot: 'morning',
      recipeId: 'r-oats',
      routineId: null,
      status: 'done',
      minutes: null,
      note: null,
    },
    {
      id: 'p-2',
      date: today,
      kind: 'activity',
      title: 'Full body at home',
      timeSlot: 'evening',
      recipeId: null,
      routineId: 'rt-full',
      status: 'planned',
      minutes: 30,
      note: null,
    },
    {
      id: 'p-3',
      date: today,
      kind: 'meal',
      title: 'Chickpea and spinach curry',
      timeSlot: 'evening',
      recipeId: 'r-curry',
      routineId: null,
      status: 'planned',
      minutes: null,
      note: 'Make a double batch for lunches.',
    },
    {
      id: 'p-4',
      date: day(1),
      kind: 'meal',
      title: 'Peanut noodle bowl',
      timeSlot: 'midday',
      recipeId: 'r-noodles',
      routineId: null,
      status: 'planned',
      minutes: null,
      note: null,
    },
    {
      id: 'p-5',
      date: day(2),
      kind: 'activity',
      title: 'Easy run and mobility',
      timeSlot: 'morning',
      recipeId: null,
      routineId: 'rt-run',
      status: 'planned',
      minutes: 35,
      note: null,
    },
    {
      id: 'p-6',
      date: day(2),
      kind: 'meal',
      title: 'Lemon herb salmon with greens',
      timeSlot: 'evening',
      recipeId: 'r-salmon',
      routineId: null,
      status: 'planned',
      minutes: null,
      note: null,
    },
    {
      id: 'p-7',
      date: day(-1),
      kind: 'activity',
      title: 'Full body at home',
      timeSlot: 'evening',
      recipeId: null,
      routineId: 'rt-full',
      status: 'done',
      minutes: 30,
      note: null,
    },
  ];

  const checkIns: CheckIn[] = [
    { date: day(-1), energy: 4, mood: 4, sleepHours: 7.5, note: null },
    { date: day(-2), energy: 3, mood: 4, sleepHours: 6.5, note: null },
    {
      date: day(-3),
      energy: 4,
      mood: 5,
      sleepHours: 8,
      note: 'Great run this morning.',
    },
    { date: day(-5), energy: 2, mood: 3, sleepHours: 6, note: null },
  ];

  return {
    calendarEntries: demoCalendar(today),
    profile: {
      preferredName: null,
      goals: ['Eat more plants', 'Move 3 times a week'],
      dietaryPreferences: ['Mostly vegetarian'],
      equipment: ['Dumbbells', 'Yoga mat'],
      experienceLevel: 'beginner',
      routineTimes: ['morning', 'evening'],
    },
    preferences: [
      {
        id: 'pref-1',
        text: 'I prefer vegetarian dinners on weekdays.',
        memoryStatus: 'synced',
        source: 'coach',
        updatedAt: updated(-6),
      },
      {
        id: 'pref-2',
        text: 'Keep weekday workouts under 30 minutes.',
        memoryStatus: 'synced',
        source: 'app',
        updatedAt: updated(-4),
      },
      {
        id: 'pref-3',
        text: "I don't like mushrooms.",
        memoryStatus: 'pending',
        source: 'planner',
        updatedAt: updated(-1),
      },
    ],
    recipes,
    shopping: [
      {
        id: 'sh-1',
        name: 'coconut milk',
        quantity: 400,
        unit: 'ml',
        checked: false,
        recipeId: 'r-curry',
      },
      {
        id: 'sh-2',
        name: 'baby spinach',
        quantity: 200,
        unit: 'g',
        checked: false,
        recipeId: 'r-curry',
      },
      {
        id: 'sh-3',
        name: 'mixed berries',
        quantity: 80,
        unit: 'g',
        checked: true,
        recipeId: 'r-oats',
      },
      {
        id: 'sh-4',
        name: 'limes',
        quantity: 2,
        unit: null,
        checked: false,
        recipeId: null,
      },
    ],
    routines,
    sessions,
    plan,
    checkIns,
    coach: [
      {
        id: 'c-1',
        role: 'user',
        content: 'What should I cook tonight? Something quick.',
        suggestions: [],
      },
      {
        id: 'c-2',
        role: 'assistant',
        content:
          'Your chickpea and spinach curry is already planned for tonight and takes about 25 minutes. If you make a double batch, tomorrow’s lunch is sorted too.',
        context: {
          memory: 'ok',
          preferences: 2,
          recalled: 1,
          recipes: 1,
          routines: 0,
          planItems: 3,
        },
        suggestions: [
          {
            type: 'preference',
            title: 'Quick weeknight dinners',
            content:
              'I prefer dinners that take 30 minutes or less on weeknights.',
          },
        ],
      },
    ],
  };
}
