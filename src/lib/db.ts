import { supabase } from '@/lib/supabase';
import type { CommodityType } from '@/lib/document-presets';

export interface Product {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
  product_charges?: ProductCharge[];
}

export interface ProductCharge {
  id?: string;
  product_id: string;
  name: string;
  description?: string;
  amount: number;
  created_at?: string;
}

// Type definitions for our database tables
export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  company?: string;
  position?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Company {
  id: string;
  name: string;
  address?: string;
  tax_id?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
  customer_user_id?: string;
  is_approved?: boolean;
  onboarding_token?: string;
  registration_docs?: string[] | null;
  storage_provider?: 'supabase' | 'r2';
}

export interface Destination {
  id: string;
  country: string;
  port?: string;
  is_active: boolean; // Added field
  created_at?: string;
  updated_at?: string;
  user_id?: string;
}

export interface FreightRate {
  id: string;
  destination_id: string;
  min_weight?: number | null;
  max_weight?: number | null;
  base_rate: number;
  effective_date?: string | null;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
}

// Define Pallet and AdditionalCharge interfaces locally if they are not exported from db.ts
export interface Pallet {
  length: number | string;
  width: number | string;
  height: number | string;
  weight: number | string;
  quantity: number | string;
  overridden_rate?: number | string;
}

export interface AdditionalCharge {
  name: string;
  description: string;
  amount: number | string; // Allow string as well for form input
}

/** Keys: freight, clearance, delivery, additional:<n> (n = index among saved additional_charges). Missing = VAT applies. */
export type QuotationTaxableLines = Partial<Record<string, boolean>>;

/** Staff form shape; `additional` parallels form `additionalCharges` field array (incl. empty rows). */
export interface QuotationTaxableLinesForm {
  freight: boolean;
  clearance: boolean;
  delivery: boolean;
  additional: boolean[];
}

export const QUOTATION_VAT_RATE = 0.07;
export const QUOTATION_WHT_RATE = 0.03;

/** Default true when column is null (legacy rows). */
export function quotationWhtEnabled(wht_enabled: boolean | null | undefined): boolean {
  return wht_enabled !== false;
}

function quotationRoundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function quotationLineIsTaxable(taxable_lines: QuotationTaxableLines | null | undefined, key: string): boolean {
  return taxable_lines?.[key] !== false;
}

/** Load DB `taxable_lines` into staff form defaults; `additionalChargeCount` = length of form additionalCharges array. */
export function parseQuotationTaxableLinesToForm(
  taxable_lines: QuotationTaxableLines | null | undefined,
  additionalChargeCount: number
): QuotationTaxableLinesForm {
  const additional = Array.from({ length: additionalChargeCount }, (_, i) =>
    quotationLineIsTaxable(taxable_lines, `additional:${i}`)
  );
  return {
    freight: quotationLineIsTaxable(taxable_lines, 'freight'),
    clearance: quotationLineIsTaxable(taxable_lines, 'clearance'),
    delivery: quotationLineIsTaxable(taxable_lines, 'delivery'),
    additional,
  };
}

/**
 * Build persisted map from form. Only non-empty additional rows (same filter as save) get keys additional:0..
 */
export function buildQuotationTaxableLinesFromForm(
  form: QuotationTaxableLinesForm,
  additionalCharges: { name?: string; description?: string; amount?: number | string }[]
): QuotationTaxableLines {
  const out: QuotationTaxableLines = {};
  out.freight = form.freight !== false;
  out.clearance = form.clearance !== false;
  out.delivery = form.delivery !== false;
  let dbIdx = 0;
  additionalCharges.forEach((charge, formIdx) => {
    const included =
      (charge.name ?? '').trim() !== '' ||
      (charge.description ?? '').trim() !== '' ||
      (Number(charge.amount) || 0) > 0;
    if (included) {
      out[`additional:${dbIdx}`] = form.additional?.[formIdx] !== false;
      dbIdx++;
    }
  });
  return out;
}

export function computeQuotationVatBreakdown(params: {
  total_freight_cost: number;
  clearance_cost: number;
  delivery_amount: number;
  additional_amounts: number[];
  taxable_lines: QuotationTaxableLines | null | undefined;
  /** Default true — 3% WHT on VAT-taxable subtotal, deducted from grand total. */
  wht_enabled?: boolean | null;
}): {
  vat_base: number;
  non_vat_base: number;
  subtotal_pre_vat: number;
  vat_amount: number;
  grand_total_with_vat: number;
  wht_amount: number;
  net_payable: number;
} {
  const tl = params.taxable_lines ?? {};
  let vatBase = 0;
  let nonVatBase = 0;
  const push = (amount: number, taxable: boolean) => {
    const a = Number(amount) || 0;
    if (taxable) vatBase += a;
    else nonVatBase += a;
  };
  push(params.total_freight_cost, tl.freight !== false);
  push(params.clearance_cost, tl.clearance !== false);
  push(params.delivery_amount, tl.delivery !== false);
  params.additional_amounts.forEach((amt, i) => {
    push(amt, tl[`additional:${i}`] !== false);
  });
  const vat_base = quotationRoundMoney(vatBase);
  const non_vat_base = quotationRoundMoney(nonVatBase);
  const subtotal_pre_vat = quotationRoundMoney(vat_base + non_vat_base);
  const vat_amount = quotationRoundMoney(vat_base * QUOTATION_VAT_RATE);
  const grand_total_with_vat = quotationRoundMoney(subtotal_pre_vat + vat_amount);
  const wht_amount = quotationWhtEnabled(params.wht_enabled)
    ? quotationRoundMoney(vat_base * QUOTATION_WHT_RATE)
    : 0;
  const net_payable = quotationRoundMoney(grand_total_with_vat - wht_amount);
  return {
    vat_base,
    non_vat_base,
    subtotal_pre_vat,
    vat_amount,
    grand_total_with_vat,
    wht_amount,
    net_payable,
  };
}

/** Rows for staff UI: split each charge into VAT vs non-VAT portions. */
export function getQuotationVatDisplayRows(
  calcResult: { totalFreightCost: number; deliveryCost: number },
  form: {
    clearanceCost: number;
    deliveryServiceRequired: boolean;
    additionalCharges: { name?: string; description?: string; amount?: number | string }[];
    taxableLines: QuotationTaxableLinesForm;
  }
): { label: string; vatPart: number; nonVatPart: number }[] {
  const map = buildQuotationTaxableLinesFromForm(form.taxableLines, form.additionalCharges);
  const rows: { label: string; vatPart: number; nonVatPart: number }[] = [];
  const split = (amt: number, taxable: boolean) =>
    taxable ? { vatPart: amt, nonVatPart: 0 } : { vatPart: 0, nonVatPart: amt };

  rows.push({ label: 'Freight Cost', ...split(calcResult.totalFreightCost, map.freight !== false) });
  rows.push({ label: 'Clearance', ...split(Number(form.clearanceCost) || 0, map.clearance !== false) });
  if (form.deliveryServiceRequired) {
    rows.push({ label: 'Delivery', ...split(calcResult.deliveryCost, map.delivery !== false) });
  }
  let dbIdx = 0;
  form.additionalCharges.forEach((ch) => {
    const included =
      (ch.name ?? '').trim() !== '' ||
      (ch.description ?? '').trim() !== '' ||
      (Number(ch.amount) || 0) > 0;
    if (!included) return;
    const amt = Number(ch.amount) || 0;
    const taxable = map[`additional:${dbIdx}`] !== false;
    rows.push({
      label: `Additional: ${ch.description || ch.name || 'Charge'}`,
      ...split(amt, taxable),
    });
    dbIdx++;
  });
  return rows;
}

