import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ChipGroup,
  Notice,
  Screen,
  TextField,
  ThemedText,
} from '../components/ui';
import { useStore } from '../data/store';
import type { ExperienceLevel, Profile, TimeSlot } from '../data/types';
import { describe, useAccount } from '../lib/account';
import { Spacing } from '../theme';

// The welcome step for an account created in this app just now (the website's onboarding after sign-up,
// mobile/src/app/(app)/onboarding.tsx): a few optional details, then Today. Accounts that sign in never see it.

const options = <T extends string>(values: readonly T[]) =>
  values.map(value => ({ value, label: value }));
const GOALS = options([
  'Cook more at home',
  'Eat more vegetables',
  'Build strength',
  'Improve fitness',
  'Move more every day',
  'Sleep better',
  'Feel less stressed',
]);
const DIETS = options([
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Gluten-free',
  'Dairy-free',
  'Nut-free',
  'Halal',
  'Kosher',
  'High-protein',
  'Low-carb',
]);
const EQUIPMENT = options([
  'No equipment',
  'Dumbbells',
  'Kettlebell',
  'Resistance bands',
  'Pull-up bar',
  'Yoga mat',
  'Bench',
  'Gym access',
]);
const LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];
const TIMES: { value: TimeSlot; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'midday', label: 'Midday' },
  { value: 'evening', label: 'Evening' },
];

export const EMPTY_PROFILE: Profile = {
  preferredName: null,
  goals: [],
  dietaryPreferences: [],
  equipment: [],
  experienceLevel: null,
  routineTimes: [],
};

/** Whether this account gets the welcome step: created in this app just now, and not through it yet. */
export function needsWelcome(isNew: boolean, profile: Profile): boolean {
  return isNew && profile.onboardingCompleted === false;
}

export function WelcomeScreen() {
  const { api, reload } = useStore();
  const { finishWelcome } = useAccount();
  const [draft, setDraft] = useState<Profile>(EMPTY_PROFILE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  async function save(profile: Profile) {
    if (!api) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveProfile(profile);
      await reload(['profile']);
      finishWelcome();
    } catch (e) {
      setError(`Couldn’t save to your account: ${describe(e)}`);
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Welcome to Rhythm"
      subtitle="A few optional details help tailor meals, routines and coaching. Skip anything you like and change it later on the website or phone."
    >
      <Card style={styles.card}>
        <TextField
          label="What should Rhythm call you?"
          value={draft.preferredName ?? ''}
          onChangeText={v => set('preferredName', v.trim() ? v : null)}
          maxLength={80}
        />
        <ThemedText type="smallBold">Goals</ThemedText>
        <ChipGroup
          options={GOALS}
          selected={draft.goals}
          onChange={v => set('goals', v)}
        />
        <ThemedText type="smallBold">Dietary preferences</ThemedText>
        <ChipGroup
          options={DIETS}
          selected={draft.dietaryPreferences}
          onChange={v => set('dietaryPreferences', v)}
        />
        <ThemedText type="smallBold">Equipment</ThemedText>
        <ChipGroup
          options={EQUIPMENT}
          selected={draft.equipment}
          onChange={v => set('equipment', v)}
        />
        <ThemedText type="smallBold">Experience</ThemedText>
        <ChipGroup
          options={LEVELS}
          multiple={false}
          selected={draft.experienceLevel ? [draft.experienceLevel] : []}
          onChange={v => set('experienceLevel', v[0] ?? null)}
        />
        <ThemedText type="smallBold">When you like to work out</ThemedText>
        <ChipGroup
          options={TIMES}
          selected={draft.routineTimes}
          onChange={v => set('routineTimes', v)}
        />
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={styles.row}>
        <Button
          title="Save and continue"
          onPress={() => save(draft)}
          loading={busy}
        />
        <Button
          title="Skip for now"
          variant="secondary"
          onPress={() => save(EMPTY_PROFILE)}
          disabled={busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
});
