import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { aiConic, GradientView, gradientStyle } from '@/components/gradient';
import { ThemedText } from '@/components/themed-text';
import { AiColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const web = Platform.OS === 'web';
/**
 * Web-only CSS the style types don't cover: the text area grows with its content (up to maxHeight;
 * phones grow it natively), and the browser's focus ring goes because the box itself shows focus.
 */
const webTextArea = (web ? { fieldSizing: 'content', outlineStyle: 'none' } : {}) as TextStyle;
// react-native-web passes CSS transitions through; they aren't in React Native's style types.
const shadowTransition = (web ? { transitionProperty: 'box-shadow', transitionDuration: '220ms', transitionTimingFunction: 'ease-out' } : {}) as ViewStyle;

/** The ring is this much of the gradient showing around the box. */
const RING = 1.5;
const RADIUS = 24;

const spin: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};

type KeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }> & {
  preventDefault?: () => void;
};

/**
 * The message box: a rounded field with a send button. Focusing it fades in an AI-gradient ring
 * (which slowly turns on the web). On the web, Enter sends and Shift+Enter adds a line.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  unavailable,
  sending,
  showHint,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  unavailable: boolean;
  sending: boolean;
  /** Shows the keyboard shortcut under the box (wide web screens). */
  showHint: boolean;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  // The turning gradient is a square as wide as the box's diagonal, so it always covers the ring.
  const [diagonal, setDiagonal] = useState(0);
  const canSend = !!value.trim() && !unavailable && !sending;
  const turning = web && !reduced && focused && diagonal > 0;

  const onKeyPress = (event: KeyEvent) => {
    if (!web) return;
    const { key, shiftKey, isComposing } = event.nativeEvent;
    if (key !== 'Enter' || shiftKey || isComposing) return;
    event.preventDefault?.();
    if (canSend) onSend();
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setDiagonal(Math.ceil(Math.hypot(width, height)));
  };

  return (
    <View style={styles.wrap}>
      <View onLayout={web ? onLayout : undefined} style={[styles.ring, web && shadowTransition, web && (focused ? styles.focusGlow : styles.raised)]}>
        <Animated.View
          aria-hidden
          style={[
            StyleSheet.absoluteFill,
            styles.ringClip,
            { opacity: focused ? 1 : 0 },
            !reduced && { transitionProperty: 'opacity', transitionDuration: '220ms', transitionTimingFunction: 'ease-out' },
          ]}>
          <GradientView style={StyleSheet.absoluteFill} />
          {turning ? (
            <Animated.View
              style={[
                styles.turner,
                { width: diagonal, height: diagonal, marginLeft: -diagonal / 2, marginTop: -diagonal / 2 },
                gradientStyle(aiConic),
                { animationName: spin, animationDuration: '6s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' },
              ]}
            />
          ) : null}
        </Animated.View>
        <View
          style={[
            styles.box,
            // Focused, the box's own border goes clear so the gradient ring shows instead.
            { backgroundColor: theme.backgroundElement, borderColor: focused ? 'transparent' : theme.border },
          ]}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onKeyPress={onKeyPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={unavailable ? 'Coach unavailable' : 'Message your coach'}
            placeholderTextColor={theme.textSecondary}
            multiline
            numberOfLines={web ? 1 : undefined}
            maxLength={4000}
            editable={!unavailable}
            accessibilityLabel="Message to coach"
            style={[styles.input, { color: theme.text }, web && styles.webInput, webTextArea]}
          />
          <SendButton enabled={canSend} onPress={onSend} />
        </View>
      </View>
      {showHint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Enter to send · Shift + Enter for a new line
        </ThemedText>
      ) : null}
    </View>
  );
}

/** A gradient circle with a white send icon; muted while there's nothing to send. Grows on hover, presses in. */
function SendButton({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const scale = reduced || !enabled ? 1 : pressed ? 0.9 : hovered && web ? 1.08 : 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={6}>
      <Animated.View
        style={[
          styles.send,
          { backgroundColor: theme.backgroundSelected, transform: [{ scale }] },
          web && enabled && hovered && styles.sendGlow,
          !reduced && { transitionProperty: web ? ['transform', 'boxShadow'] : 'transform', transitionDuration: '160ms', transitionTimingFunction: 'ease-out' },
        ]}>
        <Animated.View
          aria-hidden
          style={[
            StyleSheet.absoluteFill,
            { opacity: enabled ? 1 : 0 },
            !reduced && { transitionProperty: 'opacity', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' },
          ]}>
          <GradientView style={StyleSheet.absoluteFill} />
        </Animated.View>
        <SymbolView
          name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }}
          size={18}
          tintColor={enabled ? '#ffffff' : theme.textSecondary}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  ring: { borderRadius: RADIUS + RING, padding: RING },
  ringClip: { borderRadius: RADIUS + RING, overflow: 'hidden' },
  turner: { position: 'absolute', left: '50%', top: '50%' },
  raised: { boxShadow: '0 2px 8px rgba(16, 24, 40, 0.06)' },
  // A soft violet halo outside the ring while typing.
  focusGlow: { boxShadow: `0 0 0 4px ${AiColors.violet}1A, 0 6px 22px ${AiColors.blue}1F` },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two - Spacing.half,
    paddingVertical: Spacing.two - Spacing.half,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 160,
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: 0,
  },
  // A fixed line height keeps a single line centred in the box.
  webInput: { lineHeight: 24, paddingVertical: Spacing.two - Spacing.half },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sendGlow: { boxShadow: `0 4px 14px ${AiColors.violet}59` },
  hint: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
