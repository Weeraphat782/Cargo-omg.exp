import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const JOB_STAGES = [
  'inquiry',
  'quoting',
  'pending_docs',
  'pending_booking',
  'booking_requested',
  'awb_received',
  'waiting_for_pickup',
  'picked_up',
  'delivered',
  'payment_received',
] as const;

export type JobStage = (typeof JOB_STAGES)[number];

export type JobSummaryDoc = {
  id: string;
  document_type: string;
  file_name: string;
  submitted_at: string | null;
};

export type JobSummary = {
  quotation_id: string;
  omg_number: string | null;
  status: string | null;
  customer: string | null;
  destination: string | null;
  net_weight_kg: number | null;
  chargeable_weight: number | null;
  awb_number: string | null;
  flight_no: string | null;
  op_card_id: string | null;
  stage: string | null;
  pickup_date: string | null;
  created_at: string | null;
  documents?: JobSummaryDoc[];
};

const JOB_QUOTE_COLUMNS = `
  id,
  quotation_no,
  status,
  company_name,
  customer_name,
  destination,
  requested_destination,
  total_actual_weight,
  chargeable_weight,
  awb_number,
  booking_air_freight,
  created_at,
  opportunity_id
`;

type OppEmbed = { id?: string; stage?: string | null; pickup_date?: string | null };

function oneOpp(value: unknown): OppEmbed | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  return row as OppEmbed;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function flightNoFromAirFreight(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  return asString((value as { flight_no?: unknown }).flight_no);
}

/** PostgREST `or` clause. Wildcards and quotes stripped so the value cannot break the filter. */
export function quotedIlike(column: string, raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/["\\]/g, '')
    .replace(/[*%_]/g, '')
    .slice(0, 80)
    .trim();
  if (!cleaned) throw new Error('Filter text is empty.');
  return `${column}.ilike."*${cleaned}*"`;
}

export function toJobSummary(row: Record<string, unknown>, documents?: JobSummaryDoc[]): JobSummary {
  const opp = oneOpp(row.opportunities);
  const summary: JobSummary = {
    quotation_id: String(row.id),
    omg_number: asString(row.quotation_no),
    status: asString(row.status),
    customer: asString(row.company_name) || asString(row.customer_name),
    destination: asString(row.destination) || asString(row.requested_destination),
    net_weight_kg: asNumber(row.total_actual_weight),
    chargeable_weight: asNumber(row.chargeable_weight),
    awb_number: asString(row.awb_number),
    flight_no: flightNoFromAirFreight(row.booking_air_freight),
    op_card_id: asString(opp?.id) || asString(row.opportunity_id),
    stage: asString(opp?.stage),
    pickup_date: asString(opp?.pickup_date),
    created_at: asString(row.created_at),
  };
  if (documents) summary.documents = documents;
  return summary;
}

function boundIso(value: string, end: boolean): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return end ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
  }
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) throw new Error('Date must be YYYY-MM-DD or an ISO timestamp.');
  return t.toISOString();
}

async function loadCurrentDocNames(
  supabase: SupabaseClient,
  quotationIds: string[]
): Promise<Map<string, JobSummaryDoc[]>> {
  const grouped = new Map<string, JobSummaryDoc[]>();
  if (quotationIds.length === 0) return grouped;
  const { data, error } = await supabase
    .from('document_submissions')
    .select('id, quotation_id, document_type, file_name, original_file_name, submitted_at')
    .in('quotation_id', quotationIds)
    .is('superseded_at', null)
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const qid = String(row.quotation_id);
    const list = grouped.get(qid) ?? [];
    list.push({
      id: String(row.id),
      document_type: String(row.document_type),
      file_name: String(row.original_file_name || row.file_name),
      submitted_at: asString(row.submitted_at),
    });
    grouped.set(qid, list);
  }
  return grouped;
}

export async function getJobSummaries(input: {
  omg_numbers: string[];
  include_documents?: boolean;
}): Promise<{ jobs: JobSummary[]; missing: string[] }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const omgs: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.omg_numbers) {
    const omg = raw.trim();
    if (!omg || seen.has(omg)) continue;
    seen.add(omg);
    omgs.push(omg);
  }
  if (omgs.length === 0) throw new Error('Provide at least one omg_number.');
  if (omgs.length > 20) throw new Error('omg_numbers accepts at most 20.');

  const { data, error } = await supabase
    .from('quotations')
    .select(`${JOB_QUOTE_COLUMNS}, opportunities(id, stage, pickup_date)`)
    .in('quotation_no', omgs);
  if (error) throw new Error(error.message);

  const byOmg = new Map<string, Record<string, unknown>>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const no = asString(row.quotation_no);
    if (no && !byOmg.has(no)) byOmg.set(no, row);
  }

  const includeDocs = input.include_documents === true;
  const docs = includeDocs
    ? await loadCurrentDocNames(
        supabase,
        [...byOmg.values()].map((row) => String(row.id))
      )
    : null;

  const jobs: JobSummary[] = [];
  const missing: string[] = [];
  for (const omg of omgs) {
    const row = byOmg.get(omg);
    if (!row) {
      missing.push(omg);
      continue;
    }
    jobs.push(toJobSummary(row, docs ? docs.get(String(row.id)) ?? [] : undefined));
  }
  return { jobs, missing };
}

export type ListJobsInput = {
  from?: string;
  to?: string;
  customer?: string;
  destination?: string;
  stage?: string;
  flight?: string;
  limit?: number;
  include_documents?: boolean;
};

export async function listJobs(input: ListJobsInput): Promise<{ jobs: JobSummary[]; limit: number }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const customer = input.customer?.trim() || '';
  const destination = input.destination?.trim() || '';
  const stage = input.stage?.trim() || '';
  const flight = input.flight?.trim() || '';
  const from = input.from?.trim() || '';
  const to = input.to?.trim() || '';
  if (!customer && !destination && !stage && !flight && !from && !to) {
    throw new Error('Provide at least one of from, to, customer, destination, stage, flight.');
  }
  if (stage && !(JOB_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`stage must be one of: ${JOB_STAGES.join(', ')}`);
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const embed = stage
    ? 'opportunities!inner(id, stage, pickup_date)'
    : 'opportunities(id, stage, pickup_date)';

  let query = supabase
    .from('quotations')
    .select(`${JOB_QUOTE_COLUMNS}, ${embed}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (stage) query = query.eq('opportunities.stage', stage);
  if (from) query = query.gte('created_at', boundIso(from, false));
  if (to) query = query.lte('created_at', boundIso(to, true));
  if (customer) query = query.or(`${quotedIlike('company_name', customer)},${quotedIlike('customer_name', customer)}`);
  if (destination) {
    query = query.or(
      `${quotedIlike('destination', destination)},${quotedIlike('requested_destination', destination)}`
    );
  }
  if (flight) {
    const token = flight.replace(/[%_]/g, '').slice(0, 40);
    if (!token) throw new Error('flight is empty.');
    query = query.filter('booking_air_freight->>flight_no', 'ilike', token);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];

  const includeDocs = input.include_documents === true;
  const docs = includeDocs
    ? await loadCurrentDocNames(
        supabase,
        rows.map((row) => String(row.id))
      )
    : null;

  return {
    limit,
    jobs: rows.map((row) => toJobSummary(row, docs ? docs.get(String(row.id)) ?? [] : undefined)),
  };
}
