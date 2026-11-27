'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Building2, User, Mail, Bell, Loader2, Save, Pencil, X,
  MapPin, Hash, Phone, FileText, Upload, Trash2, Eye, CheckCircle2,
} from 'lucide-react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import {
  getCustomerSetting, saveCustomerSetting, updateCustomerProfile,
  getCustomerCompany, updateCustomerCompany,
  getCompanyDocuments, deleteCompanyDocument,
  type CompanyDocument,
} from '@/lib/customer-db';
import { getFileUrl } from '@/lib/storage';
import { browserAuthHeaders } from '@/lib/browser-auth';
import { toast } from 'sonner';

// Document slots available for company-level persistent storage
// IDs must match exactly the type IDs used in the shipment checklist (DOCUMENT_CATEGORIES)
const COMPANY_DOC_TYPES = [
  { id: 'tk-11', label: 'TK11 (Thai)', shortLabel: 'TK11 TH' },
  { id: 'tk-11-eng', label: 'TK11 (English)', shortLabel: 'TK11 EN' },
  { id: 'tk-10', label: 'TK10 (Thai)', shortLabel: 'TK10 TH' },
  { id: 'tk-10-eng', label: 'TK10 (English)', shortLabel: 'TK10 EN' },
  { id: 'id-card-copy', label: 'ID Card Copy', shortLabel: 'ID Card' },
  { id: 'thai-gacp-certificate-standard', label: 'Thai GACP Certificate', shortLabel: 'GACP' },
] as const;

type DocTypeId = typeof COMPANY_DOC_TYPES[number]['id'];

