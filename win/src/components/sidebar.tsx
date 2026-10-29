import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { setBadge } from '../../modules/north-win';
import { useStore } from '../data/store';
import { LOCAL_BACKEND } from '../config';
import { useAccount } from '../lib/account';
import { localDate } from '../lib/dates';
import {
  navItemOf,
  SECTIONS,
  useNav,
  type NavGroup,
  type Section,
} from '../navigation';
import { Accent, AiColors, Spacing, useTheme } from '../theme';
import { ThemedText, useHover } from './ui';

// The website's navigation (mobile/src/app/(app)/(tabs)/_layout.web.tsx): a sidebar on wide windows and a bar of
// links across the top on narrow ones (under 900 points), with the same branding, groups and order.

/** Rhythm · Demo version: the website's wordmark, the same whoever is signed in. */
export function Wordmark() {
  const theme = useTheme();
  return (
    <View style={styles.brand}>
      <ThemedText
        style={[styles.wordmark, { color: Accent }]}
        accessibilityRole="header"
      >
        Rhythm
      </ThemedText>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: theme.backgroundSelected,
            borderColor: theme.border,
          },
        ]}
      >
        <ThemedText style={styles.badgeText} themeColor="textSecondary">
          Demo version
        </ThemedText>
      </View>
    </View>
  );
}

/** The coach's mark, as on the website: a blue-violet orb with a sparkle (still: Windows draws no gradient). */
export function AiOrb({ size = 20 }: { size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: AiColors.blue,
          borderColor: AiColors.violet,
          borderWidth: Math.max(2, Math.round(size / 8)),
        },
      ]}
    >
      <Text style={[styles.sparkle, { fontSize: Math.round(size * 0.5) }]}>
        ✦
      </Text>
    </View>
  );
}

/** One of Windows' own icons (Segoe MDL2 Assets). */
export function Glyph({
  glyph,
  size = 18,
  color,
}: {
  glyph: string;
  size?: number;
  color: string;
}) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, { fontSize: size, color }]}
    >
      {glyph}
    </Text>
  );
}

function useBadges(): Partial<Record<Section, number>> {
  const { state } = useStore();
  const today = localDate();
  const leftToday = state.plan.filter(
    i => i.date === today && i.status === 'planned',
  ).length;
  // Same count on the taskbar button, through the NorthWin module.
  useEffect(() => {
    setBadge(leftToday);
  }, [leftToday]);
  return { overview: leftToday };
}

const GROUP_LABELS: Partial<Record<NavGroup, string>> = { discover: 'DISCOVER' };

export function Sidebar() {
  const theme = useTheme();
  const nav = useNav();
  const badges = useBadges();
  const current = navItemOf(nav.section);
  const group = (g: NavGroup) =>
    SECTIONS.filter(s => s.group === g).map(s => (
      <NavLink
        key={s.key}
        item={s}
        badge={badges[s.key]}
        active={current === s.key}
        onPress={() => nav.go(s.key)}
      />
    ));
  return (
    <View
      accessibilityRole="menu"
      style={[
        styles.sidebar,
        { backgroundColor: theme.sidebar, borderRightColor: theme.border },
      ]}
    >
      <View style={styles.brandRow}>
        <Wordmark />
      </View>
      <View style={styles.group}>{group('main')}</View>
      <View style={styles.group}>
        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={styles.groupLabel}
        >
          {GROUP_LABELS.discover}
        </ThemedText>
        {group('discover')}
      </View>
      <View style={[styles.group, styles.bottom]}>
        {group('bottom')}
        <AccountLine />
      </View>
    </View>
  );
}

/** Narrow windows: the wordmark and a scrolling row of the same links, as on the website. */
export function TopBar() {
  const theme = useTheme();
  const nav = useNav();
  const badges = useBadges();
  const current = navItemOf(nav.section);
  return (
    <View
      style={[
        styles.topBar,
        {
          backgroundColor: theme.sidebar,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View style={styles.topBrand}>
        <Wordmark />
        <AccountLine compact />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.topNav}
      >
        {SECTIONS.map(s => (
          <NavLink
            key={s.key}
            item={s}
            badge={badges[s.key]}
            active={current === s.key}
            onPress={() => nav.go(s.key)}
            compact
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Who is signed in, and whether the data is the live account or the local test backend. */
function AccountLine({ compact = false }: { compact?: boolean }) {
  const { account } = useAccount();
  const signedIn = account.status === 'signed-in' ? account : null;
  const status = signedIn
    ? LOCAL_BACKEND
      ? 'Local test backend'
      : 'Synced with Rhythm'
    : 'Demo data on this PC';
  return (
    <View style={compact ? styles.accountCompact : styles.account}>
      <View style={styles.status}>
        <View
          style={[
            styles.dot,
            signedIn && !LOCAL_BACKEND ? styles.dotSynced : null,
          ]}
        />
        <ThemedText type="smallBold" numberOfLines={1}>
          {compact && signedIn?.user.email ? signedIn.user.email : status}
        </ThemedText>
      </View>
      {!compact ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {signedIn
            ? signedIn.user.email ?? signedIn.user.name ?? 'Signed in'
            : 'Not a Rhythm account'}
        </ThemedText>
      ) : null}
    </View>
  );
}

function NavLink({
  item,
  badge,
  active,
  onPress,
  compact = false,
}: {
  item: (typeof SECTIONS)[number];
  badge?: number;
  active: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.link,
        compact && styles.linkCompact,
        active
          ? { backgroundColor: theme.backgroundSelected }
          : hovered && { backgroundColor: theme.background },
      ]}
    >
      {item.ai ? (
        <AiOrb size={compact ? 18 : 20} />
      ) : (
        <Glyph
          glyph={item.glyph}
          size={compact ? 15 : 17}
          color={active ? Accent : theme.textSecondary}
        />
      )}
      <ThemedText
        type={active ? 'smallBold' : 'small'}
        themeColor={active ? 'text' : 'textSecondary'}
        numberOfLines={1}
        style={compact ? null : styles.label}
      >
        {item.label}
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
    width: 240,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
    borderRightWidth: 1,
  },
  brandRow: { paddingHorizontal: Spacing.two + Spacing.one },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordmark: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  group: { gap: Spacing.half },
  groupLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.two + Spacing.one,
    marginBottom: Spacing.one,
  },
  bottom: { marginTop: 'auto' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - Spacing.one,
    height: 40,
    paddingHorizontal: Spacing.two + Spacing.one,
    borderRadius: 10,
  },
  linkCompact: {
    height: 36,
    gap: Spacing.two,
  },
  label: { flex: 1 },
  glyph: { fontFamily: 'Segoe MDL2 Assets', width: 20, textAlign: 'center' },
  orb: { alignItems: 'center', justifyContent: 'center' },
  sparkle: { color: '#ffffff', fontWeight: '700', marginTop: -1 },
  topBar: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
    borderBottomWidth: 1,
  },
  topBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four - Spacing.one,
  },
  topNav: { paddingHorizontal: Spacing.two, gap: Spacing.one },
  account: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.two + Spacing.one,
    gap: 2,
  },
  accountCompact: { flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B06000' },
  dotSynced: { backgroundColor: '#1E8E3E' },
});
