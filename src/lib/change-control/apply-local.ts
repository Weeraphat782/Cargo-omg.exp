import type { ChangeMoveInput } from './types';
import { simulateAssignments, snapshotFromPairs, checkGuards } from './guards';

export type LocalApplyState = {
  assignments: { slot_id: string; quotation_id: string }[];
  events: { quotation_id: string; move_type: string }[];
};

export function applyMovesLocally(
  initial: { slot_id: string; quotation_id: string }[],
  moves: ChangeMoveInput[],
  palletMeta?: {
    jobPallets: Map<string, number>;
    slotBookedPallets: Map<string, number>;
  },
): { ok: true; state: LocalApplyState } | { ok: false; error: string } {
  const snap = snapshotFromPairs(initial);
  const guard = checkGuards({
    initial: snap,
    moves,
    jobPallets: palletMeta?.jobPallets ?? new Map(),
    slotBookedPallets: palletMeta?.slotBookedPallets ?? new Map(),
  });
  if (guard.errors.length) {
    return { ok: false, error: guard.errors[0] };
  }

  const final = simulateAssignments(snap, moves);
  const pairs: { slot_id: string; quotation_id: string }[] = [];
  for (const [slot_id, quotation_id] of final.slotToJob) {
    pairs.push({ slot_id, quotation_id });
  }
  return {
    ok: true,
    state: {
      assignments: pairs,
      events: moves.map((m) => ({ quotation_id: m.quotation_id, move_type: m.move_type })),
    },
  };
}