/** VAT / non-VAT line split for preview/print from a persisted `Quotation` row (snake_case amounts). */
export function getQuotationVatRowsFromQuote(
  q: Pick<
    Quotation,
    | 'total_freight_cost'
    | 'clearance_cost'
    | 'delivery_service_required'
    | 'delivery_cost'
    | 'additional_charges'
    | 'taxable_lines'
  >
): { label: string; vatPart: number; nonVatPart: number }[] {
  const charges = Array.isArray(q.additional_charges) ? q.additional_charges : [];
  const additionalForForm = charges.map((c) => ({
    name: c.name ?? '',
    description: c.description ?? '',
    amount: Number(c.amount) || 0,
  }));
  const tlForm = parseQuotationTaxableLinesToForm(q.taxable_lines, additionalForForm.length);
  return getQuotationVatDisplayRows(
    {
      totalFreightCost: Number(q.total_freight_cost) || 0,
      deliveryCost: Number(q.delivery_cost) || 0,
    },
    {
      clearanceCost: Number(q.clearance_cost) || 0,
      deliveryServiceRequired: Boolean(q.delivery_service_required),
      additionalCharges: additionalForForm,
      taxableLines: tlForm,
    }
  );
}

/** Same VAT math as save path, for preview totals. */
export function getQuotationVatBreakdownFromQuote(
  q: Pick<
    Quotation,
    | 'total_freight_cost'
    | 'clearance_cost'
    | 'delivery_service_required'
    | 'delivery_cost'
    | 'additional_charges'
    | 'taxable_lines'
    | 'wht_enabled'
  >
): ReturnType<typeof computeQuotationVatBreakdown> {
  const charges = Array.isArray(q.additional_charges) ? q.additional_charges : [];
  const additionalForForm = charges.map((c) => ({
    name: c.name ?? '',
    description: c.description ?? '',
    amount: Number(c.amount) || 0,
  }));
  const tlForm = parseQuotationTaxableLinesToForm(q.taxable_lines, additionalForForm.length);
  const taxable_lines = buildQuotationTaxableLinesFromForm(tlForm, additionalForForm);
  const filteredAmounts = additionalForForm
    .filter(
      (charge) =>
        (charge.name ?? '').trim() !== '' ||
        (charge.description ?? '').trim() !== '' ||
        (Number(charge.amount) || 0) > 0
    )
    .map((c) => Number(c.amount) || 0);
  return computeQuotationVatBreakdown({
    total_freight_cost: Number(q.total_freight_cost) || 0,
    clearance_cost: Number(q.clearance_cost) || 0,
    delivery_amount: q.delivery_service_required ? Number(q.delivery_cost) || 0 : 0,
    additional_amounts: filteredAmounts,
    taxable_lines,
    wht_enabled: q.wht_enabled,
  });
}

/** Net payable (subtotal + VAT − WHT when enabled). */
export function getQuotationPayableTotalThb(
  q: Pick<Quotation, 'total_cost' | 'vat_amount' | 'grand_total_with_vat' | 'wht_amount' | 'wht_enabled'>
): number {
  const tc = Number(q.total_cost) || 0;
  const va = q.vat_amount != null && !Number.isNaN(Number(q.vat_amount)) ? Number(q.vat_amount) : 0;
  const preWht = quotationRoundMoney(tc + va);
  const wht =
    quotationWhtEnabled(q.wht_enabled) && q.wht_amount != null && !Number.isNaN(Number(q.wht_amount))
      ? Number(q.wht_amount)
      : 0;
  return quotationRoundMoney(preWht - wht);
}

export interface Quotation {
  id: string;
  created_at: string;
  user_id: string;
  company_id: string;
  opportunity_id?: string | null; // Added field
  /** Staff manual flag: quotation is in booking phase */
  is_booking?: boolean | null;
  product_id?: string | null; // Added field
  customer_name: string;
  contact_person: string;
  consignee_name?: string | null;
  contract_no?: string | null;
  destination_id: string | null;
  shipping_date?: string | null;
  pallets: Pallet[]; // Use defined type
  delivery_service_required: boolean;
  delivery_vehicle_type: '4wheel' | '6wheel';
  additional_charges: AdditionalCharge[]; // Use defined type
  notes?: string | null;
  total_cost: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'docs_uploaded' | 'completed' | 'Shipped' | 'pending_approval' | 'signed';
  company_name?: string | null;
  destination?: string | null;
  requested_destination?: string | null;
  updated_at?: string;
  completed_at?: string | null;
  shipment_photo_url?: string[] | null;
  shipment_photo_uploaded_at?: string | null;

  // Additional cost breakdown fields
  total_freight_cost?: number | null; // Allow null
  clearance_cost?: number | null; // Allow null
  delivery_cost?: number | null; // Allow null

  // Weight calculation fields
  total_actual_weight?: number | null; // Allow null
  total_volume_weight?: number | null; // Allow null
  chargeable_weight?: number | null; // Allow null
  internal_remark?: string | null; // Added field
  is_chargeable_weight_manual?: boolean; // New field
  manual_chargeable_weight?: number | null; // New field
  is_manual_rate?: boolean; // New field
  manual_rate?: number | null; // New field
  required_doc_types?: string[] | null; // Added field for tracking required documents
  customer_user_id?: string | null; // Assigned customer user ID
  quotation_no?: string; // Auto-generated quotation number

  // AWB & Customs Declaration - uploaded by staff or air freight
  awb_file_url?: string | null;
  awb_file_name?: string | null;
  awb_uploaded_at?: string | null;
  awb_number?: string | null;
  awb_number_source?: 'gemini' | 'manual' | 'airfreight' | string | null;
  carrier_code?: string | null;
  carrier_code_manual?: boolean | null;
  tracking_status?: string | null;
  tracking_status_raw?: string | null;
  tracking_checked_at?: string | null;
  delivered_at?: string | null;
  delivered_local_offset?: string | null;
  delivery_notify_emails?: string[] | null;
  customs_declaration_file_url?: string | null;
  customs_declaration_file_name?: string | null;
  customs_declaration_uploaded_at?: string | null;

  share_token?: string | null;
  storage_provider?: 'supabase' | 'r2';
  price_confirmed?: boolean;

  /** Base64 PNG data URL — stored in DB; omit from list queries */
  customer_signature?: string | null;
  signed_at?: string | null;
  signed_company_name?: string | null;

  opportunities?: {
    stage: string;
    closure_status?: string | null;
    pickup_date?: string | null;
  } | null;

  /** Per-line VAT flags for freight, clearance, delivery, additional (see QuotationTaxableLines). */
  taxable_lines?: QuotationTaxableLines | null;
  /** VAT 7% on VAT-eligible portions; total_cost remains pre-VAT. */
  vat_amount?: number | null;
  /** total_cost + vat_amount */
  grand_total_with_vat?: number | null;
  /** Apply 3% WHT on VAT-taxable subtotal (default true). */
  wht_enabled?: boolean | null;
  /** 3% of VAT-taxable base when wht_enabled; deducted from payable total. */
  wht_amount?: number | null;

