/** Pure TypeScript contract/client shared by the phone and the WXT side panel. No native imports. */
export type RhythmStatus =
  | 'ok' | 'irrelevant' | 'uncertain' | 'profile_required' | 'permission_required' | 'browser_unavailable'
  | 'transcript_unavailable' | 'transcript_partial' | 'stale_context' | 'budget_exceeded' | 'provider_error'
  | 'pending' | 'cancelled' | 'not_found' | 'task_required';

export type Interests = {
  originalGoalText: string;
  topics: string[];
  purposes: string[];
  experienceLevel: 'beginner' | 'intermediate' | 'advanced' | null;
  preferredDurationMinutes: number | null;
  strictDuration: boolean;
  availableEquipment: string[];
  preferredLanguages: string[];
  excludedTopics: string[];
  excludedContentTypes: string[];
  enabledSites: string[];
  consent: RhythmConsent;
};
/** The user's own switches. `learn`: learn interests automatically from coach chats and watched fitness/food videos. */
export type RhythmConsent = { metadata: boolean; transcripts: boolean; agent: boolean; memory: boolean; learn: boolean };
export type RhythmSettings = { enabledSites: string[]; consent: RhythmConsent };
/** One watched video for learning, sent by the extension only after the user turned learning on. */
export type WatchSignal = {
  metadata: VideoMetadata; capturedAt: string; transcript?: { segments: TranscriptSegment[] };
  /** Seconds actually played while the tab was visible (skips and background play excluded). */
  engagement?: { playedSeconds: number };
};
/** "Save to Rhythm" (more like this) or "Not interested" on the current video. */
export type Reaction = 'more' | 'less';
export type Topic = 'boxing' | 'karate' | 'gym' | 'home exercise' | 'food';
export type Level = 'beginner' | 'intermediate' | 'advanced';
/** The user's own choices. They always win over what Rhythm infers; null means "work it out from my activity". */
export type InterestChoices = {
  pinned: Topic[]; blocked: Topic[]; acknowledged: Topic[];
  experienceLevel: Level | null; preferredDurationMinutes: number | null; availableEquipment: string[] | null;
};
export type LearnedInterest = {
  topic: Topic; state: 'pinned' | 'learned' | 'noticed' | 'blocked'; score: number;
  videos: number; saved: number; chats: number; feedback: number; notInterested: number;
};
type Sourced<T> = { value: T; source: 'you' | 'learned' | null };
/** GET /rhythm/learned: what Rhythm learned, the evidence counts, the user's choices and any prompt to show. */
export type LearnedView = {
  learning: boolean; confirmed: boolean; interests: LearnedInterest[];
  experienceLevel: Sourced<Level | null>; preferredDurationMinutes: Sourced<number | null>;
  availableEquipment: Sourced<string[]>; avoid: string[];
  choices: { pinned: Topic[]; blocked: Topic[]; acknowledged: Topic[]; experience_level: Level | null;
    preferred_duration_minutes: number | null; available_equipment: string[] | null };
  suggestion: { topic: Topic; text: string } | null;
  counts: { videos?: number; chats?: number; feedback?: number }; learnedAt: string | null; deferred: boolean;
};
export type InterestsProfile = Interests & {
  ownerUserId: string; profileRevision: number; updatedAt: string; confirmed: boolean;
};
export type VideoMetadata = {
  videoId: string; canonicalUrl: string; title: string | null; channelName: string | null;
  descriptionExcerpt: string | null; durationSeconds: number | null;
};
export type Relevance = {
  status: 'relevant' | 'irrelevant' | 'uncertain'; reasons: string[]; matchingPreferences: string[];
  limitations: string[]; score: number;
};
export type Candidate = {
  id: string; taskId: string; videoId: string; metadata: VideoMetadata | null; relevance: Relevance;
  shortlisted: boolean; capturedAt: string; source: 'selected_page' | 'youtube_api';
};
export type BrowserSession = {
  id: string; label: string; status: string; pageRef: string; videoId: string; metadata: VideoMetadata | null;
  capturedAt: string; available: boolean; allowTranscripts: boolean;
};
export const CAPABILITIES = ['interests', 'saved', 'page', 'search', 'transcripts', 'recommend', 'memory', 'feedback'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Video tasks, page grants, search and recommendations are turned off for now. The apps and the extension hide them,
 * and the server refuses them until RHYTHM_RECOMMENDATIONS is on: switch both together. Learning, reactions and
 * the interest profile work either way.
 */
export const RECOMMENDATIONS_ENABLED = false;
/** The agent permissions that still mean something while recommendations are off. */
export const AGENT_CAPABILITIES: readonly Capability[] = RECOMMENDATIONS_ENABLED ? CAPABILITIES : ['interests', 'saved', 'memory'];
/** Assistants that connect by signing in (OAuth) rather than with a token. Their approval's clientId is `assistant:<name>`. */
export type Assistant = 'claude' | 'chatgpt' | 'codex';
export type AgentConnection = { id: string; label: string; clientId: string; status: string; capabilities: Capability[] };
export type VideoTask = {
  id: string; action: 'evaluate' | 'recommend'; request: string; status: string; profileRevision: number;
  analyzeTranscripts: boolean; browserSessionId: string | null; agentId: string | null; expiresAt: string;
  candidateChecks: number; transcriptAttempts: number; cacheHits: number; candidates: Candidate[];
};
export type TaskInput = {
  action: 'evaluate' | 'recommend'; request: string; analyzeTranscripts: boolean; browserSessionId?: string | null;
  agentId?: string | null; idempotencyKey: string;
};
export type TranscriptSegment = { startSeconds: number; text: string };
export type Transcript = {
  id: string; videoId: string; language: string | null; source: string; completeness: 'complete' | 'partial';
  capturedAt: string; segments: TranscriptSegment[]; offset: number; nextOffset: number | null;
  totalSegments: number; limitation: string;
};
export type BrowserRequest = {
  id: string; taskId: string; candidateId: string; browserSessionId: string; operation: 'read_displayed_transcript';
  pageRef: string; videoId: string; language: string | null; profileRevision: number; expiresAt: string; idempotencyKey: string;
};
export type TranscriptUpload = {
  pageRef: string; videoId: string; source: 'youtube_displayed'; language: string | null;
  completeness: 'complete' | 'partial' | 'unavailable'; capturedAt: string; segments: TranscriptSegment[];
  observedStart: boolean; observedEnd: boolean; virtualized: boolean; totalVisibleRows: number; limitation: string;
};
export type Recommendation = {
  id: string; taskId: string; videoId: string; url: string; title: string | null; durationSeconds: number | null;
  matchingPreferences: string[]; explanation: string; analysisBasis: string; sourceRefs: string[];
  excerpts: TranscriptSegment[]; limitations: string[]; profileRevision: number; createdAt: string;
  feedback: string | null; stale: boolean;
};
export type MemorySuggestion = {
  id: string; text: string; status: string; evidenceRef: string | null; memoryStatus: string; recalled: boolean;
  evidenceTitle: string | null; evidenceUrl: string | null;
};
export type RhythmMetrics = {
  day: string; candidateChecks: number; transcriptAttempts: number; cacheHits: number;
  blockedRequests: number; providerFailures: number; searchRequests: number;
};
export type SavedVideo = {
  videoId: string; url: string; title: string | null; channel: string | null; durationSeconds: number | null;
  topics: string[]; description: string | null; summary: string | null; hasTranscript: boolean;
  summaryState: 'ready' | 'generating' | 'no_transcript' | 'not_ready';
  summarizedAt: string | null; savedAt: string;
};
export type RhythmResult = {
  status: RhythmStatus; message: string; profileRevision?: number; profile?: InterestsProfile; taskId?: string;
  mcpUrl?: string;
  savedVideos?: SavedVideo[];
  task?: VideoTask; tasks?: VideoTask[]; candidates?: Candidate[]; browser?: BrowserSession; browsers?: BrowserSession[];
  agents?: AgentConnection[]; requests?: BrowserRequest[]; transcript?: Transcript; recommendations?: Recommendation[];
  memories?: MemorySuggestion[]; memoryStatus?: string; metrics?: RhythmMetrics;
  limits?: { candidatesPerTask: number; shortlistPerTask: number; attemptsPerTask: number; attemptsPerDay: number;
    taskMinutes: number; cacheHours: number };
  delivery?: 'saved_for_later' | 'displayed'; sourceRefs: string[]; limitations: string[]; notice: string;
  /** GET /rhythm/learned and choice saves return a LearnedView; GET /rhythm/interests a short evidence summary. */
  learned?: LearnedView | Record<string, unknown>;
};
export type RecommendationInput = {
  candidateId: string; analysisBasis: 'metadata' | 'transcript' | 'user_text';
  citations?: { segmentIndex: number; quote: string }[];
};

export const EMPTY_INTERESTS: Interests = {
  originalGoalText: '', topics: [], purposes: [], experienceLevel: null, preferredDurationMinutes: null,
  strictDuration: false, availableEquipment: [], preferredLanguages: [], excludedTopics: [],
  excludedContentTypes: [], enabledSites: [], consent: { metadata: false, transcripts: false, agent: false, memory: false, learn: false },
};

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;
export function createRhythmApi(request: Request) {
  const call = (method: string, path: string, body?: unknown) => request<RhythmResult>(method, `/rhythm${path}`, body);
  return {
    interests: () => call('GET', '/interests'),
    saveInterests: (profile: Interests, expectedRevision: number) => call('PUT', '/interests', { ...profile, expectedRevision }),
    /** Switches only; interests themselves are learned by the backend. */
    saveSettings: (settings: RhythmSettings, expectedRevision: number) => call('PUT', '/settings', { ...settings, expectedRevision }),
    recordSignal: (signal: WatchSignal) => call('POST', '/signals', signal),
    /** `transcript`: what Save to Rhythm read from YouTube's transcript panel, when the video has one. */
    react: (metadata: VideoMetadata, capturedAt: string, reaction: Reaction, transcript?: { segments: TranscriptSegment[] }) =>
      call('POST', '/reactions', { metadata, capturedAt, reaction, ...(transcript ? { transcript } : {}) }),
    savedVideos: () => call('GET', '/saved'),
    summarizeVideo: (videoId: string) => call('POST', `/saved/${encodeURIComponent(videoId)}/summary`),
    /** What Rhythm learned, with the user's choices and any "You've watched…" prompt (`result.learned`). */
    learned: () => call('GET', '/learned'),
    /** Only the fields you send change; send a whole list to replace it, and null to hand a value back to learning. */
    saveChoices: (choices: Partial<InterestChoices>, expectedRevision: number) =>
      call('PUT', '/choices', { ...choices, expectedRevision }),
    /** "Forget this": delete the videos behind one interest and stop counting earlier chats about it. */
    forgetTopic: (topic: Topic) => call('POST', '/forget', { topic }),
    metrics: () => call('GET', '/metrics'),
    connections: () => call('GET', '/connections'),
    approveAgent: (id: string, capabilities: Capability[]) => call('POST', `/agents/${id}/approve`, { capabilities }),
    revokeAgent: (id: string) => call('DELETE', `/agents/${id}`),
    /** "Connect Claude / ChatGPT / Codex": approve it here; it then signs in with this account from the assistant. */
    approveAssistant: (assistant: Assistant, capabilities: Capability[]) => call('PUT', `/assistants/${assistant}`, { capabilities }),
    createAgentToken: async (label: string, capabilities: Capability[]) => {
      const result = await request<{ token?: string; agent?: AgentConnection; message?: string }>(
        'POST', '/rhythm/agents/token', { label, capabilities });
      if (!result.token || !result.agent) throw new Error(result.message || 'The connection could not be created.');
      return { token: result.token, agent: result.agent };
    },
    permitPage: (metadata: VideoMetadata, capturedAt: string, allowTranscripts: boolean, expectedRevision: number) =>
      call('POST', '/browsers', { metadata, capturedAt, allowTranscripts, expectedRevision }),
    pauseBrowser: (id: string) => call('DELETE', `/browsers/${id}`),
    disconnectBrowser: (id: string) => call('POST', `/browsers/${id}/disconnect`),
    poll: (id: string, pageRef: string, videoId: string) => call('POST', `/browsers/${id}/poll`, { pageRef, videoId }),
    claim: (browserId: string, requestId: string, pageRef: string, videoId: string) =>
      call('POST', `/browsers/${browserId}/requests/${requestId}/claim`, { pageRef, videoId }),
    complete: (browserId: string, requestId: string, body: TranscriptUpload) =>
      call('POST', `/browsers/${browserId}/requests/${requestId}/complete`, body),
    cancelRequest: (browserId: string, requestId: string) =>
      call('DELETE', `/browsers/${browserId}/requests/${requestId}`),
    createTask: (body: TaskInput) => call('POST', '/tasks', body),
    tasks: () => call('GET', '/tasks'),
    task: (id: string) => call('GET', `/tasks/${id}`),
    approveTask: (id: string) => call('POST', `/tasks/${id}/approve`),
    cancelTask: (id: string) => call('DELETE', `/tasks/${id}`),
    addSelected: (taskId: string, browserSessionId: string) =>
      call('POST', `/tasks/${taskId}/selected`, { browserSessionId }),
    shortlist: (taskId: string, candidateIds: string[]) => call('POST', `/tasks/${taskId}/shortlist`, { candidateIds }),
    search: (taskId: string, query: string, limit = 10) => call('POST', `/tasks/${taskId}/search`, { query, limit }),
    transcript: (taskId: string, candidateId: string, language: string | null = null, offset = 0) =>
      call('POST', `/tasks/${taskId}/candidates/${candidateId}/transcript`, { language, range: { offset, limit: 40 } }),
    importTranscript: (taskId: string, candidateId: string, segments: TranscriptSegment[], language: string | null) =>
      call('POST', `/tasks/${taskId}/candidates/${candidateId}/import`, { language, completeness: 'partial', segments }),
    publish: (taskId: string, items: RecommendationInput[]) => call('POST', `/tasks/${taskId}/recommendations`, { items }),
    recommendations: () => call('GET', '/recommendations'),
    feedback: (id: string, feedback: 'saved' | 'dismissed' | 'helpful' | 'not_for_me' | 'clear', reason = '') =>
      call('POST', `/recommendations/${id}/feedback`, { feedback, reason }),
    displayed: (id: string, browserSessionId: string) =>
      call('POST', `/recommendations/${id}/displayed`, { browserSessionId }),
    memories: () => call('GET', '/memories'),
    approveMemory: (id: string) => call('POST', `/memories/${id}/approve`),
    deleteMemory: (id: string) => call('DELETE', `/memories/${id}`),
    deleteData: () => call('DELETE', '/data'),
  };
}
export type RhythmApi = ReturnType<typeof createRhythmApi>;
