import { transcriptExcerpt } from './learning';
import { keptVideo } from './relevance';
import type {
  InterestChoices, LearnedView, Reaction, RhythmApi, RhythmResult, Topic, TranscriptSegment, VideoMetadata,
} from '../../mobile/src/lib/rhythm';

/**
 * The panel's explicit choices: "Save to Rhythm" / "Not interested" on the current video, and the answers to the
 * learned-interest prompt. Kept apart from React so the tests can drive them with a stand-in backend.
 */
type Api = Pick<RhythmApi, 'interests' | 'react' | 'learned' | 'saveChoices' | 'forgetTopic'>;
/** Reads the current video; with `withTranscript`, also its transcript (opening YouTube's panel if needed). */
export type Capture = (withTranscript: boolean) => Promise<{ metadata: VideoMetadata; capturedAt: string; transcript?: TranscriptSegment[] }>;

/** The most of a saved video's transcript that's sent: the backend's limit of 400 segments and 20,000 characters. */
export const SAVED_TRANSCRIPT_SEGMENTS = 400;

export type ReactionOutcome = {
  status: RhythmResult['status'] | 'error';
  message: string;
  /** The video's title, once it was read. */
  title: string | null;
  /** Page details are off for the account: the panel links to the settings page. */
  needsSettings: boolean;
};

export const PAGE_DETAILS_OFF = 'Page details are off for your account, so Rhythm didn’t read this video.';
export const CANT_TELL = 'Rhythm can’t tell what this video is about, so nothing was sent.';

/**
 * "Save to Rhythm" ('more') or "Not interested" ('less') on the video in the active tab. Works with learning off.
 * Save to Rhythm also reads the video's transcript and sends it with the details. With page details off for the
 * account, nothing is read. A video the backend couldn't place (its kept_video rule, applied here first to the title,
 * description excerpt and transcript) isn't sent.
 */
export async function reactToVideo(api: Api, capture: Capture, reaction: Reaction): Promise<ReactionOutcome> {
  try {
    const { profile } = await api.interests();
    if (!profile?.consent.metadata || !profile.enabledSites.includes('youtube')) {
      return { status: 'permission_required', message: PAGE_DETAILS_OFF, title: null, needsSettings: true };
    }
    const { metadata, capturedAt, transcript } = await capture(reaction === 'more');
    const segments = transcriptExcerpt(transcript ?? [], SAVED_TRANSCRIPT_SEGMENTS);
    const text = [metadata.title, metadata.descriptionExcerpt, ...segments.map((s) => s.text)].filter(Boolean).join(' ');
    if (!keptVideo(text)) {
      return { status: 'irrelevant', message: CANT_TELL, title: metadata.title, needsSettings: false };
    }
    const result = await api.react(metadata, capturedAt, reaction, segments.length ? { segments } : undefined);
    const saved = result.status === 'ok' && reaction === 'more'
      ? segments.length ? ' Its transcript was saved too. Check your Content library for useful notes and the YouTube link.'
        : ' YouTube had no transcript for it, so only its details and YouTube link were saved in your Content library.'
      : '';
    return {
      status: result.status, title: metadata.title, needsSettings: result.status === 'permission_required',
      message: (result.message || (result.status === 'ok' ? 'Saved.' : result.status.replaceAll('_', ' '))) + saved,
    };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'That didn’t save. Try again.', title: null, needsSettings: false };
  }
}

/** `result.learned` from GET /rhythm/learned or a choice save; GET /rhythm/interests returns a different summary. */
export function learnedView(result: RhythmResult | undefined): LearnedView | null {
  const learned = result?.learned;
  return learned && 'choices' in learned && 'suggestion' in learned ? learned as LearnedView : null;
}

export type Answer = 'yes' | 'no' | 'forget';

/**
 * Every choice, with one topic answered. PUT /rhythm/choices replaces each field it is sent (and keeps the ones left
 * out); the current lists and settings are sent in full so the request also checks them against the revision.
 */
export function answeredChoices(choices: LearnedView['choices'], topic: Topic, answer: 'yes' | 'no'): InterestChoices {
  const without = (list: Topic[]) => list.filter((t) => t !== topic);
  return {
    pinned: answer === 'yes' ? [...without(choices.pinned), topic] : without(choices.pinned),
    blocked: answer === 'no' ? [...without(choices.blocked), topic] : without(choices.blocked),
    acknowledged: [...without(choices.acknowledged), topic],
    experienceLevel: choices.experience_level,
    preferredDurationMinutes: choices.preferred_duration_minutes,
    availableEquipment: choices.available_equipment,
  };
}

/** Yes (pin), Not interested (block) or Forget this, for the prompt's topic. A save made stale elsewhere is retried once. */
export async function answerSuggestion(api: Api, view: LearnedView, revision: number, answer: Answer): Promise<RhythmResult> {
  const topic = view.suggestion?.topic;
  if (!topic) throw new Error('There’s nothing to answer right now.');
  if (answer === 'forget') return api.forgetTopic(topic);
  const saved = await api.saveChoices(answeredChoices(view.choices, topic, answer), revision);
  if (saved.status !== 'stale_context') return saved;
  // Another screen saved first: start again from the current choices and revision.
  const fresh = await api.learned();
  const current = learnedView(fresh);
  if (!current) return saved;
  return api.saveChoices(answeredChoices(current.choices, topic, answer), fresh.profileRevision ?? 0);
}