  /** Document checklist preset: cannabis | hemp | kratom | general */
  commodity_type?: CommodityType;
  /** Customer asked us to provide Phytosanitary certificate service */
  phyto_required?: boolean | null;

  /** Public Air Freight booking link token (separate from share_token) */
  booking_share_token?: string | null;
  /** Read-only booking sheet link for customer / consignee (no AWB upload) */
  booking_view_token?: string | null;
  /** Staff-entered booking request fields (airline, routing, etc.) */
  booking_details?: import('./email-templates').EmailBookingData | Record<string, unknown> | null;
  /** Air Freight team response from public booking page */
  booking_air_freight?: import('./email-templates').BookingAirFreightResponse | Record<string, unknown> | null;
  booking_status?: 'draft' | 'sent' | 'confirmed' | string | null;
  booking_confirmed_at?: string | null;
  /** MCP / Grok Bot already drafted booking email */
  booking_email_drafted_at?: string | null;
  booking_email_drafted_by?: string | null;

  /** Whole document set was swapped with another OMG; staff must re-verify */
  docs_swapped_at?: string | null;
  docs_swapped_with?: string | null;
  docs_swapped_by?: string | null;
  docs_swap_checked_at?: string | null;
  docs_swap_checked_by?: string | null;
}

export interface DocumentSubmission {
  id: string;
  quotation_id: string;
  company_name: string;
  document_type: string;
  document_type_name?: string;
  document_type_id?: string;
  category?: string;
  file_name: string;
  original_file_name?: string;
  file_path?: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  notes?: string;
  status?: string;
  submitted_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  description?: string; // AI-generated document summary
  storage_provider?: 'supabase' | 'r2';
  source?: string; // 'company_profile' for auto-linked documents
}

export interface ProformaLineItem {
  description: string;
  amount: number;
  /** Whether this line participates in VAT (7%). Defaults to true for legacy rows. */
  taxable?: boolean;
}

export interface ProformaInvoice {
  id: string;
  quotation_id: string;
  user_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_address: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  freight_type: 'sea' | 'air' | null;
  est_shipped_date: string | null;
  est_gross_weight: number | null;
  est_net_weight: number | null;
  carrier: string | null;
  mawb: string | null;
  /** Free-text so users can include UOM, e.g. "2 plt / 145 kgs" */
  qty_wt: string | null;
  chargeable_weight: number | null;
  airport_destination: string | null;
  line_items: ProformaLineItem[];
  subtotal: number | null;
  vat: number | null;
  grand_total: number | null;
  wht_enabled?: boolean | null;
  wht_amount?: number | null;
  status: 'draft' | 'sent' | 'signed' | 'cancelled';
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  id: string;
  category: string;
  settings_key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings_value?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
}

// ============================================================
// CUSTOMER ASSIGNMENT FUNCTIONS
// ============================================================

/**
 * ดึง customer ทั้งหมดสำหรับ dropdown assign
 */
export async function getCustomerUsers(): Promise<{ id: string; email: string; full_name: string; company: string }[]> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, company, role')
      .eq('role', 'customer')
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Error fetching customer users:', error);
      return [];
    }

    return (data || []).map(p => ({
      id: p.id,
      email: p.email || '',
      full_name: p.full_name || '',
      company: p.company || '',
    }));
  } catch (error) {
    console.error('Error in getCustomerUsers:', error);
    return [];
  }
}

/**
 * Assign customer ให้กับ quotation
 */
export async function assignCustomerToQuotation(quotationId: string, customerUserId: string | null): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('quotations')
      .update({ customer_user_id: customerUserId })
      .eq('id', quotationId);

    if (error) {
      console.error('Error assigning customer:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in assignCustomerToQuotation:', error);
    return false;
  }
}

// PROFILE FUNCTIONS
export async function getProfile(userId: string) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data as Profile;
  } catch (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any
  ) {
    console.error('Error in getProfile:', error);
    return null;
  }
}

export async function updateProfile(userId: string, updates: Partial<Profile>) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Error updating profile:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in updateProfile:', error);
    return null;
  }
}

// COMPANY FUNCTIONS
export async function getCompanies() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('User not authenticated');
      return null;
    }

    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching companies:', error);
      return null;
    }

    return data as Company[];
  } catch (error) {
    console.error('Error in getCompanies:', error);
    return null;
  }
}

// Returns staff-owned companies + customer-linked companies (for quotation dropdowns)
export async function getCompaniesForDropdown(): Promise<Company[]> {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching companies for dropdown:', error);
      return [];
    }

    return (data || []) as Company[];
  } catch (error) {
    console.error('Error in getCompaniesForDropdown:', error);
    return [];
  }
}

// Fetch a single company by onboarding token (Public access)
export async function getCompanyByToken(token: string): Promise<Company | null> {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('onboarding_token', token)
      .single();

    if (error) {
      console.error('Error fetching company by token:', error);
      return null;
    }

    return data as Company;
  } catch (error) {
    console.error('Unexpected error fetching company by token:', error);
    return null;
  }
}

export async function getCompanyById(id: string) {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching company:', error);
      return null;
    }

    return data as Company;
  } catch (error) {
    console.error('Error in getCompanyById:', error);
    return null;
  }
}

export async function createCompany(company: Omit<Company, 'id' | 'created_at' | 'updated_at'>) {
  try {
    const { data, error } = await supabase
      .from('companies')
      .insert([company])
      .select();

    if (error) {
      console.error('Error creating company:', error);
      return null;
    }

    return data[0] as Company;
  } catch (error) {
    console.error('Error in createCompany:', error);
    return null;
  }
}

export async function updateCompany(id: string, updates: Partial<Company>) {
  try {
    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error updating company:', error);
      return null;
    }

    return data[0] as Company;
  } catch (error) {
    console.error('Error in updateCompany:', error);
    return null;
  }
}

export async function deleteCompany(id: string) {
  try {
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting company:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteCompany:', error);
    return false;
  }
}

// DESTINATION FUNCTIONS
export async function getDestinations(onlyActive: boolean = false) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('User not authenticated');
      return [];
    }

    let query = supabase
      .from('destinations')
      .select('id, country, port, is_active')
      .eq('user_id', user.id);
    
    if (onlyActive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('country', { ascending: true });

    if (error) {
      console.error('Error fetching destinations:', error);
      return [];
    }

    return data as Pick<Destination, 'id' | 'country' | 'port' | 'is_active'>[];
  } catch (error) {
    console.error('Error in getDestinations:', error);
    return [];
  }
}

export async function getDestinationById(id: string) {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .select('id, country, port, is_active')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching destination:', error);
      return null;
    }

    return data as Pick<Destination, 'id' | 'country' | 'port' | 'is_active'>;
  } catch (error) {
    console.error('Error in getDestinationById:', error);
    return null;
  }
}

export async function createDestination(destination: Omit<Destination, 'id' | 'created_at' | 'updated_at'>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      throw new Error("User not authenticated to create destination.");
    }

    const dataToSave = {
      country: destination.country,
      port: destination.port || null,
      is_active: destination.is_active ?? true,
      user_id: userId
    };

    const { data, error } = await supabase
      .from('destinations')
      .insert([dataToSave])
      .select('id, country, port, is_active');

    if (error) {
      console.error('Error creating destination:', error);
      return null;
    }

    return data[0] as Destination;
  } catch (error) {
    console.error('Error in createDestination:', error);
    return null;
  }
}

