export type SlotStatus = 'requested' | 'confirmed' | 'loaded' | 'departed' | 'cancelled';

export type ChangeSetStatus = 'draft' | 'applied' | 'cancelled';

export type MoveType = 'replace' | 'swap' | 'move' | 'park' | 'new_booking';

export type SlotRow = {
  id: string;
  airline: string;
  flight_no: string;
  flight_date: string | null;
  load_date: string | null;
  awb_number: string | null;
  booked_pallets: number;
  status: SlotStatus;
  confirmed_at: string | null;
  note: string | null;
  created_at: string;
};

export type SlotWithJob = SlotRow & {
  quotation_id?: string | null;
  quotation_no?: string | null;
  actual_pallets?: number;
  company_name?: string | null;
};

export type ChangeMoveInput = {
  quotation_id: string;
  from_slot_id?: string | null;
  to_slot_id?: string | null;
  move_type: MoveType;
  new_slot?: {
    airline?: string;
    flight_no?: string;
    flight_date?: string;
    load_date?: string;
    awb_number?: string;
    booked_pallets?: number;
  };
};

export type ChangeMoveRow = ChangeMoveInput & {
  id: string;
  change_set_id: string;
  seq: number;
};

export type ChangeSetRow = {
  id: string;
  code: string;
  status: ChangeSetStatus;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
};

export type AssignmentSnapshot = {
  slotToJob: Map<string, string>;
  jobToSlot: Map<string, string>;
};

export type GuardResult = {
  errors: string[];
  warnings: string[];
};