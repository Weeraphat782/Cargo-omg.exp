'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Plane, Package, MapPin, CalendarDays,
    CheckCircle2, Inbox, Loader2, FileText,
    Search, ArrowRight, Clock, PlusCircle, X,
    ChevronDown, ChevronUp, BookOpen, FlaskConical, Share2, Check,
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import {
    getCustomerQuotations,
    getCustomerPendingRequests,
    cancelCustomerQuoteRequest,
    generateCustomerBookingViewToken,
} from '@/lib/customer-db';
import { getQuotationPayableTotalThb, type Quotation } from '@/lib/db';
import { toast } from 'sonner';
import { TOUR_POSTER_URL, TOUR_VIDEO_URL } from '@/lib/site';

// ============ HELPERS ============

function formatDate(dateStr: string) {
    try {
        return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

/** List card: payable incl. VAT (matches Proforma / quotation DB). */
function formatPayableThb(amount: number) {
    return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getStageDisplay(stage?: string, status?: string, deliveredAt?: string | null) {
    if (deliveredAt || stage === 'delivered' || status === 'completed') return { label: 'Delivered', step: 6, badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' };
    if (status === 'Shipped') return { label: 'Shipped', step: 4, badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' };
    switch (stage) {
        case 'payment_received': return { label: 'Payment received', step: 6, badge: 'bg-cyan-50 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500' };
        case 'picked_up': return { label: 'Picked up', step: 5, badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' };
        case 'waiting_for_pickup': return { label: 'Waiting for Pick Up', step: 5, badge: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-teal-500' };
        case 'awb_received': return { label: 'AWB Received', step: 4, badge: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' };
        case 'booking_requested': return { label: 'Booking Requested', step: 3, badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' };
        case 'pending_booking': return { label: 'Pending Booking', step: 2, badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' };
        case 'pending_docs': return { label: 'Pending Documents', step: 1, badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
        default: return { label: 'Preparing', step: 0, badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' };
    }
}

function isShipmentCompleted(q: Quotation): boolean {
    const sc = getStageDisplay(q.opportunities?.stage, q.status, q.delivered_at);
    return sc.label === 'Delivered';
}

function isPricingPending(q: Quotation): boolean {
    return !q.destination_id || !q.total_cost || Number(q.total_cost) <= 0;
}

// ============ SHIPMENT TABLE ============

function ShipmentRow({ q }: { q: Quotation }) {
    const router = useRouter();
    const sc = getStageDisplay(q.opportunities?.stage, q.status, q.delivered_at);
    const pricingPending = isPricingPending(q);
    const [copying, setCopying] = useState(false);
    const [copied, setCopied] = useState(false);
    const [viewToken, setViewToken] = useState(q.booking_view_token ?? null);

    const handleCopyBookingSheet = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setCopying(true);
        try {
            const token = viewToken || (await generateCustomerBookingViewToken(q.id));
            if (!token) {
                toast.error('Could not copy booking sheet link');
                return;
            }
            setViewToken(token);
            await navigator.clipboard.writeText(`${window.location.origin}/booking/view/${token}`);
            setCopied(true);
            toast.success('Booking sheet link copied');
            setTimeout(() => setCopied(false), 3000);
        } catch {
            toast.error('Could not copy link');
        } finally {
            setCopying(false);
        }
    };

    return (
        <TableRow
            className="cursor-pointer hover:bg-gray-50/80"
            onClick={() => router.push(`/portal/shipments/${q.id}`)}
        >
            <TableCell className="min-w-[88px] text-xs sm:text-sm font-bold font-mono">
                {q.quotation_no || q.id.slice(0, 8)}
            </TableCell>
            <TableCell className="min-w-[140px]">
                <span
                    className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${sc.badge}`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${sc.dot}`} />
                    {sc.label}
                </span>
            </TableCell>
            <TableCell
                className="min-w-[120px] max-w-[220px] truncate text-xs sm:text-sm font-semibold text-[var(--navy-700)]"
                title={pricingPending ? undefined : q.destination || undefined}
            >
                {pricingPending ? 'Destination TBD' : q.destination || 'N/A'}
            </TableCell>
            <TableCell className="min-w-[56px] text-xs sm:text-sm tabular-nums">
                {q.pallets?.length || 0}
            </TableCell>
            <TableCell className="min-w-[90px] text-xs sm:text-sm whitespace-nowrap">
                {formatDate(q.created_at)}
            </TableCell>
            <TableCell className="min-w-[90px] text-xs sm:text-sm whitespace-nowrap text-gray-500">
                {formatDate(q.updated_at || q.created_at)}
            </TableCell>
            <TableCell className="min-w-[120px] text-xs sm:text-sm">
                {pricingPending ? (
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Awaiting Pricing
                        </div>
                        <div className="text-[11px] text-slate-500">Staff will set rate soon</div>
                    </div>
                ) : (
                    <div>
                        <div
                            className={`text-[10px] font-bold uppercase tracking-widest ${q.price_confirmed ? 'text-emerald-500' : 'text-amber-500'}`}
                        >
                            {q.price_confirmed ? 'Confirmed' : 'Pending'}
                        </div>
                        <div
                            className={`text-sm font-black tabular-nums ${q.price_confirmed ? 'text-emerald-700' : 'text-amber-700'}`}
                        >
                            {formatPayableThb(getQuotationPayableTotalThb(q))}
                        </div>
                    </div>
                )}
            </TableCell>
            <TableCell className="min-w-[200px] text-right">
                <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        type="button"
                        onClick={(e) => void handleCopyBookingSheet(e)}
                        disabled={copying}
                        title="Copy booking sheet link to share with your consignee (no prices)"
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-bold border transition-colors disabled:opacity-60 ${
                            copied
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-white text-[#215497] border-[#215497]/30 hover:bg-blue-50'
                        }`}
                    >
                        {copying ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : copied ? (
                            <Check className="w-3 h-3" />
                        ) : (
                            <Share2 className="w-3 h-3" />
                        )}
                        {copied ? 'Copied!' : 'Copy sheet'}
                    </button>
                    <Link
                        href={`/portal/shipments/${q.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50"
                    >
                        View
                        <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </TableCell>
        </TableRow>
    );
}

function ShipmentTable({ items }: { items: Quotation[] }) {
    return (
        <div className="overflow-x-auto bg-white rounded-sm border border-gray-100">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-[88px] text-xs sm:text-sm">OMG No.</TableHead>
                        <TableHead className="min-w-[140px] text-xs sm:text-sm">Status</TableHead>
                        <TableHead className="min-w-[120px] text-xs sm:text-sm">Destination</TableHead>
                        <TableHead className="min-w-[56px] text-xs sm:text-sm">Pallets</TableHead>
                        <TableHead className="min-w-[90px] text-xs sm:text-sm">Created</TableHead>
                        <TableHead className="min-w-[90px] text-xs sm:text-sm">Updated</TableHead>
                        <TableHead className="min-w-[120px] text-xs sm:text-sm">Total (incl. VAT)</TableHead>
                        <TableHead className="min-w-[200px] text-right text-xs sm:text-sm">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((q) => (
                        <ShipmentRow key={q.id} q={q} />
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

// ============ MAIN PAGE ============

const QC_PROMO_DISMISSED_KEY = 'qc_promo_dismissed';

export default function MyShipmentsPage() {
    const { user, profile, isLoading: authLoading } = useCustomerAuth();
    const displayName = profile?.full_name || profile?.company || 'Customer';
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [pendingRequests, setPendingRequests] = useState<Quotation[]>([]);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [showCompleted, setShowCompleted] = useState(false);
    const [showQcPromo, setShowQcPromo] = useState(false);

    useEffect(() => {
        setShowQcPromo(localStorage.getItem(QC_PROMO_DISMISSED_KEY) !== '1');
    }, []);

    const dismissQcPromo = () => {
        localStorage.setItem(QC_PROMO_DISMISSED_KEY, '1');
        setShowQcPromo(false);
    };

    const loadData = useCallback(async () => {
        if (!user?.id) return;
        setLoading(true);
        try {
            const [quots, pending] = await Promise.all([
                getCustomerQuotations(user.id),
                getCustomerPendingRequests(user.id),
            ]);
            // Filter out pending_approval from main list (they show in separate section)
            setQuotations(quots.filter(q => q.status !== 'pending_approval'));
            setPendingRequests(pending);
        } catch (err) {
            console.error('[MyShipments] Load error:', err);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (authLoading) return;
        if (!user?.id) { setLoading(false); return; }
        loadData();
    }, [user?.id, authLoading, loadData]);

    const handleCancel = async (quotationId: string) => {
        if (!confirm('Cancel this quote request? This cannot be undone.')) return;
        setCancellingId(quotationId);
        const res = await cancelCustomerQuoteRequest(quotationId);
        setCancellingId(null);
        if (res.success) {
            toast.success('Quote request cancelled');
            setPendingRequests(prev => prev.filter(q => q.id !== quotationId));
        } else {
            toast.error(res.error || 'Failed to cancel');
        }
    };

    const filtered = quotations.filter(q => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const qNo = (q.quotation_no || '').toLowerCase();
        const dest = (q.destination || '').toLowerCase();
        const company = (q.company_name || '').toLowerCase();
        return qNo.includes(query) || dest.includes(query) || company.includes(query);
    });

    const activeFiltered = filtered.filter(q => !isShipmentCompleted(q));
    const completedFiltered = filtered.filter(q => isShipmentCompleted(q));

    const stats = useMemo(() => {
        const total = quotations.length;
        const active = quotations.filter(q => {
            const s = getStageDisplay(q.opportunities?.stage, q.status, q.delivered_at);
            return s.step > 0 && s.step < 4;
        }).length;
        const shipped = quotations.filter(q => {
            const s = getStageDisplay(q.opportunities?.stage, q.status, q.delivered_at);
            return s.step === 4 || s.step === 5;
        }).length;
        const delivered = quotations.filter(q => {
            const s = getStageDisplay(q.opportunities?.stage, q.status, q.delivered_at);
            return s.step === 6;
        }).length;
        return { total, active, shipped, delivered };
    }, [quotations]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">My Shipments</h1>
                    <p className="text-sm text-gray-500 mt-1">Track and manage all your shipments, {displayName}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <a
                        href="/manual/index.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-sm hover:opacity-90 hover:shadow-lg transition-all"
                        style={{
                            background: "linear-gradient(135deg, #184878 0%, #2c6bb8 100%)",
                            boxShadow: "0 4px 14px rgba(33,84,151,0.35)",
                        }}
                    >
                        <BookOpen className="w-4 h-4" /> User Manual
                    </a>
                    <Link
                        href="/portal/quotations/new"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-sm hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                        <PlusCircle className="w-4 h-4" /> Request Quote
                    </Link>
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-sm border border-gray-100 shadow-sm">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Live</span>
                    </div>
                </div>
            </div>

            {showQcPromo && (
                <div className="relative overflow-hidden rounded-sm border border-emerald-300/50 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 p-5 text-white shadow-lg animate-scale-in">
                    {/* Decorative blobs */}
                    <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
                    <div className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-cyan-300/20 blur-2xl" />
                    {/* Shimmer sweep */}
                    <div className="pointer-events-none absolute inset-0 animate-shimmer opacity-40" />
                    <button
                        type="button"
                        onClick={dismissQcPromo}
                        className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                        aria-label="Dismiss QC promo"
                    >
                        <X className="w-4 h-4" />
                    </button>
                    <div className="relative z-[1] flex flex-col sm:flex-row sm:items-center gap-4 pr-8">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-white/20 backdrop-blur-sm">
                            <FlaskConical className="h-6 w-6 animate-float" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-950 animate-pulse">
                                    New
                                </span>
                                <h2 className="text-lg font-bold">QC Lab Testing Service</h2>
                            </div>
                            <p className="mt-1 text-sm text-emerald-50">
                                Submit lab samples from the portal — request a quote and track results online.
                            </p>
                        </div>
                        <Link
                            href="/portal/qc-requests/new"
                            className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-sm bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-md hover:bg-emerald-50 hover:scale-105 transition-all"
                        >
                            Try QC Request
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                    </div>
                </div>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Total', value: stats.total, icon: FileText, color: 'emerald' },
                    { label: 'In Progress', value: stats.active, icon: Package, color: 'amber' },
                    { label: 'Shipped', value: stats.shipped, icon: Plane, color: 'blue' },
                    { label: 'Delivered', value: stats.delivered, icon: CheckCircle2, color: 'violet' },
                ].map((s, i) => (
                    <div key={i} className="bg-white rounded-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color === 'emerald' ? 'bg-emerald-50' : s.color === 'amber' ? 'bg-amber-50' : s.color === 'blue' ? 'bg-[var(--info-bg)]' : 'bg-violet-50'
                                }`}>
                                <s.icon className={`w-4 h-4 ${s.color === 'emerald' ? 'text-emerald-600' : s.color === 'amber' ? 'text-amber-600' : s.color === 'blue' ? 'text-[var(--navy-700)]' : 'text-violet-600'
                                    }`} />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-gray-900">
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-300" /> : s.value}
                                </div>
                                <div className="text-[10px] text-gray-500 font-medium">{s.label}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search by quotation number, destination..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
            </div>

            {/* Pending Quote Requests */}
            {!loading && pendingRequests.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Pending Quote Requests ({pendingRequests.length})
                    </h2>
                    {pendingRequests.map((q) => (
                        <div
                            key={q.id}
                            className="bg-amber-50/50 rounded-sm border border-amber-100 p-5"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-sm flex items-center justify-center shrink-0 bg-amber-50 text-amber-600">
                                        <Clock className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-1.5 min-w-0">
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <span className="text-base font-bold text-gray-900">
                                                {q.quotation_no || q.id.slice(0, 8)}
                                            </span>
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border bg-amber-50 border-amber-200 text-amber-700">
                                                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mr-1.5 animate-pulse" />
                                                Pending Approval
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Package className="w-3.5 h-3.5 text-gray-400" /> {q.pallets?.length || 0} pallet type(s)
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <CalendarDays className="w-3.5 h-3.5 text-gray-400" /> {formatDate(q.created_at)}
                                            </span>
                                        </div>
                                        {q.requested_destination && (
                                            <p className="text-xs text-gray-600 mt-1 flex items-start gap-1">
                                                <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                                                <span className="line-clamp-2">{q.requested_destination}</span>
                                            </p>
                                        )}
                                        {q.notes && (
                                            <p className="text-xs text-gray-400 mt-1 line-clamp-1">Note: {q.notes}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right shrink-0 flex flex-col sm:items-end gap-3">
                                    <div>
                                        <div className="text-xs text-amber-600 font-semibold">Awaiting staff review</div>
                                        <div className="text-[10px] text-gray-400 mt-1 max-w-[220px] sm:text-right">
                                            Destination &amp; pricing will be set by our team — you can still upload documents anytime.
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <button
                                            onClick={() => handleCancel(q.id)}
                                            disabled={cancellingId === q.id}
                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
                                        >
                                            {cancellingId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                                            Cancel
                                        </button>
                                        <Link
                                            href={`/portal/shipments/${q.id}#documents`}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm transition-colors flex-1 sm:flex-none"
                                        >
                                            <FileText className="w-3.5 h-3.5" /> Open &amp; upload documents
                                            <ArrowRight className="w-3.5 h-3.5" />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Shipment List (active only) */}
            {loading ? (
                <div className="bg-white rounded-sm border border-gray-100 flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                </div>
            ) : activeFiltered.length === 0 && completedFiltered.length === 0 ? (
                <div className="bg-white rounded-sm border border-gray-100">
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-sm flex items-center justify-center mb-4">
                            <Inbox className="w-8 h-8 text-gray-300" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 mb-1">
                            {quotations.length === 0 ? 'No shipments yet' : 'No matching results'}
                        </h3>
                        <p className="text-sm text-gray-500 max-w-[320px]">
                            {quotations.length === 0
                                ? 'Your shipments will appear here once our team assigns quotations to your account.'
                                : 'Try adjusting your search query.'}
                        </p>
                        {quotations.length === 0 && (
                            <div className="mt-8 w-full max-w-[560px] px-4">
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                    New here? Watch how it works (1 min)
                                </h4>
                                <video
                                    className="w-full rounded-sm border border-gray-200 aspect-video bg-black"
                                    controls
                                    preload="none"
                                    playsInline
                                    poster={TOUR_POSTER_URL}
                                    src={TOUR_VIDEO_URL}
                                />
                            </div>
                        )}
                    </div>
                </div>
            ) : activeFiltered.length === 0 ? (
                <div className="bg-white rounded-sm border border-gray-100">
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                        <div className="w-14 h-14 bg-emerald-50 rounded-sm flex items-center justify-center mb-3">
                            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 mb-1">All shipments delivered</h3>
                        <p className="text-sm text-gray-500 max-w-[320px]">
                            {searchQuery
                                ? 'No active shipments match your search. Expand Completed below to see delivered shipments.'
                                : 'You have no active shipments. Expand the Completed section below to view delivered shipments.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <ShipmentTable items={activeFiltered} />
                    <div className="text-center pt-2">
                        <span className="text-xs text-gray-400">
                            Showing {activeFiltered.length} active shipment{activeFiltered.length === 1 ? '' : 's'}
                            {completedFiltered.length > 0 && ` · ${completedFiltered.length} completed hidden`}
                        </span>
                    </div>
                </div>
            )}

            {/* Completed shipments (collapsed by default) */}
            {!loading && completedFiltered.length > 0 && (
                <div className="bg-white rounded-sm border border-gray-100 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setShowCompleted((v) => !v)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="text-left">
                                <div className="text-sm font-bold text-gray-900">
                                    Completed ({completedFiltered.length})
                                </div>
                                <div className="text-[11px] text-gray-500">
                                    Delivered shipments — hidden by default
                                </div>
                            </div>
                        </div>
                        {showCompleted ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                    </button>
                    {showCompleted && (
                        <div className="border-t border-gray-100 p-3 bg-gray-50/40">
                            <ShipmentTable items={completedFiltered} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
