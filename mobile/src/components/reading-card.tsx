import { StyleSheet } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, Row } from '@/components/ui';

/** Shown while the AI reads pasted text (a recipe or a workout): the coach's orb, thinking, with a way to cancel. */
export function ReadingCard({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <Card>
      <Row>
        <AiOrb size={28} thinking />
        <ThemedText type="small" style={styles.fill} accessibilityLiveRegion="polite">
          {label}
        </ThemedText>
        <Button title="Cancel" size="small" variant="quiet" onPress={onCancel} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