export async function updateDestination(id: string, updates: Partial<Pick<Destination, 'country' | 'port' | 'is_active'>>) {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .update(updates)
      .eq('id', id)
      .select('id, country, port, is_active');

    if (error) {
      console.error('Error updating destination:', error);
      return null;
    }

    return data[0] as Destination;
  } catch (error) {
    console.error('Error in updateDestination:', error);
    return null;
  }
}

export async function deleteDestination(id: string) {
  try {
    const { error } = await supabase
      .from('destinations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting destination:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteDestination:', error);
    return false;
  }
}

// FREIGHT RATE FUNCTIONS
export async function getFreightRates() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('User not authenticated');
      return [];
    }

    const { data, error } = await supabase
      .from('freight_rates')
      .select(`
        id, destination_id, min_weight, max_weight, base_rate, effective_date, user_id,
        destinations ( country, port )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching freight rates:', error);
      return [];
    }

    return data as (Pick<FreightRate, 'id' | 'destination_id' | 'min_weight' | 'max_weight' | 'base_rate' | 'effective_date' | 'user_id'> & {
      destinations: Pick<Destination, 'country' | 'port'>[] | null;
    })[];
  } catch (error) {
    console.error('Error in getFreightRates:', error);
    return [];
  }
}

export async function getFreightRateById(id: string) {
  try {
    const { data, error } = await supabase
      .from('freight_rates')
      .select(`
         id, destination_id, min_weight, max_weight, base_rate, effective_date, user_id,
         destinations ( country, port )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching freight rate:', error);
      return null;
    }

    return data as Pick<FreightRate, 'id' | 'destination_id' | 'min_weight' | 'max_weight' | 'base_rate' | 'effective_date' | 'user_id'> & {
      destinations: Pick<Destination, 'country' | 'port'>[] | null;
    };
  } catch (error) {
    console.error('Error in getFreightRateById:', error);
    return null;
  }
}

export async function createFreightRate(rate: Omit<FreightRate, 'id' | 'created_at' | 'updated_at' | 'currency' | 'vehicle_type' | 'container_size'>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      throw new Error("User not authenticated to create freight rate.");
    }

    const dataToSave = {
      destination_id: rate.destination_id,
      min_weight: rate.min_weight,
      max_weight: rate.max_weight,
      base_rate: rate.base_rate,
      effective_date: rate.effective_date,
      user_id: userId
    };

    const { data, error } = await supabase
      .from('freight_rates')
      .insert([dataToSave])
      .select();

    if (error) {
      console.error('Error creating freight rate:', error);
      return null;
    }

    return data[0] as FreightRate;
  } catch (error) {
    console.error('Error in createFreightRate:', error);
    return null;
  }
}

export async function updateFreightRate(id: string, updates: Partial<Omit<FreightRate, 'currency' | 'vehicle_type' | 'container_size'>>) {
  try {
    // Disable unused vars check for this line as destructuring is used to exclude fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user_id, destination_id, id: rateId, created_at, updated_at, ...restUpdates } = updates;

    const { data, error } = await supabase
      .from('freight_rates')
      .update(restUpdates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error updating freight rate:', error);
      return null;
    }

    return data[0] as FreightRate;
  } catch (error: unknown) {
    console.error('Exception in updateFreightRate:', error);
    return null;
  }
}

export async function deleteFreightRate(id: string) {
  try {
    const { error } = await supabase
      .from('freight_rates')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting freight rate:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteFreightRate:', error);
    return false;
  }
}

// QUOTATION FUNCTIONS
/** Strip heavy base64 signature from list payloads */
function stripQuotationSignature<T extends Record<string, unknown>>(q: T): Omit<T, 'customer_signature'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { customer_signature: _cs, ...rest } = q;
  return rest as Omit<T, 'customer_signature'>;
}

export async function getQuotations(userId: string) {
  try {
    const { data, error } = await supabase
      .from('quotations')
      .select(`
        *,
        company:companies(name),
        destination_country:destinations(country, port),
        product:products(name),
        opportunities(stage, closure_status, pickup_date)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching quotations:', error);
      return []; // Return empty array on error
    }

    const transformedData = data.map((q) => {
      const row = q as {
        company?: { name?: string };
        destination_country?: { country?: string; port?: string | null };
        destination?: string | null;
      } & Record<string, unknown>;
      const lean = stripQuotationSignature(row);
      const dc = row.destination_country;
      const destination =
        dc && dc.country
          ? `${dc.country}${dc.port ? ` - ${dc.port}` : ''}`.trim()
          : row.destination ?? null;
      return {
        ...lean,
        company_name: row.company?.name,
        destination,
      };
    });

    return transformedData as Quotation[];
  } catch (err) {
    console.error('Error in getQuotations:', err);
    return [];
  }
}

/**
 * ดึง pending_approval quotations ที่ลูกค้าสร้าง (สำหรับ staff)
 */
export async function getPendingApprovalQuotations(): Promise<Quotation[]> {
  try {
    const { data, error } = await supabase
      .from('quotations')
      .select(`
        *,
        company:companies(name),
        destination_country:destinations(country, port),
        product:products(name)
      `)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending approval quotations:', error);
      return [];
    }

    const transformedData = (data || []).map((q) => {
      const row = q as {
        company?: { name?: string };
        destination_country?: { country?: string; port?: string | null };
        destination?: string | null;
      } & Record<string, unknown>;
      const lean = stripQuotationSignature(row);
      const dc = row.destination_country;
      const destination =
        dc && dc.country
          ? `${dc.country}${dc.port ? ` - ${dc.port}` : ''}`.trim()
          : row.destination ?? null;
      return {
        ...lean,
        company_name: row.company?.name,
        destination,
      };
    });

    return transformedData as Quotation[];
  } catch (err) {
    console.error('Error in getPendingApprovalQuotations:', err);
    return [];
  }
}

/**
 * Approve customer quote request — staff fills in destination, company, rate and approves
 */
export async function approveQuoteRequest(
  quotationId: string,
  staffUserId: string,
  updates: {
    company_id?: string;
    destination_id?: string;
    destination?: string;
    company_name?: string;
    status: string;
    [key: string]: unknown;
  }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('quotations')
      .update({
        ...updates,
        user_id: staffUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quotationId)
      .eq('status', 'pending_approval');

    if (error) {
      console.error('Error approving quote request:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error in approveQuoteRequest:', err);
    return false;
  }
}

export async function getQuotationById(id: string): Promise<Quotation | null> {
  try {
    const { data, error } = await supabase
      .from('quotations')
      .select(`
        *,
        company:companies(name, address, tax_id, contact_person, contact_email, contact_phone),
        destination_country:destinations(country, port),
        product:products(name)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching quotation by ID:', error.message, error.code, 'ID:', id);
      return null;
    }
    if (!data) return null;

    // Transform data to match Quotation interface
    const quotation: Quotation = {
      ...data,
      company_name: data.company?.name,
      destination: data.destination_country
        ? `${data.destination_country.country}${data.destination_country.port ? ' - ' + data.destination_country.port : ''}`.trim()
        : data.destination ?? null,
      // Ensure shipment_photo_url and shipment_photo_uploaded_at are correctly typed here if needed
      // If the database returns shipment_photo_url as a string that looks like an array (e.g., "{\"url1\",\"url2\"}"),
      // you might need to parse it here. However, Supabase usually handles TEXT[] as JS arrays directly.
    };

    return quotation;
  } catch (err) {
    console.error('Error in getQuotationById:', err);
    return null;
  }
}

