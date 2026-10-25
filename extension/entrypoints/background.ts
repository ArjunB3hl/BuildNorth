import { defineBackground } from 'wxt/utils/define-background';
import { LEARN_KEY, YOUTUBE_ACCESS, chromeLearningEnv, createLearningObserver, type LearningFlag } from '../lib/learning';
import { forgetSignedInAccount, signedInAccount } from '../lib/worker-session';

/**
 * No token, job, or permanent network connection lives in the service worker. Learning (lib/learning.ts) runs here
 * only while the panel's switch is on and Chrome granted the optional YouTube permission.
 */
export default defineBackground(() => {
  void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const learning = createLearningObserver(chromeLearningEnv(signedInAccount));

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    // Open synchronously from the action gesture. A side-panel button alone cannot grant activeTab.
    void chrome.sidePanel.open({ tabId: tab.id });
    let url: URL;
    try { url = new URL(tab.url ?? ''); } catch { void chrome.storage.session.remove('invocation'); return; }
    const videoId = url.searchParams.get('v');
    if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch' || !/^[\w-]{11}$/.test(videoId ?? '')) {
      void chrome.storage.session.remove('invocation');
      return;
    }
    void chrome.storage.session.set({
      invocation: { tabId: tab.id, url: `https://www.youtube.com/watch?v=${videoId}`, invokedAt: Date.now(), nonce: crypto.randomUUID() },
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    // Chrome reports a tab's URL only for sites the extension may access, so without the YouTube permission
    // learning never sees one, and a tab that moves to another site reports none: that ends its checks.
    // YouTube changes videos in-page; those arrive as URL changes too.
    if (change.url !== undefined || change.status !== undefined) void learning.tabChanged(tabId, tab.url, tab.active);
    if (!change.url && change.status !== 'loading') return;
    void chrome.storage.session.get<{ invocation?: { tabId: number } }>('invocation').then(({ invocation }) => {
      if (invocation?.tabId === tabId) return chrome.storage.session.remove('invocation');
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void learning.tabClosed(tabId);
    void chrome.storage.session.get<{ invocation?: { tabId: number } }>('invocation').then(({ invocation }) => {
      if (invocation?.tabId === tabId) return chrome.storage.session.remove('invocation');
    });
  });
  chrome.alarms.onAlarm.addListener((alarm) => void learning.alarm(alarm.name));
  chrome.permissions.onRemoved.addListener((removed) => {
    // Removing YouTube access (in the panel or in Chrome's own settings) turns learning off in this browser.
    if (removed.origins?.some((origin) => YOUTUBE_ACCESS.origins.includes(origin))) void learning.stop(true);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((key) => key.includes('__clerk_client_jwt'))) forgetSignedInAccount();
    const change = changes[LEARN_KEY];
    if (!change) return;
    const before = change.oldValue as LearningFlag | undefined, after = change.newValue as LearningFlag | undefined;
    if (before?.userId === after?.userId) return;
    void learning.stop().then(async () => {
      if (!after) return;
      // Turned on: start checking videos that are already open. Their first check is only a baseline, since
      // whatever played before learning was on doesn't count.
      for (const tab of await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' })) {
        if (tab.id !== undefined) void learning.tabChanged(tab.id, tab.url);
      }
    }).catch(() => undefined);
  });
});
