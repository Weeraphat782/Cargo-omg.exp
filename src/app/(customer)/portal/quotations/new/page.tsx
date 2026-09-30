'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft, ArrowRight, Plus, Trash2, Package, Send,
    Loader2, CheckCircle2, AlertCircle, Upload, Check, Eye, Leaf,
    ChevronUp, ChevronDown, FileText, Building2, FlaskConical, Thermometer,
} from 'lucide-react';
import { createCustomerQuoteRequest, getSavedNotifyRecipients, submitCustomerDocument, upsertSavedNotifyRecipients } from '@/lib/customer-db';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import {
    ALL_COMMODITY_TYPES,
    COMMODITY_META,
    GACP_DOCS_FARM,
    GACP_DOCS_STANDARD,
    getDocumentCategories,
    type CommodityType,
} from '@/lib/document-presets';
import { getDocumentTemplate } from '@/lib/db';
import type { DocumentSubmission } from '@/lib/db';
import { getFileUrl } from '@/lib/storage';
import toast from 'react-hot-toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface PalletInput {
    id: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    quantity: string;
}

interface QueuedFile {
    id: string;
    file: File;
    documentType: string;
    documentTypeName: string;
}

const COMMODITY_OPTIONS = ALL_COMMODITY_TYPES;

function createEmptyPallet(): PalletInput {
    return {
        id: crypto.randomUUID(),
        length: '',
        width: '',
        height: '',
        weight: '',
        quantity: '1',
    };
}

