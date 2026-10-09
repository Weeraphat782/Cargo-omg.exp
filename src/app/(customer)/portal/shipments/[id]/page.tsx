'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Plane, Package, MapPin, CalendarDays,
    CheckCircle2, Loader2, FileText, Download,
    Save, Trash2, Plus, Info, XCircle, Clock,
    Image as ImageIcon, FileSpreadsheet, Upload,
    ChevronUp, ChevronDown, Eye, Calculator, Share2, Check, ExternalLink
} from 'lucide-react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import {
    getCustomerQuotationById,
    getCustomerDocuments,
    updateCustomerQuotation,
    submitCustomerDocument,
    getFreightRatesByDestination,
    generateCustomerShareToken,
    generateCustomerBookingViewToken,
    getCompanyDocuments,
} from '@/lib/customer-db';
import { calculateVolumeWeight } from '@/lib/calculators';
import {
    getDocumentTemplate,
    getQuotationPayableTotalThb,
    getQuotationVatBreakdownFromQuote,
    type Quotation,
    type DocumentSubmission,
    type AdditionalCharge,
    type Pallet,
} from '@/lib/db';
import type { FreightRate, CompanyDocument } from '@/lib/customer-db';
import { DocumentCheckCard } from '@/components/portal/document-check-card';
import { getFileUrl } from '@/lib/storage';
import { toast } from 'react-hot-toast';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Leaf } from 'lucide-react';
import {
    COMMODITY_META,
    GACP_DOCS_FARM,
    GACP_DOCS_STANDARD,
    getDocumentCategories,
    normalizeCommodityType,
} from '@/lib/document-presets';

const TRACKING_STEPS = [
    { label: 'Pending Docs', step: 1 },
    { label: 'Pending Booking', step: 2 },
    { label: 'Booking Requested', step: 3 },
    { label: 'AWB Received', step: 4 },
    { label: 'Waiting for Pick Up', step: 5 },
    { label: 'Delivered', step: 6 },
];

// ============ HELPERS ============

function formatDate(dateStr: string, hasMounted: boolean) {
    if (!hasMounted) return ""; // Prevent hydration mismatch
    try {
        return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

function formatAmount(amount: number) {
    return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** THB with decimals (payable / VAT lines). */
function formatMoneyThb(amount: number) {
    return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupPallets(pallets: Pallet[]) {
    if (!pallets || pallets.length === 0) return [];
    const groups: Record<string, Pallet> = {};
    pallets.forEach(p => {
        // Group by dimensions and weight
        const key = `${p.length}-${p.width}-${p.height}-${p.weight}`;
        if (groups[key]) {
            groups[key] = {
                ...groups[key],
                quantity: (Number(groups[key].quantity) || 1) + (Number(p.quantity) || 1)
            };
        } else {
            groups[key] = { ...p, quantity: Number(p.quantity) || 1 };
        }
    });
    return Object.values(groups);
}

function getStageDisplay(stage?: string, status?: string, deliveredAt?: string | null) {
    if (deliveredAt || stage === 'delivered') return { label: 'Delivered', color: 'text-[#4a9c2d]', bgColor: 'bg-[#eaf6e0] border-[#4a9c2d]/20', step: 6 };
    if (status === 'completed') return { label: 'Delivered', color: 'text-[#4a9c2d]', bgColor: 'bg-[#eaf6e0] border-[#4a9c2d]/20', step: 6 };
    if (status === 'Shipped') return { label: 'Shipped', color: 'text-[#184878]', bgColor: 'bg-[#e6eef6] border-[#184878]/20', step: 4 };
    switch (stage) {
        case 'payment_received': return { label: 'Payment received', color: 'text-[#e0a209]', bgColor: 'bg-[#fef9e7] border-[#e0a209]/30', step: 6 };
        case 'picked_up': return { label: 'Picked up', color: 'text-[#184878]', bgColor: 'bg-[#e6eef6] border-[#184878]/20', step: 5 };
        case 'waiting_for_pickup': return { label: 'Waiting for Pick Up', color: 'text-[#184878]', bgColor: 'bg-[#e6eef6] border-[#184878]/20', step: 5 };
        case 'awb_received': return { label: 'AWB Received', color: 'text-[#184878]', bgColor: 'bg-[#e6eef6] border-[#184878]/20', step: 4 };
        case 'booking_requested': return { label: 'Booking Requested', color: 'text-[#184878]', bgColor: 'bg-[#e6eef6] border-[#184878]/20', step: 3 };
        case 'pending_booking': return { label: 'Pending Booking', color: 'text-[#5c656e]', bgColor: 'bg-[var(--paper-muted)] border-[var(--line)]', step: 2 };
        case 'pending_docs': return { label: 'Pending Documents', color: 'text-[#e0a209]', bgColor: 'bg-[#fef9e7] border-[#e0a209]/30', step: 1 };
        default: return { label: 'Preparing', color: 'text-[#5c656e]', bgColor: 'bg-[var(--paper-muted)] border-[var(--line)]', step: 0 };
    }
}

// ============ SUB-COMPONENTS ============

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        draft: 'bg-gray-100 text-gray-600 border-gray-200',
        sent: 'bg-[var(--info-bg)] text-[var(--navy-700)] border-[var(--line)]',
        accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        rejected: 'bg-red-50 text-red-700 border-red-200',
        completed: 'bg-violet-50 text-violet-700 border-violet-200',
        pending_approval: 'bg-amber-50 text-amber-800 border-amber-200',
        docs_uploaded: 'bg-cyan-50 text-cyan-700 border-cyan-200',
        Shipped: 'bg-[var(--info-bg)] text-[var(--navy-700)] border-[var(--line)]',
    };
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${styles[status] || styles.draft}`}>
            {status.replace('_', ' ')}
        </span>
    );
}

function DocStatusBadge({ status }: { status: string }) {
    const config: Record<string, { icon: React.ElementType; label: string; className: string }> = {
        approved: { icon: CheckCircle2, label: 'Approved', className: 'bg-emerald-50 text-emerald-700' },
        submitted: { icon: Clock, label: 'Under Review', className: 'bg-[var(--info-bg)] text-[var(--navy-700)]' },
        rejected: { icon: XCircle, label: 'Rejected', className: 'bg-red-50 text-red-700' },
        pending: { icon: Clock, label: 'Pending', className: 'bg-amber-50 text-amber-700' },
        reviewed: { icon: CheckCircle2, label: 'Reviewed', className: 'bg-emerald-50 text-emerald-700' },
    };
    const c = config[status] || config.submitted;
    const Icon = c.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${c.className}`}>
            <Icon className="w-3 h-3" /> {c.label}
        </span>
    );
}

function FileIcon({ mimeType }: { mimeType?: string }) {
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
    if (mimeType?.includes('image')) return <ImageIcon className="w-5 h-5 text-violet-500" />;
    return <FileText className="w-5 h-5 text-[var(--navy-700)]" />;
}

