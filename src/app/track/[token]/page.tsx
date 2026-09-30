'use client';

import { useState, useEffect, useMemo, use } from 'react';
import {
    Plane, Package, MapPin, CalendarDays,
    CheckCircle2, Loader2, FileText, Download,
    Calculator, Globe, AlertTriangle,
    Image as ImageIcon, FileSpreadsheet, Clock
} from 'lucide-react';
import { getQuotationByShareToken } from '@/lib/db';
import { calculateVolumeWeight } from '@/lib/calculators';
import type { Quotation, DocumentSubmission, AdditionalCharge, Pallet } from '@/lib/db';

// ============ CONSTANTS ============

const TRACKING_STEPS = [
    { label: 'Pending Docs', step: 1 },
    { label: 'Pending Booking', step: 2 },
    { label: 'Booking Requested', step: 3 },
    { label: 'AWB Received', step: 4 },
    { label: 'Waiting for Pick Up', step: 5 },
    { label: 'Delivered', step: 6 },
];

// ============ HELPERS ============

function formatDate(dateStr: string) {
    try {
        return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

function formatAmount(amount: number) {
    return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getStageDisplay(stage?: string, status?: string, deliveredAt?: string | null) {
    if (deliveredAt || stage === 'delivered') return { label: 'Delivered', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200', step: 6 };
    if (status === 'completed') return { label: 'Delivered', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200', step: 6 };
    if (status === 'Shipped') return { label: 'Shipped', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', step: 4 };
    switch (stage) {
        case 'payment_received': return { label: 'Payment received', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200', step: 6 };
        case 'picked_up': return { label: 'Picked up', color: 'text-teal-700', bgColor: 'bg-teal-50 border-teal-200', step: 5 };
        case 'waiting_for_pickup': return { label: 'Waiting for Pick Up', color: 'text-teal-700', bgColor: 'bg-teal-50 border-teal-200', step: 5 };
        case 'awb_received': return { label: 'AWB Received', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', step: 4 };
        case 'booking_requested': return { label: 'Booking Requested', color: 'text-cyan-700', bgColor: 'bg-cyan-50 border-cyan-200', step: 3 };
        case 'pending_booking': return { label: 'Pending Booking', color: 'text-purple-700', bgColor: 'bg-purple-50 border-purple-200', step: 2 };
        case 'pending_docs': return { label: 'Pending Documents', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200', step: 1 };
        default: return { label: 'Preparing', color: 'text-slate-700', bgColor: 'bg-slate-50 border-slate-200', step: 0 };
    }
}

// ============ SUB-COMPONENTS ============

function TrackingProgress({ sc }: { sc: ReturnType<typeof getStageDisplay> }) {
    return (
        <div className="px-2">
            <div className="relative">
                <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-100 -translate-y-1/2 rounded-full" />
                <div
                    className={`absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full transition-all duration-1000 ${sc.step >= 6 ? 'bg-emerald-500' : 'bg-blue-500'}`}
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
                                        : 'bg-white border-blue-600 scale-125 shadow-lg shadow-blue-100'
                                    : isActive
                                        ? doneEmerald ? 'bg-emerald-600 border-emerald-600' : 'bg-blue-600 border-blue-600'
                                        : 'bg-white border-gray-200'
                                    }`}>
                                    {isActive && !isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                    {isCurrent && <div className={`w-2 h-2 rounded-full animate-pulse ${step.step === 6 ? 'bg-emerald-600' : 'bg-blue-600'}`} />}
                                </div>
                                <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[60px] ${isCurrent ? 'text-blue-700 font-black' : isActive ? 'text-gray-600' : 'text-gray-300'}`}>
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

// ============ MAIN PAGE ============

export default function PublicTrackingPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [loading, setLoading] = useState(true);
    const [quotation, setQuotation] = useState<(Quotation & { documents?: DocumentSubmission[] }) | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [resolvedUrls, setResolvedUrls] = useState<{ awb?: string; customs?: string }>({});
    const [resolvedSubmissions, setResolvedSubmissions] = useState<DocumentSubmission[]>([]);

    useEffect(() => {
        async function load() {
            try {
                const data = await getQuotationByShareToken(token);
                if (data) {
                    setQuotation(data);

                    const { getFileUrl } = await import('@/lib/storage');

                    // Resolve AWB and Customs
                    const urls: { awb?: string; customs?: string } = {};
                    if (data.awb_file_url) {
                        const path = data.awb_file_url.includes('supabase') ? data.awb_file_url.split('/public/')[1] || data.awb_file_url : data.awb_file_url;
                        urls.awb = await getFileUrl(path, data.storage_provider || 'supabase');
                    }
                    if (data.customs_declaration_file_url) {
                        const path = data.customs_declaration_file_url.includes('supabase') ? data.customs_declaration_file_url.split('/public/')[1] || data.customs_declaration_file_url : data.customs_declaration_file_url;
                        urls.customs = await getFileUrl(path, data.storage_provider || 'supabase');
                    }
                    setResolvedUrls(urls);

                    // Resolve Document Submissions
                    if (data.documents && data.documents.length > 0) {
                        const resolvedDocs = await Promise.all(data.documents.map(async (doc) => {
                            const url = await getFileUrl(doc.file_path || doc.file_url, doc.storage_provider || 'supabase');
                            return { ...doc, file_url: url };
                        }));
                        setResolvedSubmissions(resolvedDocs);
                    }
                } else {
                    setNotFound(true);
                }
            } catch (err) {
                console.error('Error loading shared shipment:', err);
                setNotFound(true);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [token]);

    const totals = useMemo(() => {
        if (!quotation) return null;
        const pallets: Pallet[] = quotation.pallets || [];
        let totalActualWeight = 0, totalVolumeWeight = 0;

        pallets.forEach(pallet => {
            const length = Number(pallet.length) || 0;
            const width = Number(pallet.width) || 0;
            const height = Number(pallet.height) || 0;
            const weight = Number(pallet.weight) || 0;
            const quantity = Number(pallet.quantity) || 1;
            const volWt = calculateVolumeWeight(length, width, height);
            totalActualWeight += weight * quantity;
            totalVolumeWeight += volWt * quantity;
        });

        const chargeableWeight = Math.max(totalActualWeight, totalVolumeWeight);
        const deliveryRates: Record<string, number> = { '4wheel': 3500, '6wheel': 6500 };
        const deliveryCost = quotation.delivery_service_required && quotation.delivery_vehicle_type
            ? (deliveryRates[quotation.delivery_vehicle_type] || 0) : 0;
        const totalAdditionalCharges = (quotation.additional_charges || []).reduce(
            (sum: number, charge: AdditionalCharge) => sum + (Number(charge.amount) || 0), 0);
        const totalCost = quotation.total_cost || 0;

        return { totalFreightCost: quotation.total_freight_cost || 0, deliveryCost, totalActualWeight, totalVolumeWeight, chargeableWeight, totalCost, totalAdditionalCharges };
    }, [quotation]);

    // Loading
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">Loading shipment tracking...</p>
                </div>
            </div>
        );
    }

    // Not found
    if (notFound || !quotation || !totals) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                    <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="w-8 h-8 text-red-400" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Tracking Link Not Found</h1>
                    <p className="text-sm text-gray-500">
                        This tracking link is invalid or has expired. Please contact the sender for a new link.
                    </p>
                </div>
            </div>
        );
    }

    const q = quotation;
    const sc = getStageDisplay(q.opportunities?.stage, q.status);
    const pallets: Pallet[] = q.pallets || [];

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/images/Logo.png" alt="Logo" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
                        <Globe className="w-4 h-4 text-white hidden" />
                    </div>
                    <div>
                        <span className="text-sm font-bold text-gray-900">Shipment Tracking</span>
                        <span className="text-[9px] text-emerald-600 font-medium ml-2">OMG Exp</span>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                {/* Header Card */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    <div className="p-6 md:p-8">
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
                            <div className="flex items-start gap-4">
                                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${sc.step >= 6 ? 'bg-emerald-50 text-emerald-600' : sc.step === 5 ? 'bg-teal-50 text-teal-600' : sc.step >= 4 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                    <Plane className={`w-7 h-7 ${sc.step >= 4 ? 'animate-bounce' : ''}`} />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h1 className="text-xl font-bold text-gray-900">{q.quotation_no || q.id.slice(0, 8)}</h1>
                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${sc.bgColor} ${sc.color}`}>
                                            {(sc.step === 4 || sc.step === 5) && <span className={`w-1.5 h-1.5 rounded-full mr-2 animate-pulse ${sc.step === 5 ? 'bg-teal-500' : 'bg-blue-500'}`} />}
                                            {sc.label}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                                        <span className="flex items-center gap-1.5 text-blue-600 font-bold"><MapPin className="w-4 h-4" /> {q.destination || 'N/A'}</span>
                                        <span className="flex items-center gap-1.5"><Package className="w-4 h-4 text-gray-400" /> {pallets.length} pallets</span>
                                        <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-gray-400" /> {formatDate(q.created_at)}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-50 px-5 py-3 rounded-xl border border-slate-100 shrink-0">
                                <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest text-right mb-0.5">Total</div>
                                <div className="text-2xl font-black text-gray-900">{formatAmount(totals.totalCost)}</div>
                            </div>
                        </div>
                        <TrackingProgress sc={sc} />
                    </div>
                </div>

                {/* Shipping Info + Weight Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                            <Plane className="w-3.5 h-3.5" /> Shipping Info
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Shipping Date</div>
                                <div className="text-sm font-semibold text-gray-900">
                                    {q.shipping_date ? new Date(q.shipping_date).toLocaleDateString('en-GB') : 'TBC'}
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
                        {q.notes && (
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Notes</div>
                                <div className="text-xs text-gray-600 mt-1 italic">&quot;{q.notes}&quot;</div>
                            </div>
                        )}
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5" /> Weight Summary
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50 text-center">
                                <div className="text-[9px] font-bold text-emerald-600 uppercase">Actual</div>
                                <div className="text-base font-bold text-emerald-700">{totals.totalActualWeight.toFixed(1)} kg</div>
                            </div>
                            <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100/50 text-center">
                                <div className="text-[9px] font-bold text-blue-600 uppercase">Volume</div>
                                <div className="text-base font-bold text-blue-700">{totals.totalVolumeWeight.toFixed(1)} kg</div>
                            </div>
                            <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-100/50 text-center">
                                <div className="text-[9px] font-bold text-amber-600 uppercase">Chargeable</div>
                                <div className="text-base font-bold text-amber-700">{totals.chargeableWeight.toFixed(1)} kg</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Cost Breakdown */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                        <Calculator className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cost Breakdown</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                        <div className="px-5 py-3 flex justify-between items-center">
                            <div><span className="text-sm text-gray-600">Freight Cost</span><br /><span className="text-[10px] text-gray-400">Based on chargeable weight</span></div>
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
                        <div className="px-5 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 flex justify-between items-center">
                            <span className="text-xs font-black text-emerald-100 uppercase tracking-widest">Total</span>
                            <span className="text-xl font-black text-white">{formatAmount(totals.totalCost)}</span>
                        </div>
                    </div>
                </div>

                {/* AWB + Customs Declaration Documents */}
                {(resolvedUrls.awb || resolvedUrls.customs) && (
                    <div className="bg-white rounded-xl border border-gray-100 p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-1 h-4 bg-blue-600 rounded-full" />
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Shipping Documents</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {resolvedUrls.awb && (
                                <a href={resolvedUrls.awb} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 rounded-xl border border-blue-100 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-200 transition-all group/doc">
                                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 group-hover/doc:bg-blue-200 transition-colors">
                                        <FileText className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-blue-800">AWB (Air Waybill)</div>
                                        <div className="text-[10px] text-blue-500 truncate">{q.awb_file_name || 'Download'}</div>
                                    </div>
                                    <Download className="w-4 h-4 text-blue-400 shrink-0 group-hover/doc:text-blue-600 transition-colors" />
                                </a>
                            )}
                            {resolvedUrls.customs && (
                                <a href={resolvedUrls.customs} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-200 transition-all group/doc">
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

                {/* Submitted Documents */}
                {resolvedSubmissions && resolvedSubmissions.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <div className="w-1 h-4 bg-violet-600 rounded-full" />
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Submitted Documents</span>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] bg-violet-50 text-violet-700 rounded-full font-bold border border-violet-100">
                                {resolvedSubmissions.length} files
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {resolvedSubmissions.map((doc: DocumentSubmission) => {
                                const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
                                    approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
                                    submitted: { label: 'Under Review', className: 'bg-blue-50 text-blue-700', icon: Clock },
                                    reviewed: { label: 'Reviewed', className: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
                                    rejected: { label: 'Rejected', className: 'bg-red-50 text-red-700', icon: AlertTriangle },
                                    pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700', icon: Clock },
                                };
                                const sc2 = statusConfig[doc.status || 'submitted'] || statusConfig.submitted;
                                const StatusIcon = sc2.icon;
                                const mime = doc.mime_type || '';
                                const DocIcon = mime.includes('spreadsheet') || mime.includes('excel')
                                    ? FileSpreadsheet : mime.includes('image') ? ImageIcon : FileText;
                                const iconColor = mime.includes('spreadsheet') || mime.includes('excel')
                                    ? 'text-emerald-500' : mime.includes('image') ? 'text-violet-500' : 'text-blue-500';

                                return (
                                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:border-gray-200 transition-all group/doc">
                                        <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 group-hover/doc:border-violet-200 transition-colors">
                                            <DocIcon className={`w-5 h-5 ${iconColor}`} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-bold text-gray-900 truncate">{doc.document_type_name || doc.document_type}</div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${sc2.className}`}>
                                                    <StatusIcon className="w-2.5 h-2.5" /> {sc2.label}
                                                </span>
                                                {doc.submitted_at && (
                                                    <span className="text-[9px] text-gray-400">
                                                        {formatDate(doc.submitted_at)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {doc.file_url && (
                                            <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-100 text-gray-400 hover:bg-violet-600 hover:text-white hover:border-violet-600 transition-all shrink-0">
                                                <Download className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Pallet Details (Readonly) */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Package className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Pallet Details ({pallets.reduce((s, p) => s + (Number(p.quantity) || 1), 0)})</span>
                    </div>
                    <div className="space-y-3">
                        {pallets.map((pallet: Pallet, idx: number) => {
                            const length = Number(pallet.length) || 0;
                            const width = Number(pallet.width) || 0;
                            const height = Number(pallet.height) || 0;
                            const weight = Number(pallet.weight) || 0;
                            const quantity = Number(pallet.quantity) || 1;
                            const volWt = calculateVolumeWeight(length, width, height);

                            return (
                                <div key={idx} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center text-[10px] font-bold text-gray-500">#{idx + 1}</div>
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Pallet Unit</span>
                                        {quantity > 1 && <span className="text-xs font-bold text-emerald-600">x{quantity}</span>}
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                        <div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Length</div>
                                            <div className="text-sm font-semibold text-gray-900">{length} cm</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Width</div>
                                            <div className="text-sm font-semibold text-gray-900">{width} cm</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Height</div>
                                            <div className="text-sm font-semibold text-gray-900">{height} cm</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Weight</div>
                                            <div className="text-sm font-semibold text-gray-900">{weight} kg</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Vol. Weight</div>
                                            <div className="text-sm font-semibold text-blue-600">{volWt.toFixed(1)} kg</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center py-6 text-xs text-gray-400">
                    <p>Powered by <span className="font-bold text-emerald-600">OMG Exp</span> &middot; Export Tracking System</p>
                    <p className="mt-1">This is a shared tracking link. Data updates in real-time.</p>
                </div>
            </main>
        </div>
    );
}