// Type for creating a new quotation (without DB-generated fields)
export type NewQuotationData = Omit<Quotation, 'id' | 'created_at' | 'updated_at'>;

export async function saveQuotation(quotationData: NewQuotationData): Promise<Quotation | null> {
  try {
    console.log('Saving new quotation:', quotationData);

    // Check for required fields
    if (!quotationData.user_id || !quotationData.company_id || !quotationData.destination_id) {
      console.error('Missing required fields for quotation:',
        !quotationData.user_id ? 'user_id' : '',
        !quotationData.company_id ? 'company_id' : '',
        !quotationData.destination_id ? 'destination_id' : ''
      );
      throw new Error('Missing required fields for quotation');
    }

    // Ensure pallets is a valid array
    if (!Array.isArray(quotationData.pallets) || quotationData.pallets.length === 0) {
      console.error('Invalid or empty pallets array');
      throw new Error('At least one pallet is required');
    }

    // Prepare data - sanitize any fields that could cause database issues
    const sanitizedData = {
      ...quotationData,
      // Convert any undefined values to null for PostgreSQL compatibility
      contract_no: quotationData.contract_no || null,
      notes: quotationData.notes || null,
      opportunity_id: quotationData.opportunity_id || null, // Added field
      product_id: quotationData.product_id || null, // Added field
      internal_remark: quotationData.internal_remark || null, // Added field
      required_doc_types: Array.isArray(quotationData.required_doc_types) ? quotationData.required_doc_types : null, // Added field
      // Ensure JSONB fields are properly formatted
      pallets: Array.isArray(quotationData.pallets) ? quotationData.pallets : [],
      additional_charges: Array.isArray(quotationData.additional_charges) ? quotationData.additional_charges : [],
      is_chargeable_weight_manual: quotationData.is_chargeable_weight_manual || false,
      manual_chargeable_weight: quotationData.manual_chargeable_weight || null,
      is_manual_rate: quotationData.is_manual_rate || false,
      manual_rate: quotationData.manual_rate || null,
      taxable_lines: quotationData.taxable_lines ?? null,
      vat_amount: quotationData.vat_amount ?? null,
      grand_total_with_vat: quotationData.grand_total_with_vat ?? null,
      wht_enabled: quotationData.wht_enabled ?? true,
      wht_amount: quotationData.wht_amount ?? null,
    };

    const { data, error } = await supabase
      .from('quotations')
      .insert([sanitizedData])
      .select() // Select all columns of the newly created row
      .single(); // Expecting one row back

    if (error) {
      console.error('Error saving quotation:', error);

      // More detailed error reporting based on error type
      if (error.code === '23505') {
        console.error('Unique constraint violation. A record with these values already exists.');
        throw new Error('A quotation with these details already exists');
      } else if (error.code === '23503') {
        console.error('Foreign key constraint violation. Referenced record does not exist.');
        throw new Error('One of the referenced records (company, destination) does not exist');
      } else if (error.code === '23502') {
        console.error('Not null constraint violation. A required field is missing.');
        throw new Error('A required field is missing');
      } else {
        // Generic database error
        throw new Error(`Database error: ${error.message || 'Unknown error'} `);
      }
    }

    if (!data) {
      console.error('No data returned after saving quotation, though no error reported.');
      throw new Error('Failed to save quotation - no data returned');
    }

    console.log('Quotation saved successfully:', data);
    // Cast the returned data to the full Quotation type
    return data as Quotation;

  } catch (error: unknown) {
    console.error('Exception in saveQuotation:', error);
    // Return null to indicate failure, with error message logged
    if (error instanceof Error && error.message) {
      console.error('Error message:', error.message);
    }
    throw error; // Throw the error so the calling function can handle it
  }
}

// Update the Quotation in the database
// Accepts a partial Quotation object, but ensure it matches the updated interface
export async function updateQuotation(id: string, updates: Partial<Omit<Quotation, 'id' | 'created_at' | 'user_id'>>): Promise<Quotation | null> {
  try {
    console.log('Updating quotation:', id, updates);

    const { data, error } = await supabase
      .from('quotations')
      .update(updates)
      .eq('id', id)
      .select()
      .single(); // Expecting a single row back

    if (error) {
      console.error('Error updating quotation:', error);
      // Check for specific errors like RLS violation or not found
      if (error.code === 'PGRST204') { // PostgREST: No rows found
        console.warn(`Quotation with ID ${id} not found for update.`);
        return null;
      }
      throw error; // Re-throw other errors
    }

    console.log('Quotation updated successfully:', data);
    return data as Quotation; // Cast to the full Quotation type

  } catch (error) {
    console.error('Exception in updateQuotation:', error);
    return null;
  }
}

/**
 * ดึง quotations ที่ยังไม่ได้ผูกกับ opportunity ใดเลย
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getUnlinkedQuotations(userId?: string): Promise<Quotation[]> {
  try {
    const { data, error } = await supabase
      .from('quotations')
      .select(`
        *,
        company:companies(name),
        destination_country:destinations(country, port)
      `)
      .is('opportunity_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching unlinked quotations:', error);
      return [];
    }

    const transformedData = (data || []).map(q => {
      const row = q as {
        company?: { name?: string };
        company_name?: string | null;
        destination_country?: { country: string; port?: string | null };
        destination?: string | null;
      } & Record<string, unknown>;
      const lean = stripQuotationSignature(row);
      return {
        ...lean,
        company_name: row.company?.name || row.company_name,
        destination: row.destination_country
          ? `${row.destination_country.country}${row.destination_country.port ? ' - ' + row.destination_country.port : ''}`
          : row.destination ?? null,
      };
    });

    return transformedData as Quotation[];
  } catch (err) {
    console.error('Error in getUnlinkedQuotations:', err);
    return [];
  }
}

/**
 * ผูก quotation เข้ากับ opportunity (manual link)
 */
export async function linkQuotationToOpportunity(quotationId: string, opportunityId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('quotations')
      .update({
        opportunity_id: opportunityId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quotationId);

    if (error) {
      console.error('Error linking quotation to opportunity:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error in linkQuotationToOpportunity:', err);
    return false;
  }
}

/**
 * ยกเลิกการผูก quotation ออกจาก opportunity
 */
export async function unlinkQuotationFromOpportunity(quotationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('quotations')
      .update({
        opportunity_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quotationId);

    if (error) {
      console.error('Error unlinking quotation from opportunity:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error in unlinkQuotationFromOpportunity:', err);
    return false;
  }
}

/**
 * สร้าง share token สำหรับ public tracking link
 * ถ้ามี token อยู่แล้วจะ return token เดิม
 */
export async function generateShareToken(quotationId: string): Promise<string | null> {
  try {
    // Check if token already exists
    const { data: existing } = await supabase
      .from('quotations')
      .select('share_token')
      .eq('id', quotationId)
      .single();

    if (existing?.share_token) {
      return existing.share_token;
    }

    // Generate new token
    const token = crypto.randomUUID();

    const { error } = await supabase
      .from('quotations')
      .update({ share_token: token })
      .eq('id', quotationId);

    if (error) {
      console.error('Error generating share token:', error);
      return null;
    }

    return token;
  } catch (err) {
    console.error('Error in generateShareToken:', err);
    return null;
  }
}

/**
 * ดึง quotation จาก share token (สำหรับ public tracking — ไม่ต้อง auth)
 */
export type BookingStatus = 'draft' | 'sent' | 'confirmed';

/**
 * Generate or return existing booking_share_token for Air Freight public link.
 */
export async function generateBookingShareToken(quotationId: string): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('quotations')
      .select('booking_share_token')
      .eq('id', quotationId)
      .single();

    if (existing?.booking_share_token) {
      return existing.booking_share_token;
    }

    const token = crypto.randomUUID();

    const { error } = await supabase
      .from('quotations')
      .update({ booking_share_token: token })
      .eq('id', quotationId);

    if (error) {
      console.error('Error generating booking share token:', error);
      return null;
    }

    return token;
  } catch (err) {
    console.error('Error in generateBookingShareToken:', err);
    return null;
  }
}

