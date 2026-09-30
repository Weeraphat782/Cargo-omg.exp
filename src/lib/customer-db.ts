import { queryClient, loadSession } from '@/lib/customer-query-client';
import type { Quotation, DocumentSubmission } from '@/lib/db';
import type { CommodityType } from '@/lib/document-presets';

export interface FreightRate {
  id: string;
  destination_id: string;
  min_weight: number | null;
  max_weight: number | null;
  base_rate: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Customer-specific database functions
// ใช้สำหรับ customer portal เท่านั้น
//
// ใช้ queryClient (ไม่ใช่ main supabase client) เพื่อ bypass navigator.locks
// queryClient ไม่มี autoRefreshToken, ไม่มี persistSession → ไม่มี lock → ไม่ค้าง
//
// ก่อนทุก query: loadSession() อ่าน token จาก localStorage → sync เข้า queryClient
// ถ้า token หมดอายุ → refresh ด้วย fetch() ตรง (5s timeout)
// ============================================================

/**
 * ดึง quotations ทั้งหมดที่ assign ให้ customer
 */
export async function getCustomerQuotations(providedUserId?: string): Promise<Quotation[]> {
  try {
    const ready = await loadSession();
    if (!ready && !providedUserId) return [];

    let userId = providedUserId;
    if (!userId) {
      const { data: { user } } = await queryClient.auth.getUser();
      if (!user) return [];
      userId = user.id;
    }

    const { data, error } = await queryClient
      .from('quotations')
      .select('*, opportunities(stage, closure_status)')
      .eq('customer_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getCustomerQuotations error:', error.message);
      return [];
    }

    return (data || []) as Quotation[];
  } catch (err) {
    console.error('getCustomerQuotations exception:', err);
    return [];
  }
}

/**
 * ดึง quotation เดี่ยวสำหรับ customer
 */
export async function getCustomerQuotationById(id: string, providedUserId?: string): Promise<Quotation | null> {
  try {
    const ready = await loadSession();
    if (!ready && !providedUserId) return null;

    let userId = providedUserId;
    if (!userId) {
      const { data: { user } } = await queryClient.auth.getUser();
      if (!user) return null;
      userId = user.id;
    }

    const { data, error } = await queryClient
      .from('quotations')
      .select('*, opportunities(stage, closure_status)')
      .eq('id', id)
      .eq('customer_user_id', userId)
      .single();

    if (error) {
      console.error('getCustomerQuotationById error:', error.message);
      return null;
    }

    return data as Quotation | null;
  } catch (err) {
    console.error('getCustomerQuotationById exception:', err);
    return null;
  }
}

/**
 * ดึง document_submissions สำหรับ quotations ที่ assign ให้ customer
 */
export async function getCustomerDocuments(providedUserId?: string): Promise<(DocumentSubmission & { quotation_display_id?: string })[]> {
  try {
    const ready = await loadSession();
    if (!ready && !providedUserId) return [];

    let userId = providedUserId;
    if (!userId) {
      const { data: { user } } = await queryClient.auth.getUser();
      if (!user) return [];
      userId = user.id;
    }

    const { data: quotations } = await queryClient
      .from('quotations')
      .select('id')
      .eq('customer_user_id', userId);

    if (!quotations || quotations.length === 0) return [];

    const quotationIds = quotations.map(q => q.id);
    const quotationMap = new Map(quotations.map(q => [q.id, q.id.slice(0, 8).toUpperCase()]));

    const { data: docs, error } = await queryClient
      .from('document_submissions')
      .select('*')
      .in('quotation_id', quotationIds)
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('getCustomerDocuments error:', error.message);
      return [];
    }

    return (docs || []).map(doc => ({
      ...doc,
      quotation_display_id: quotationMap.get(doc.quotation_id) || 'N/A',
    }));
  } catch (err) {
    console.error('getCustomerDocuments exception:', err);
    return [];
  }
}

/**
 * ดึง customer stats สำหรับ dashboard
 */
