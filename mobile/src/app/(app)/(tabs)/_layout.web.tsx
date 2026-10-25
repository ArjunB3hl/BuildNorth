import { Link, Slot, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Accent } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NavItem = { href: Href; label: string; icon: SymbolViewProps['name']; active: (path: string) => boolean; ai?: boolean };

const rhythmPaths = ['/profile/videos', '/profile/interests'];

// Same Material Symbols as the native Android tabs, so the web and phone apps read alike.
const main: NavItem[] = [
  { href: '/', label: 'Overview', icon: { ios: 'square.grid.2x2', android: 'space_dashboard', web: 'space_dashboard' }, active: (p) => p === '/' },
  { href: '/coach', label: 'Coach', icon: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }, active: (p) => p.startsWith('/coach'), ai: true },
  { href: '/meals', label: 'Meals', icon: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }, active: (p) => p.startsWith('/meals') },
  { href: '/activity', label: 'Activity', icon: { ios: 'figure.run', android: 'fitness_center', web: 'fitness_center' }, active: (p) => p.startsWith('/activity') },
];
const rhythm: NavItem[] = [
  { href: '/profile/videos', label: 'Content library', icon: { ios: 'play.rectangle.on.rectangle', android: 'video_library', web: 'video_library' }, active: (p) => p.startsWith('/profile/videos') },
  { href: '/profile/interests', label: 'Interests & sharing', icon: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }, active: (p) => p.startsWith('/profile/interests') },
];
const profile: NavItem = {
  href: '/profile', label: 'Profile', icon: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  active: (p) => p === '/profile' || (p.startsWith('/profile/') && !rhythmPaths.some((r) => p.startsWith(r))),
};

export default function WebLayout() {
  const path = usePathname();
  const theme = useTheme();
  const wide = useWindowDimensions().width >= 900;

  if (!wide) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.background }]}>
        <View style={[styles.topBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.brandTop}><Wordmark /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNav}>
            {[...main, ...rhythm, profile].map((item) => <NavLink key={item.label} item={item} active={item.active(path)} compact />)}
          </ScrollView>
        </View>
        <View style={styles.fill}><Slot /></View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, styles.row, { backgroundColor: theme.background }]}>
      <View role="navigation" style={[styles.sidebar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.brand}><Wordmark /></View>
        <View style={styles.group}>
          {main.map((item) => <NavLink key={item.label} item={item} active={item.active(path)} />)}
        </View>
        <View style={styles.group}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.groupLabel}>RHYTHM</ThemedText>
          {rhythm.map((item) => <NavLink key={item.label} item={item} active={item.active(path)} />)}
        </View>
        <View style={[styles.group, styles.bottom]}>
          <NavLink item={profile} active={profile.active(path)} />
        </View>
      </View>
      <View style={styles.content}><Slot /></View>
    </View>
  );
}

function NavLink({ item, active, compact = false }: { item: NavItem; active: boolean; compact?: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  // Link's asChild wrapper (Slot) accepts only one flat style object: no arrays, no style functions.
  return (
    <Link href={item.href} asChild>
      <Pressable
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={StyleSheet.flatten([
          styles.link,
          navTransition,
          compact && styles.linkCompact,
          active ? { backgroundColor: theme.backgroundSelected } : hovered && { backgroundColor: theme.background },
        ])}>
        {item.ai ? (
          <AiOrb size={compact ? 18 : 20} />
        ) : (
          <SymbolView name={item.icon} size={compact ? 18 : 20} tintColor={active ? Accent : theme.textSecondary} />
        )}
        <ThemedText type={active ? 'smallBold' : 'small'} themeColor={active ? 'text' : 'textSecondary'} numberOfLines={1}>
          {item.label}
        </ThemedText>
      </Pressable>
    </Link>
  );
}

// react-native-web passes CSS transitions through; they aren't in React Native's style types.
const navTransition = { transitionProperty: 'background-color', transitionDuration: '160ms' } as object;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  sidebar: { width: 240, paddingHorizontal: Spacing.three, paddingVertical: Spacing.four, gap: Spacing.four, borderRightWidth: 1 },
  brand: { paddingHorizontal: Spacing.two + Spacing.one, paddingBottom: Spacing.two },
  brandTop: { paddingHorizontal: Spacing.four - Spacing.one },
  group: { gap: Spacing.half },
  groupLabel: { fontSize: 11, letterSpacing: 0.8, paddingHorizontal: Spacing.two + Spacing.one, marginBottom: Spacing.one },
  bottom: { marginTop: 'auto' },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - Spacing.one, height: 40, paddingHorizontal: Spacing.two + Spacing.one, borderRadius: 10 },
  linkCompact: { minHeight: 36, paddingHorizontal: Spacing.two + Spacing.one, gap: Spacing.two },
  topBar: { paddingTop: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two, borderBottomWidth: 1 },
  topNav: { paddingHorizontal: Spacing.two, gap: Spacing.one },
  content: { flex: 1, minWidth: 0 },
});