/**
 * Persist staff booking form fields and mark booking as sent.
 */
export async function saveBookingDetails(
  quotationId: string,
  details: import('./email-templates').EmailBookingData
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('quotations')
      .update({
        booking_details: details,
        booking_status: 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quotationId);

    if (error) {
      console.error('Error saving booking details:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error in saveBookingDetails:', err);
    return false;
  }
}

export async function getQuotationByShareToken(token: string): Promise<(Quotation & { documents?: DocumentSubmission[] }) | null> {
  try {
    const { data, error } = await supabase
      .from('quotations')
      .select('*, opportunities(stage, closure_status)')
      .eq('share_token', token)
      .single();

    if (error) {
      console.error('Error fetching quotation by share token:', error);
      return null;
    }

    if (!data) return null;

    const { data: docs } = await supabase
      .from('document_submissions')
      .select('*')
      .eq('quotation_id', data.id)
      .order('submitted_at', { ascending: false });

    return { ...data, documents: docs || [] } as (Quotation & { documents?: DocumentSubmission[] }) | null;
  } catch (err) {
    console.error('Error in getQuotationByShareToken:', err);
    return null;
  }
}

/**
 * Submit customer e-signature from public sign page (uses /api/quotation-sign + service role).
 */
export async function submitQuotationSignature(
  token: string,
  signatureDataUrl: string,
  signedCompanyName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/quotation-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        signatureDataUrl,
        signedCompanyName: signedCompanyName.trim(),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (e) {
    console.error('submitQuotationSignature:', e);
    return { success: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function deleteQuotation(id: string) {
  try {
    const { error } = await supabase
      .from('quotations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting quotation:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteQuotation:', error);
    return false;
  }
}

// DOCUMENT SUBMISSION FUNCTIONS
export async function getDocumentSubmissions(quotationId?: string) {
  try {
    let query = supabase
      .from('document_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (quotationId) {
      query = query.eq('quotation_id', quotationId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching document submissions:', error);
      return [];
    }

    return data as DocumentSubmission[];
  } catch (error) {
    console.error('Error in getDocumentSubmissions:', error);
    return [];
  }
}

export async function getDocumentSubmissionsByOpp(opportunityId: string) {
  try {
    const { data, error } = await supabase
      .from('document_submissions')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching document submissions by Opp:', error);
      return [];
    }

    return data as DocumentSubmission[];
  } catch (error) {
    console.error('Error in getDocumentSubmissionsByOpp:', error);
    return [];
  }
}

export async function getDocumentSubmissionById(id: string) {
  try {
    const { data, error } = await supabase
      .from('document_submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching document submission:', error);
      return null;
    }

    return data as DocumentSubmission;
  } catch (error) {
    console.error('Error in getDocumentSubmissionById:', error);
    return null;
  }
}

export async function createDocumentSubmission(submission: Omit<DocumentSubmission, 'id' | 'submitted_at'>) {
  try {
    const { data, error } = await supabase
      .from('document_submissions')
      .insert([submission])
      .select();

    if (error) {
      console.error('Error creating document submission:', error);
      return null;
    }

    return data[0] as DocumentSubmission;
  } catch (error) {
    console.error('Error in createDocumentSubmission:', error);
    return null;
  }
}

export async function updateDocumentSubmission(id: string, updates: Partial<DocumentSubmission>) {
  try {
    console.log('🔍 updateDocumentSubmission called with:');
    console.log('- Document ID:', id);
    console.log('- Updates:', updates);

    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    console.log('👤 Current user session:', session ? 'User logged in' : 'No user session');
    console.log('👤 User ID:', session?.user?.id || 'None');

    const { data, error } = await supabase
      .from('document_submissions')
      .update(updates)
      .eq('id', id)
      .select();

    console.log('📊 Supabase response:');
    console.log('- Data:', data);
    console.log('- Error:', error);

    if (error) {
      console.error('❌ Error updating document submission:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.error('⚠️ No document found with ID:', id);
      console.log('🔍 This could be due to:');
      console.log('  1. Document ID does not exist');
      console.log('  2. Row Level Security (RLS) policy blocking update');
      console.log('  3. User does not have permission to update this document');
      return null;
    }

    console.log('✅ Document updated successfully:', data[0]);
    return data[0] as DocumentSubmission;
  } catch (error) {
    console.error('❌ Error in updateDocumentSubmission:', error);
    return null;
  }
}

export async function deleteDocumentSubmission(id: string) {
  try {
    const { deleteFile } = await import('@/lib/storage');

    // 1. Fetch document data first to get file path and provider
    const { data: doc, error: fetchError } = await supabase
      .from('document_submissions')
      .select('file_path, file_url, storage_provider')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching document before deletion:', fetchError);
      // Proceed with record deletion anyway if needed, but safer to return false
      return false;
    }

    // 2. Delete the physical file from storage (R2 or Supabase)
    const filePath = doc.file_path || doc.file_url;
    if (filePath) {
      const isPath = typeof filePath === 'string' && !filePath.startsWith('http');
      const provider = doc.storage_provider || (isPath ? 'r2' : 'supabase');

      // Document submissions are typically in 'documents' bucket
      await deleteFile('documents', filePath, provider);
      console.log(`Deleted file from ${provider}: ${filePath}`);
    }

    // 3. Delete from database
    const { error } = await supabase
      .from('document_submissions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting document submission:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteDocumentSubmission:', error);
    return false;
  }
}

// SETTINGS FUNCTIONS
export async function getSettings(category?: string) {
  try {
    let query = supabase
      .from('settings')
      .select('*');

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching settings:', error);
      return [];
    }

    return data as Setting[];
  } catch (error) {
    console.error('Error in getSettings:', error);
    return [];
  }
}

export async function getSetting(category: string, key: string) {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('category', category)
      .eq('settings_key', key)
      .single();

    if (error) {
      console.error('Error fetching setting:', error);
      return null;
    }

    return data as Setting;
  } catch (error) {
    console.error('Error in getSetting:', error);
    return null;
  }
}

export async function createOrUpdateSetting(
  category: string,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: Record<string, any>,
  userId: string
) {
  try {
    const { data: existingSetting } = await supabase
      .from('settings')
      .select('*')
      .eq('category', category)
      .eq('settings_key', key)
      .maybeSingle();

    if (existingSetting) {
      const { data, error } = await supabase
        .from('settings')
        .update({
          settings_value: value,
          user_id: userId
        })
        .eq('id', existingSetting.id)
        .select();

      if (error) {
        console.error('Error updating setting:', error);
        return null;
      }

      return data[0] as Setting;
    } else {
      const { data, error } = await supabase
        .from('settings')
        .insert([{
          category,
          settings_key: key,
          settings_value: value,
          user_id: userId
        }])
        .select();

      if (error) {
        console.error('Error creating setting:', error);
        return null;
      }

      return data[0] as Setting;
    }
  } catch (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any
  ) {
    console.error('Error in createOrUpdateSetting:', error);
    return null;
  }
}

export async function deleteSetting(id: string) {
  try {
    const { error } = await supabase
      .from('settings')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting setting:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteSetting:', error);
    return false;
  }
}

// Function to get document template by document type ID
export async function getDocumentTemplate(documentTypeId: string) {
  try {
    const { data, error } = await supabase
      .from('document_templates')
      .select('*')
      .eq('document_type_id', documentTypeId)
      .single();

    if (error) {
      console.error('Error fetching document template:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Failed to fetch document template:', err);
    return null;
  }
}

// Product Master Functions
export async function getProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_charges(*)')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching products:', error);
      return [];
    }
    return data as Product[];
  } catch (err) {
    console.error('Failed to fetch products:', err);
    return [];
  }
}