export async function getCustomerStats(providedUserId?: string) {
  try {
    const quotations = await getCustomerQuotations(providedUserId);

    const activeStatuses = ['draft', 'sent', 'accepted', 'docs_uploaded', 'signed'];
    const inTransitStatuses = ['Shipped'];
    const completedStatuses = ['completed'];
    const pendingStatuses = ['pending_approval'];

    return {
      totalQuotations: quotations.filter(q => !pendingStatuses.includes(q.status)).length,
      activeQuotations: quotations.filter(q => activeStatuses.includes(q.status)).length,
      inTransit: quotations.filter(q => inTransitStatuses.includes(q.status)).length,
      completed: quotations.filter(q => completedStatuses.includes(q.status)).length,
      pendingRequests: quotations.filter(q => pendingStatuses.includes(q.status)).length,
      recentQuotations: quotations.slice(0, 5),
      allQuotations: quotations,
    };
  } catch (err) {
    console.error('getCustomerStats exception:', err);
    return {
      totalQuotations: 0,
      activeQuotations: 0,
      inTransit: 0,
      completed: 0,
      pendingRequests: 0,
      recentQuotations: [],
      allQuotations: [],
    };
  }
}

/**
 * อัปเดต quotation สำหรับ customer
 */
export async function updateCustomerQuotation(id: string, updates: Partial<Quotation>): Promise<boolean> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return false;

    const { data: checkData, error: checkError } = await queryClient
      .from('quotations')
      .select('id')
      .eq('id', id)
      .eq('customer_user_id', user.id)
      .single();

    if (checkError || !checkData) {
      console.error('Unauthorized or quotation not found');
      return false;
    }

    // Explode pallets if they are being updated
    const finalUpdates = { ...updates };
    if (updates.pallets && Array.isArray(updates.pallets)) {
      const explodedPallets = updates.pallets.flatMap(p => {
        const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
        return Array(qty).fill(null).map(() => ({
          ...p,
          quantity: 1
        }));
      });
      finalUpdates.pallets = explodedPallets;
    }

    const { error } = await queryClient
      .from('quotations')
      .update(finalUpdates)
      .eq('id', id)
      .eq('customer_user_id', user.id);

    if (error) {
      console.error('Error updating customer quotation:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('updateCustomerQuotation exception:', err);
    return false;
  }
}

/**
 * ส่งเอกสารใหม่สำหรับ quotation
 */
export async function submitCustomerDocument(document: Omit<DocumentSubmission, 'id' | 'submitted_at'>): Promise<boolean> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return false;

    const { data: qCheck } = await queryClient
      .from('quotations')
      .select('id')
      .eq('id', document.quotation_id)
      .eq('customer_user_id', user.id)
      .single();

    if (!qCheck) {
      console.error('Unauthorized: Quotation does not belong to this customer');
      return false;
    }

    const { error } = await queryClient
      .from('document_submissions')
      .insert({
        ...document,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error submitting document:', error);
      return false;
    }

    const { data: quotation } = await queryClient
      .from('quotations')
      .select('status')
      .eq('id', document.quotation_id)
      .single();

    if (quotation && ['draft', 'sent', 'accepted'].includes(quotation.status)) {
      await queryClient
        .from('quotations')
        .update({ status: 'docs_uploaded' })
        .eq('id', document.quotation_id);
    }

    return true;
  } catch (err) {
    console.error('submitCustomerDocument exception:', err);
    return false;
  }
}

/**
 * ดึงข้อมูลการตั้งค่าของ customer
 */
export async function getCustomerSetting<T>(category: string, key: string, defaultValue: T): Promise<T> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return defaultValue;

    const { data, error } = await queryClient
      .from('settings')
      .select('settings_value')
      .eq('user_id', user.id)
      .eq('category', category)
      .eq('settings_key', key)
      .maybeSingle();

    if (error) {
      console.error('getCustomerSetting error:', error);
      return defaultValue;
    }

    return (data?.settings_value as T) ?? defaultValue;
  } catch (err) {
    console.error('getCustomerSetting exception:', err);
    return defaultValue;
  }
}

/**
 * บันทึกข้อมูลการตั้งค่าของ customer
 */
