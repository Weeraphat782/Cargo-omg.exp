import type { AssignmentSnapshot, ChangeMoveInput, GuardResult } from './types';

export function snapshotFromPairs(
  pairs: { slot_id: string; quotation_id: string }[],
): AssignmentSnapshot {
  const slotToJob = new Map<string, string>();
  const jobToSlot = new Map<string, string>();
  for (const p of pairs) {
    slotToJob.set(p.slot_id, p.quotation_id);
    jobToSlot.set(p.quotation_id, p.slot_id);
  }
  return { slotToJob, jobToSlot };
}

export function simulateAssignments(
  initial: AssignmentSnapshot,
  moves: ChangeMoveInput[],
): AssignmentSnapshot {
  const slotToJob = new Map(initial.slotToJob);
  const jobToSlot = new Map(initial.jobToSlot);

  moves.forEach((mv, idx) => {
    const currentSlot = jobToSlot.get(mv.quotation_id);
    if (currentSlot) {
      slotToJob.delete(currentSlot);
      jobToSlot.delete(mv.quotation_id);
    }

    const target =
      mv.to_slot_id ??
      (mv.move_type === 'new_booking' ? `__new_booking_${idx}` : null);

    if (target) {
      const occupant = slotToJob.get(target);
      if (occupant && occupant !== mv.quotation_id) {
        jobToSlot.delete(occupant);
        slotToJob.delete(target);
      }
      slotToJob.set(target, mv.quotation_id);
      jobToSlot.set(mv.quotation_id, target);
    }
  });

  return { slotToJob, jobToSlot };
}

export function checkGuards(params: {
  initial: AssignmentSnapshot;
  moves: ChangeMoveInput[];
  jobPallets: Map<string, number>;
  slotBookedPallets: Map<string, number>;
}): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const final = simulateAssignments(params.initial, params.moves);

  const touchedJobs = new Set(params.moves.map((m) => m.quotation_id));
  for (const jobId of touchedJobs) {
    if (!final.jobToSlot.has(jobId)) {
      errors.push(`Job ${jobId} would remain in Parking without a target`);
    }
  }

  for (const [slotId, jobId] of final.slotToJob) {
    const booked = params.slotBookedPallets.get(slotId);
    const actual = params.jobPallets.get(jobId);
    if (booked != null && actual != null && booked !== actual) {
      warnings.push(
        `Slot ${slotId}: booked ${booked} vs actual ${actual} — ต้องแจ้ง forwarder/สายการบิน`,
      );
    }
  }

  return { errors, warnings };
}