export async function getProductWithCharges(id: string) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_charges(*)')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching product:', error);
      return null;
    }
    return data as Product;
  } catch (err) {
    console.error('Failed to fetch product:', err);
    return null;
  }
}

export async function saveProductWithCharges(
  productData: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'product_charges'>,
  charges: Omit<ProductCharge, 'id' | 'product_id' | 'created_at'>[],
  productId?: string
) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user_id = userData.user?.id;

    let id = productId;

    // 1. Save or Update Product
    if (productId) {
      const { error: updateError } = await supabase
        .from('products')
        .update({
          ...productData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);

      if (updateError) throw updateError;
    } else {
      const { data: newProduct, error: insertError } = await supabase
        .from('products')
        .insert({
          ...productData,
          user_id,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      id = newProduct.id;
    }

    if (!id) throw new Error('Failed to get product ID');

    // 2. Manage Charges (Delete old ones and insert new ones for simplicity in this master-detail save)
    if (productId) {
      const { error: deleteError } = await supabase
        .from('product_charges')
        .delete()
        .eq('product_id', id);

      if (deleteError) throw deleteError;
    }

    if (charges.length > 0) {
      const chargesToInsert = charges.map(c => ({
        ...c,
        product_id: id,
      }));

      const { error: chargesError } = await supabase
        .from('product_charges')
        .insert(chargesToInsert);

      if (chargesError) throw chargesError;
    }

    return id;
  } catch (err) {
    console.error('Failed to save product:', err);
    throw err;
  }
}

export async function deleteProduct(id: string) {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Failed to delete product:', err);
    return false;
  }
}

// ============================================================
// PROFORMA INVOICES
// ============================================================

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeProformaTotals(
  lineItems: ProformaLineItem[],
  wht_enabled?: boolean | null
): {
  subtotal: number;
  vat: number;
  grand_total: number;
  wht_amount: number;
  net_payable: number;
} {
  const subtotal = roundMoney(
    lineItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  );
  const taxableBase = roundMoney(
    lineItems.reduce((s, i) => {
      const isTaxable = i.taxable !== false; // undefined -> taxable by default
      return s + (isTaxable ? Number(i.amount) || 0 : 0);
    }, 0)
  );
  const vat = roundMoney(taxableBase * 0.07);
  const grand_total = roundMoney(subtotal + vat);
  const wht_amount = quotationWhtEnabled(wht_enabled) ? roundMoney(taxableBase * QUOTATION_WHT_RATE) : 0;
  const net_payable = roundMoney(grand_total - wht_amount);
  return { subtotal, vat, grand_total, wht_amount, net_payable };
}

/** Net payable for proforma (grand_total − WHT). */
export function getProformaPayableTotal(p: Pick<ProformaInvoice, 'grand_total' | 'wht_amount' | 'wht_enabled'>): number {
  const gt = Number(p.grand_total) || 0;
  const wht =
    quotationWhtEnabled(p.wht_enabled) && p.wht_amount != null && !Number.isNaN(Number(p.wht_amount))
      ? Number(p.wht_amount)
      : 0;
  return roundMoney(gt - wht);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProformaRow(row: any): ProformaInvoice {
  const rawItems = row.line_items;
  const line_items: ProformaLineItem[] = Array.isArray(rawItems)
    ? rawItems.map((i: { description?: string; amount?: number; taxable?: boolean }) => ({
        description: String(i.description ?? ''),
        amount: Number(i.amount) || 0,
        taxable: i.taxable === false ? false : true,
      }))
    : [];

  return {
    ...row,
    line_items,
    freight_type: row.freight_type === 'sea' || row.freight_type === 'air' ? row.freight_type : null,
    est_gross_weight: row.est_gross_weight != null ? Number(row.est_gross_weight) : null,
    est_net_weight: row.est_net_weight != null ? Number(row.est_net_weight) : null,
    qty_wt: row.qty_wt != null && row.qty_wt !== '' ? String(row.qty_wt) : null,
    chargeable_weight: row.chargeable_weight != null ? Number(row.chargeable_weight) : null,
    subtotal: row.subtotal != null ? Number(row.subtotal) : null,
    vat: row.vat != null ? Number(row.vat) : null,
    grand_total: row.grand_total != null ? Number(row.grand_total) : null,
    wht_enabled: row.wht_enabled === false ? false : true,
    wht_amount: row.wht_amount != null ? Number(row.wht_amount) : null,
  } as ProformaInvoice;
}

/** One selectable charge line from a quotation (used by proforma import picker). */
export interface QuotationLineOption {
  key: string;
  description: string;
  amount: number;
  taxable: boolean;
}

export function getQuotationLineOptions(q: Quotation): QuotationLineOption[] {
  const out: QuotationLineOption[] = [];
  if (q.total_freight_cost) {
    out.push({
      key: 'freight',
      description: 'Freight Cost',
      amount: Number(q.total_freight_cost),
      taxable: quotationLineIsTaxable(q.taxable_lines, 'freight'),
    });
  }
  if (q.clearance_cost) {
    out.push({
      key: 'clearance',
      description: 'Clearance Cost',
      amount: Number(q.clearance_cost),
      taxable: quotationLineIsTaxable(q.taxable_lines, 'clearance'),
    });
  }
  if (q.delivery_service_required && q.delivery_cost) {
    out.push({
      key: 'delivery',
      description: `Delivery Service (${q.delivery_vehicle_type || ''})`,
      amount: Number(q.delivery_cost),
      taxable: quotationLineIsTaxable(q.taxable_lines, 'delivery'),
    });
  }
  (q.additional_charges ?? []).forEach((c, index) => {
    out.push({
      key: `additional:${index}`,
      description: c.description,
      amount: Number(c.amount) || 0,
      taxable: quotationLineIsTaxable(q.taxable_lines, `additional:${index}`),
    });
  });
  return out;
}

export function buildProformaDefaultsFromQuote(q: Quotation): Pick<
  ProformaInvoice,
  | 'customer_name'
  | 'qty_wt'
  | 'chargeable_weight'
  | 'airport_destination'
  | 'est_net_weight'
  | 'line_items'
> {
  const line_items: ProformaLineItem[] = getQuotationLineOptions(q).map(({ description, amount }) => ({
    description,
    amount,
  }));

  return {
    customer_name: q.company_name ?? null,
    qty_wt: q.pallets?.length ? String(q.pallets.length) : null,
    chargeable_weight: q.chargeable_weight ?? null,
    airport_destination: q.destination ?? null,
    est_net_weight: q.total_actual_weight ?? null,
    line_items,
  };
}

export type ProformaInvoiceListItem = ProformaInvoice & {
  quotation_no?: string | null;
  /** From joined quotation row (display fallback next to proforma customer_name) */
  company_name?: string | null;
};

export async function getProformaInvoices(): Promise<ProformaInvoiceListItem[]> {
  try {
    const { data, error } = await supabase
      .from('proforma_invoices')
      .select(
        `
        *,
        quotation:quotations(quotation_no, company_name)
      `
      )
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching proforma invoices:', error);
      return [];
    }

    return (data ?? []).map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      const q = r.quotation;
      const parent = q && !Array.isArray(q) ? q : Array.isArray(q) ? q[0] : null;
      const rest = { ...r };
      delete (rest as Record<string, unknown>).quotation;
      const base = mapProformaRow(rest);
      return {
        ...base,
        quotation_no: parent?.quotation_no ?? null,
        company_name: parent?.company_name ?? null,
      };
    });
  } catch (err) {
    console.error('Error in getProformaInvoices:', err);
    return [];
  }
}

