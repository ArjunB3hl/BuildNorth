import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { setBadge } from '../../modules/north-win';
import { useStore } from '../data/store';
import { LOCAL_BACKEND } from '../config';
import { useAccount } from '../lib/account';
import { localDate } from '../lib/dates';
import { SECTIONS, useNav, type Section } from '../navigation';
import { Spacing, useTheme } from '../theme';
import { ThemedText, useHover } from './ui';

/** Sidebar standing in for the iPhone app's tab bar, as in the Mac app. */
export function Sidebar() {
  const { account } = useAccount();
  const signedIn = account.status === 'signed-in' ? account : null;
  const theme = useTheme();
  const nav = useNav();
  const { state } = useStore();
  const today = localDate();
  const leftToday = state.plan.filter(
    i => i.date === today && i.status === 'planned',
  ).length;
  const badges: Partial<Record<Section, number>> = { today: leftToday };

  // Same count on the taskbar button, through the NorthWin module.
  useEffect(() => {
    setBadge(leftToday);
  }, [leftToday]);

  return (
    <View
      style={[
        styles.sidebar,
        {
          backgroundColor: theme.sidebar,
          borderRightColor: theme.backgroundSelected,
        },
      ]}
    >
      <View style={styles.brand}>
        <ThemedText style={styles.wordmark}>Rhythm</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {signedIn
            ? LOCAL_BACKEND
              ? 'Local test backend'
              : 'Your account'
            : 'Demo version'}
        </ThemedText>
      </View>
      {SECTIONS.map(s => (
        <SidebarItem
          key={s.key}
          label={s.label}
          icon={s.icon}
          badge={badges[s.key]}
          selected={
            (nav.section === 'meals' || nav.section === 'activity'
              ? 'calendar'
              : nav.section) === s.key
          }
          onPress={() => nav.go(s.key)}
        />
      ))}
      <View style={styles.footer}>
        <View style={styles.status}>
          <View style={[styles.dot, signedIn && styles.dotSynced]} />
          <ThemedText type="smallBold">
            {signedIn
              ? LOCAL_BACKEND
                ? 'Test data on this PC'
                : 'Synced with Rhythm'
              : 'Saved on this PC'}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {signedIn
            ? signedIn.user.email ?? signedIn.user.name ?? 'Signed in'
            : 'Demo data on this PC, not a Rhythm account.'}
        </ThemedText>
      </View>
    </View>
  );
}

function SidebarItem({
  label,
  icon,
  badge,
  selected,
  onPress,
}: {
  label: string;
  icon: (typeof SECTIONS)[number]['icon'];
  badge?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.item,
        selected
          ? { backgroundColor: theme.backgroundSelected }
          : hovered && { backgroundColor: theme.backgroundElement },
      ]}
    >
      <Image source={icon} style={styles.icon} />
      <ThemedText
        type={selected ? 'smallBold' : 'small'}
        style={[styles.label, styles.itemText]}
      >
        {label}
      </ThemedText>
      {badge ? (
        <ThemedText type="small" themeColor="textSecondary">
          {badge}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  brand: {
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.four,
    gap: 2,
  },
  wordmark: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.two,
    height: 32,
    borderRadius: 8,
    cursor: 'pointer',
  },
  icon: { width: 20, height: 20 },
  label: { flex: 1 },
  itemText: { fontSize: 14 },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: Spacing.two,
    gap: 2,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B06000' },
  dotSynced: { backgroundColor: '#1E8E3E' },
});