export async function saveCustomerSetting(category: string, key: string, value: unknown): Promise<boolean> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) {
      console.error('saveCustomerSetting: no user');
      return false;
    }

    const { data: existing, error: selectError } = await queryClient
      .from('settings')
      .select('id')
      .eq('user_id', user.id)
      .eq('category', category)
      .eq('settings_key', key)
      .maybeSingle();

    if (selectError) {
      console.error('saveCustomerSetting select error:', selectError.message);
      return false;
    }

    if (existing) {
      const { error } = await queryClient
        .from('settings')
        .update({
          settings_value: value,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) console.error('saveCustomerSetting update error:', error.message);
      return !error;
    } else {
      const { error } = await queryClient
        .from('settings')
        .insert({
          user_id: user.id,
          category,
          settings_key: key,
          settings_value: value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (error) console.error('saveCustomerSetting insert error:', error.message);
      return !error;
    }
  } catch (err) {
    console.error('saveCustomerSetting exception:', err);
    return false;
  }
}

/**
 * สร้าง quote request จากลูกค้า (pending_approval)
 * ลูกค้าใส่แค่ pallet dimensions + notes
 * Staff จะเป็นคน approve และใส่ destination/company/rate ภายหลัง
 */
export async function getSavedNotifyRecipients(): Promise<string[]> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return [];
    const { data } = await queryClient
      .from('saved_notify_recipients')
      .select('emails')
      .eq('customer_user_id', user.id)
      .maybeSingle();
    return (data?.emails as string[]) ?? [];
  } catch {
    return [];
  }
}

export async function upsertSavedNotifyRecipients(emails: string[]): Promise<void> {
  await loadSession();
  const { data: { user } } = await queryClient.auth.getUser();
  if (!user) return;
  const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  await queryClient.from('saved_notify_recipients').upsert({
    customer_user_id: user.id,
    emails: cleaned,
    updated_at: new Date().toISOString(),
  });
}