export async function getProformaInvoicesByQuotation(quotationId: string): Promise<ProformaInvoice[]> {
  try {
    const { data, error } = await supabase
      .from('proforma_invoices')
      .select('*')
      .eq('quotation_id', quotationId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching proforma invoices:', error);
      return [];
    }
    return (data ?? []).map(mapProformaRow);
  } catch (err) {
    console.error('Error in getProformaInvoicesByQuotation:', err);
    return [];
  }
}

export async function getProformaInvoiceById(id: string): Promise<ProformaInvoice | null> {
  try {
    const { data, error } = await supabase.from('proforma_invoices').select('*').eq('id', id).single();

    if (error) {
      console.error('Error fetching proforma invoice:', error);
      return null;
    }
    if (!data) return null;
    return mapProformaRow(data);
  } catch (err) {
    console.error('Error in getProformaInvoiceById:', err);
    return null;
  }
}

export async function createProformaInvoice(
  quotationId: string,
  overrides?: Partial<
    Omit<ProformaInvoice, 'id' | 'quotation_id' | 'created_at' | 'updated_at' | 'line_items'>
  > & { line_items?: ProformaLineItem[] }
): Promise<ProformaInvoice | null> {
  try {
    const q = await getQuotationById(quotationId);
    if (!q) {
      console.error('createProformaInvoice: quotation not found');
      return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    const fromQuote = buildProformaDefaultsFromQuote(q);
    const { line_items: ovLineItems, ...restOverrides } = overrides ?? {};
    const line_items = ovLineItems ?? fromQuote.line_items;
    const wht_enabled = overrides?.wht_enabled ?? quotationWhtEnabled(q.wht_enabled);
    const { subtotal, vat, grand_total, wht_amount } = computeProformaTotals(line_items, wht_enabled);

    const row = {
      quotation_id: quotationId,
      user_id: userId,
      invoice_no: null,
      invoice_date: null,
      customer_code: null,
      customer_address: null,
      consignee_name: null,
      consignee_address: null,
      freight_type: null,
      est_shipped_date: null,
      est_gross_weight: null,
      carrier: null,
      mawb: null,
      share_token: null,
      status: 'draft' as const,
      ...fromQuote,
      ...restOverrides,
      line_items,
      subtotal,
      vat,
      grand_total,
      wht_enabled,
      wht_amount,
    };

    const { data, error } = await supabase.from('proforma_invoices').insert([row]).select('*').single();

    if (error) {
      console.error(
        'Error creating proforma invoice:',
        JSON.stringify(
          {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          },
          null,
          2
        )
      );
      return null;
    }
    return mapProformaRow(data);
  } catch (err) {
    console.error('Error in createProformaInvoice:', err);
    return null;
  }
}

export async function updateProformaInvoice(
  id: string,
  patch: Partial<
    Omit<ProformaInvoice, 'id' | 'created_at' | 'updated_at' | 'quotation_id'>
  >
): Promise<ProformaInvoice | null> {
  try {
    let nextLineItems: ProformaLineItem[] | undefined;
    if (patch.line_items) {
      nextLineItems = patch.line_items;
    }

    const whtForTotals =
      patch.wht_enabled !== undefined ? patch.wht_enabled : undefined;

    let totals: ReturnType<typeof computeProformaTotals> | null = null;
    if (nextLineItems !== undefined) {
      let whtForCalc = whtForTotals;
      if (whtForCalc === undefined) {
        const existing = await getProformaInvoiceById(id);
        whtForCalc = existing?.wht_enabled;
      }
      totals = computeProformaTotals(nextLineItems, whtForCalc);
    }

    const rest: Record<string, unknown> = { ...patch };
    delete rest.line_items;

    const updatePayload: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined)
    );
    updatePayload.updated_at = new Date().toISOString();

    if (nextLineItems !== undefined) {
      updatePayload.line_items = nextLineItems;
      updatePayload.subtotal = totals!.subtotal;
      updatePayload.vat = totals!.vat;
      updatePayload.grand_total = totals!.grand_total;
      updatePayload.wht_amount = totals!.wht_amount;
      if (whtForTotals !== undefined) {
        updatePayload.wht_enabled = quotationWhtEnabled(whtForTotals);
      }
    } else if (whtForTotals !== undefined) {
      const existing = await getProformaInvoiceById(id);
      if (existing?.line_items?.length) {
        const recalc = computeProformaTotals(existing.line_items, whtForTotals);
        updatePayload.wht_enabled = quotationWhtEnabled(whtForTotals);
        updatePayload.wht_amount = recalc.wht_amount;
      } else {
        updatePayload.wht_enabled = quotationWhtEnabled(whtForTotals);
        updatePayload.wht_amount = 0;
      }
    }

    // NOTE: no .single() — RLS may hide the updated row on read-back and produce
    // an empty-looking error. We update first, then re-fetch separately.
    const { error: updateError } = await supabase
      .from('proforma_invoices')
      .update(updatePayload)
      .eq('id', id);

    if (updateError) {
      console.error(
        'Error updating proforma invoice:',
        JSON.stringify(
          {
            message: updateError.message,
            code: updateError.code,
            details: updateError.details,
            hint: updateError.hint,
          },
          null,
          2
        ),
        '\nPayload keys:',
        Object.keys(updatePayload)
      );
      return null;
    }

    return await getProformaInvoiceById(id);
  } catch (err) {
    console.error('Error in updateProformaInvoice:', err);
    return null;
  }
}

export async function deleteProformaInvoice(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('proforma_invoices').delete().eq('id', id);

    if (error) {
      console.error('Error deleting proforma invoice:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error in deleteProformaInvoice:', err);
    return false;
  }
}