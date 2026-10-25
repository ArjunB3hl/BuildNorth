import { Alert, Platform } from 'react-native';

/**
 * Ask the user to confirm an action. Resolves true only when they confirm.
 * React Native Web's Alert.alert does nothing, so the web uses the browser's own dialog.
 */
export function confirmAction({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false }: {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Native only: the browser's own dialog always shows OK and Cancel. */
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
