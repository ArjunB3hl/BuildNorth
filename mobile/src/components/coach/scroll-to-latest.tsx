import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { FadeIn, liftStyle, useHover } from '@/components/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A round button floating above the composer that jumps back to the newest message. */
export function ScrollToLatest({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View style={styles.overlay}>
      <FadeIn>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to the latest message"
          onPress={onPress}
          hitSlop={8}
          {...hoverProps}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            liftStyle(hovered),
            pressed && styles.pressed,
          ]}>
          <SymbolView name={{ ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' }} size={18} tintColor={theme.text} />
        </Pressable>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  // Spans the list's width so the button centres, without blocking touches around it.
  overlay: { position: 'absolute', left: 0, right: 0, bottom: Spacing.three, alignItems: 'center', pointerEvents: 'box-none' },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(16, 24, 40, 0.14)',
  },
  pressed: { transform: [{ scale: 0.94 }] },
});
