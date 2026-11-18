import type { ChangeMoveInput } from './types';

/** B takes A's slot; A goes to Parking until another move assigns A. */
export function buildReplaceMoves(params: {
  jobInSlotId: string;
  jobInSlotFromSlotId: string;
  replacementJobId: string;
  replacementFromSlotId?: string | null;
}): ChangeMoveInput[] {
  return [
    {
      quotation_id: params.replacementJobId,
      from_slot_id: params.replacementFromSlotId ?? null,
      to_slot_id: params.jobInSlotFromSlotId,
      move_type: 'replace',
    },
    {
      quotation_id: params.jobInSlotId,
      from_slot_id: params.jobInSlotFromSlotId,
      to_slot_id: null,
      move_type: 'park',
    },
  ];
}

export function buildSwapMoves(params: {
  jobAId: string;
  slotAId: string;
  jobBId: string;
  slotBId: string;
}): ChangeMoveInput[] {
  return [
    {
      quotation_id: params.jobAId,
      from_slot_id: params.slotAId,
      to_slot_id: params.slotBId,
      move_type: 'swap',
    },
    {
      quotation_id: params.jobBId,
      from_slot_id: params.slotBId,
      to_slot_id: params.slotAId,
      move_type: 'swap',
    },
  ];
}

export function buildMoveIntoVacant(params: {
  jobId: string;
  fromSlotId: string | null;
  toSlotId: string;
}): ChangeMoveInput {
  return {
    quotation_id: params.jobId,
    from_slot_id: params.fromSlotId,
    to_slot_id: params.toSlotId,
    move_type: 'move',
  };
}

export function buildParkMove(params: {
  jobId: string;
  fromSlotId: string;
}): ChangeMoveInput {
  return {
    quotation_id: params.jobId,
    from_slot_id: params.fromSlotId,
    to_slot_id: null,
    move_type: 'park',
  };
}

export function buildNewBookingMove(params: {
  jobId: string;
  fromSlotId: string | null;
  new_slot: NonNullable<ChangeMoveInput['new_slot']>;
}): ChangeMoveInput {
  return {
    quotation_id: params.jobId,
    from_slot_id: params.fromSlotId,
    to_slot_id: null,
    move_type: 'new_booking',
    new_slot: params.new_slot,
  };
}