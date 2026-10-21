import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { available as northMacAvailable } from '../../modules/north-mac';
import {
  Button,
  Card,
  EmptyState,
  ListItem,
  Notice,
  Pill,
  Row,
  Screen,
  SectionHeader,
  TextField,
  ThemedText,
} from '../components/ui';
import { computeProgress, useStore } from '../data/store';
import type { Preference, Progress } from '../data/types';
import { friendlyDateInline, localDate } from '../lib/dates';
import { useNav } from '../navigation';
import { Accent, Spacing, useTheme } from '../theme';

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ProfileScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const p = state.profile;
  const progress = computeProgress(state, localDate());

  return (
    <Screen title={p.preferredName || 'Your profile'} subtitle="Sample profile">
      <SectionHeader title="This week" />
      <ProgressCard progress={progress} />

      <SectionHeader title="About you" />
      <Card>
        <Summary label="Goals" values={p.goals} />
        <Summary label="Dietary preferences" values={p.dietaryPreferences} />
        <Summary label="Equipment" values={p.equipment} />
        <Summary
          label="Experience"
          values={p.experienceLevel ? [capitalise(p.experienceLevel)] : []}
        />
        <Summary
          label="Routine times"
          values={p.routineTimes.map(capitalise)}
        />
      </Card>
      <ListItem
        title="What BuildNorth remembers"
        subtitle={`${plural(
          state.preferences.length,
          'saved preference',
        )} · view, correct or delete`}
        onPress={() => nav.push({ name: 'memory' })}
      />

      <SectionHeader title="This Mac" />
      <Card>
        <Summary
          label="Computer"
          values={[Constants.deviceName ?? 'This Mac']}
        />
        <Summary
          label="System"
          values={[`${Platform.OS} ${Platform.Version}`]}
        />
        <Summary label="Account" values={['Not signed in']} />
        <Summary
          label="Data"
          values={['Sample data, saved on this Mac with expo-sqlite']}
        />
        <Summary
          label="Expo"
          values={[
            `SDK ${
              Constants.expoConfig?.sdkVersion ?? '55'
            }: expo-sqlite, expo-crypto, expo-constants${
              northMacAvailable ? ', NorthMac (Swift module)' : ''
            }`,
          ]}
        />
      </Card>
      <View style={styles.start}>
        <Button
          title="Reset to sample data"
          variant="secondary"
          onPress={() =>
            Alert.alert(
              'Reset to sample data?',
              'This replaces everything saved on this Mac (plan, check-ins, shopping list and preferences) with the original sample data.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Reset',
                  style: 'destructive',
                  onPress: () => dispatch({ type: 'store/reset' }),
                },
              ],
            )
          }
        />
      </View>
    </Screen>
  );
}

