// The weekly plan the user is still reviewing. Kept on this device only (per user) so an
// unfinished review survives an app restart; nothing here is saved to the plan until accepted.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Proposal, ProposalItem } from '@/lib/types';

export type PlanDraft = {
  proposal: Pick<Proposal, 'proposalId' | 'startDate' | 'days' | 'summary' | 'facts' | 'notes'>;
  /** Items as the user has edited them. */
  items: ProposalItem[];
  /** Keys of items already saved to the plan. */
  accepted: string[];
};

export function planDraftKeyFor(userId: string) {
  return `buildnorth-plan-draft-v1-${userId}`;
}

export async function loadPlanDraft(userId: string): Promise<PlanDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(planDraftKeyFor(userId));
    return raw ? (JSON.parse(raw) as PlanDraft) : null;
  } catch {
    return null;
  }
}

export async function savePlanDraft(userId: string, draft: PlanDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(planDraftKeyFor(userId), JSON.stringify(draft));
  } catch {
    // Storage unavailable: the draft still works for this session.
  }
}

export async function clearPlanDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(planDraftKeyFor(userId));
  } catch {
    // Nothing to clear.
  }
}

export function draftFromProposal(proposal: Proposal): PlanDraft {
  const { items, ...rest } = proposal;
  return { proposal: rest, items, accepted: [] };
}