export async function createCustomerQuoteRequest(
  pallets: { length: number; width: number; height: number; weight: number; quantity: number }[],
  requestedDestination: string,
  consigneeName: string,
  notes?: string,
  commodity: CommodityType = 'cannabis',
  phytoRequired: boolean = false,
  notifyOptions?: { extraNotifyEmails?: string[]; rememberNotifyRecipients?: boolean },
): Promise<{ success: boolean; quotationId?: string; error?: string }> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // Get customer profile + company record
    const [{ data: profile }, { data: customerCompany }] = await Promise.all([
      queryClient.from('profiles').select('full_name, company, email').eq('id', user.id).maybeSingle(),
      queryClient.from('companies').select('id, name').eq('customer_user_id', user.id).maybeSingle(),
    ]);

    const customerName = profile?.full_name || profile?.email || 'Customer';
    const requesterEmail = (profile?.email as string | undefined)?.trim().toLowerCase() || '';
    const companyName = customerCompany?.name || profile?.company || '';
    const companyId = customerCompany?.id || null;

    const extra = (notifyOptions?.extraNotifyEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@') && e !== requesterEmail);
    const deliveryNotifyEmails = [...new Set(extra)].slice(0, 10);

    if (!companyName.trim()) {
      return {
        success: false,
        error: 'Please complete your company setup before submitting a quote request.',
      };
    }

    // Explode pallets: if any row has quantity > 1, convert it to multiple rows with quantity 1
    const explodedPallets = pallets.flatMap(p => {
      const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
      return Array(qty).fill(null).map(() => ({
        ...p,
        quantity: 1
      }));
    });

    const { data, error } = await queryClient
      .from('quotations')
      .insert({
        customer_user_id: user.id,
        customer_name: customerName,
        company_name: companyName,
        contact_person: customerName,
        consignee_name: consigneeName.trim(),
        status: 'pending_approval',
        pallets: explodedPallets,
        requested_destination: requestedDestination,
        notes: notes || null,
        commodity_type: commodity,
        phyto_required: phytoRequired,
        // Pre-fill company from customer's registered company (staff can change at approval)
        company_id: companyId,
        // Fields that staff will fill in later
        user_id: null,
        destination_id: null,
        destination: null,
        additional_charges: [],
        delivery_service_required: false,
        delivery_vehicle_type: '4wheel',
        total_cost: 0,
        total_freight_cost: 0,
        clearance_cost: 0,
        delivery_cost: 0,
        delivery_notify_emails: deliveryNotifyEmails,
      })
      .select('id')
      .single();

    if (error) {
      console.error('createCustomerQuoteRequest error:', JSON.stringify(error, null, 2));
      console.error('Error details - code:', error.code, 'message:', error.message, 'details:', error.details, 'hint:', error.hint);
      return { success: false, error: error.message || error.code || 'Database error (check RLS policies & NOT NULL constraints)' };
    }

    const quotationId = data?.id;

    if (notifyOptions?.rememberNotifyRecipients && deliveryNotifyEmails.length > 0) {
      await upsertSavedNotifyRecipients(deliveryNotifyEmails);
    }

    // Auto-link company-level documents to the new quotation
    if (quotationId) {
      try {
        const { data: companyDocs } = await queryClient
          .from('company_documents')
          .select('document_type, document_type_name, file_path, file_name, storage_provider')
          .eq('user_id', user.id);

        if (companyDocs && companyDocs.length > 0) {
          const rows = companyDocs.map(doc => ({
            quotation_id: quotationId,
            document_type: doc.document_type,
            document_type_name: doc.document_type_name,
            file_name: doc.file_name,
            original_file_name: doc.file_name,
            file_path: doc.file_path,
            file_url: '',
            notes: null,
            company_name: companyName,
            storage_provider: doc.storage_provider || 'r2',
            source: 'company_profile',
          }));

          const { error: insertErr } = await queryClient
            .from('document_submissions')
            .insert(rows);

          if (insertErr) {
            console.error('Auto-link company docs error:', insertErr.message);
          }
        }
      } catch (linkErr) {
        console.error('Auto-link company docs exception:', linkErr);
      }
    }

    return { success: true, quotationId };
  } catch (err) {
    console.error('createCustomerQuoteRequest exception:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

/**
 * ดึง pending quote requests ของลูกค้า
 */
export async function getCustomerPendingRequests(providedUserId?: string): Promise<Quotation[]> {
  try {
    const ready = await loadSession();
    if (!ready && !providedUserId) return [];

    let userId = providedUserId;
    if (!userId) {
      const { data: { user } } = await queryClient.auth.getUser();
      if (!user) return [];
      userId = user.id;
    }

    const { data, error } = await queryClient
      .from('quotations')
      .select('*')
      .eq('customer_user_id', userId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getCustomerPendingRequests error:', error.message);
      return [];
    }

    return (data || []) as Quotation[];
  } catch (err) {
    console.error('getCustomerPendingRequests exception:', err);
    return [];
  }
}

/**
 * สร้าง share token สำหรับ public tracking link (customer-side)
 */
export async function generateCustomerShareToken(quotationId: string): Promise<string | null> {
  try {
    await loadSession();

    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return null;

    // Check ownership
    const { data: existing } = await queryClient
      .from('quotations')
      .select('share_token')
      .eq('id', quotationId)
      .eq('customer_user_id', user.id)
      .single();

    if (!existing) return null;
    if (existing.share_token) return existing.share_token;

    // Generate new token
    const token = crypto.randomUUID();

    const { error } = await queryClient
      .from('quotations')
      .update({ share_token: token })
      .eq('id', quotationId)
      .eq('customer_user_id', user.id);

    if (error) {
      console.error('Error generating share token:', error);
      return null;
    }

    return token;
  } catch (err) {
    console.error('generateCustomerShareToken exception:', err);
    return null;
  }
}

/**
 * ดึงอัตราค่าขนส่งสำหรับสถานที่ปลายทางเฉพาะ
 */
export async function getFreightRatesByDestination(destinationId: string): Promise<FreightRate[]> {
  try {
    await loadSession();

    const { data, error } = await queryClient
      .from('freight_rates')
      .select('*')
      .eq('destination_id', destinationId);

    if (error) {
      console.error('Error fetching freight rates:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('getFreightRatesByDestination exception:', err);
    return [];
  }
}

export interface CustomerCompanyInput {
  name: string;
  address?: string;
  tax_id?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
}

export async function getCustomerCompany(): Promise<{ id: string; name: string; address?: string; tax_id?: string; contact_person?: string; contact_email?: string; contact_phone?: string } | null> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return null;

    const { data, error } = await queryClient
      .from('companies')
      .select('id, name, address, tax_id, contact_person, contact_email, contact_phone')
      .eq('customer_user_id', user.id)
      .maybeSingle();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function createCustomerCompany(
  input: CustomerCompanyInput
): Promise<{ success: boolean; companyId?: string; error?: string }> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await queryClient
      .from('companies')
      .insert({
        name: input.name.trim(),
        address: input.address?.trim() || null,
        tax_id: input.tax_id?.trim() || null,
        contact_person: input.contact_person?.trim() || null,
        contact_email: input.contact_email?.trim() || null,
        contact_phone: input.contact_phone?.trim() || null,
        customer_user_id: user.id,
        user_id: null,
        is_approved: false,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, companyId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

export async function updateCustomerCompany(
  companyId: string,
  input: CustomerCompanyInput
): Promise<{ success: boolean; error?: string }> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await queryClient
      .from('companies')
      .update({
        name: input.name.trim(),
        address: input.address?.trim() || null,
        tax_id: input.tax_id?.trim() || null,
        contact_person: input.contact_person?.trim() || null,
        contact_email: input.contact_email?.trim() || null,
        contact_phone: input.contact_phone?.trim() || null,
      })
      .eq('id', companyId)
      .eq('customer_user_id', user.id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

export async function updateCustomerProfile(
  fullName: string,
  company: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await queryClient
      .from('profiles')
      .update({ full_name: fullName.trim(), company: company.trim() })
      .eq('id', user.id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

// ============================================================
// Company Documents — persistent, reusable documents stored at
// the company level (TK11, TK10, ID Card, Thai GACP).
// They auto-link to new quotations on creation.
// ============================================================

export interface CompanyDocument {
  id: string;
  user_id: string;
  document_type: string;
  document_type_name: string;
  file_path: string;
  file_name: string;
  storage_provider: string;
  uploaded_at: string;
}

export async function getCompanyDocuments(): Promise<CompanyDocument[]> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return [];

    const { data, error } = await queryClient
      .from('company_documents')
      .select('*')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('getCompanyDocuments error:', error.message);
      return [];
    }
    return (data || []) as CompanyDocument[];
  } catch (err) {
    console.error('getCompanyDocuments exception:', err);
    return [];
  }
}

export async function cancelCustomerQuoteRequest(
  quotationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const res = await fetch('/api/cancel-quote-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotationId, userId: user.id }),
    });

    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error || 'Failed to cancel' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

export async function deleteCompanyDocument(
  documentType: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    await loadSession();
    const { data: { user } } = await queryClient.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: existing } = await queryClient
      .from('company_documents')
      .select('file_path')
      .eq('user_id', user.id)
      .eq('document_type', documentType)
      .single();

    const { error } = await queryClient
      .from('company_documents')
      .delete()
      .eq('user_id', user.id)
      .eq('document_type', documentType);

    if (error) return { success: false, error: error.message };
    return { success: true, filePath: existing?.file_path };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

// ============================================================
// Customer self document check (pre-booking)
// ============================================================

export interface CustomerDocCheckResponse {
  success: boolean;
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  checks: Array<{
    name: string;
    status: 'PASS' | 'WARNING' | 'FAIL';
    details: string;
    message: string;
  }>;
  extractedByDocument: Array<{
    name: string;
    file_name: string;
    fields: Array<{ label: string; value: string }>;
  }>;
  documents: Array<{
    name: string;
    file_name: string;
    critical_issues: string[];
    warnings: string[];
  }>;
  requiredDocs: Array<{ type: string; name: string; primary: boolean; uploaded: boolean }>;
  checksRemaining: number;
  checkedAt: string;
}

export type CustomerDocCheckResult =
  | { ok: true; data: CustomerDocCheckResponse }
  | { ok: false; status: number; error: string };

/**
 * Run the automated pre-booking document check for a shipment the customer owns.
 * The server fills in the rule and selects all uploaded documents automatically.
 */
export async function runCustomerDocumentCheck(quotationId: string): Promise<CustomerDocCheckResult> {
  try {
    const ready = await loadSession();
    if (!ready) return { ok: false, status: 401, error: 'Session expired. Please sign in again.' };

    const { data: { session } } = await queryClient.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, status: 401, error: 'Session expired. Please sign in again.' };

    const res = await fetch('/api/portal/document-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ quotation_id: quotationId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error || 'Could not run the document check.' };
    }
    return { ok: true, data: data as CustomerDocCheckResponse };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}