function Summary({ label, values }: { label: string; values: string[] }) {
  return (
    <Row style={styles.summary}>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.summaryLabel}
      >
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.fill}>
        {values.length ? values.join(', ') : 'Not set'}
      </ThemedText>
    </Row>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="subtitle" style={styles.statValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ProgressCard({ progress }: { progress: Progress }) {
  const theme = useTheme();
  const w = progress.week;
  const maxMinutes = Math.max(1, ...progress.last7.map(d => d.activeMinutes));
  const nothingYet =
    w.sessionsCompleted === 0 && w.checkIns === 0 && w.planDone === 0;
  return (
    <Card>
      {nothingYet ? (
        <ThemedText type="small" themeColor="textSecondary">
          Complete a session, a planned item or a daily check-in and your
          progress shows up here.
        </ThemedText>
      ) : null}
      <Row style={styles.stats}>
        <Stat label="Sessions" value={String(w.sessionsCompleted)} />
        <Stat label="Active min" value={String(w.activeMinutes)} />
        <Stat label="Day streak" value={String(progress.streakDays)} />
        <Stat label="Check-ins" value={String(w.checkIns)} />
        <Stat
          label="Avg energy"
          value={w.averageEnergy != null ? `${w.averageEnergy}/5` : '—'}
        />
        <Stat
          label="Avg mood"
          value={w.averageMood != null ? `${w.averageMood}/5` : '—'}
        />
      </Row>
      {w.averageSleepHours != null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Average sleep logged: {w.averageSleepHours} h
        </ThemedText>
      ) : null}
      <View
        style={styles.chart}
        accessibilityLabel="Active minutes over the last 7 days"
      >
        {progress.last7.map(d => (
          <View key={d.date} style={styles.barColumn}>
            <View
              style={[
                styles.barTrack,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <View
                style={[
                  styles.bar,
                  { height: `${(d.activeMinutes / maxMinutes) * 100}%` },
                ]}
              />
            </View>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.barLabel}
            >
              {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
              })}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Last 30 days: {plural(progress.month.sessionsCompleted, 'session')} ·{' '}
        {plural(progress.month.activeMinutes, 'active minute')} ·{' '}
        {plural(progress.month.planDone, 'planned item')} done
      </ThemedText>
    </Card>
  );
}

function sourceLabel(p: Preference): string {
  switch (p.source) {
    case 'coach':
      return 'Saved from Coach';
    case 'planner':
      return 'Saved from the planner';
    case 'assistant':
      return 'Approved from an AI assistant';
    default:
      return 'Added in the app';
  }
}

export function MemoryScreen() {
  const { state, dispatch } = useStore();
  const [text, setText] = useState('');
  const [erased, setErased] = useState<number | null>(null);
  const list = state.preferences;

  return (
    <Screen title="What BuildNorth remembers">
      <ThemedText themeColor="textSecondary">
        Preferences you save or confirm are used by the Coach and by AI
        assistants you connect. Your profile, recipes and routines are stored
        separately and aren’t affected here.
      </ThemedText>

      <Card>
        <TextField
          label="Add a preference"
          value={text}
          onChangeText={setText}
          placeholder="e.g. I prefer vegetarian recipes."
          maxLength={500}
          multiline
        />
        <View style={styles.start}>
          <Button
            title="Save preference"
            size="small"
            disabled={!text.trim()}
            onPress={() => {
              dispatch({
                type: 'preference/add',
                text: text.trim(),
                source: 'app',
              });
              setText('');
              setErased(null);
            }}
          />
        </View>
      </Card>

      <SectionHeader title="Saved preferences" />
      {list.length === 0 ? (
        <EmptyState
          title="No saved preferences yet"
          body="Add one above, or confirm one the coach suggests."
        />
      ) : null}
      {list.map(p => (
        <PreferenceRow key={p.id} preference={p} />
      ))}

      <SectionHeader title="Erase memory" />
      {erased != null ? (
        <Notice tone="success">
          Memory erased ({plural(erased, 'preference')}).
        </Notice>
      ) : null}
      <View style={styles.start}>
        <Button
          title="Erase everything BuildNorth remembers"
          variant="danger"
          disabled={list.length === 0}
          onPress={() =>
            Alert.alert(
              'Erase all memory?',
              'This permanently removes your saved preferences and everything long-term memory holds about you. Recipes, routines, check-ins and your plan stay.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase',
                  style: 'destructive',
                  onPress: () => {
                    setErased(list.length);
                    dispatch({ type: 'memory/erase' });
                  },
                },
              ],
            )
          }
        />
      </View>
    </Screen>
  );
}

function PreferenceRow({ preference }: { preference: Preference }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(preference.text);

  if (editing) {
    return (
      <Card>
        <TextField
          label="Correct this preference"
          value={text}
          onChangeText={setText}
          maxLength={500}
          multiline
        />
        <Row>
          <Button
            title="Save correction"
            size="small"
            disabled={!text.trim() || text.trim() === preference.text}
            onPress={() => {
              dispatch({
                type: 'preference/correct',
                id: preference.id,
                text: text.trim(),
              });
              setEditing(false);
            }}
          />
          <Button
            title="Cancel"
            size="small"
            variant="secondary"
            onPress={() => {
              setEditing(false);
              setText(preference.text);
            }}
          />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText>{preference.text}</ThemedText>
      <Row style={styles.wrap}>
        <ThemedText type="small" themeColor="textSecondary">
          {sourceLabel(preference)} · updated{' '}
          {friendlyDateInline(preference.updatedAt.slice(0, 10))}
        </ThemedText>
        <Pill
          label={
            preference.memoryStatus === 'synced'
              ? 'In memory'
              : 'Memory sync pending'
          }
          tone={preference.memoryStatus === 'synced' ? 'success' : 'muted'}
        />
      </Row>
      <Row>
        <Button
          title="Correct"
          size="small"
          variant="secondary"
          onPress={() => setEditing(true)}
          accessibilityLabel={`Correct: ${preference.text}`}
        />
        <Button
          title="Delete"
          size="small"
          variant="quiet"
          accessibilityLabel={`Delete: ${preference.text}`}
          onPress={() =>
            Alert.alert('Delete this preference?', preference.text, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  dispatch({ type: 'preference/remove', id: preference.id }),
              },
            ])
          }
        />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  start: { alignItems: 'flex-start' },
  summary: { alignItems: 'flex-start' },
  summaryLabel: { width: 150 },
  stats: { justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, lineHeight: 28 },
  chart: {
    flexDirection: 'row',
    height: 110,
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  barColumn: { flex: 1, alignItems: 'center', gap: Spacing.one },
  barTrack: {
    flex: 1,
    width: '60%',
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: { width: '100%', borderRadius: 6, backgroundColor: Accent },
  barLabel: { fontSize: 11, lineHeight: 14 },
});
