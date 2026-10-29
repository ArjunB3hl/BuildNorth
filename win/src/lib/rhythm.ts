// The Rhythm (content library and personalisation) part of the API, as the website uses it (mobile/src/lib/rhythm.ts):
// the types and calls the Windows app needs. Video tasks, recommendations, page grants and search are off on the
// server (RECOMMENDATIONS_ENABLED there), so they aren't here; nor is the private-memory tab or a Codex connection,
// which the website no longer shows.

export type RhythmStatus =
  | 'ok'
  | 'irrelevant'
  | 'uncertain'
  | 'profile_required'
  | 'permission_required'
  | 'browser_unavailable'
  | 'transcript_unavailable'
  | 'transcript_partial'
  | 'stale_context'
  | 'budget_exceeded'
  | 'provider_error'
  | 'pending'
  | 'cancelled'
  | 'not_found'
  | 'task_required';

/** The user's own switches. `learn`: learn interests from coach chats and watched fitness and food videos. */
export type RhythmConsent = {
  metadata: boolean;
  transcripts: boolean;
  agent: boolean;
  memory: boolean;
  learn: boolean;
};
export type RhythmSettings = { enabledSites: string[]; consent: RhythmConsent };

export type InterestsProfile = {
  ownerUserId: string;
  profileRevision: number;
  updatedAt: string;
  confirmed: boolean;
  enabledSites: string[];
  consent: RhythmConsent;
};

export type Topic = 'boxing' | 'karate' | 'gym' | 'home exercise' | 'food';
export type Level = 'beginner' | 'intermediate' | 'advanced';

/** The user's own choices. They always win over what Rhythm infers; null means "work it out from my activity". */
export type InterestChoices = {
  pinned: Topic[];
  blocked: Topic[];
  acknowledged: Topic[];
  experienceLevel: Level | null;
  preferredDurationMinutes: number | null;
  availableEquipment: string[] | null;
};
export type LearnedInterest = {
  topic: Topic;
  state: 'pinned' | 'learned' | 'noticed' | 'blocked';
  score: number;
  videos: number;
  saved: number;
  chats: number;
  feedback: number;
  notInterested: number;
};
type Sourced<T> = { value: T; source: 'you' | 'learned' | null };
/** GET /rhythm/learned: what Rhythm learned, the evidence counts and the user's choices. */
export type LearnedView = {
  learning: boolean;
  confirmed: boolean;
  interests: LearnedInterest[];
  experienceLevel: Sourced<Level | null>;
  preferredDurationMinutes: Sourced<number | null>;
  availableEquipment: Sourced<string[]>;
  avoid: string[];
  choices: {
    pinned: Topic[];
    blocked: Topic[];
    acknowledged: Topic[];
    experience_level: Level | null;
    preferred_duration_minutes: number | null;
    available_equipment: string[] | null;
  };
  counts: { videos?: number; chats?: number; feedback?: number };
  learnedAt: string | null;
};

/** A video saved with Save to Rhythm in the Chrome extension, with Rhythm's notes once they're prepared. */
export type SavedVideo = {
  videoId: string;
  url: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  topics: string[];
  description: string | null;
  summary: string | null;
  hasTranscript: boolean;
  summaryState: 'ready' | 'generating' | 'no_transcript' | 'not_ready';
  summarizedAt: string | null;
  savedAt: string;
};

export type Capability =
  | 'interests'
  | 'saved'
  | 'page'
  | 'search'
  | 'transcripts'
  | 'recommend'
  | 'memory'
  | 'feedback';
/** An assistant or agent that may use Rhythm's tools for this account. */
export type AgentConnection = {
  id: string;
  label: string;
  clientId: string;
  status: string;
  capabilities: Capability[];
};

export type RhythmResult = {
  status: RhythmStatus;
  message: string;
  profileRevision?: number;
  profile?: InterestsProfile;
  savedVideos?: SavedVideo[];
  agents?: AgentConnection[];
  /** GET /rhythm/learned and choice saves give a LearnedView; GET /rhythm/interests a short summary. */
  learned?: LearnedView | Record<string, unknown>;
};

type Request = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs?: number,
) => Promise<T>;

export function createRhythmApi(request: Request) {
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ) => request<RhythmResult>(method, `/rhythm${path}`, body, timeoutMs);
  return {
    interests: () => call('GET', '/interests'),
    /** The switches only; interests themselves are learned by the backend. */
    saveSettings: (settings: RhythmSettings, expectedRevision: number) =>
      call('PUT', '/settings', { ...settings, expectedRevision }),
    savedVideos: () => call('GET', '/saved'),
    /** Prepares the notes for a saved video from its transcript (it can take a minute). */
    summarizeVideo: (videoId: string) =>
      call(
        'POST',
        `/saved/${encodeURIComponent(videoId)}/summary`,
        undefined,
        120_000,
      ),
    learned: () => call('GET', '/learned'),
    /** Only the fields sent change; a whole list replaces it, and null hands a value back to learning. */
    saveChoices: (
      choices: Partial<InterestChoices>,
      expectedRevision: number,
    ) => call('PUT', '/choices', { ...choices, expectedRevision }),
    /** "Forget this": delete the videos behind one interest and stop counting earlier chats about it. */
    forgetTopic: (topic: Topic) => call('POST', '/forget', { topic }),
    connections: () => call('GET', '/connections'),
    revokeAgent: (id: string) => call('DELETE', `/agents/${id}`),
  };
}
export type RhythmApi = ReturnType<typeof createRhythmApi>;

/** The assistants the website offers (Claude, ChatGPT): a Codex connection is left out, as on the website now. */
export function shownConnection(agent: AgentConnection): boolean {
  return !/codex/i.test(agent.clientId) && !/codex/i.test(agent.label);
}

/** "home exercise" → "Home exercise". */
export function topicLabel(topic: string): string {
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

/** 754 → "12:34"; 3725 → "1:02:05". */
export function videoLength(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) {
    return null;
  }
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Only YouTube links open from the library: anything else in a saved record is not followed. */
export function youtubeLink(
  video: Pick<SavedVideo, 'url' | 'videoId'>,
): string {
  const ok = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(
    video.url ?? '',
  );
  return ok
    ? video.url
    : `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
}
