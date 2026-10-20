import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  buildQuotationTaxableLinesFromForm,
  computeQuotationVatBreakdown,
} from '@/lib/quotation-tax';
import type { FreightRate } from '@/lib/mcp/quotation-freight';
import { buildBookingDocumentListUrl } from '@/lib/email-templates';
import { resolveOpportunityOwnerId } from '@/lib/mcp/opportunity-owner';
import {
  calculateStaffQuotationFreight,
  explodePallets,
  type FreightPalletInput,
} from '@/lib/mcp/quotation-freight';
import { absoluteUrl } from '@/lib/site';
import { getSupabaseServerClient } from '@/lib/supabase/server';
const DEFAULT_CURRENCY = 'THB';

type Pallet = {
  length: number | string;
  width: number | string;
  height: number | string;
  weight: number | string;
  quantity?: number | string;
};

export const quotationPieceSchema = z.object({
  length_cm: z.number().positive(),
  width_cm: z.number().positive(),
  height_cm: z.number().positive(),
  gross_weight_kg: z.number().nonnegative(),
  qty: z.number().int().positive().optional(),
});

export const createQuotationSchema = z
  .object({
    company_name: z.string().min(1),
    shipper_name: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    contact_phone: z.string().optional(),
    consignee_name: z.string().optional(),
    consignee_address: z.string().optional(),
    consignee_country: z.string().optional(),
    destination_id: z.string().uuid().optional(),
    destination_iata: z.string().optional(),
    pieces: z.array(quotationPieceSchema).min(1),
    net_weight_kg: z.number().nonnegative().optional(),
    chargeable_weight: z.number().positive().optional(),
    rate_per_kg: z.number().positive().optional(),
    commodity: z.string().optional(),
    status: z.enum(['draft', 'pending_approval']).optional(),
    dry_run: z.boolean().optional(),
    client_ref: z.string().min(1).optional(),
    create_company: z.boolean().optional(),
    create_op_card: z.boolean().optional(),
    internal_remark: z.string().optional(),
    airline: z.string().optional(),
    routing: z.string().optional(),
    origin: z.string().optional(),
    hs_code: z.string().optional(),
    packaging: z.string().optional(),
    preferred_shipment_date: z.string().optional(),
    phyto_required: z.boolean().optional(),
  })
  .refine((v) => v.destination_id || v.destination_iata?.trim(), {
    message: 'destination_id or destination_iata is required',
  });

export const updateQuotationSchema = z
  .object({
    quotation_id: z.string().uuid().optional(),
    omg_number: z.string().optional(),
    dry_run: z.boolean().optional(),
    company_name: z.string().min(1).optional(),
    shipper_name: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    contact_phone: z.string().optional(),
    consignee_name: z.string().optional(),
    consignee_address: z.string().optional(),
    consignee_country: z.string().optional(),
    destination_id: z.string().uuid().optional(),
    destination_iata: z.string().optional(),
    pieces: z.array(quotationPieceSchema).min(1).optional(),
    net_weight_kg: z.number().nonnegative().optional(),
    chargeable_weight: z.number().positive().optional(),
    rate_per_kg: z.number().positive().optional(),
    commodity: z.string().optional(),
    status: z.enum(['draft', 'pending_approval']).optional(),
    internal_remark: z.string().optional(),
    airline: z.string().optional(),
    routing: z.string().optional(),
    origin: z.string().optional(),
    hs_code: z.string().optional(),
    packaging: z.string().optional(),
    preferred_shipment_date: z.string().optional(),
    phyto_required: z.boolean().optional(),
  })
  .refine((v) => v.quotation_id || v.omg_number?.trim(), {
    message: 'quotation_id or omg_number is required',
  });

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;

export type PricingSnapshot = {
  chargeable_weight: number;
  rate: number | null;
  total: number;
  currency: string;
};

export type StoredQuotationRow = {
  id: string;
  quotation_no: string | null;
  status: string;
  company_id: string;
  company_name: string | null;
  destination_id: string | null;
  destination: string | null;
  customer_name: string | null;
  contact_person: string | null;
  consignee_name: string | null;
  pallets: Pallet[] | unknown;
  total_actual_weight: number | null;
  total_volume_weight: number | null;
  chargeable_weight: number | null;
  total_freight_cost: number | null;
  total_cost: number | null;
  clearance_cost: number | null;
  delivery_cost: number | null;
  delivery_service_required: boolean | null;
  is_chargeable_weight_manual: boolean | null;
  manual_chargeable_weight: number | null;
  is_manual_rate: boolean | null;
  manual_rate: number | null;
  commodity_type: string | null;
  internal_remark: string | null;
  booking_details: Record<string, unknown> | null;
  opportunity_id: string | null;
  booking_share_token: string | null;
  client_ref: string | null;
  phyto_required?: boolean | null;
  user_id: string;
  additional_charges?: unknown;
  taxable_lines?: unknown;
  vat_amount?: number | null;
  grand_total_with_vat?: number | null;
  wht_enabled?: boolean | null;
  wht_amount?: number | null;
};

