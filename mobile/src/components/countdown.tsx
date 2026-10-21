import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Vibration } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, Row } from '@/components/ui';
import { formatDuration } from '@/lib/dates';

/**
 * In-app countdown (runs while the screen is open; no background notifications).
 * Give it a `key` that changes with the step so a new step starts a fresh timer.
 */
export function Countdown({ seconds, label }: { seconds: number; label: string }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const endsAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    endsAt.current = Date.now() + remaining * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round(((endsAt.current ?? 0) - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        Vibration.vibrate(500);
      }
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="title" style={styles.time} accessibilityLabel={`${label}: ${formatDuration(remaining)} remaining`}>
        {formatDuration(remaining)}
      </ThemedText>
      {remaining === 0 ? <Notice tone="success">Time&apos;s up.</Notice> : null}
      <Row>
        <Button
          title={running ? 'Pause' : remaining === seconds ? 'Start timer' : remaining === 0 ? 'Restart' : 'Resume'}
          size="small"
          onPress={() => {
            if (running) {
              setRunning(false);
              return;
            }
            if (remaining === 0) setRemaining(seconds);
            setRunning(true);
          }}
        />
        <Button
          title="Reset"
          size="small"
          variant="secondary"
          onPress={() => {
            setRunning(false);
            setRemaining(seconds);
          }}
        />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({ time: { fontVariant: ['tabular-nums'] } });
