import { Redirect } from 'expo-router';

/** The browser handoff approval page is available only on the web. */
export default function MacConnectUnavailable() {
  return <Redirect href="/" />;
}