type DestinationRow = { id: string; country: string; port?: string | null };

export type CreateQuotationDeps = {
  resolveOwnerId: () => Promise<string>;
  findByClientRef: (ref: string) => Promise<StoredQuotationRow | null>;
  matchCompanies: (name: string) => Promise<{ id: string; name: string }[]>;
  suggestCompanies: (name: string) => Promise<string[]>;
  insertCompany: (row: {
    name: string;
    contact_person?: string;
    contact_email?: string;
    contact_phone?: string;
    user_id: string;
  }) => Promise<{ id: string; name: string }>;
  resolveDestination: (ref: {
    destination_id?: string;
    destination_iata?: string;
  }) => Promise<DestinationRow>;
  loadFreightRates: () => Promise<FreightRate[]>;
  insertQuotation: (row: Record<string, unknown>) => Promise<StoredQuotationRow>;
  updateQuotation: (id: string, row: Record<string, unknown>) => Promise<StoredQuotationRow>;
  loadQuotation: (ref: {
    quotation_id?: string;
    omg_number?: string;
  }) => Promise<StoredQuotationRow | null>;
  isOpportunityLost: (opportunityId: string) => Promise<boolean>;
  insertActivityLog: (entry: {
    quotation_id: string;
    event: string;
    actor: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  ensureBookingShareToken: (
    quotationId: string,
    existing?: string | null
  ) => Promise<string | null>;
  emitCreated: (quote: StoredQuotationRow) => Promise<void>;
};

function destinationLabel(d: DestinationRow): string {
  return `${d.country}${d.port ? `, ${d.port}` : ''}`;
}

function palletsForDb(exploded: FreightPalletInput[]): Pallet[] {
  return exploded.map((p) => ({
    length: p.length,
    width: p.width,
    height: p.height,
    weight: p.weight,
    quantity: 1,
  }));
}

function buildBookingDetails(
  input: Partial<CreateQuotationInput & UpdateQuotationInput>,
  shipper: string,
  existing?: Record<string, unknown> | null
): Record<string, unknown> {
  const base = { ...(existing || {}) };
  if (input.airline) base.airline = input.airline;
  if (input.routing) base.routing = input.routing;
  if (input.origin) base.origin = input.origin;
  if (input.hs_code) base.hs_code = input.hs_code;
  if (input.packaging) base.packaging = input.packaging;
  if (input.preferred_shipment_date) base.preferredShipmentDate = input.preferred_shipment_date;
  if (input.consignee_address) base.consignee = input.consignee_address;
  if (input.consignee_country) base.consigneeCountry = input.consignee_country;
  base.shipper = shipper;
  return base;
}

function manualFlags(input: {
  chargeable_weight?: number;
  rate_per_kg?: number;
}): {
  isChargeableWeightManual: boolean;
  manualChargeableWeight: number | null;
  isManualRate: boolean;
  manualRate: number | null;
} {
  return {
    isChargeableWeightManual: input.chargeable_weight != null && input.chargeable_weight > 0,
    manualChargeableWeight: input.chargeable_weight ?? null,
    isManualRate: input.rate_per_kg != null && input.rate_per_kg > 0,
    manualRate: input.rate_per_kg ?? null,
  };
}

function pricingSnapshot(
  chargeableWeight: number,
  rate: number | null,
  total: number
): PricingSnapshot {
  return {
    chargeable_weight: chargeableWeight,
    rate,
    total,
    currency: DEFAULT_CURRENCY,
  };
}

function pricingFromRow(row: StoredQuotationRow): PricingSnapshot {
  const cw = Number(row.chargeable_weight) || 0;
  const total = Number(row.total_cost) || 0;
  const freight = Number(row.total_freight_cost) || 0;
  const rate =
    row.is_manual_rate && row.manual_rate
      ? Number(row.manual_rate)
      : cw > 0
        ? Math.round((freight / cw) * 100) / 100
        : null;
  return pricingSnapshot(cw, rate, total);
}

function defaultTaxableLines() {
  return buildQuotationTaxableLinesFromForm(
    { freight: true, clearance: true, delivery: true, additional: [] },
    []
  );
}

function computeTotals(
  pallets: FreightPalletInput[],
  destinationId: string,
  freightRates: FreightRate[],
  flags: ReturnType<typeof manualFlags>,
  netWeightKg?: number
) {
  const calc = calculateStaffQuotationFreight(pallets, freightRates, destinationId, {
    isChargeableWeightManual: flags.isChargeableWeightManual,
    manualChargeableWeight: flags.manualChargeableWeight,
    isManualRate: flags.isManualRate,
    manualRate: flags.manualRate,
    clearanceCost: 0,
    additionalChargesTotal: 0,
  });
  const totalActual =
    netWeightKg != null && netWeightKg > 0 ? netWeightKg : calc.totalActualWeight;
  const taxable_lines = defaultTaxableLines();
  const vat = computeQuotationVatBreakdown({
    total_freight_cost: calc.totalFreightCost,
    clearance_cost: 0,
    delivery_amount: 0,
    additional_amounts: [],
    taxable_lines,
    wht_enabled: true,
  });
  return { calc, totalActual, taxable_lines, vat };
}

function buildInsertRow(params: {
  ownerId: string;
  companyId: string;
  companyName: string;
  destination: DestinationRow;
  input: CreateQuotationInput;
  palletsDb: Pallet[];
  flags: ReturnType<typeof manualFlags>;
  calc: ReturnType<typeof calculateStaffQuotationFreight>;
  totalActual: number;
  taxable_lines: ReturnType<typeof defaultTaxableLines>;
  vat: ReturnType<typeof computeQuotationVatBreakdown>;
  clientRef?: string;
}): Record<string, unknown> {
  const { input, destination } = params;
  const shipper = input.shipper_name?.trim() || input.company_name.trim();
  const status = input.status || 'draft';
  return {
    user_id: params.ownerId,
    company_id: params.companyId,
    company_name: params.companyName,
    customer_name: input.contact_name?.trim() || params.companyName,
    contact_person: input.contact_name?.trim() || '',
    consignee_name: input.consignee_name?.trim() || '',
    destination_id: destination.id,
    destination: destinationLabel(destination),
    pallets: params.palletsDb,
    delivery_service_required: false,
    delivery_vehicle_type: '4wheel',
    clearance_cost: 0,
    additional_charges: [],
    notes: null,
    internal_remark: input.internal_remark?.trim() || null,
    opportunity_id: null,
    product_id: null,
    total_cost: params.calc.finalTotalCost,
    total_freight_cost: params.calc.totalFreightCost,
    delivery_cost: 0,
    total_volume_weight: params.calc.totalVolumeWeight,
    total_actual_weight: params.totalActual,
    chargeable_weight: params.calc.totalChargeableWeight,
    is_chargeable_weight_manual: params.flags.isChargeableWeightManual,
    manual_chargeable_weight: params.flags.manualChargeableWeight,
    is_manual_rate: params.flags.isManualRate,
    manual_rate: params.flags.manualRate,
    status,
    commodity_type: input.commodity?.trim() || 'cannabis',
    phyto_required: input.phyto_required ?? false,
    booking_details: buildBookingDetails(input, shipper),
    taxable_lines: params.taxable_lines,
    vat_amount: params.vat.vat_amount,
    grand_total_with_vat: params.vat.grand_total_with_vat,
    wht_enabled: true,
    wht_amount: params.vat.wht_amount,
    client_ref: params.clientRef ?? null,
  };
}

export async function createQuotationCore(
  input: CreateQuotationInput,
  deps: CreateQuotationDeps
): Promise<Record<string, unknown>> {
  if (input.client_ref) {
    const existing = await deps.findByClientRef(input.client_ref);
    if (existing) {
      const token = await deps.ensureBookingShareToken(
        existing.id,
        existing.booking_share_token
      );
      const booking_url = token
        ? buildBookingDocumentListUrl(absoluteUrl(''), token)
        : null;
      return {
        ok: true,
        idempotent: true,
        quotation_id: existing.id,
        omg_number: existing.quotation_no,
        status: existing.status,
        ...pricingFromRow(existing),
        booking_url,
        webhook_emitted: false,
      };
    }
  }

  const destination = await deps.resolveDestination({
    destination_id: input.destination_id,
    destination_iata: input.destination_iata,
  });
  const freightRates = await deps.loadFreightRates();
  const exploded = explodePallets(input.pieces);
  const flags = manualFlags(input);
  const { calc, totalActual, taxable_lines, vat } = computeTotals(
    exploded,
    destination.id,
    freightRates,
    flags,
    input.net_weight_kg
  );
  const pricing = pricingSnapshot(
    calc.totalChargeableWeight,
    calc.effectiveRate,
    calc.finalTotalCost
  );

  if (input.dry_run) {
    return {
      ok: true,
      dry_run: true,
      quotation_id: null,
      omg_number: null,
      status: input.status || 'draft',
      ...pricing,
      booking_url: null,
      webhook_emitted: false,
    };
  }

  const ownerId = await deps.resolveOwnerId();
  const name = input.company_name.trim();
  const matches = await deps.matchCompanies(name);
  let companyId: string;
  let companyName: string;

  if (matches.length === 1) {
    companyId = matches[0].id;
    companyName = matches[0].name;
  } else if (matches.length > 1) {
    throw new Error(`Multiple companies match "${name}"; resolve manually.`);
  } else if (input.create_company) {
    const created = await deps.insertCompany({
      name,
      contact_person: input.contact_name,
      contact_email: input.contact_email,
      contact_phone: input.contact_phone,
      user_id: ownerId,
    });
    companyId = created.id;
    companyName = created.name;
  } else {
    const suggestions = await deps.suggestCompanies(name);
    return {
      ok: false,
      code: 'company_not_found',
      error: `Company not found: ${name}`,
      company_suggestions: suggestions,
    };
  }

  const palletsDb = palletsForDb(exploded);
  const row = buildInsertRow({
    ownerId,
    companyId,
    companyName,
    destination,
    input,
    palletsDb,
    flags,
    calc,
    totalActual,
    taxable_lines,
    vat,
    clientRef: input.client_ref,
  });

  const inserted = await deps.insertQuotation(row);
  await deps.emitCreated(inserted);

  const token = await deps.ensureBookingShareToken(
    inserted.id,
    inserted.booking_share_token
  );
  const booking_url = token ? buildBookingDocumentListUrl(absoluteUrl(''), token) : null;

  return {
    ok: true,
    quotation_id: inserted.id,
    omg_number: inserted.quotation_no,
    status: inserted.status,
    ...pricingSnapshot(
      Number(inserted.chargeable_weight) || calc.totalChargeableWeight,
      calc.effectiveRate,
      Number(inserted.total_cost) || calc.finalTotalCost
    ),
    booking_url,
    webhook_emitted: true,
  };
}

const PRICING_FIELDS = [
  'destination_id',
  'pieces',
  'net_weight_kg',
  'chargeable_weight',
  'rate_per_kg',
] as const;

export async function updateQuotationCore(
  input: UpdateQuotationInput,
  deps: CreateQuotationDeps,
  actor = 'mcp'
): Promise<Record<string, unknown>> {
  const existing = await deps.loadQuotation({
    quotation_id: input.quotation_id,
    omg_number: input.omg_number,
  });
  if (!existing) throw new Error('Quotation not found.');

  if (existing.opportunity_id && (await deps.isOpportunityLost(existing.opportunity_id))) {
    throw new Error('Cannot update quotation: linked opportunity is Lose Case.');
  }

  const changedFields: string[] = [];
  for (const key of Object.keys(input)) {
    if (key === 'quotation_id' || key === 'omg_number' || key === 'dry_run') continue;
    if (input[key as keyof UpdateQuotationInput] !== undefined) changedFields.push(key);
  }

  let destinationId = existing.destination_id || '';
  if (input.destination_id || input.destination_iata) {
    const dest = await deps.resolveDestination({
      destination_id: input.destination_id,
      destination_iata: input.destination_iata,
    });
    destinationId = dest.id;
    if (dest.id !== existing.destination_id) changedFields.push('destination_id');
  }

  if (!destinationId) throw new Error('Quotation has no destination; pass destination_id or destination_iata.');

  const freightRates = await deps.loadFreightRates();
  const existingPallets = Array.isArray(existing.pallets)
    ? (existing.pallets as Pallet[]).map((p) => ({
        length: Number(p.length) || 0,
        width: Number(p.width) || 0,
        height: Number(p.height) || 0,
        weight: Number(p.weight) || 0,
        quantity: 1,
      }))
    : [];

  const palletsInput: FreightPalletInput[] = input.pieces
    ? explodePallets(input.pieces)
    : existingPallets;

  const flags = input.chargeable_weight != null || input.rate_per_kg != null
    ? manualFlags({
        chargeable_weight: input.chargeable_weight ?? existing.manual_chargeable_weight ?? undefined,
        rate_per_kg: input.rate_per_kg ?? existing.manual_rate ?? undefined,
      })
    : manualFlags({
        chargeable_weight: existing.is_chargeable_weight_manual
          ? existing.manual_chargeable_weight ?? undefined
          : undefined,
        rate_per_kg: existing.is_manual_rate ? existing.manual_rate ?? undefined : undefined,
      });

  const pricingBefore = pricingFromRow(existing);
  const netWeight =
    input.net_weight_kg != null
      ? input.net_weight_kg
      : Number(existing.total_actual_weight) || undefined;
  const { calc, totalActual, taxable_lines, vat } = computeTotals(
    palletsInput,
    destinationId,
    freightRates,
    flags,
    netWeight
  );
  const pricingAfter = pricingSnapshot(
    calc.totalChargeableWeight,
    calc.effectiveRate,
    calc.finalTotalCost
  );

  const pricingChanged = PRICING_FIELDS.some((f) => changedFields.includes(f));

  if (input.dry_run) {
    return {
      ok: true,
      dry_run: true,
      quotation_id: existing.id,
      omg_number: existing.quotation_no,
      changed_fields: changedFields,
      ...(pricingChanged
        ? { pricing_before: pricingBefore, pricing_after: pricingAfter }
        : {}),
    };
  }

  const shipper =
    input.shipper_name?.trim() ||
    input.company_name?.trim() ||
    existing.company_name ||
    '';
  const booking_details = buildBookingDetails(
    input,
    shipper,
    existing.booking_details
  );

  const patch: Record<string, unknown> = {
    total_cost: calc.finalTotalCost,
    total_freight_cost: calc.totalFreightCost,
    total_volume_weight: calc.totalVolumeWeight,
    total_actual_weight: totalActual,
    chargeable_weight: calc.totalChargeableWeight,
    is_chargeable_weight_manual: flags.isChargeableWeightManual,
    manual_chargeable_weight: flags.manualChargeableWeight,
    is_manual_rate: flags.isManualRate,
    manual_rate: flags.manualRate,
    taxable_lines,
    vat_amount: vat.vat_amount,
    grand_total_with_vat: vat.grand_total_with_vat,
    wht_amount: vat.wht_amount,
    booking_details,
  };

  if (input.pieces) patch.pallets = palletsForDb(palletsInput);
  if (input.destination_id || input.destination_iata) {
    const dest = await deps.resolveDestination({
      destination_id: input.destination_id,
      destination_iata: input.destination_iata,
    });
    patch.destination_id = dest.id;
    patch.destination = destinationLabel(dest);
  }
  if (input.consignee_name != null) patch.consignee_name = input.consignee_name.trim();
  if (input.contact_name != null) {
    patch.customer_name = input.contact_name.trim();
    patch.contact_person = input.contact_name.trim();
  }
  if (input.internal_remark != null) patch.internal_remark = input.internal_remark.trim() || null;
  if (input.commodity != null) patch.commodity_type = input.commodity.trim() || 'cannabis';
  if (input.status != null) patch.status = input.status;
  if (input.phyto_required != null) patch.phyto_required = input.phyto_required;

  const changes: { field: string; old: unknown; new: unknown }[] = [];
  for (const field of changedFields) {
    const oldVal = (existing as Record<string, unknown>)[field];
    const newVal = (patch as Record<string, unknown>)[field] ?? input[field as keyof UpdateQuotationInput];
    if (newVal !== undefined) changes.push({ field, old: oldVal ?? null, new: newVal });
  }
  if (pricingChanged) {
    changes.push(
      { field: 'chargeable_weight', old: pricingBefore.chargeable_weight, new: pricingAfter.chargeable_weight },
      { field: 'total_cost', old: pricingBefore.total, new: pricingAfter.total }
    );
  }

  const updated = await deps.updateQuotation(existing.id, patch);

  if (changes.length) {
    await deps.insertActivityLog({
      quotation_id: existing.id,
      event: 'quotation_updated',
      actor,
      payload: { changes, omg_number: existing.quotation_no },
    });
  }

  return {
    ok: true,
    quotation_id: updated.id,
    omg_number: updated.quotation_no,
    status: updated.status,
    changed_fields: changedFields,
    ...(pricingChanged
      ? { pricing_before: pricingBefore, pricing_after: pricingAfter }
      : {}),
  };
}

async function ensureBookingShareTokenServer(
  supabase: SupabaseClient,
  quotationId: string,
  existing?: string | null
): Promise<string | null> {
  if (existing) return existing;
  const token = randomUUID();
  const { error } = await supabase
    .from('quotations')
    .update({ booking_share_token: token })
    .eq('id', quotationId);
  return error ? null : token;
}

export function buildCreateQuotationDeps(supabase: SupabaseClient): CreateQuotationDeps {
  return {
    resolveOwnerId: () => resolveOpportunityOwnerId(supabase, {}),
    findByClientRef: async (ref) => {
      const { data, error } = await supabase
        .from('quotations')
        .select('*')
        .eq('client_ref', ref)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as StoredQuotationRow | null;
    },
    matchCompanies: async (name) => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .ilike('name', name.trim());
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string }[];
    },
    suggestCompanies: async (name) => {
      const q = `%${name.trim()}%`;
      const { data, error } = await supabase
        .from('companies')
        .select('name')
        .ilike('name', q)
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.name as string);
    },
    insertCompany: async (row) => {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name: row.name,
          contact_person: row.contact_person || null,
          contact_email: row.contact_email || null,
          contact_phone: row.contact_phone || null,
          user_id: row.user_id,
        })
        .select('id, name')
        .single();
      if (error) throw new Error(error.message);
      return data as { id: string; name: string };
    },
    resolveDestination: async (ref) => {
      if (ref.destination_id) {
        const { data, error } = await supabase
          .from('destinations')
          .select('id, country, port')
          .eq('id', ref.destination_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error(`Unknown destination_id: ${ref.destination_id}`);
        return data as DestinationRow;
      }
      const iata = ref.destination_iata!.trim().toUpperCase();
      const { data, error } = await supabase
        .from('destinations')
        .select('id, country, port')
        .ilike('port', iata)
        .limit(2);
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error(`Unknown destination IATA: ${iata}`);
      if (data.length > 1) throw new Error(`Ambiguous destination IATA: ${iata}`);
      return data[0] as DestinationRow;
    },
    loadFreightRates: async () => {
      const { data, error } = await supabase.from('freight_rates').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as FreightRate[];
    },
    insertQuotation: async (row) => {
      const { data, error } = await supabase.from('quotations').insert(row).select('*').single();
      if (error) throw new Error(error.message);
      return data as StoredQuotationRow;
    },
    updateQuotation: async (id, row) => {
      const { data, error } = await supabase
        .from('quotations')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as StoredQuotationRow;
    },
    loadQuotation: async (ref) => {
      if (ref.quotation_id) {
        const { data, error } = await supabase
          .from('quotations')
          .select('*')
          .eq('id', ref.quotation_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data as StoredQuotationRow | null;
      }
      if (ref.omg_number) {
        const { data, error } = await supabase
          .from('quotations')
          .select('*')
          .eq('quotation_no', ref.omg_number.trim())
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data as StoredQuotationRow | null;
      }
      return null;
    },
    isOpportunityLost: async (opportunityId) => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('closure_status')
        .eq('id', opportunityId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.closure_status === 'lost';
    },
    insertActivityLog: async (entry) => {
      const { error } = await supabase.from('quotation_activity_log').insert(entry);
      if (error) throw new Error(error.message);
    },
    ensureBookingShareToken: (quotationId, existing) =>
      ensureBookingShareTokenServer(supabase, quotationId, existing),
    emitCreated: async (quote) => {
      const { emitQuotationCreated } = await import('@/lib/webhooks');
      return emitQuotationCreated(supabase, quote as unknown as import('@/lib/db').Quotation);
    },
  };
}

export async function createQuotation(input: CreateQuotationInput) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');
  const result = await createQuotationCore(input, buildCreateQuotationDeps(supabase));
  if (
    input.create_op_card &&
    result.ok === true &&
    result.quotation_id &&
    !result.dry_run &&
    !result.idempotent
  ) {
    const { createOpCard } = await import('@/lib/mcp/booking-service');
    const op = await createOpCard({ quotation_id: result.quotation_id as string });
    return { ...result, op_card_id: op.op_card_id };
  }
  return result;
}

export async function updateQuotation(input: UpdateQuotationInput) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');
  return updateQuotationCore(input, buildCreateQuotationDeps(supabase));
}
