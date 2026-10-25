import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { FadeIn } from '@/components/motion';

/**
 * Fades its content up into place when `when` is true, and is a plain view otherwise. Keep `when`
 * fixed for the life of the element: switching it swaps the wrapper and remounts the content.
 */
export function Appear({ when, delay, index, style, children }: {
  when: boolean;
  delay?: number;
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!when) return <View style={style}>{children}</View>;
  return (
    <FadeIn delay={delay} index={index} style={style}>
      {children}
    </FadeIn>
  );
}
