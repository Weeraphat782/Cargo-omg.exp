import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChangeMoveInput,
  ChangeMoveRow,
  ChangeSetRow,
  SlotRow,
  SlotWithJob,
} from './types';

export type ChangeControlDeps = {
  supabase: SupabaseClient;
};

export async function listSlots(
  deps: ChangeControlDeps,
  opts?: { load_date?: string },
): Promise<SlotWithJob[]> {
  let q = deps.supabase.from('slots').select('*').order('load_date', { ascending: true, nullsFirst: false });
  if (opts?.load_date) {
    q = q.eq('load_date', opts.load_date);
  }
  const { data: slotRows, error } = await q;
  if (error) throw new Error(error.message);

  const { data: assigns, error: aErr } = await deps.supabase
    .from('slot_assignments')
    .select(
      'slot_id, quotation_id, quotations ( quotation_no, company_name, pallets )',
    )
    .eq('active', true);
  if (aErr) throw new Error(aErr.message);

  const assignBySlot = new Map(
    (assigns ?? []).map((a) => [a.slot_id as string, a]),
  );

  const withJobs: SlotWithJob[] = (slotRows ?? []).map((row) => {
    const base = row as SlotRow;
    const a = assignBySlot.get(base.id);
    const qRow = a?.quotations as { quotation_no?: string; company_name?: string; pallets?: unknown[] } | undefined;
    const pallets = qRow?.pallets;
    return {
      ...base,
      quotation_id: (a?.quotation_id as string) ?? null,
      quotation_no: qRow?.quotation_no ?? null,
      company_name: qRow?.company_name ?? null,
      actual_pallets: Array.isArray(pallets) ? pallets.length : undefined,
    };
  });

  return withJobs.sort((a, b) => {
    const da = a.load_date ?? '';
    const db = b.load_date ?? '';
    return da.localeCompare(db);
  });
}

export async function getSlot(deps: ChangeControlDeps, slotId: string): Promise<SlotWithJob | null> {
  const slots = await listSlots(deps);
  return slots.find((s) => s.id === slotId) ?? null;
}

export async function listParkingJobs(deps: ChangeControlDeps) {
  const { data: ended, error } = await deps.supabase
    .from('slot_assignments')
    .select('quotation_id, quotations ( id, quotation_no, company_name, pallets )')
    .eq('active', false)
  if (error) throw new Error(error.message);

  const { data: active, error: aErr } = await deps.supabase
    .from('slot_assignments')
    .select('quotation_id')
    .eq('active', true);
  if (aErr) throw new Error(aErr.message);

  const activeIds = new Set((active ?? []).map((r) => r.quotation_id as string));
  const seen = new Set<string>();
  const rows: Array<{
    quotation_id: string;
    quotation_no?: string;
    company_name?: string;
    actual_pallets?: number;
  }> = [];

  for (const row of ended ?? []) {
    const qid = row.quotation_id as string;
    if (activeIds.has(qid) || seen.has(qid)) continue;
    seen.add(qid);
    const q = row.quotations as { quotation_no?: string; company_name?: string; pallets?: unknown[] };
    rows.push({
      quotation_id: qid,
      quotation_no: q?.quotation_no,
      company_name: q?.company_name,
      actual_pallets: Array.isArray(q?.pallets) ? q.pallets.length : undefined,
    });
  }
  return rows;
}

export async function createChangeSet(
  deps: ChangeControlDeps,
  params: { reason?: string; created_by: string },
): Promise<ChangeSetRow> {
  const { data, error } = await deps.supabase
    .from('change_sets')
    .insert({
      reason: params.reason ?? null,
      created_by: params.created_by,
      status: 'draft',
      code: '',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ChangeSetRow;
}

export async function addMove(
  deps: ChangeControlDeps,
  changeSetId: string,
  move: ChangeMoveInput,
): Promise<ChangeMoveRow> {
  const { data: maxRow } = await deps.supabase
    .from('change_moves')
    .select('seq')
    .eq('change_set_id', changeSetId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  const seq = (maxRow?.seq ?? 0) + 1;
  const { data, error } = await deps.supabase
    .from('change_moves')
    .insert({
      change_set_id: changeSetId,
      seq,
      quotation_id: move.quotation_id,
      from_slot_id: move.from_slot_id ?? null,
      to_slot_id: move.to_slot_id ?? null,
      move_type: move.move_type,
      new_slot: move.new_slot ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ChangeMoveRow;
}

export async function getChangeSet(
  deps: ChangeControlDeps,
  id: string,
): Promise<{ set: ChangeSetRow; moves: ChangeMoveRow[] } | null> {
  const { data: set, error } = await deps.supabase
    .from('change_sets')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!set) return null;

  const { data: moves, error: mErr } = await deps.supabase
    .from('change_moves')
    .select('*')
    .eq('change_set_id', id)
    .order('seq', { ascending: true });
  if (mErr) throw new Error(mErr.message);

  return { set: set as ChangeSetRow, moves: (moves ?? []) as ChangeMoveRow[] };
}

export async function listChangeSets(deps: ChangeControlDeps, limit = 30): Promise<ChangeSetRow[]> {
  const { data, error } = await deps.supabase
    .from('change_sets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeSetRow[];
}

export async function applyChangeSet(
  deps: ChangeControlDeps,
  changeSetId: string,
  actorId: string,
): Promise<{ ok: boolean; code?: string }> {
  const { data, error } = await deps.supabase.rpc('apply_change_set', {
    p_id: changeSetId,
    p_actor: actorId,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: true }) as { ok: boolean; code?: string };
}

export async function slotHistory(
  deps: ChangeControlDeps,
  ref: { quotation_id?: string; slot_id?: string },
) {
  let q = deps.supabase
    .from('slot_events')
    .select('*, change_sets ( code )')
    .order('created_at', { ascending: false })
    .limit(100);

  if (ref.quotation_id) q = q.eq('quotation_id', ref.quotation_id);
  if (ref.slot_id) q = q.eq('slot_id', ref.slot_id);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function activeAssignments(deps: ChangeControlDeps) {
  const { data, error } = await deps.supabase
    .from('slot_assignments')
    .select('slot_id, quotation_id')
    .eq('active', true);
  if (error) throw new Error(error.message);
  return (data ?? []) as { slot_id: string; quotation_id: string }[];
}