function TrackingProgress({ sc }: { sc: ReturnType<typeof getStageDisplay> }) {
    return (
        <div className="px-2">
            <div className="relative">
                <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-100 -translate-y-1/2 rounded-full" />
                <div
                    className={`absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full transition-all duration-1000 ${sc.step >= 6 ? 'bg-emerald-500' : 'bg-[var(--navy-700)]'}`}
                    style={{ width: `${Math.min((sc.step / 6) * 100, 100)}%` }}
                />
                <div className="relative flex justify-between">
                    {TRACKING_STEPS.map((step) => {
                        const isActive = sc.step >= step.step;
                        const isCurrent = sc.step === step.step;
                        const doneEmerald = sc.step >= 6;
                        return (
                            <div key={step.step} className="flex flex-col items-center">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-500 z-10 ${isCurrent
                                    ? doneEmerald && step.step === 6
                                        ? 'bg-white border-emerald-600 scale-125 shadow-lg shadow-emerald-100'
                                        : 'bg-white border-[var(--navy-700)] scale-125 shadow-lg shadow-[rgba(24,72,120,0.12)]'
                                    : isActive
                                        ? doneEmerald ? 'bg-emerald-600 border-emerald-600' : 'bg-[var(--navy-700)] border-[var(--navy-700)]'
                                        : 'bg-white border-gray-200'
                                    }`}>
                                    {isActive && !isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                    {isCurrent && <div className={`w-2 h-2 rounded-full animate-pulse ${step.step === 6 ? 'bg-emerald-600' : 'bg-[var(--navy-700)]'}`} />}
                                </div>
                                <span className={`text-[10px] font-black uppercase tracking-tighter mt-3 transition-colors ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ============ INTERFACES ============

interface QueuedFile {
    file: File;
    documentType: string;
    documentTypeName: string;
    id: string;
}

/**
 * Matches staff `/shipping-calculator/new` logic: optional manual chargeable weight,
 * then optional single manual THB/kg rate on that chargeable (else per-pallet band rates).
 */
function computeShipmentTotalsFromPallets(
    quotation: Quotation,
    pallets: Pallet[],
    freightRates: FreightRate[],
): {
    totalFreightCost: number;
    totalActualWeight: number;
    totalVolumeWeight: number;
    chargeableWeight: number;
    deliveryCost: number;
    totalAdditionalCharges: number;
    totalCost: number;
    hasManualChargeable: boolean;
    hasManualRate: boolean;
} {
    let totalFreightCost = 0;
    let totalActualWeight = 0;
    let totalVolumeWeight = 0;

    const useManualRate =
        Boolean(quotation.is_manual_rate) && Number(quotation.manual_rate) > 0;

    pallets.forEach((pallet) => {
        const length = Number(pallet.length) || 0;
        const width = Number(pallet.width) || 0;
        const height = Number(pallet.height) || 0;
        const weight = Number(pallet.weight) || 0;
        const quantity = Number(pallet.quantity) || 1;
        const volWt = calculateVolumeWeight(length, width, height);
        const lineChargeable = Math.max(volWt, weight);

        totalActualWeight += weight * quantity;
        totalVolumeWeight += volWt * quantity;

        if (!useManualRate) {
            const overriddenRate = Number(pallet.overridden_rate) || 0;
            const applicableRates = freightRates.filter(
                (rate) =>
                    (rate.min_weight === null || lineChargeable >= rate.min_weight) &&
                    (rate.max_weight === null || lineChargeable <= rate.max_weight),
            );
            const baseRate = applicableRates.length > 0 ? applicableRates[0].base_rate : 0;
            const rate = overriddenRate > 0 ? overriddenRate : baseRate;
            const cost = Math.round(lineChargeable * rate) * quantity;
            totalFreightCost += cost;
        }
    });

    const computedChargeable = Math.max(totalActualWeight, totalVolumeWeight);
    const manualCW = Number(quotation.manual_chargeable_weight) || 0;
    const hasManualChargeable =
        Boolean(quotation.is_chargeable_weight_manual) && manualCW > 0;
    const chargeableWeight = hasManualChargeable ? manualCW : computedChargeable;

    const manualRate = Number(quotation.manual_rate) || 0;
    const hasManualRate = Boolean(quotation.is_manual_rate) && manualRate > 0;

    if (hasManualRate) {
        totalFreightCost = Math.round(chargeableWeight * manualRate);
    }

    const deliveryRates: Record<string, number> = { '4wheel': 3500, '6wheel': 6500 };
    const deliveryCost =
        quotation.delivery_service_required && quotation.delivery_vehicle_type
            ? deliveryRates[quotation.delivery_vehicle_type] || 0
            : 0;
    const totalAdditionalCharges = (quotation.additional_charges || []).reduce(
        (sum: number, charge: AdditionalCharge) => sum + (Number(charge.amount) || 0),
        0,
    );
    const totalCost =
        totalFreightCost +
        deliveryCost +
        (quotation.clearance_cost || 0) +
        totalAdditionalCharges;

    return {
        totalFreightCost,
        totalActualWeight,
        totalVolumeWeight,
        chargeableWeight,
        deliveryCost,
        totalAdditionalCharges,
        totalCost,
        hasManualChargeable,
        hasManualRate,
    };
}

/** Per-pallet rows for save; when manual rate applies, freight is prorated by line chargeable×qty. */
function mapPalletsForCustomerSave(
    quotation: Quotation,
    pallets: Pallet[],
    freightRates: FreightRate[],
    aggregateFreightCost: number,
): Pallet[] {
    const useManualRate =
        Boolean(quotation.is_manual_rate) && Number(quotation.manual_rate) > 0;

    const rows = pallets.map((pallet) => {
        const length = Number(pallet.length) || 0;
        const width = Number(pallet.width) || 0;
        const height = Number(pallet.height) || 0;
        const weight = Number(pallet.weight) || 0;
        const quantity = Number(pallet.quantity) || 1;
        const volWt = calculateVolumeWeight(length, width, height);
        const chargeableWeight = Math.max(volWt, weight);
        const overriddenRate = Number(pallet.overridden_rate) || 0;
        const applicableRates = freightRates.filter(
            (rate) =>
                (rate.min_weight === null || chargeableWeight >= rate.min_weight) &&
                (rate.max_weight === null || chargeableWeight <= rate.max_weight),
        );
        const baseRate = applicableRates.length > 0 ? applicableRates[0].base_rate : 0;
        const rate = overriddenRate > 0 ? overriddenRate : baseRate;
        const cost = Math.round(chargeableWeight * rate) * quantity;
        const lineShare = chargeableWeight * quantity;
        return { pallet, length, width, height, weight, quantity, volWt, chargeableWeight, cost, lineShare };
    });

    const sumShares = rows.reduce((acc, r) => acc + r.lineShare, 0);
    let allocated = 0;
    const lineFreights = rows.map((row, i) => {
        if (useManualRate) {
            if (!sumShares) return 0;
            const isLast = i === rows.length - 1;
            if (isLast) return Math.max(0, aggregateFreightCost - allocated);
            const f = Math.round((aggregateFreightCost * row.lineShare) / sumShares);
            allocated += f;
            return f;
        }
        return row.cost;
    });

    return rows.flatMap((row, i) => {
        const freightForLine = lineFreights[i];
        const customerFreightCost = row.quantity > 0 ? freightForLine / row.quantity : 0;
        
        // Explode pallets: if quantity > 1, create multiple rows with quantity 1
        const exploded = [];
        const qty = Math.max(1, Math.floor(row.quantity));
        for (let q = 0; q < qty; q++) {
            exploded.push({
                ...row.pallet,
                length: row.length,
                width: row.width,
                height: row.height,
                weight: row.weight,
                quantity: 1, // Set each unit's quantity to 1
                volumeWeight: row.volWt,
                chargeableWeight: row.chargeableWeight,
                customerFreightCost,
            });
        }
        return exploded;
    });
}

// ============ MAIN PAGE ============

export default function ShipmentDetailPage() {
    const { id } = useParams() as { id: string };
    const router = useRouter();
    const { user, isLoading: authLoading } = useCustomerAuth();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [quotation, setQuotation] = useState<Quotation | null>(null);
    const [pallets, setPallets] = useState<Pallet[]>([]);
    const [documents, setDocuments] = useState<DocumentSubmission[]>([]);
    const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
    const [freightRates, setFreightRates] = useState<FreightRate[]>([]);
    const [uploadQueue, setUploadQueue] = useState<QueuedFile[]>([]);
    const [includeMsds, setIncludeMsds] = useState(false);
    const [isThaiGacp, setIsThaiGacp] = useState(false);
    const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
    const [resolvedShippingUrls, setResolvedShippingUrls] = useState<{ awb?: string; customs?: string }>({});

    // Share link state
    const [sharing, setSharing] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);
    const [bookingSheetBusy, setBookingSheetBusy] = useState(false);
    const [bookingSheetCopied, setBookingSheetCopied] = useState(false);

    // Documents & Upload sections collapsed
    const [docsOpen, setDocsOpen] = useState(false);
    const [submittedOpen, setSubmittedOpen] = useState(false);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        'company-info': true, 'permits-forms': true,
        'shipping-docs': true, 'additional': true, 'gacp-certification': true
    });
    const [dragOverType, setDragOverType] = useState<string | null>(null);
    const [isPalletsExpanded, setIsPalletsExpanded] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => {
        setHasMounted(true);
    }, []);

    // Scroll to upload section after page finishes loading (hash-based navigation)
    useEffect(() => {
        if (loading) return;
        if (window.location.hash !== '#documents') return;
        setDocsOpen(true);
        setTimeout(() => {
            document.getElementById('documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
    }, [loading]);

    // ---- Data loading ----
    const loadData = async () => {
        if (!user?.id || !id) return;
        try {
            const [qData, docsData, profileDocs] = await Promise.all([
                getCustomerQuotationById(id, user.id),
                getCustomerDocuments(user.id),
                getCompanyDocuments(),
            ]);
            setCompanyDocs(profileDocs);
            if (!qData) {
                toast.error('Shipment not found');
                router.push('/portal');
                return;
            }
            setQuotation(qData);
            setPallets(groupPallets(qData.pallets || []));
            if (qData.destination_id) {
                const rates = await getFreightRatesByDestination(qData.destination_id);
                setFreightRates(rates);
            }

            // Resolve Document URLs
            const docsToResolve = docsData.filter(d => d.quotation_id === id);
            // #region agent log
            fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1H3',location:'customer-shipment:loadData:before-map',message:'eager URL resolve begin',data:{docCount:docsToResolve.length,providers:docsToResolve.map(d=>d.storage_provider||'supabase'),hasEmptyPath:docsToResolve.filter(d=>!d.file_path).length,quotationId:id},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            let docsWithUrls: typeof docsToResolve = [];
            try {
                docsWithUrls = await Promise.all(docsToResolve.map(async (doc) => {
                    const url = await getFileUrl(doc.file_path || '', doc.storage_provider || 'supabase');
                    return { ...doc, file_url: url };
                }));
                // #region agent log
                fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1',location:'customer-shipment:loadData:after-map',message:'eager URL resolve done',data:{resolved:docsWithUrls.length,blanks:docsWithUrls.filter(d=>!d.file_url).length},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
            } catch (mapErr) {
                // #region agent log
                fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1',location:'customer-shipment:loadData:map-throw',message:'Promise.all docs map threw',data:{err:String((mapErr as Error)?.message||mapErr),name:(mapErr as Error)?.name},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                throw mapErr;
            }
            setDocuments(docsWithUrls);
            if (docsWithUrls.length === 0) {
                setDocsOpen(true);
            }

            // Resolve Shipping Doc URLs
            const shippingUrls: { awb?: string; customs?: string } = {};
            if (qData.awb_file_url) {
                const path = qData.awb_file_url.includes('supabase') ? qData.awb_file_url.split('/public/')[1] || qData.awb_file_url : qData.awb_file_url;
                shippingUrls.awb = await getFileUrl(path, qData.storage_provider || 'supabase');
            }
            if (qData.customs_declaration_file_url) {
                const path = qData.customs_declaration_file_url.includes('supabase') ? qData.customs_declaration_file_url.split('/public/')[1] || qData.customs_declaration_file_url : qData.customs_declaration_file_url;
                shippingUrls.customs = await getFileUrl(path, qData.storage_provider || 'supabase');
            }
            setResolvedShippingUrls(shippingUrls);

        } catch (err) {
            console.error('Load error:', err);
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading) return;
        if (!user?.id) { setLoading(false); return; }
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, user?.id, authLoading]);

    // ---- Calculations ----
    const totals = useMemo(() => {
        if (!quotation) return null;
        return computeShipmentTotalsFromPallets(quotation, pallets, freightRates);
    }, [pallets, quotation, freightRates]);

    const isPricingPending = useMemo(() => {
        if (!quotation) return false;
        return !quotation.destination_id || !quotation.total_cost || Number(quotation.total_cost) <= 0;
    }, [quotation]);

    /** VAT breakdown from live freight/delivery when price is not locked; otherwise use DB. */
    const liveVatBreakdown = useMemo(() => {
        if (!quotation || !totals) return null;
        if (isPricingPending) return null;
        if (quotation.price_confirmed) return null;
        return getQuotationVatBreakdownFromQuote({
            total_freight_cost: totals.totalFreightCost,
            clearance_cost: Number(quotation.clearance_cost) || 0,
            delivery_service_required: Boolean(quotation.delivery_service_required),
            delivery_cost: totals.deliveryCost,
            additional_charges: quotation.additional_charges ?? [],
            taxable_lines: quotation.taxable_lines,
            wht_enabled: quotation.wht_enabled,
        });
    }, [quotation, totals, isPricingPending]);

    const payableTotalThb = useMemo(() => {
        if (!quotation || !totals || isPricingPending) return 0;
        if (quotation.price_confirmed) {
            return getQuotationPayableTotalThb(quotation);
        }
        return liveVatBreakdown?.net_payable ?? totals.totalCost;
    }, [quotation, totals, liveVatBreakdown, isPricingPending]);

    const subtotalExclVat = totals?.totalCost ?? 0;

    const vatLineAmount = useMemo(() => {
        if (!quotation || !totals || isPricingPending) return 0;
        if (quotation.price_confirmed) {
            return quotation.vat_amount != null ? Number(quotation.vat_amount) : 0;
        }
        return liveVatBreakdown?.vat_amount ?? 0;
    }, [quotation, totals, liveVatBreakdown, isPricingPending]);

    const whtLineAmount = useMemo(() => {
        if (!quotation || !totals || isPricingPending) return 0;
        if (quotation.price_confirmed) {
            return quotation.wht_enabled !== false && quotation.wht_amount != null
                ? Number(quotation.wht_amount)
                : 0;
        }
        return liveVatBreakdown?.wht_amount ?? 0;
    }, [quotation, totals, liveVatBreakdown, isPricingPending]);

    // ---- Pallet handlers ----
    const isPalletLocked = quotation?.price_confirmed === true;

    const handlePalletChange = (index: number, field: string, value: string | number) => {
        if (isPalletLocked) return;
        const np = [...pallets];
        np[index] = { ...np[index], [field]: value };
        setPallets(np);
    };

    const addPallet = () => {
        if (isPalletLocked) return;
        setPallets([...pallets, { length: 0, width: 0, height: 0, weight: 0, quantity: 1 }]);
    };

    const removePallet = (index: number) => {
        if (isPalletLocked) return;
        if (pallets.length <= 1) { toast.error('At least one pallet is required'); return; }
        const np = [...pallets]; np.splice(index, 1); setPallets(np);
    };

    const handleSave = async () => {
        if (!quotation) return;
        if (isPalletLocked) return;
        setSaving(true);
        try {
            const t = computeShipmentTotalsFromPallets(quotation, pallets, freightRates);
            const updatedPallets = mapPalletsForCustomerSave(
                quotation,
                pallets,
                freightRates,
                t.totalFreightCost,
            );

            const success = await updateCustomerQuotation(quotation.id, {
                pallets: updatedPallets,
                total_freight_cost: t.totalFreightCost,
                total_actual_weight: t.totalActualWeight,
                total_volume_weight: t.totalVolumeWeight,
                chargeable_weight: t.chargeableWeight,
                delivery_cost: t.deliveryCost,
                total_cost: t.totalCost,
                updated_at: new Date().toISOString(),
            });
            if (success) { toast.success('Saved!'); await loadData(); }
            else toast.error('Failed to save');
        } catch (err) { console.error(err); toast.error('An error occurred'); }
        finally { setSaving(false); }
    };

    // ---- Document handlers ----
    const handleFileUpload = (files: FileList | null, docTypeId: string, docTypeName: string) => {
        if (!files || files.length === 0) return;
        const newItems: QueuedFile[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} > 10MB`); continue; }
            newItems.push({ file, documentType: docTypeId, documentTypeName: docTypeName, id: Math.random().toString(36).substring(7) });
        }
        setUploadQueue(prev => [...prev, ...newItems]);
    };

    const handlePreview = async (documentTypeId: string, documentName: string) => {
        try {
            setPreviewLoading(prev => ({ ...prev, [documentTypeId]: true }));
            const template = await getDocumentTemplate(documentTypeId);
            if (template?.file_url) {
                const url = await getFileUrl(template.file_url, (template as DocumentSubmission).storage_provider || 'supabase', 'templates');
                if (url) window.open(url, '_blank');
                else toast.error('Could not resolve template URL');
            }
            else toast.error(`No template for ${documentName}`);
        } catch { toast.error('Failed to load template'); }
        finally { setPreviewLoading(prev => ({ ...prev, [documentTypeId]: false })); }
    };

    const submitAllDocuments = async () => {
        if (uploadQueue.length === 0 || !quotation) return;
        setUploading(true);
        try {
            let ok = 0;
            const uploadedTypeNames: string[] = [];
            for (const item of uploadQueue) {
                // 1. Get Signed URL
                const generateUrlResponse = await fetch('/api/generate-upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileName: item.file.name,
                        contentType: item.file.type,
                        quotationId: id,
                        documentType: item.documentType,
                    }),
                });

                if (!generateUrlResponse.ok) throw new Error('Failed to get upload URL');
                const { signedUrl, path: filePath, provider } = await generateUrlResponse.json();

                // 2. Upload to Storage
                const storageResponse = await fetch(signedUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': item.file.type },
                    body: item.file,
                });

                if (!storageResponse.ok) throw new Error('Storage upload failed');

                // 3. Confirm via lib
                const success = await submitCustomerDocument({
                    quotation_id: id,
                    company_name: quotation.company_name || 'N/A',
                    document_type: item.documentType,
                    document_type_name: item.documentTypeName,
                    file_name: item.file.name,
                    original_file_name: item.file.name,
                    file_path: filePath,
                    file_url: filePath, // This will be resolved on load
                    file_size: item.file.size,
                    mime_type: item.file.type,
                    status: 'submitted',
                    storage_provider: (provider === 'r2' ? 'r2' : 'supabase')
                } as Omit<DocumentSubmission, 'id' | 'submitted_at'>);

                if (success) {
                    ok++;
                    uploadedTypeNames.push(item.documentTypeName);
                    if (['commercial-invoice', 'packing-list'].includes(item.documentType)) {
                        void fetch('/api/notify-docs-uploaded', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                quotationId: id,
                                docTypesAdded: [item.documentType],
                            }),
                            keepalive: true,
                        }).catch(() => {});
                    }
                }
            }
            if (ok > 0) {
                toast.success(`Uploaded ${ok} file(s)`);
                setUploadQueue([]);
                await loadData();

                try {
                    const documentTypes = [...new Set(uploadedTypeNames)];
                    await fetch('/api/telegram/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            quotationId: id,
                            quotationNo: quotation.quotation_no ?? null,
                            customerName:
                                quotation.customer_name ||
                                quotation.company_name ||
                                null,
                            destination:
                                quotation.destination ||
                                quotation.requested_destination ||
                                null,
                            documentTypes,
                            fileCount: ok,
                        }),
                    });
                } catch (notifyErr) {
                    console.error('Telegram notify (portal upload):', notifyErr);
                }
            }
        } catch (err) { console.error(err); toast.error('Upload error'); }
        finally { setUploading(false); }
    };

    // ---- Share handler ----
    const handleShare = async () => {
        if (!quotation) return;
        setSharing(true);
        try {
            const token = quotation.share_token || await generateCustomerShareToken(quotation.id);
            if (token) {
                const url = `${window.location.origin}/track/${token}`;
                await navigator.clipboard.writeText(url);
                setShareCopied(true);
                toast.success('Tracking link copied to clipboard!');
                setTimeout(() => setShareCopied(false), 3000);
            } else {
                toast.error('Failed to generate share link');
            }
        } catch {
            toast.error('Failed to copy link');
        } finally {
            setSharing(false);
        }
    };

    const getBookingViewUrl = async (): Promise<string | null> => {
        if (!quotation) return null;
        const token =
            quotation.booking_view_token ||
            (await generateCustomerBookingViewToken(quotation.id));
        if (!token) return null;
        if (!quotation.booking_view_token) {
            setQuotation({ ...quotation, booking_view_token: token });
        }
        return `${window.location.origin}/booking/view/${token}`;
    };

    const handleBookingSheetOpen = async () => {
        setBookingSheetBusy(true);
        try {
            const url = await getBookingViewUrl();
            if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                toast.error('Could not open booking sheet');
            }
        } catch {
            toast.error('Could not open booking sheet');
        } finally {
            setBookingSheetBusy(false);
        }
    };

    const handleBookingSheetCopy = async () => {
        setBookingSheetBusy(true);
        try {
            const url = await getBookingViewUrl();
            if (url) {
                await navigator.clipboard.writeText(url);
                setBookingSheetCopied(true);
                toast.success('Booking sheet link copied');
                setTimeout(() => setBookingSheetCopied(false), 3000);
            } else {
                toast.error('Could not copy booking sheet link');
            }
        } catch {
            toast.error('Could not copy link');
        } finally {
            setBookingSheetBusy(false);
        }
    };

    const commodity = useMemo(
        () => normalizeCommodityType(quotation?.commodity_type),
        [quotation?.commodity_type]
    );

    const documentCategoriesWithGacp = useMemo(() => {
        const base = getDocumentCategories(commodity, includeMsds);
        if (!COMMODITY_META[commodity].supportsGacp) {
            return base;
        }
        return [
            ...base,
            {
                id: 'gacp-certification',
                name: 'Thai GACP or GACP Certificate',
                types: isThaiGacp ? GACP_DOCS_FARM : GACP_DOCS_STANDARD,
            },
        ];
    }, [commodity, includeMsds, isThaiGacp]);

    const commodityMeta = COMMODITY_META[commodity];
    const CommodityIcon = commodityMeta.icon;

    // ---- Loading / Not found ----
    if (loading) {
        return (
            <div className="min-h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    if (!quotation || !totals) return null;

    const q = quotation;
    const sc = getStageDisplay(q.opportunities?.stage, q.status, (q as { delivered_at?: string | null }).delivered_at);

    return (
        <div className="max-w-5xl mx-auto space-y-6" suppressHydrationWarning>
            {/* Back Button */}
            <Link href="/portal" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors group">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                Back to My Shipments
            </Link>

            {q.status === 'pending_approval' && (
                <div className="flex gap-3 rounded-sm border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
                    <Info className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                    <p>
                        <span className="font-semibold">Quote request pending team review.</span>{' '}
                        Our team will set the official destination and pricing. You can still upload your export documents below — no need to wait for approval first.
                    </p>
                </div>
            )}

            {/* ===== HEADER CARD ===== */}
            <div className="bg-white rounded-sm border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-6 md:p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
                        <div className="flex items-start gap-4">
                            <div className={`w-14 h-14 rounded-sm flex items-center justify-center shrink-0 ${sc.step >= 6 ? 'bg-emerald-50 text-emerald-600' : sc.step === 5 ? 'bg-teal-50 text-teal-600' : sc.step >= 4 ? 'bg-[var(--info-bg)] text-[var(--navy-700)]' : 'bg-amber-50 text-amber-600'}`}>
                                <Plane className={`w-7 h-7 ${sc.step >= 4 ? 'animate-bounce' : ''}`} />
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h1 className="text-xl font-bold text-gray-900">{q.quotation_no || q.id.slice(0, 8)}</h1>
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${commodityMeta.badgeClass}`}>
                                        <CommodityIcon className="w-3 h-3" />
                                        {commodityMeta.label}
                                    </span>
                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${sc.bgColor} ${sc.color}`}>
                                        {(sc.step === 4 || sc.step === 5) && <span className={`w-1.5 h-1.5 rounded-full mr-2 animate-pulse ${sc.step === 5 ? 'bg-teal-500' : 'bg-[var(--navy-700)]'}`} />}
                                        {sc.label}
                                    </span>
                                    <StatusBadge status={q.status} />
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                                    <span className="flex items-center gap-1.5 text-[var(--navy-700)] font-bold"><MapPin className="w-4 h-4" /> {q.destination || q.requested_destination || 'N/A'}</span>
                                    <span className="flex items-center gap-1.5"><Package className="w-4 h-4 text-gray-400" /> {q.pallets?.length || 0} pallets</span>
                                    <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-gray-400" /> {formatDate(q.created_at, hasMounted)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 shrink-0">
                            <button
                                onClick={handleShare}
                                disabled={sharing}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-sm text-xs font-bold transition-all shadow-sm border ${shareCopied
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                    }`}
                            >
                                {sharing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : shareCopied ? (
                                    <Check className="w-4 h-4 text-emerald-600" />
                                ) : (
                                    <Share2 className="w-4 h-4" />
                                )}
                                {shareCopied ? 'Copied!' : 'Share'}
                            </button>
                            {isPricingPending ? (
                                <div className="px-5 py-3 rounded-sm border-2 border-slate-200 bg-slate-50 text-right max-w-[220px]">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Awaiting Pricing</div>
                                    <div className="text-sm font-semibold text-slate-600">Our team will provide a quote shortly</div>
                                </div>
                            ) : (
                                <div className={`px-5 py-3 rounded-sm border-2 ${q.price_confirmed ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-400 animate-pulse'}`}>
                                    <div className={`text-[10px] font-black uppercase tracking-widest text-right mb-0.5 ${q.price_confirmed ? 'text-emerald-500' : 'text-amber-500'}`}>
                                        {q.price_confirmed ? 'Confirmed Total' : 'Price not confirmed'}
                                    </div>
                                    <div className={`text-2xl font-black ${q.price_confirmed ? 'text-emerald-700' : 'text-amber-700'}`}>{formatMoneyThb(payableTotalThb)}</div>
                                    {!q.price_confirmed && (
                                        <div className="text-[10px] text-amber-600 font-semibold text-right mt-0.5">might be changed</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <TrackingProgress sc={sc} />
                </div>
            </div>

            {q.status !== 'pending_approval' && (
                <div className="bg-white rounded-sm border border-[#215497]/25 p-5 md:p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-[#215497]" />
                                Booking sheet
                            </h3>
                            <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
                                Share this sheet with your consignee or overseas partner — documents and shipment
                                details only, no prices shown.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => void handleBookingSheetOpen()}
                                disabled={bookingSheetBusy}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-sm text-xs font-bold bg-[#215497] text-white hover:bg-[#1a4378] transition-colors disabled:opacity-60"
                            >
                                {bookingSheetBusy ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <ExternalLink className="w-4 h-4" />
                                )}
                                Open
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleBookingSheetCopy()}
                                disabled={bookingSheetBusy}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-sm text-xs font-bold border transition-all ${
                                    bookingSheetCopied
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {bookingSheetCopied ? (
                                    <Check className="w-4 h-4" />
                                ) : (
                                    <Share2 className="w-4 h-4" />
                                )}
                                {bookingSheetCopied ? 'Copied!' : 'Copy link'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== SHIPPING INFO + WEIGHT ===== */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-sm border border-gray-100 p-5 space-y-3">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <Plane className="w-3.5 h-3.5" /> Shipping Info
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-[10px] font-bold text-gray-400 uppercase">Shipping Date</div>
                            <div className="text-sm font-semibold text-gray-900">
                                {q.shipping_date ? (hasMounted ? new Date(q.shipping_date).toLocaleDateString('en-GB') : "...") : 'TBC'}
                            </div>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-[10px] font-bold text-gray-400 uppercase">Vehicle</div>
                            <div className="text-sm font-semibold text-gray-900 capitalize">{q.delivery_vehicle_type || 'N/A'}</div>
                        </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Destination Port</div>
                        <div className="text-sm font-semibold text-gray-900">{q.destination || 'N/A'}</div>
                    </div>
                    {q.phyto_required && (
                        <div className="bg-emerald-50 p-3 rounded-lg flex items-center gap-2">
                            <Leaf className="w-3.5 h-3.5 text-emerald-600" />
                            <div className="text-xs font-semibold text-emerald-700">
                                Phytosanitary service requested
                            </div>
                        </div>
                    )}
                    {q.notes && (
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-[10px] font-bold text-gray-400 uppercase">Notes</div>
                            <div className="text-xs text-gray-600 mt-1 italic">&quot;{q.notes}&quot;</div>
                        </div>
                    )}
                </div>
                <div className="bg-white rounded-sm border border-gray-100 p-5 space-y-3">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5" /> Weight Summary
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50 text-center">
                            <div className="text-[9px] font-bold text-emerald-600 uppercase">Actual</div>
                            <div className="text-base font-bold text-emerald-700">{totals.totalActualWeight} kg</div>
                        </div>
                        <div className="bg-[var(--info-bg)]/50 p-3 rounded-lg border border-[var(--line)]/50 text-center">
                            <div className="text-[9px] font-bold text-[var(--navy-700)] uppercase">Volume</div>
                            <div className="text-base font-bold text-[var(--navy-700)]">{totals.totalVolumeWeight} kg</div>
                        </div>
                        <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-100/50 text-center">
                            <div className="text-[9px] font-bold text-amber-600 uppercase">Chargeable</div>
                            <div className="text-base font-bold text-amber-700">{totals.chargeableWeight} kg</div>
                            {totals.hasManualChargeable && (
                                <div className="text-[8px] text-amber-600 font-semibold mt-0.5">Staff override</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ===== COST BREAKDOWN ===== */}
            <div className="bg-white rounded-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                    <Calculator className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cost Breakdown</span>
                    {!isPricingPending && (
                        <span className="ml-auto text-[10px] text-gray-400 italic">Updates in real-time</span>
                    )}
                </div>
                {isPricingPending ? (
                    <div className="px-5 py-8 text-center">
                        <p className="text-sm font-semibold text-slate-700">Awaiting pricing</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                            Our team is preparing your quote. You will see the cost breakdown here once destination and rates are set.
                        </p>
                    </div>
                ) : (
                <div className="divide-y divide-gray-50">
                    {q.status === 'pending_approval' && (
                        <div className="px-5 py-2.5 bg-amber-50/60 border-b border-amber-100/80 flex gap-2 text-xs text-amber-900">
                            <Info className="w-4 h-4 shrink-0 text-amber-600" />
                            <span>
                                Amounts below are not final yet: freight uses your team&apos;s rate once the shipment is configured. Upload documents anytime while we prepare your quote.
                            </span>
                        </div>
                    )}
                    <div className="px-5 py-3 flex justify-between items-center">
                        <div>
                            <span className="text-sm text-gray-600">Freight Cost</span>
                            <br />
                            <span className="text-[10px] text-gray-400">
                                {totals.hasManualRate
                                    ? `Manual rate: ${Number(q.manual_rate) || 0} THB/kg × ${totals.chargeableWeight} kg chargeable`
                                    : 'Based on chargeable weight per pallet & rate bands'}
                            </span>
                        </div>
                        <span className="text-sm font-bold text-gray-900">{formatAmount(totals.totalFreightCost)}</span>
                    </div>
                    {totals.deliveryCost > 0 && (
                        <div className="px-5 py-3 flex justify-between items-center">
                            <span className="text-sm text-gray-600">Delivery Fee</span>
                            <span className="text-sm font-bold text-gray-900">{formatAmount(totals.deliveryCost)}</span>
                        </div>
                    )}
                    {(q.clearance_cost ?? 0) > 0 && (
                        <div className="px-5 py-3 flex justify-between items-center">
                            <span className="text-sm text-gray-600">Clearance Fee</span>
                            <span className="text-sm font-bold text-gray-900">{formatAmount(q.clearance_cost || 0)}</span>
                        </div>
                    )}
                    {q.additional_charges?.map((charge: AdditionalCharge, i: number) => (
                        <div key={i} className="px-5 py-3 flex justify-between items-center">
                            <span className="text-sm text-gray-600">{charge.name}</span>
                            <span className="text-sm font-bold text-gray-900">{formatAmount(Number(charge.amount))}</span>
                        </div>
                    ))}
                    <div className="px-5 py-3 flex justify-between items-center bg-gray-50/90 border-t border-gray-100">
                        <span className="text-sm text-gray-600">Subtotal (excl. VAT)</span>
                        <span className="text-sm font-bold text-gray-900">{formatMoneyThb(subtotalExclVat)}</span>
                    </div>
                    {vatLineAmount > 0 && (
                        <div className="px-5 py-3 flex justify-between items-center border-t border-gray-50">
                            <span className="text-sm text-gray-600">VAT 7%</span>
                            <span className="text-sm font-bold text-gray-900">{formatMoneyThb(vatLineAmount)}</span>
                        </div>
                    )}
                    {whtLineAmount > 0 && (
                        <div className="px-5 py-3 flex justify-between items-center border-t border-gray-50">
                            <span className="text-sm text-gray-600">Tax 3% (WHT)</span>
                            <span className="text-sm font-bold text-red-600">
                                ({formatMoneyThb(whtLineAmount)})
                            </span>
                        </div>
                    )}
                    <div className="px-5 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 flex justify-between items-center">
                        <span className="text-xs font-black text-emerald-100 uppercase tracking-widest">Net to Pay</span>
                        <span className="text-xl font-black text-white">{formatMoneyThb(payableTotalThb)}</span>
                    </div>
                </div>
                )}
            </div>

            {/* ===== AWB + CUSTOMS (from staff) ===== */}
            {(q.awb_file_url || q.customs_declaration_file_url) && (
                <div className="bg-white rounded-sm border border-gray-100 p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-4 bg-[var(--color-accent-ref)] rounded-full" />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Shipping Documents</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {q.awb_file_url && (
                            <a href={resolvedShippingUrls.awb} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 rounded-sm border border-[var(--line)] bg-[var(--info-bg)]/50 hover:bg-[var(--info-bg)] hover:border-[var(--line)] transition-all group/doc">
                                <div className="w-10 h-10 rounded-lg bg-[var(--info-bg)] flex items-center justify-center shrink-0 group-hover/doc:bg-[var(--info-bg)] transition-colors">
                                    <FileText className="w-5 h-5 text-[var(--navy-700)]" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-bold text-[var(--navy-700)]">AWB (Air Waybill)</div>
                                    <div className="text-[10px] text-gray-500 truncate">{q.awb_file_name || 'Download'}</div>
                                </div>
                                <Download className="w-4 h-4 text-gray-400 shrink-0 group-hover/doc:text-[var(--navy-700)] transition-colors" />
                            </a>
                        )}
                        {q.customs_declaration_file_url && (
                            <a href={resolvedShippingUrls.customs} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 rounded-sm border border-amber-100 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-200 transition-all group/doc">
                                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 group-hover/doc:bg-amber-200 transition-colors">
                                    <FileText className="w-5 h-5 text-amber-600" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-bold text-amber-800">Customs Declaration</div>
                                    <div className="text-[10px] text-amber-500 truncate">{q.customs_declaration_file_name || 'Download'}</div>
                                </div>
                                <Download className="w-4 h-4 text-amber-400 shrink-0 group-hover/doc:text-amber-600 transition-colors" />
                            </a>
                        )}
                    </div>
                </div>
            )}

            {/* ===== PALLET MANAGEMENT (Collapsible) ===== */}
            <div className="bg-white rounded-sm border border-gray-100 p-5 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${isPalletsExpanded ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-500'}`}>
                            <Package className="w-5 h-5" />
                        </div>
                        <div className="text-left">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Pallet Details</span>
                            <div className="text-sm font-bold text-gray-900">
                                {pallets.reduce((s, p) => s + (Number(p.quantity) || 1), 0)} Pallets &bull; Total {totals.totalActualWeight} kg
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {!q.price_confirmed && (
                            <button onClick={(e) => { e.stopPropagation(); addPallet(); }}
                                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-100 flex items-center gap-1.5 transition-colors border border-emerald-100">
                                <Plus className="w-3.5 h-3.5" /> Add Pallet
                            </button>
                        )}
                        <button 
                            type="button"
                            onClick={() => setIsPalletsExpanded(!isPalletsExpanded)}
                            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            {isPalletsExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                <CollapsibleContent isOpen={isPalletsExpanded} className="space-y-4 pt-6 mt-4 border-t border-gray-50">
                    {q.price_confirmed ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex gap-3">
                            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 font-medium">Price has been confirmed. Pallet dimensions are locked.</p>
                        </div>
                    ) : (
                        <div className="bg-[var(--info-bg)] border border-[var(--line)] rounded-sm p-3 flex gap-3">
                            <Info className="w-4 h-4 text-[var(--navy-700)] shrink-0 mt-0.5" />
                            <p className="text-xs text-[var(--navy-700)]">Verify pallet dimensions. Changes will recalculate the quote in real-time.</p>
                        </div>
                    )}
                    
                    <div className="space-y-3">
                        {pallets.map((pallet, idx) => (
                            <div key={idx} className="relative bg-gray-50 rounded-sm p-4 border border-gray-100 hover:border-emerald-200 transition-all">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center text-[10px] font-bold text-gray-500">#{idx + 1}</div>
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Pallet Unit</span>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                    {(['length', 'width', 'height', 'weight'] as const).map(field => (
                                        <div key={field} className="space-y-1">
                                            <label className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">
                                                {field === 'weight' ? 'Weight (kg)' : `${field.charAt(0).toUpperCase() + field.slice(1)} (cm)`}
                                            </label>
                                            <input type="number" value={pallet[field]}
                                                onChange={(e) => handlePalletChange(idx, field, e.target.value)}
                                                disabled={q.price_confirmed}
                                                className={`w-full border rounded-lg px-3 py-2 text-sm outline-none ${q.price_confirmed ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' : 'bg-white border-gray-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'}`} />
                                        </div>
                                    ))}
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Qty</label>
                                        <input type="number" value={pallet.quantity}
                                            onChange={(e) => handlePalletChange(idx, 'quantity', e.target.value)}
                                            disabled={q.price_confirmed}
                                            className={`w-full border rounded-lg px-3 py-2 text-sm font-bold outline-none ${q.price_confirmed ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed text-emerald-600' : 'bg-white border-emerald-100 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'}`} />
                                    </div>
                                </div>
                                {pallets.length > 1 && !q.price_confirmed && (
                                    <button onClick={() => removePallet(idx)}
                                        className="absolute -top-2 -right-2 w-7 h-7 bg-white border border-red-100 text-red-400 rounded-full flex items-center justify-center hover:bg-red-50 hover:text-red-500 shadow-sm transition-all">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    
                    {!q.price_confirmed && (
                        <div className="flex justify-end mt-4">
                            <button onClick={handleSave} disabled={saving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-sm font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50">
                                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
                            </button>
                        </div>
                    )}
                </CollapsibleContent>
            </div>

            {/* ===== DOCUMENT CHECKLIST ===== */}
            {(() => {
                // Include both quotation docs AND profile company docs in the checked set
                const uploadedTypeSet = new Set([
                    ...documents.map(d => d.document_type).filter(Boolean),
                    ...companyDocs.map(d => d.document_type),
                ] as string[]);
                const allCategories = documentCategoriesWithGacp;
                const processed = allCategories.map(cat => {
                    const types = cat.types.map(type => ({
                        ...type,
                        isUploaded: uploadedTypeSet.has(type.id)
                    }));
                    return { ...cat, types, uploadedCount: types.filter(t => t.isUploaded).length };
                });
                const totalTypes = processed.reduce((s, c) => s + c.types.length, 0);
                const totalUploaded = processed.reduce((s, c) => s + c.uploadedCount, 0);
                const allDone = totalUploaded === totalTypes;

                return (
                    <div className="bg-white rounded-sm border border-gray-100 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${allDone ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                                    {allDone
                                        ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                        : <FileText className="w-5 h-5 text-amber-600" />
                                    }
                                </div>
                                <div>
                                    <span className="text-sm font-bold text-gray-900">Document Checklist</span>
                                    <p className="text-[10px] text-gray-400">
                                        {allDone ? 'All documents uploaded!' : `${totalUploaded} of ${totalTypes} documents uploaded`}
                                    </p>
                                </div>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${allDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                {totalUploaded} / {totalTypes}
                            </div>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-700 ${allDone ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                style={{ width: `${totalTypes > 0 ? (totalUploaded / totalTypes) * 100 : 0}%` }}
                            />
                        </div>

                        <div className="space-y-3">
                            {processed.map(cat => {
                                const missing = cat.types.filter(t => !t.isUploaded);
                                const catDone = missing.length === 0;
                                return (
                                    <div key={cat.id} className={`rounded-sm p-3 border transition-all ${catDone ? 'border-emerald-100 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/50'}`}>
                                        <div className="flex items-center gap-2 mb-2">
                                            {catDone
                                                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                                : <div className="w-4 h-4 rounded-full border-2 border-amber-400 shrink-0 flex items-center justify-center"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" /></div>
                                            }
                                            <span className="text-xs font-bold text-gray-700">{cat.name}</span>
                                            <span className={`ml-auto text-[9px] font-bold ${catDone ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {cat.uploadedCount}/{cat.types.length}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5 ml-6">
                                            {cat.types.map(type => (
                                                <span
                                                    key={type.id}
                                                    className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${type.isUploaded
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                        : 'bg-red-50 text-red-600 border-red-100'
                                                        }`}
                                                >
                                                    {type.isUploaded ? '✓' : '✗'} {type.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {/* ===== DOCUMENT CHECK (pre-booking) ===== */}
            <DocumentCheckCard
                quotationId={q.id}
                uploadedTypes={documents.map(d => d.document_type).filter(Boolean) as string[]}
            />

            {/* ===== DOCUMENTS UPLOAD (Collapsed) ===== */}
            <div id="documents">
            <Collapsible open={docsOpen} onOpenChange={setDocsOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-5 bg-white rounded-sm border border-gray-100 hover:border-emerald-200 transition-colors shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                            <Upload className="w-4.5 h-4.5 text-emerald-600" />
                        </div>
                        <div className="text-left">
                            <span className="text-sm font-bold text-gray-900">Upload Documents</span>
                            <p className="text-[10px] text-gray-400">Upload required export documents for this shipment</p>
                        </div>
                        {uploadQueue.length > 0 && (
                            <span className="px-2 py-0.5 text-[10px] bg-emerald-100 text-emerald-700 rounded-full font-bold">{uploadQueue.length} QUEUED</span>
                        )}
                    </div>
                    {docsOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="mt-3 bg-white rounded-sm border border-gray-100 p-5 space-y-4">
                        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--info-bg)] border border-[var(--line)] rounded-sm">
                            <Upload className="w-5 h-5 text-[var(--navy-700)] shrink-0" />
                            <p className="text-xs font-semibold text-[var(--navy-700)]">You can upload multiple files at once and drag-and-drop files into each document slot.</p>
                        </div>
                        {documentCategoriesWithGacp.map(category => (
                            <Collapsible key={category.id} open={openSections[category.id]}
                                onOpenChange={(open) => setOpenSections(prev => ({ ...prev, [category.id]: open }))}
                                className="border rounded-sm overflow-hidden bg-white border-gray-100">
                                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-gray-50/50 hover:bg-emerald-50/20 transition-colors">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-3.5 h-3.5 text-emerald-500" />
                                        <span className="text-xs font-bold text-gray-600">{category.name}</span>
                                        {(() => {
                                            const count = uploadQueue.filter(item => category.types.some(t => t.id === item.documentType)).length;
                                            return count > 0 ? <span className="px-1.5 py-0.5 text-[9px] bg-emerald-100 text-emerald-700 rounded-full font-bold">{count}</span> : null;
                                        })()}
                                    </div>
                                    {openSections[category.id] ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="p-4 space-y-4">
                                        {category.id === 'shipping-docs' && commodityMeta.supportsMsds && (
                                            <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg mb-2">
                                                <Checkbox
                                                    id={`msds-toggle-${id}`}
                                                    checked={includeMsds}
                                                    onCheckedChange={(checked) => setIncludeMsds(checked === true)}
                                                />
                                                <Label htmlFor={`msds-toggle-${id}`} className="text-sm font-medium cursor-pointer">
                                                    Has Data Logger (attach MSDS)
                                                </Label>
                                            </div>
                                        )}
                                        {category.id === 'gacp-certification' && (
                                            <div className="flex items-start space-x-3 p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                                                <Leaf className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                                                <div className="flex-1">
                                                    <Label htmlFor={`gacp-${id}`} className="text-xs font-bold text-emerald-900 cursor-pointer">
                                                        Using GACP from another farm
                                                    </Label>
                                                    <p className="text-[10px] text-emerald-700 opacity-80">Check if purchased from another farm</p>
                                                </div>
                                                <Checkbox id={`gacp-${id}`} checked={isThaiGacp}
                                                    onCheckedChange={(checked) => setIsThaiGacp(!!checked)}
                                                    className="h-4 w-4 border-emerald-300 data-[state=checked]:bg-emerald-600" />
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {category.types.map((docType) => {
                                                const isUploaded = documents.some(d => d.document_type === docType.id);
                                                const queuedForType = uploadQueue.filter(uq => uq.documentType === docType.id);
                                                const isDragOver = dragOverType === docType.id;
                                                const labelText = queuedForType.length === 0
                                                    ? 'Drop files or click to select...'
                                                    : queuedForType.length === 1
                                                        ? queuedForType[0].file.name
                                                        : `${queuedForType.length} files selected`;
                                                return (
                                                    <div
                                                        key={docType.id}
                                                        className={`flex flex-col space-y-1.5 p-3 rounded-sm border transition-colors ${isDragOver ? 'bg-emerald-50/50 border-emerald-400' : 'bg-gray-50/30 border-gray-100 hover:border-emerald-200'}`}
                                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverType(docType.id); }}
                                                        onDragEnter={(e) => { e.preventDefault(); setDragOverType(docType.id); }}
                                                        onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverType(null); }}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            setDragOverType(null);
                                                            handleFileUpload(e.dataTransfer.files, docType.id, docType.name);
                                                        }}
                                                    >
                                                        <Label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                                            {isUploaded && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                                                            {docType.name}
                                                            <span className="text-red-400 font-bold">*</span>
                                                        </Label>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="relative flex-1">
                                                                <input type="file" id={`${docType.id}-${id}`} className="sr-only" multiple
                                                                    onChange={(e) => handleFileUpload(e.target.files, docType.id, docType.name)}
                                                                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" />
                                                                <label htmlFor={`${docType.id}-${id}`}
                                                                    className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:border-emerald-500 cursor-pointer transition-all shadow-sm">
                                                                    <span className="truncate flex-1">
                                                                        {labelText}
                                                                    </span>
                                                                    <Upload className="w-3 h-3 opacity-50" />
                                                                </label>
                                                            </div>
                                                            <button type="button" onClick={() => handlePreview(docType.id, docType.name)}
                                                                disabled={previewLoading[docType.id]}
                                                                className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg border border-gray-100 shadow-sm transition-all shrink-0"
                                                                title="View Template">
                                                                {previewLoading[docType.id] ? <Loader2 className="w-3 h-3 animate-spin text-emerald-500" /> : <Eye className="w-3 h-3" />}
                                                            </button>
                                                        </div>
                                                        {queuedForType.length > 0 && (
                                                            <div className="mt-2 space-y-1">
                                                                {queuedForType.map((item) => (
                                                                    <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 px-2 bg-emerald-50/50 rounded-lg border border-emerald-100/50 text-[11px]">
                                                                        <span className="truncate flex-1 font-medium text-gray-700" title={item.file.name}>{item.file.name}</span>
                                                                        <span className="text-gray-400 shrink-0">{(item.file.size / 1024).toFixed(1)} KB</span>
                                                                        <button type="button" onClick={() => setUploadQueue(prev => prev.filter(x => x.id !== item.id))}
                                                                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0" title="Remove">
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        ))}

                        {/* Upload Queue */}
                        {uploadQueue.length > 0 && (
                            <div className="space-y-3 pt-3 border-t border-gray-100">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Queue ({uploadQueue.length})</span>
                                    </div>
                                    <button onClick={() => setUploadQueue([])} className="text-[10px] text-red-400 font-bold hover:text-red-500">Clear All</button>
                                </div>
                                <div className="space-y-1.5">
                                    {uploadQueue.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between p-3 bg-emerald-50/20 rounded-sm border border-emerald-50/50">
                                            <div className="flex items-center gap-3">
                                                <FileIcon mimeType={item.file.type} />
                                                <div>
                                                    <div className="text-xs font-bold text-gray-900 truncate max-w-[250px]">{item.file.name}</div>
                                                    <div className="text-[9px] text-emerald-600 font-bold uppercase">{item.documentTypeName}</div>
                                                </div>
                                            </div>
                                            <button onClick={() => setUploadQueue(prev => prev.filter(x => x.id !== item.id))}
                                                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 rounded-lg transition-all">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={submitAllDocuments} disabled={uploading}
                                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white rounded-sm font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50">
                                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><CheckCircle2 className="w-4 h-4" /> Submit All ({uploadQueue.length} Files)</>}
                                </button>
                            </div>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>
            </div>

            {/* ===== SUBMITTED DOCUMENTS (Collapsed) ===== */}
            {documents.length > 0 && (
                <Collapsible open={submittedOpen} onOpenChange={setSubmittedOpen}>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-5 bg-white rounded-sm border border-gray-100 hover:border-[var(--line)] transition-colors shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-[var(--info-bg)] rounded-lg flex items-center justify-center">
                                <FileText className="w-4.5 h-4.5 text-[var(--navy-700)]" />
                            </div>
                            <div className="text-left">
                                <span className="text-sm font-bold text-gray-900">Submitted Documents</span>
                                <p className="text-[10px] text-gray-400">View status of uploaded documents</p>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] bg-[var(--info-bg)] text-[var(--navy-700)] rounded-full font-bold">{documents.length}</span>
                        </div>
                        {submittedOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div className="mt-3 bg-white rounded-sm border border-gray-100 p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {documents.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-sm hover:border-emerald-200 hover:shadow-md transition-all group">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className="w-9 h-9 bg-gray-50 rounded-lg flex items-center justify-center border border-gray-100 shrink-0 group-hover:bg-emerald-50 transition-colors">
                                                <FileIcon mimeType={doc.mime_type} />
                                            </div>
                                            <div className="overflow-hidden">
                                                <div className="text-xs font-bold text-gray-900 truncate">{doc.file_name}</div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <span className="text-[9px] text-emerald-600/80 font-bold uppercase truncate max-w-[80px]">{doc.document_type}</span>
                                                    <span className="text-[9px] text-gray-300">&bull;</span>
                                                    <span className="text-[9px] text-gray-400">
                                                        {doc.submitted_at ? new Date(doc.submitted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <DocStatusBadge status={doc.status || 'submitted'} />
                                            {doc.file_url && (
                                                <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 text-gray-400 hover:bg-emerald-600 hover:text-white transition-all">
                                                    <Download className="w-3.5 h-3.5" />
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            )}

            {/* Footer */}
            <div className="text-center pb-8">
                <span className="text-[10px] text-gray-400">Last updated: {formatDate(q.updated_at || q.created_at, hasMounted)}</span>
            </div>
        </div>
    );
}
