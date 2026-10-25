import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { FormActions } from '@/components/profile/controls';
import { Divider, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, errorMessage, Row } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { ExperienceLevel, Profile, TimeSlot } from '@/lib/types';
import { Enter, Stagger } from '@/components/motion';

const GOALS = ['Cook more at home', 'Eat more vegetables', 'Build strength', 'Improve fitness', 'Move more every day', 'Sleep better', 'Feel less stressed'];
const DIETS = ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free', 'Halal', 'Kosher', 'High-protein', 'Low-carb'];
const EQUIPMENT = ['No equipment', 'Dumbbells', 'Kettlebell', 'Resistance bands', 'Pull-up bar', 'Yoga mat', 'Bench', 'Gym access'];
const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;
const TIMES = [
  { value: 'morning', label: 'Morning' },
  { value: 'midday', label: 'Midday' },
  { value: 'evening', label: 'Evening' },
] as const;

export type ProfileDraft = Omit<Profile, 'onboardingCompleted'>;

export const EMPTY_PROFILE: ProfileDraft = {
  preferredName: null,
  goals: [],
  dietaryPreferences: [],
  equipment: [],
  experienceLevel: null,
  routineTimes: [],
};

function asOptions(values: string[], selected: string[]) {
  // Keep any custom entries the user added visible as chips.
  return [...new Set([...values, ...selected])].map((v) => ({ value: v, label: v }));
}

/** Suggested values as chips, plus a field to add your own. Also used for Rhythm's equipment. */
export function TagPicker({
  label,
  hint,
  suggestions,
  selected,
  onChange,
  hideLabel = false,
}: {
  label: string;
  hint?: string;
  suggestions: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Leave out the heading when the surrounding card already names the field. */
  hideLabel?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const add = () => {
    const value = custom.trim();
    if (value && !selected.includes(value)) onChange([...selected, value]);
    setCustom('');
  };
  return (
    <View style={styles.section}>
      {hideLabel ? null : <ThemedText type="smallBold">{label}</ThemedText>}
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      <ChipGroup options={asOptions(suggestions, selected)} selected={selected} onChange={onChange} />
      <Row style={styles.addRow}>
        <View style={styles.fill}>
          <TextField
            label={`Add your own ${label.toLowerCase()}`}
            value={custom}
            onChangeText={setCustom}
            onSubmitEditing={add}
            returnKeyType="done"
            maxLength={80}
            placeholder="Type and press Add"
          />
        </View>
        <View style={styles.addButton}>
          <Button title="Add" size="small" variant="secondary" onPress={add} disabled={!custom.trim()} />
        </View>
      </Row>
    </View>
  );
}

/** Optional profile fields. Saving shows success only after the server confirms. */
export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
  allowSkip = false,
}: {
  initial: ProfileDraft;
  submitLabel: string;
  onSubmit: (profile: ProfileDraft) => Promise<void>;
  /** Show "Skip for now", which saves an empty profile through the same error handling. */
  allowSkip?: boolean;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function submit(value: ProfileDraft = draft) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...value, preferredName: value.preferredName?.trim() || null });
    } catch (e) {
      setError(errorMessage(e)); // entries stay in the form so nothing has to be retyped
    } finally {
      setSaving(false);
    }
  }

  const save = <Button key="save" title={submitLabel} onPress={() => submit()} loading={saving} />;
  const skip = allowSkip ? (
    <Button key="skip" title="Skip for now" variant="quiet" onPress={() => submit(EMPTY_PROFILE)} disabled={saving} />
  ) : null;

  return (
    <View style={styles.form}>
      <Stagger>
        <SectionCard title="About you" icon={{ ios: 'person', android: 'person', web: 'person' }}>
          <TextField
            label="What should we call you?"
            value={draft.preferredName ?? ''}
            onChangeText={(t) => set('preferredName', t)}
            placeholder="Your first name or a nickname"
            maxLength={80}
            autoComplete="given-name"
          />
        </SectionCard>

        <SectionCard title="Goals" icon={{ ios: 'flag', android: 'flag', web: 'flag' }}>
          <TagPicker label="Goals" hideLabel suggestions={GOALS} selected={draft.goals} onChange={(v) => set('goals', v)} />
        </SectionCard>

        <SectionCard
          title="Dietary preferences"
          description="Used to tailor suggestions. BuildNorth can't guarantee a recipe is allergen-free."
          icon={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }}>
          <TagPicker
            label="Dietary preferences"
            hideLabel
            suggestions={DIETS}
            selected={draft.dietaryPreferences}
            onChange={(v) => set('dietaryPreferences', v)}
          />
        </SectionCard>

        <SectionCard title="Training" icon={{ ios: 'figure.run', android: 'fitness_center', web: 'fitness_center' }}>
          <TagPicker label="Equipment" suggestions={EQUIPMENT} selected={draft.equipment} onChange={(v) => set('equipment', v)} />
          <Divider />
          <View style={styles.section}>
            <ThemedText type="smallBold">Exercise experience</ThemedText>
            <ChipGroup
              options={LEVELS}
              multiple={false}
              selected={draft.experienceLevel ? [draft.experienceLevel] : []}
              onChange={(v) => set('experienceLevel', (v[0] as ExperienceLevel) ?? null)}
            />
          </View>
          <Divider />
          <View style={styles.section}>
            <ThemedText type="smallBold">Preferred routine times</ThemedText>
            <ChipGroup options={TIMES} selected={draft.routineTimes} onChange={(v) => set('routineTimes', v as TimeSlot[])} />
          </View>
        </SectionCard>
      </Stagger>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* The main action sits last on a web row and first in a phone's stack. */}
      <Enter index={4}>
        <FormActions>{Platform.OS === 'web' ? [skip, save] : [save, skip]}</FormActions>
      </Enter>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  section: { gap: Spacing.two },
  fill: { flex: 1 },
  addRow: { alignItems: 'flex-end' },
  addButton: { marginBottom: Spacing.two },
});