function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
    const steps = [
        { n: 1, label: 'Commodity' },
        { n: 2, label: 'Details' },
        { n: 3, label: 'Documents' },
    ] as const;

    return (
        <div className="flex items-center justify-center gap-2 sm:gap-4 mb-8">
            {steps.map((step, idx) => {
                const done = currentStep > step.n;
                const active = currentStep === step.n;
                return (
                    <div key={step.n} className="flex items-center gap-2 sm:gap-4">
                        <div className="flex flex-col items-center gap-1">
                            <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                                    done
                                        ? 'bg-emerald-600 border-emerald-600 text-white'
                                        : active
                                            ? 'bg-white border-emerald-500 text-emerald-600'
                                            : 'bg-gray-50 border-gray-200 text-gray-400'
                                }`}
                            >
                                {done ? <Check className="w-4 h-4" /> : step.n}
                            </div>
                            <span
                                className={`text-[10px] font-bold uppercase tracking-wider hidden sm:block ${
                                    active ? 'text-emerald-700' : done ? 'text-emerald-600' : 'text-gray-400'
                                }`}
                            >
                                {step.label}
                            </span>
                        </div>
                        {idx < steps.length - 1 && (
                            <div
                                className={`w-8 sm:w-16 h-0.5 rounded ${done ? 'bg-emerald-400' : 'bg-gray-200'}`}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}


export default function NewQuoteRequestPage() {
    const router = useRouter();
    const { profile } = useCustomerAuth();

    const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
    const [commodity, setCommodity] = useState<CommodityType | null>(null);
    const [pallets, setPallets] = useState<PalletInput[]>([createEmptyPallet()]);
    const [requestedDestination, setRequestedDestination] = useState('');
    const [consignee, setConsignee] = useState('');
    const [notes, setNotes] = useState('');
    const [phytoRequired, setPhytoRequired] = useState(false);
    const [dataLoggerAttached, setDataLoggerAttached] = useState(false);
    const [noAttachments, setNoAttachments] = useState(false);
    const [qcInterested, setQcInterested] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submittedQuotationId, setSubmittedQuotationId] = useState<string | null>(null);
    const [extraNotifyEmails, setExtraNotifyEmails] = useState<string[]>([]);
    const [notifyInput, setNotifyInput] = useState('');
    const [rememberNotifyRecipients, setRememberNotifyRecipients] = useState(false);

    useEffect(() => {
        void getSavedNotifyRecipients().then((saved) => {
            if (saved.length) setExtraNotifyEmails(saved);
        });
    }, []);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Step 3 upload state
    const [includeMsds, setIncludeMsds] = useState(false);
    const [isThaiGacp, setIsThaiGacp] = useState(false);
    const [uploadQueue, setUploadQueue] = useState<QueuedFile[]>([]);
    const [uploading, setUploading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        'company-info': true,
        'permits-forms': true,
        'shipping-docs': true,
        'additional': true,
        'gacp-certification': true,
    });

    const selectedCommodity = commodity ?? 'cannabis';

    const uploadCategories = useMemo(() => {
        const preset = getDocumentCategories(selectedCommodity, includeMsds);
        if (!COMMODITY_META[selectedCommodity].supportsGacp) {
            return preset;
        }
        return [
            ...preset,
            {
                id: 'gacp-certification',
                name: 'Thai GACP or GACP Certificate',
                types: isThaiGacp ? GACP_DOCS_FARM : GACP_DOCS_STANDARD,
            },
        ];
    }, [selectedCommodity, includeMsds, isThaiGacp]);

    const addPallet = () => setPallets(prev => [...prev, createEmptyPallet()]);

    const removePallet = (id: string) => {
        if (pallets.length === 1) return;
        setPallets(prev => prev.filter(p => p.id !== id));
    };

    const updatePallet = (id: string, field: keyof PalletInput, value: string) => {
        setPallets(prev => prev.map(p => (p.id === id ? { ...p, [field]: value } : p)));
        setErrors(prev => {
            const next = { ...prev };
            delete next[`${id}-${field}`];
            return next;
        });
    };

    const handleRequestedDestinationChange = (value: string) => {
        setRequestedDestination(value);
        if (value.trim()) {
            setErrors(prev => {
                const next = { ...prev };
                delete next['requestedDestination'];
                return next;
            });
        }
    };

    const handleConsigneeChange = (value: string) => {
        setConsignee(value);
        if (value.trim()) {
            setErrors(prev => {
                const next = { ...prev };
                delete next['consignee'];
                return next;
            });
        }
    };

    const clearAttachmentsError = () => {
        setErrors(prev => {
            if (!prev['attachments']) return prev;
            const next = { ...prev };
            delete next['attachments'];
            return next;
        });
    };

    const handlePhytoChange = (checked: boolean) => {
        setPhytoRequired(checked);
        if (checked) setNoAttachments(false);
        clearAttachmentsError();
    };

    const handleDataLoggerChange = (checked: boolean) => {
        setDataLoggerAttached(checked);
        setIncludeMsds(checked);
        if (checked) setNoAttachments(false);
        clearAttachmentsError();
    };

    const handleNoAttachmentsChange = (checked: boolean) => {
        setNoAttachments(checked);
        if (checked) {
            setPhytoRequired(false);
            setDataLoggerAttached(false);
            setIncludeMsds(false);
        }
        clearAttachmentsError();
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!requestedDestination.trim()) {
            newErrors['requestedDestination'] = 'Shipping Destination is required';
        }
        if (!consignee.trim()) {
            newErrors['consignee'] = 'Consignee is required';
        }
        pallets.forEach((p, idx) => {
            const num = idx + 1;
            if (!p.length || parseFloat(p.length) <= 0) newErrors[`${p.id}-length`] = `Pallet ${num}: Length required`;
            if (!p.width || parseFloat(p.width) <= 0) newErrors[`${p.id}-width`] = `Pallet ${num}: Width required`;
            if (!p.height || parseFloat(p.height) <= 0) newErrors[`${p.id}-height`] = `Pallet ${num}: Height required`;
            if (!p.quantity || parseInt(p.quantity) < 1) newErrors[`${p.id}-quantity`] = `Pallet ${num}: Qty must be >= 1`;
        });
        if (!phytoRequired && !dataLoggerAttached && !noAttachments) {
            newErrors['attachments'] = 'Please select Phyto, Data Logger, or No attachments';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmitQuote = async () => {
        if (!commodity || !validate()) {
            toast.error('Please fill in all required fields.');
            return;
        }

        setSubmitting(true);
        try {
            const palletData = pallets.map(p => ({
                length: parseFloat(p.length),
                width: parseFloat(p.width),
                height: parseFloat(p.height),
                weight: p.weight ? parseFloat(p.weight) : 0,
                quantity: parseInt(p.quantity),
            }));

            const submitNotes = [
                notes.trim(),
                qcInterested ? '[QC] Customer requested lab testing (COA) quote' : '',
                dataLoggerAttached ? '[DATA LOGGER] Customer will attach data logger (MSDS included)' : '',
            ].filter(Boolean).join('\n\n') || undefined;

            const result = await createCustomerQuoteRequest(
                palletData,
                requestedDestination,
                consignee.trim(),
                submitNotes,
                commodity,
                phytoRequired,
                { extraNotifyEmails, rememberNotifyRecipients }
            );

            if (result.success && result.quotationId) {
                setSubmittedQuotationId(result.quotationId);
                setCurrentStep(3);
                toast.success('Quote request submitted!');
                void fetch('/api/notify-quote-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quotationId: result.quotationId }),
                    keepalive: true,
                }).catch(() => {});
            } else {
                toast.error(result.error || 'Failed to submit request.');
            }
        } catch {
            toast.error('Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const goToShipment = () => {
        if (submittedQuotationId) {
            router.push(`/portal/shipments/${submittedQuotationId}`);
        } else {
            router.push('/portal');
        }
    };

    const handleFileUpload = (files: FileList | null, docTypeId: string, docTypeName: string) => {
        if (!files || files.length === 0) return;
        const newItems: QueuedFile[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > 10 * 1024 * 1024) {
                toast.error(`${file.name} > 10MB`);
                continue;
            }
            newItems.push({
                file,
                documentType: docTypeId,
                documentTypeName: docTypeName,
                id: Math.random().toString(36).substring(7),
            });
        }
        setUploadQueue(prev => [...prev, ...newItems]);
    };

    const handlePreview = async (documentTypeId: string, documentName: string) => {
        try {
            setPreviewLoading(prev => ({ ...prev, [documentTypeId]: true }));
            const template = await getDocumentTemplate(documentTypeId);
            if (template?.file_url) {
                const url = await getFileUrl(
                    template.file_url,
                    (template as DocumentSubmission).storage_provider || 'supabase',
                    'templates'
                );
                if (url) window.open(url, '_blank');
                else toast.error('Could not resolve template URL');
            } else {
                toast.error(`No template for ${documentName}`);
            }
        } catch {
            toast.error('Failed to load template');
        } finally {
            setPreviewLoading(prev => ({ ...prev, [documentTypeId]: false }));
        }
    };

    const submitAllDocuments = async () => {
        if (uploadQueue.length === 0 || !submittedQuotationId) return;
        setUploading(true);
        const companyName = profile?.company || profile?.full_name || 'N/A';
        try {
            let ok = 0;
            for (const item of uploadQueue) {
                const generateUrlResponse = await fetch('/api/generate-upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileName: item.file.name,
                        contentType: item.file.type,
                        quotationId: submittedQuotationId,
                        documentType: item.documentType,
                    }),
                });

                if (!generateUrlResponse.ok) throw new Error('Failed to get upload URL');
                const { signedUrl, path: filePath, provider } = await generateUrlResponse.json();

                const storageResponse = await fetch(signedUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': item.file.type },
                    body: item.file,
                });

                if (!storageResponse.ok) throw new Error('Storage upload failed');

                const success = await submitCustomerDocument({
                    quotation_id: submittedQuotationId,
                    company_name: companyName,
                    document_type: item.documentType,
                    document_type_name: item.documentTypeName,
                    file_name: item.file.name,
                    original_file_name: item.file.name,
                    file_path: filePath,
                    file_url: filePath,
                    file_size: item.file.size,
                    mime_type: item.file.type,
                    status: 'submitted',
                    storage_provider: provider === 'r2' ? 'r2' : 'supabase',
                } as Omit<DocumentSubmission, 'id' | 'submitted_at'>);

                if (success) ok++;

                if (success && ['commercial-invoice', 'packing-list'].includes(item.documentType)) {
                    void fetch('/api/notify-docs-uploaded', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            quotationId: submittedQuotationId,
                            docTypesAdded: [item.documentType],
                        }),
                        keepalive: true,
                    }).catch(() => {});
                }
            }
            if (ok > 0) {
                toast.success(`Uploaded ${ok} file(s)`);
                setUploadQueue([]);
                goToShipment();
            }
        } catch (err) {
            console.error(err);
            toast.error('Upload error');
        } finally {
            setUploading(false);
        }
    };

    const handlePrimaryCta = async () => {
        if (uploadQueue.length > 0) {
            await submitAllDocuments();
        } else {
            goToShipment();
        }
    };

    if (profile && !profile.company) {
        return (
            <div className="max-w-md mx-auto bg-white rounded-sm border p-6 text-center">
                <Building2 className="w-10 h-10 mx-auto text-[#184878] mb-3" />
                <h2 className="text-lg font-bold text-gray-900">Set up your company first</h2>
                <p className="text-sm text-gray-500 mt-1">
                    We need your company details on the quote before our team can prepare a price.
                </p>
                <Link
                    href="/portal/setup"
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#184878] hover:bg-[#1a4278] text-white text-sm font-semibold rounded-lg"
                >
                    Go to setup <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/portal" className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Request a Quote</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {currentStep === 1 && 'What are you shipping?'}
                        {currentStep === 2 && 'Enter shipment details'}
                        {currentStep === 3 && 'Attach documents (optional)'}
                    </p>
                </div>
            </div>

            <StepIndicator currentStep={currentStep} />

            {/* ===== STEP 1: Commodity ===== */}
            {currentStep === 1 && (
                <div className="space-y-6">
                    <p className="text-sm text-gray-600 text-center">
                        Select the type of product you plan to export. This helps us prepare the right document checklist.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {COMMODITY_OPTIONS.map((key) => {
                            const meta = COMMODITY_META[key];
                            const Icon = meta.icon;
                            const selected = commodity === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setCommodity(key)}
                                    className={`relative text-left p-6 rounded-sm border-2 transition-all hover:shadow-md ${
                                        selected
                                            ? meta.selectedRingClass
                                            : 'border-gray-100 bg-white hover:border-gray-200'
                                    }`}
                                >
                                    {selected && (
                                        <span className="absolute top-3 right-3 w-6 h-6 bg-emerald-600 rounded-full flex items-center justify-center">
                                            <Check className="w-3.5 h-3.5 text-white" />
                                        </span>
                                    )}
                                    <div
                                        className={`w-14 h-14 rounded-sm flex items-center justify-center mb-4 ${meta.iconBgClass}`}
                                    >
                                        <Icon className={`w-7 h-7 ${meta.iconClass}`} />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900">{meta.label}</h3>
                                    <p className="text-sm text-gray-500 mt-1">{meta.description}</p>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="button"
                            disabled={!commodity}
                            onClick={() => setCurrentStep(2)}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white text-sm font-bold rounded-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* ===== STEP 2: Details ===== */}
            {currentStep === 2 && commodity && (
                <div className="space-y-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${COMMODITY_META[commodity].badgeClass}`}>
                        {(() => {
                            const Icon = COMMODITY_META[commodity].icon;
                            return <Icon className="w-3.5 h-3.5" />;
                        })()}
                        {COMMODITY_META[commodity].label}
                    </div>

                    <div className="bg-[var(--info-bg)] border border-blue-100 rounded-sm p-4 flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                        <div className="text-sm text-[var(--navy-700)]">
                            <p className="font-semibold">How it works</p>
                            <p className="mt-1 text-[var(--navy-700)]">
                                Enter your pallet dimensions. After submit, you can attach export documents right away — or skip and upload later from your shipment page.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white rounded-sm border border-gray-100 p-5">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            Shipping Destination (Where to?) <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Bangkok to Tokyo / Warehouse Address"
                            value={requestedDestination}
                            onChange={(e) => handleRequestedDestinationChange(e.target.value)}
                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${errors['requestedDestination'] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                        />
                        {errors['requestedDestination'] && (
                            <p className="text-xs text-red-500 mt-1">{errors['requestedDestination']}</p>
                        )}
                    </div>

                    <div className="bg-white rounded-sm border border-gray-100 p-5 space-y-3">
                        <h3 className="text-sm font-bold text-gray-700">Notify when delivered</h3>
                        <p className="text-xs text-gray-500">We will email these addresses when your shipment is delivered.</p>
                        {profile?.email && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700 border border-gray-200">
                            {profile.email} <span className="text-gray-400">(you)</span>
                            </span>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                            {extraNotifyEmails.map((email) => (
                                <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-xs text-emerald-800 border border-emerald-200">
                                    {email}
                                    <button type="button" className="text-emerald-600 hover:text-red-500" onClick={async () => {
                                        const next = extraNotifyEmails.filter((e) => e !== email);
                                        setExtraNotifyEmails(next);
                                        if (rememberNotifyRecipients) await upsertSavedNotifyRecipients(next);
                                    }}>×</button>
                                </span>
                            ))}
                        </div>
                        {extraNotifyEmails.length < 10 && (
                            <div className="flex gap-2 flex-wrap">
                                <input
                                    type="email"
                                    placeholder="Add email"
                                    value={notifyInput}
                                    onChange={(e) => setNotifyInput(e.target.value)}
                                    className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-gray-200 rounded-lg"
                                />
                                <button
                                    type="button"
                                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50"
                                    onClick={() => {
                                        const e = notifyInput.trim().toLowerCase();
                                        if (!e.includes('@') || extraNotifyEmails.includes(e) || e === profile?.email?.toLowerCase()) return;
                                        setExtraNotifyEmails([...extraNotifyEmails, e]);
                                        setNotifyInput('');
                                    }}
                                >
                                    Add
                                </button>
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <Checkbox checked={rememberNotifyRecipients} onCheckedChange={(v) => setRememberNotifyRecipients(Boolean(v))} />
                            Remember these recipients for next quote
                        </label>
                    </div>

                    <div className="bg-white rounded-sm border border-gray-100 p-5">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            Consignee (Who receives the shipment) <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. ABC Imports Ltd / John Smith"
                            value={consignee}
                            onChange={(e) => handleConsigneeChange(e.target.value)}
                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${errors['consignee'] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                        />
                        {errors['consignee'] && (
                            <p className="text-xs text-red-500 mt-1">{errors['consignee']}</p>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Package className="w-5 h-5 text-emerald-600" />
                                Pallet Dimensions
                            </h2>
                            <button
                                type="button"
                                onClick={addPallet}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Pallet
                            </button>
                        </div>

                        {pallets.map((pallet, idx) => (
                            <div key={pallet.id} className="bg-white rounded-sm border border-gray-100 p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm font-bold text-gray-700">Pallet {idx + 1}</span>
                                    {pallets.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removePallet(pallet.id)}
                                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                    {(['length', 'width', 'height'] as const).map((field) => (
                                        <div key={field}>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                                {field.charAt(0).toUpperCase() + field.slice(1)} (cm)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                placeholder="0"
                                                value={pallet[field]}
                                                onChange={(e) => updatePallet(pallet.id, field, e.target.value)}
                                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${errors[`${pallet.id}-${field}`] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                                            />
                                        </div>
                                    ))}
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                            Weight (kg) <span className="normal-case font-normal text-gray-400">opt.</span>
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            placeholder="0"
                                            value={pallet.weight}
                                            onChange={(e) => updatePallet(pallet.id, 'weight', e.target.value)}
                                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                            Quantity
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            placeholder="1"
                                            value={pallet.quantity}
                                            onChange={(e) => updatePallet(pallet.id, 'quantity', e.target.value)}
                                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${errors[`${pallet.id}-quantity`] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className={`bg-white rounded-sm border p-5 ${errors['attachments'] ? 'border-red-300 bg-red-50/30' : 'border-gray-100'}`}>
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-sm bg-emerald-50 flex items-center justify-center shrink-0">
                                <Package className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div>
                                <div className="text-sm font-bold text-gray-900">
                                    Attachments &amp; Services <span className="text-red-500">*</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    Select at least one option below.
                                </p>
                            </div>
                        </div>
                        <div className="space-y-4 pl-1">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={phytoRequired}
                                    onChange={(e) => handlePhytoChange(e.target.checked)}
                                    className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="text-sm font-bold text-gray-900">
                                        Need Phytosanitary Certificate service?
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Tick if you want us to arrange the Phytosanitary Certificate
                                        (plant health certificate required by many destinations).
                                        Additional fees may apply — we&apos;ll include this in your quote.
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={dataLoggerAttached}
                                    onChange={(e) => handleDataLoggerChange(e.target.checked)}
                                    className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Thermometer className="w-4 h-4 text-sky-600 shrink-0" />
                                        <div className="text-sm font-bold text-gray-900">
                                            Attach Data Logger (MSDS required)
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Tick if your shipment includes a temperature data logger.
                                        You will need to upload the MSDS in the documents step.
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={noAttachments}
                                    onChange={(e) => handleNoAttachmentsChange(e.target.checked)}
                                    className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="text-sm font-bold text-gray-900">
                                        No attachments needed
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Tick if you are not arranging Phyto or attaching a data logger for this shipment.
                                    </p>
                                </div>
                            </label>
                        </div>
                        {errors['attachments'] && (
                            <p className="text-xs text-red-600 mt-3 pl-1">{errors['attachments']}</p>
                        )}
                    </div>

                    {commodity !== 'general' && (
                        <div className="bg-white rounded-sm border border-gray-100 p-5">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-sm bg-teal-50 flex items-center justify-center shrink-0">
                                    <FlaskConical className="w-5 h-5 text-teal-600" />
                                </div>
                                <div className="flex-1">
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={qcInterested}
                                            onChange={(e) => setQcInterested(e.target.checked)}
                                            className="mt-1 w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                        />
                                        <div>
                                            <div className="text-sm font-bold text-gray-900">
                                                Need lab testing (COA) for this batch?
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Tick and we&apos;ll include a QC quote — GACP-aligned tests, QR-tracked samples,
                                                results online before your shipment departs. We&apos;ll include this in your quote.
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-sm border border-gray-100 p-5">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            Additional Notes <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <textarea
                            rows={3}
                            placeholder="Any special requirements, preferred shipping dates, or other notes..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
                        />
                    </div>

                    {Object.keys(errors).length > 0 && (
                        <div className="bg-red-50 border border-red-100 rounded-sm p-4">
                            <ul className="text-xs text-red-600 space-y-0.5">
                                {Object.values(errors).map((err, i) => (
                                    <li key={i}>• {err}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2">
                        <button
                            type="button"
                            onClick={() => setCurrentStep(1)}
                            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                        >
                            ← Back
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmitQuote}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white text-sm font-bold rounded-sm hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" /> Submit Quote Request
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ===== STEP 3: Optional documents ===== */}
            {currentStep === 3 && submittedQuotationId && commodity && (
                <div className="space-y-6">
                    <div className="bg-white rounded-sm border border-emerald-100 p-6 text-center">
                        <div className="w-14 h-14 bg-emerald-50 rounded-sm flex items-center justify-center mx-auto mb-3">
                            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-2">Quote received!</h2>
                        <p className="text-sm text-gray-500 max-w-md mx-auto">
                            Want to attach your export documents now?{' '}
                            <span className="font-medium text-gray-700">Optional</span> — you can upload anytime from your shipment page.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-5">
                            <button
                                type="button"
                                onClick={goToShipment}
                                className="text-sm font-semibold text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
                            >
                                Skip for now
                            </button>
                            <button
                                type="button"
                                onClick={handlePrimaryCta}
                                disabled={uploading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                                {uploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : uploadQueue.length > 0 ? (
                                    <>
                                        <Upload className="w-4 h-4" />
                                        Upload {uploadQueue.length} file(s) &amp; continue
                                    </>
                                ) : (
                                    <>Done — view my shipment</>
                                )}
                            </button>
                        </div>
                    </div>

                    {qcInterested && (
                        <div className="rounded-sm border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 p-5">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-teal-100">
                                    <FlaskConical className="h-6 w-6 text-teal-700" />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <h3 className="text-base font-bold text-gray-900">Lab testing (COA) — next step</h3>
                                    <p className="mt-1 text-sm text-teal-900/80">
                                        Your QC request form is pre-filled and ready — company, contact and email are already done.
                                        Every sample gets a QR code for live status and results.
                                    </p>
                                </div>
                                <Link
                                    href="/portal/qc-requests/new"
                                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-sm bg-teal-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-700 transition-colors"
                                >
                                    Start QC Request
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        </div>
                    )}

                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${COMMODITY_META[commodity].badgeClass}`}>
                        {(() => {
                            const Icon = COMMODITY_META[commodity].icon;
                            return <Icon className="w-3.5 h-3.5" />;
                        })()}
                        Document checklist for {COMMODITY_META[commodity].label}
                    </div>

                    <div className="bg-white rounded-sm border border-gray-100 p-4 space-y-3">
                        {uploadCategories.map((category) => (
                            <Collapsible
                                key={category.id}
                                open={openSections[category.id]}
                                onOpenChange={(open) =>
                                    setOpenSections(prev => ({ ...prev, [category.id]: open }))
                                }
                                className="border rounded-sm overflow-hidden"
                            >
                                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-gray-50/80 hover:bg-emerald-50/30 transition-colors">
                                    <span className="text-xs font-bold text-gray-700">{category.name}</span>
                                    {openSections[category.id] ? (
                                        <ChevronUp className="w-4 h-4 text-gray-400" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                    )}
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="p-4 space-y-3">
                                        {category.id === 'shipping-docs' && COMMODITY_META[selectedCommodity].supportsMsds && (
                                            <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg mb-2">
                                                <Checkbox
                                                    id="msds-toggle-wizard"
                                                    checked={includeMsds}
                                                    onCheckedChange={(checked) => setIncludeMsds(checked === true)}
                                                />
                                                <Label htmlFor="msds-toggle-wizard" className="text-sm font-medium cursor-pointer">
                                                    Has Data Logger (attach MSDS)
                                                </Label>
                                            </div>
                                        )}
                                        {category.id === 'gacp-certification' && (
                                            <div className="flex items-start gap-3 p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg mb-2">
                                                <Leaf className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                                                <div className="flex-1">
                                                    <Label htmlFor="gacp-wizard" className="text-xs font-bold text-emerald-900 cursor-pointer">
                                                        Using GACP from another farm
                                                    </Label>
                                                    <p className="text-[10px] text-emerald-700">Check if purchased from another farm</p>
                                                </div>
                                                <Checkbox
                                                    id="gacp-wizard"
                                                    checked={isThaiGacp}
                                                    onCheckedChange={(checked) => setIsThaiGacp(!!checked)}
                                                    className="h-4 w-4"
                                                />
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {category.types.map((docType) => {
                                                const queued = uploadQueue.filter(q => q.documentType === docType.id);
                                                return (
                                                    <div
                                                        key={docType.id}
                                                        className="p-3 rounded-sm border border-gray-100 bg-gray-50/30"
                                                    >
                                                        <Label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                                            {docType.name}
                                                        </Label>
                                                        <div className="flex items-center gap-1.5 mt-1.5">
                                                            <input
                                                                type="file"
                                                                id={`wiz-${docType.id}`}
                                                                className="sr-only"
                                                                multiple
                                                                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                                                                onChange={(e) =>
                                                                    handleFileUpload(e.target.files, docType.id, docType.name)
                                                                }
                                                            />
                                                            <label
                                                                htmlFor={`wiz-${docType.id}`}
                                                                className="flex-1 flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:border-emerald-500 cursor-pointer"
                                                            >
                                                                <span className="truncate">
                                                                    {queued.length === 0
                                                                        ? 'Choose file...'
                                                                        : `${queued.length} selected`}
                                                                </span>
                                                                <Upload className="w-3 h-3 opacity-50" />
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePreview(docType.id, docType.name)}
                                                                disabled={previewLoading[docType.id]}
                                                                className="p-1.5 border border-gray-100 rounded-lg hover:bg-emerald-50"
                                                            >
                                                                {previewLoading[docType.id] ? (
                                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                                ) : (
                                                                    <Eye className="w-3 h-3 text-gray-400" />
                                                                )}
                                                            </button>
                                                        </div>
                                                        {queued.map((item) => (
                                                            <div
                                                                key={item.id}
                                                                className="flex items-center justify-between mt-1 text-[10px] text-gray-600"
                                                            >
                                                                <span className="truncate">{item.file.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setUploadQueue(prev =>
                                                                            prev.filter(x => x.id !== item.id)
                                                                        )
                                                                    }
                                                                    className="text-red-500 hover:text-red-700"
                                                                >
                                                                    <Trash2 className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        ))}
                    </div>

                    {uploadQueue.length > 0 && (
                        <div className="bg-emerald-50 border border-emerald-100 rounded-sm p-4 flex items-center gap-2 text-sm text-emerald-800">
                            <FileText className="w-4 h-4 shrink-0" />
                            <span>
                                <strong>{uploadQueue.length}</strong> file(s) ready to upload
                            </span>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pb-8">
                        <button
                            type="button"
                            onClick={goToShipment}
                            className="text-sm font-semibold text-gray-500 hover:text-gray-700"
                        >
                            Skip for now
                        </button>
                        <button
                            type="button"
                            onClick={handlePrimaryCta}
                            disabled={uploading}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white text-sm font-bold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
                        >
                            {uploading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : uploadQueue.length > 0 ? (
                                <>
                                    <Upload className="w-4 h-4" />
                                    Upload {uploadQueue.length} file(s) &amp; continue
                                </>
                            ) : (
                                <>Done — view my shipment</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-4 rounded-sm border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-100">
                    <FlaskConical className="h-5 w-5 text-teal-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Need lab testing for your product?</p>
                    <p className="text-xs text-gray-500 mt-0.5">Get a QC quote and track results online.</p>
                </div>
                <Link
                    href="/portal/qc-requests/new"
                    className="shrink-0 text-sm font-bold text-teal-700 hover:text-teal-900 transition-colors"
                >
                    Request QC →
                </Link>
            </div>
        </div>
    );
}