async function uploadCompanyDoc(
  file: File,
  userId: string,
  documentType: string,
  documentTypeName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Get signed upload URL
    const urlRes = await fetch('/api/generate-upload-url', {
      method: 'POST',
      headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        userId,
        documentType,
        isCompanyDoc: true,
      }),
    });

    if (!urlRes.ok) {
      const err = await urlRes.json().catch(() => ({}));
      return { success: false, error: err.error || 'Failed to get upload URL' };
    }

    const { signedUrl, path, originalFileName, provider } = await urlRes.json();

    // 2. Upload to R2
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    if (!uploadRes.ok) return { success: false, error: 'Upload to storage failed' };

    // 3. Confirm in DB
    const confirmRes = await fetch('/api/confirm-company-document', {
      method: 'POST',
      headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        filePath: path,
        userId,
        documentType,
        documentTypeName,
        originalFileName: originalFileName || file.name,
        provider: provider || 'r2',
      }),
    });

    if (!confirmRes.ok) {
      const err = await confirmRes.json().catch(() => ({}));
      return { success: false, error: err.error || 'Failed to save record' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

function CompanyDocSlot({
  docType,
  existing,
  userId,
  onUploaded,
  onDeleted,
}: {
  docType: typeof COMPANY_DOC_TYPES[number];
  existing?: CompanyDocument;
  userId: string;
  onUploaded: () => void;
  onDeleted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [loadingView, setLoadingView] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    const res = await uploadCompanyDoc(file, userId, docType.id, docType.label);
    setUploading(false);

    if (res.success) {
      toast.success(`${docType.shortLabel} uploaded`);
      onUploaded();
    } else {
      toast.error(res.error || 'Upload failed');
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    const res = await deleteCompanyDocument(docType.id);
    setDeleting(false);
    if (res.success) {
      toast.success(`${docType.shortLabel} removed`);
      onDeleted();
    } else {
      toast.error(res.error || 'Delete failed');
    }
  };

  const handleView = async () => {
    if (!existing) return;
    setLoadingView(true);
    try {
      const url = await getFileUrl(existing.file_path, existing.storage_provider as 'r2' | 'supabase');
      setViewUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not generate view link');
    } finally {
      setLoadingView(false);
    }
  };

  const hasFile = !!existing;

  return (
    <div className={`rounded-sm border p-4 transition-all ${hasFile ? 'border-emerald-200 bg-emerald-50/30' : 'border-dashed border-gray-200 bg-gray-50/50'}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {hasFile ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-gray-300 shrink-0" />
          )}
          <span className="text-sm font-semibold text-gray-700">{docType.label}</span>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${hasFile ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
          {hasFile ? 'Uploaded' : 'Optional'}
        </span>
      </div>

      {hasFile ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 truncate" title={existing.file_name}>{existing.file_name}</p>
          <p className="text-[10px] text-gray-400">
            {new Date(existing.uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleView}
              disabled={loadingView}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingView ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              View
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Replace
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-2 py-4 text-gray-400 hover:text-emerald-600 hover:border-emerald-300 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          ) : (
            <Upload className="w-5 h-5" />
          )}
          <span className="text-xs font-medium">{uploading ? 'Uploading…' : 'Click to upload'}</span>
          <span className="text-[10px] text-gray-300">PDF, JPG, PNG · max 100MB</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        onChange={handleFileChange}
      />
      {/* suppress unused viewUrl lint warning */}
      {viewUrl && null}
    </div>
  );
}

export default function ProfilePage() {
  const { profile, user, refreshProfile } = useCustomerAuth();

  // Notification settings
  const [notifSettings, setNotifSettings] = useState<Record<string, boolean>>({
    quotation_updates: true,
    document_review: true,
    shipment_tracking: true,
  });
  const [isSavingNotif, setIsSavingNotif] = useState<string | null>(null);
  const [isLoadingNotif, setIsLoadingNotif] = useState(true);

  // Company record
  const [companyRecord, setCompanyRecord] = useState<{
    id: string; name: string; address?: string; tax_id?: string;
    contact_person?: string; contact_email?: string; contact_phone?: string;
  } | null>(null);

  // Company documents
  const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editContactPerson, setEditContactPerson] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    if (user?.id) {
      getCustomerSetting('notification', 'preferences', {
        quotation_updates: true,
        document_review: true,
        shipment_tracking: true,
      }).then(saved => {
        setNotifSettings(saved);
        setIsLoadingNotif(false);
      });

      getCustomerCompany().then(c => setCompanyRecord(c));
      loadDocs();
    }
  }, [user?.id]);

  const loadDocs = async () => {
    setLoadingDocs(true);
    const docs = await getCompanyDocuments();
    setCompanyDocs(docs);
    setLoadingDocs(false);
  };

  const refreshDocs = () => loadDocs();

  const startEdit = () => {
    setEditFullName(profile?.full_name || '');
    setEditName(companyRecord?.name || profile?.company || '');
    setEditAddress(companyRecord?.address || '');
    setEditTaxId(companyRecord?.tax_id || '');
    setEditContactPerson(companyRecord?.contact_person || '');
    setEditContactEmail(companyRecord?.contact_email || '');
    setEditContactPhone(companyRecord?.contact_phone || '');
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveProfile = async () => {
    if (!editFullName.trim()) { toast.error('Full name is required'); return; }
    if (!editName.trim()) { toast.error('Company name is required'); return; }

    setIsSavingProfile(true);

    if (companyRecord) {
      const r = await updateCustomerCompany(companyRecord.id, {
        name: editName,
        address: editAddress,
        tax_id: editTaxId,
        contact_person: editContactPerson,
        contact_email: editContactEmail,
        contact_phone: editContactPhone,
      });
      if (!r.success) {
        toast.error(r.error || 'Failed to save company');
        setIsSavingProfile(false);
        return;
      }
      setCompanyRecord({
        ...companyRecord,
        name: editName,
        address: editAddress,
        tax_id: editTaxId,
        contact_person: editContactPerson,
        contact_email: editContactEmail,
        contact_phone: editContactPhone,
      });
    }

    // Sync profile name + company text field
    await updateCustomerProfile(editFullName, editName);
    await refreshProfile();

    toast.success('Profile updated');
    setIsSavingProfile(false);
    setEditing(false);
  };

  const handleToggle = async (key: string) => {
    const newValue = !notifSettings[key];
    const newSettings = { ...notifSettings, [key]: newValue };
    setNotifSettings(newSettings);
    setIsSavingNotif(key);
    const success = await saveCustomerSetting('notification', 'preferences', newSettings);
    if (success) {
      toast.success('Settings updated');
    } else {
      toast.error('Failed to update settings');
      setNotifSettings(notifSettings);
    }
    setIsSavingNotif(null);
  };

  const displayName = profile?.full_name || 'Customer';
  const companyName = companyRecord?.name || profile?.company || '-';
  const email = profile?.email || user?.email || '-';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'C';

  const Field = ({ label, value }: { label: string; value?: string }) => (
    <div>
      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{label}</label>
      <div className="text-sm text-gray-900 font-medium bg-slate-50 p-3 rounded-lg border border-slate-100">{value || '-'}</div>
    </div>
  );

  const docMap = new Map<DocTypeId, CompanyDocument>(
    companyDocs.map(d => [d.document_type as DocTypeId, d])
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account information and preferences</p>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-sm border border-gray-100 overflow-hidden shadow-sm">
        <div className="h-32 bg-gradient-to-r from-emerald-500 via-emerald-600 to-cyan-600 relative">
          <div className="absolute bottom-0 left-6 translate-y-1/2">
            <div className="w-20 h-20 bg-white rounded-sm shadow-lg flex items-center justify-center text-2xl font-bold text-emerald-600 border-4 border-white">
              {initials}
            </div>
          </div>
        </div>

        <div className="pt-14 px-6 pb-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{displayName}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{companyName}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-wider border border-emerald-100">
                  {profile?.role || 'customer'}
                </span>
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              </div>
            </div>
            {!editing && (
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Company Information */}
        <div className="bg-white rounded-sm border border-gray-100 p-6 shadow-sm group transition-all hover:shadow-md md:col-span-2">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-emerald-500 transition-colors">
              <Building2 className="w-5 h-5" />
            </div>
            Company Information
          </h3>

          {editing ? (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Company Name */}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Company Name <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" required />
                </div>
              </div>
              {/* Tax ID */}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Tax ID / VAT</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={editTaxId} onChange={e => setEditTaxId(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              {/* Address */}
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <textarea value={editAddress} onChange={e => setEditAddress(e.target.value)} rows={2}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" />
                </div>
              </div>
              {/* Contact Person */}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Contact Person</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={editContactPerson} onChange={e => setEditContactPerson(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              {/* Contact Phone */}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="tel" value={editContactPhone} onChange={e => setEditContactPhone(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              {/* Contact Email */}
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Contact Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="email" value={editContactEmail} onChange={e => setEditContactEmail(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Company Name" value={companyRecord?.name || profile?.company || undefined} />
              <Field label="Tax ID / VAT" value={companyRecord?.tax_id} />
              <div className="md:col-span-2">
                <Field label="Address" value={companyRecord?.address} />
              </div>
              <Field label="Contact Person" value={companyRecord?.contact_person} />
              <Field label="Phone" value={companyRecord?.contact_phone} />
              <div className="md:col-span-2">
                <Field label="Contact Email" value={companyRecord?.contact_email} />
              </div>
            </div>
          )}
        </div>

        {/* Contact / Personal Information */}
        <div className="bg-white rounded-sm border border-gray-100 p-6 shadow-sm group transition-all hover:shadow-md">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-emerald-500 transition-colors">
              <User className="w-5 h-5" />
            </div>
            Personal Information
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Full Name</label>
              {editing ? (
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={editFullName} onChange={e => setEditFullName(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              ) : (
                <div className="text-sm text-gray-900 font-bold bg-slate-50 p-3 rounded-lg border border-slate-100">{displayName}</div>
              )}
            </div>
            <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div className="p-1.5 bg-white rounded-md shadow-sm">
                <Mail className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-sm text-gray-900 font-medium">{email}</div>
            </div>
          </div>
        </div>

        {/* Save / Cancel row */}
        {editing && (
          <div className="flex items-center justify-end gap-3">
            <button onClick={cancelEdit} disabled={isSavingProfile}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button onClick={saveProfile} disabled={isSavingProfile}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        )}

        {/* Company Documents */}
        <div className="bg-white rounded-sm border border-gray-100 p-6 shadow-sm md:col-span-2 group transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-emerald-500 transition-colors">
                <FileText className="w-5 h-5" />
              </div>
              Company Documents
            </h3>
            {loadingDocs && <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />}
          </div>
          <p className="text-xs text-gray-400 mb-5">
            Upload once — these documents auto-attach to every new shipment request so you don&apos;t have to re-upload each time.
          </p>

          {user ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {COMPANY_DOC_TYPES.map(docType => (
                <CompanyDocSlot
                  key={docType.id}
                  docType={docType}
                  existing={docMap.get(docType.id)}
                  userId={user.id}
                  onUploaded={refreshDocs}
                  onDeleted={refreshDocs}
                />
              ))}
            </div>
          ) : (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
          )}
        </div>

        {/* Notification Preferences */}
        <div className="bg-white rounded-sm border border-gray-100 p-6 shadow-sm md:col-span-2 group transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-emerald-500 transition-colors">
                <Bell className="w-5 h-5" />
              </div>
              Notifications
            </h3>
            {isLoadingNotif && <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />}
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { id: 'quotation_updates', label: 'Quotation Updates', desc: 'When a quotation status changes' },
              { id: 'document_review', label: 'Document Review', desc: 'When documents are approved/rejected' },
              { id: 'shipment_tracking', label: 'Shipment Tracking', desc: 'Real-time milestone notifications' },
            ].map((pref) => {
              const enabled = notifSettings[pref.id];
              const saving = isSavingNotif === pref.id;

              return (
                <div key={pref.id} className="flex flex-col justify-between p-4 bg-gray-50/50 rounded-sm border border-gray-100 hover:border-emerald-100 transition-all hover:bg-emerald-50/10">
                  <div className="mb-4">
                    <div className="text-sm font-bold text-gray-900">{pref.label}</div>
                    <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">{pref.desc}</div>
                  </div>
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button
                      onClick={() => handleToggle(pref.id)}
                      disabled={saving}
                      className={`w-12 h-6 rounded-full relative transition-all duration-300 ${enabled ? 'bg-emerald-500' : 'bg-gray-300'} ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-300 flex items-center justify-center ${enabled ? 'left-[26px]' : 'left-0.5'}`}>
                        {saving && <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />}
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="text-center">
        <p className="text-xs text-gray-400">Settings are automatically saved to your account</p>
      </div>
    </div>
  );
}
