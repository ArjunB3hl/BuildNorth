import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Head><title>Rhythm · Demo version</title><meta name="description" content="Demo version of Rhythm, your companion for meals, movement and everyday routines." /></Head>
      <AnimatedSplashOverlay />
      {publishableKey ? (
        // tokenCache keeps the Clerk session in expo-secure-store, so it survives app restarts.
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
          <Slot />
        </ClerkProvider>
      ) : (
        <MissingConfig />
      )}
    </ThemeProvider>
  );
}

function MissingConfig() {
  return (
    <ThemedView style={styles.missing}>
      <ThemedText type="subtitle">Clerk isn&apos;t configured</ThemedText>
      <ThemedText themeColor="textSecondary">
        Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the project&apos;s .env file, then restart
        `npx expo start`.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
});
