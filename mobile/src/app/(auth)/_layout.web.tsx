import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AiOrb } from '@/components/ai-orb';
import { LoadingScreen } from '@/components/form';
import { gradientStyle } from '@/components/gradient';
import { FadeIn } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { AiColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function WebAuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const theme = useTheme();
  const wide = useWindowDimensions().width >= 900;
  if (!isLoaded) return <LoadingScreen label="Loading…" />;
  if (isSignedIn) return <Redirect href="/" />;
  return <View style={[s.root, wide && s.row, { backgroundColor: theme.background }]}>
    {wide ? (
      <View style={[s.story, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
        <Wordmark />
        <View style={s.storyBody}>
          <FadeIn>
            <View style={s.orbWrap}>
              <View style={[s.halo, gradientStyle(`radial-gradient(circle, ${AiColors.glow}, transparent 70%)`)]} />
              <AiOrb size={56} />
            </View>
          </FadeIn>
          <FadeIn index={1}>
            <ThemedText type="subtitle">Meals, movement and the videos worth your time.</ThemedText>
          </FadeIn>
          <FadeIn index={2}>
            <ThemedText themeColor="textSecondary">
              Plan your week with an AI coach that knows your preferences, keep track of what you do, and collect the
              workouts and recipes you choose with the Rhythm extension for Chrome.
            </ThemedText>
          </FadeIn>
        </View>
        <ThemedText type="small" themeColor="textSecondary">Use the same account as the phone app and the extension.</ThemedText>
      </View>
    ) : (
      <View style={s.narrowHeader}><Wordmark /></View>
    )}
    <View style={[s.form, wide && s.formWide]}><Stack screenOptions={{ headerShown: false }} /></View>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row' },
  story: { width: '42%', maxWidth: 560, padding: Spacing.six, justifyContent: 'space-between', borderRightWidth: StyleSheet.hairlineWidth },
  storyBody: { gap: Spacing.three, maxWidth: 440 },
  orbWrap: { width: 56, height: 56, marginBottom: Spacing.two },
  halo: { position: 'absolute', width: 180, height: 180, left: -62, top: -62 },
  narrowHeader: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  form: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  formWide: { alignSelf: 'auto', marginHorizontal: 'auto', paddingTop: Spacing.six },
});
