import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveOpCardId } from '@/lib/mcp/booking-service';

export type CaseClosureRef = {
  quotation_id?: string;
  omg_number?: string;
  op_card_id?: string;
};

export type ClosureSnapshot = {
  stage: string;
  quotations: { id: string; status: string }[];
  closed_at: string;
  closure_status: 'lost' | 'won';
};

export type OpportunityClosureRow = {
  id: string;
  stage: string;
  closure_status: 'won' | 'lost' | null;
  closure_snapshot: ClosureSnapshot | null;
  notes: string | null;
  customer_name: string | null;
  updated_at: string;
};

export type QuoteLinkRow = {
  id: string;
  status: string;
  quotation_no: string | null;
};

export type CaseClosureResult = {
  ok: true;
  op_card_id: string;
  omg_number: string | null;
  customer: string | null;
  stage: string;
  status: 'Open' | 'Lose Case' | 'Completed';
  notes: string | null;
  updated_at: string;
};

export type CaseClosureDeps = {
  resolveOpCardId: (ref: CaseClosureRef) => Promise<string>;
  loadOpportunity: (opCardId: string) => Promise<OpportunityClosureRow | null>;
  listQuotations: (opCardId: string) => Promise<QuoteLinkRow[]>;
  updateOpportunity: (
    opCardId: string,
    patch: Record<string, unknown>
  ) => Promise<OpportunityClosureRow>;
  setQuotationStatus: (quotationId: string, status: string) => Promise<void>;
  completeLinkedQuotations: (opCardId: string) => Promise<void>;
  logActivity: (
    quotationId: string,
    event: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
};

const COMPLETE_STAGES = new Set(['delivered', 'payment_received']);

export function bangkokNoteStamp(date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `[${formatted}]`;
}

export function appendNoteLine(existing: string | null | undefined, line: string): string {
  const base = (existing || '').trimEnd();
  return base ? `${base}\n${line}` : line;
}

export function uiClosureStatus(
  closure: 'won' | 'lost' | null | undefined
): 'Open' | 'Lose Case' | 'Completed' {
  if (closure === 'lost') return 'Lose Case';
  if (closure === 'won') return 'Completed';
  return 'Open';
}

function assertRef(ref: CaseClosureRef): void {
  if (!ref.op_card_id?.trim() && !ref.omg_number?.trim() && !ref.quotation_id?.trim()) {
    throw new Error('Provide op_card_id, omg_number, or quotation_id.');
  }
}

function buildSnapshot(
  opp: OpportunityClosureRow,
  quotes: QuoteLinkRow[],
  closure_status: 'lost' | 'won'
): ClosureSnapshot {
  return {
    stage: opp.stage,
    quotations: quotes.map((q) => ({ id: q.id, status: q.status })),
    closed_at: new Date().toISOString(),
    closure_status,
  };
}

function primaryOmg(quotes: QuoteLinkRow[]): string | null {
  return quotes[0]?.quotation_no ?? null;
}

function toResult(
  opp: OpportunityClosureRow,
  quotes: QuoteLinkRow[]
): CaseClosureResult {
  return {
    ok: true,
    op_card_id: opp.id,
    omg_number: primaryOmg(quotes),
    customer: opp.customer_name,
    stage: opp.stage,
    status: uiClosureStatus(opp.closure_status),
    notes: opp.notes,
    updated_at: opp.updated_at,
  };
}

async function auditAll(
  deps: CaseClosureDeps,
  quotes: QuoteLinkRow[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  await Promise.all(quotes.map((q) => deps.logActivity(q.id, event, payload)));
}

export async function markLoseCaseCore(
  deps: CaseClosureDeps,
  ref: CaseClosureRef,
  reason: string,
  note?: string
): Promise<CaseClosureResult> {
  assertRef(ref);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('reason is required.');

  const opCardId = await deps.resolveOpCardId(ref);
  const opp = await deps.loadOpportunity(opCardId);
  if (!opp) throw new Error('Opportunity not found.');

  if (opp.closure_status === 'lost') {
    throw new Error('Job is already Lose Case.');
  }
  if (opp.closure_status === 'won') {
    throw new Error('Job is Completed; use reopen_case first.');
  }

  const quotes = await deps.listQuotations(opCardId);
  const snapshot = buildSnapshot(opp, quotes, 'lost');
  const noteLine = `${bangkokNoteStamp()} Lose Case: ${trimmedReason} (via MCP)${
    note?.trim() ? ` — ${note.trim()}` : ''
  }`;

  const updated = await deps.updateOpportunity(opCardId, {
    closure_status: 'lost',
    closure_reason: trimmedReason,
    closure_date: new Date().toISOString(),
    closure_snapshot: snapshot,
    notes: appendNoteLine(opp.notes, noteLine),
  });

  await auditAll(deps, quotes, 'case_lost', {
    op_card_id: opCardId,
    from: 'Open',
    to: 'Lose Case',
    reason: trimmedReason,
    stage: opp.stage,
  });

  return toResult(updated, quotes);
}

export async function completeCaseCore(
  deps: CaseClosureDeps,
  ref: CaseClosureRef,
  opts: { note?: string; force?: boolean }
): Promise<CaseClosureResult> {
  assertRef(ref);
  const opCardId = await deps.resolveOpCardId(ref);
  const opp = await deps.loadOpportunity(opCardId);
  if (!opp) throw new Error('Opportunity not found.');

  if (opp.closure_status === 'won') {
    throw new Error('Job is already Completed.');
  }
  if (opp.closure_status === 'lost') {
    throw new Error('Job is Lose Case; use reopen_case first.');
  }

  const force = opts.force === true;
  if (!force && !COMPLETE_STAGES.has(opp.stage)) {
    throw new Error(
      `Cannot complete: current stage is "${opp.stage}" (needs delivered or payment_received; pass force=true to override).`
    );
  }

  const quotes = await deps.listQuotations(opCardId);
  const snapshot = buildSnapshot(opp, quotes, 'won');
  const noteLine = `${bangkokNoteStamp()} Completed (via MCP)${
    opts.note?.trim() ? ` — ${opts.note.trim()}` : ''
  }`;

  const updated = await deps.updateOpportunity(opCardId, {
    closure_status: 'won',
    closure_reason: opts.note?.trim() || null,
    closure_date: new Date().toISOString(),
    closure_snapshot: snapshot,
    notes: appendNoteLine(opp.notes, noteLine),
  });

  await deps.completeLinkedQuotations(opCardId);
  const quotesAfter = await deps.listQuotations(opCardId);

  await auditAll(deps, quotesAfter, 'case_completed', {
    op_card_id: opCardId,
    from: 'Open',
    to: 'Completed',
    stage: opp.stage,
    force,
  });

  return toResult(updated, quotesAfter);
}

export async function reopenCaseCore(
  deps: CaseClosureDeps,
  ref: CaseClosureRef,
  reason: string
): Promise<CaseClosureResult> {
  assertRef(ref);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('reason is required.');

  const opCardId = await deps.resolveOpCardId(ref);
  const opp = await deps.loadOpportunity(opCardId);
  if (!opp) throw new Error('Opportunity not found.');

  if (opp.closure_status !== 'lost' && opp.closure_status !== 'won') {
    throw new Error('Job is not closed; nothing to reopen.');
  }

  const fromLabel = uiClosureStatus(opp.closure_status);
  const quotes = await deps.listQuotations(opCardId);
  const snap = opp.closure_snapshot;

  if (snap?.quotations?.length) {
    for (const q of snap.quotations) {
      await deps.setQuotationStatus(q.id, q.status);
    }
  } else {
    for (const q of quotes) {
      if (q.status === 'completed') {
        await deps.setQuotationStatus(q.id, 'draft');
      }
    }
  }

  const noteLine = `${bangkokNoteStamp()} Reopened: ${trimmedReason} (via MCP)`;
  const stagePatch = snap?.stage ? { stage: snap.stage } : {};

  const updated = await deps.updateOpportunity(opCardId, {
    closure_status: null,
    closure_snapshot: null,
    closure_date: null,
    closure_reason: null,
    notes: appendNoteLine(opp.notes, noteLine),
    ...stagePatch,
  });

  const quotesAfter = await deps.listQuotations(opCardId);

  await auditAll(deps, quotesAfter, 'case_reopened', {
    op_card_id: opCardId,
    from: fromLabel,
    to: 'Open',
    reason: trimmedReason,
    stage: updated.stage,
  });

  return toResult(updated, quotesAfter);
}

function createDefaultDeps(): CaseClosureDeps {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  return {
    resolveOpCardId: (ref) => resolveOpCardId(supabase, ref),
    loadOpportunity: async (opCardId) => {
      const { data, error } = await supabase
        .from('opportunities')
        .select(
          'id, stage, closure_status, closure_snapshot, notes, customer_name, updated_at'
        )
        .eq('id', opCardId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const snap = data.closure_snapshot as ClosureSnapshot | null;
      return {
        id: data.id,
        stage: data.stage,
        closure_status: data.closure_status as 'won' | 'lost' | null,
        closure_snapshot: snap,
        notes: data.notes,
        customer_name: data.customer_name,
        updated_at: data.updated_at,
      };
    },
    listQuotations: async (opCardId) => {
      const { data, error } = await supabase
        .from('quotations')
        .select('id, status, quotation_no')
        .eq('opportunity_id', opCardId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as QuoteLinkRow[];
    },
    updateOpportunity: async (opCardId, patch) => {
      const { data, error } = await supabase
        .from('opportunities')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', opCardId)
        .select(
          'id, stage, closure_status, closure_snapshot, notes, customer_name, updated_at'
        )
        .single();
      if (error) throw new Error(error.message);
      return {
        id: data.id,
        stage: data.stage,
        closure_status: data.closure_status as 'won' | 'lost' | null,
        closure_snapshot: data.closure_snapshot as ClosureSnapshot | null,
        notes: data.notes,
        customer_name: data.customer_name,
        updated_at: data.updated_at,
      };
    },
    setQuotationStatus: async (quotationId, status) => {
      const { error } = await supabase
        .from('quotations')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', quotationId);
      if (error) throw new Error(error.message);
    },
    completeLinkedQuotations: async (opCardId) => {
      const { error } = await supabase
        .from('quotations')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('opportunity_id', opCardId)
        .neq('status', 'rejected');
      if (error) throw new Error(error.message);
    },
    logActivity: async (quotationId, event, payload) => {
      const { error } = await supabase.from('quotation_activity_log').insert({
        quotation_id: quotationId,
        event,
        actor: 'mcp',
        payload,
      });
      if (error) throw new Error(error.message);
    },
  };
}

export async function markLoseCase(
  ref: CaseClosureRef,
  reason: string,
  note?: string
): Promise<CaseClosureResult> {
  return markLoseCaseCore(createDefaultDeps(), ref, reason, note);
}

export async function completeCase(
  ref: CaseClosureRef,
  opts?: { note?: string; force?: boolean }
): Promise<CaseClosureResult> {
  return completeCaseCore(createDefaultDeps(), ref, opts ?? {});
}

export async function reopenCase(
  ref: CaseClosureRef,
  reason: string
): Promise<CaseClosureResult> {
  return reopenCaseCore(createDefaultDeps(), ref, reason);
}