"use client";

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Opportunity, OpportunityStage } from '@/types/opportunity';
import { Quotation, getQuotationPayableTotalThb } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, FileText, Edit, Calendar, Package, Eye, Flag, Globe, Link2, Link2Off, Share2, Receipt, ShieldCheck, CheckCircle, UserCircle2, Leaf, Loader2 } from 'lucide-react';
import { unlinkQuotationFromOpportunity } from '@/lib/db';
import { toast } from 'sonner';
import Link from 'next/link';
import { QuotationDocuments } from '@/components/quotations/quotation-documents';
import { ShippingDocumentsUpload } from '@/components/quotations/shipping-documents-upload';
import { AwbTrackingPanel } from '@/components/awb-tracking/awb-tracking-panel';
import { StageProgressBar } from '@/components/opportunities/stage-progress-bar';
import { ContactWidget } from '@/components/opportunities/contact-widget';
import { OpportunityTasks } from '@/components/opportunities/opportunity-tasks';
import { AnalysisHistory } from '@/components/opportunities/analysis-history';
import { LinkQuotationDialog } from '@/components/opportunities/link-quotation-dialog';
import { COMMODITY_META, normalizeCommodityType } from '@/lib/document-presets';

interface OpportunityDetail extends Omit<Opportunity, 'quotationIds'> {
    description?: string;
    quotations?: Quotation[];
    contact_person?: string;
    contact_email?: string;
    contact_phone?: string;
}

export default function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const [opportunity, setOpportunity] = useState<OpportunityDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [unlinkingQuoteId, setUnlinkingQuoteId] = useState<string | null>(null);

    const fetchOpportunity = async () => {
        setLoading(true);
        try {
            // Fetch opportunity with linked quotations
            const { data, error } = await supabase
                .from('opportunities')
                .select(`
                        *, 
                        quotations(*), 
                        destination:destination_id(country, port), 
                        opportunity_products(product:products(name)),
                        company:company_id(name, contact_person, contact_email, contact_phone)
                    `)
                .eq('id', id)
                .single();

            if (error) {
                throw error;
            }

            if (data) {
                interface RawSupabaseOpportunity {
                    id: string;
                    topic: string;
                    customer_name: string | null;
                    company_id: string | null;
                    amount: number;
                    currency: string;
                    stage: OpportunityStage;
                    probability: number;
                    created_at: string;
                    updated_at: string;
                    close_date: string;
                    vehicle_type?: string;
                    container_size?: string;
                    product_details?: string | { description?: string };
                    notes?: string;
                    destination_id?: string;
                    destination?: { country: string; port: string | null };
                    quotations?: Quotation[];
                    opportunity_products?: { product: { name: string } }[];
                    closure_status?: 'won' | 'lost' | null;
                    company?: {
                        name: string;
                        contact_person?: string;
                        contact_email?: string;
                        contact_phone?: string;
                    };
                }

                const item = data as unknown as RawSupabaseOpportunity;

                const dest = item.destination;
                const destinationName = dest ? `${dest.country}${dest.port ? ` (${dest.port})` : ''}` : undefined;

                // Map products
                const productNames = item.opportunity_products?.map(op => op.product.name) || [];

                const mapped: OpportunityDetail = {
                    id: item.id,
                    topic: item.topic,
                    customerName: item.customer_name || 'Unknown',
                    companyName: item.company?.name || item.customer_name || 'Unknown',
                    companyId: item.company_id || undefined,
                    amount: item.amount,
                    currency: item.currency,
                    stage: item.stage,
                    probability: item.probability,
                    closeDate: item.close_date,
                    ownerName: 'Me',
                    createdAt: item.created_at,
                    updatedAt: item.updated_at,
                    vehicleType: item.vehicle_type,
                    containerSize: item.container_size,
                    productDetails: typeof item.product_details === 'object' ? item.product_details?.description || '' : item.product_details || '',
                    notes: item.notes,
                    destinationId: item.destination_id,
                    destinationName,
                    productName: productNames, // Map to string[]
                    quotations: item.quotations || [], // Full quotation objects
                    closureStatus: item.closure_status || null,
                    contact_person: item.company?.contact_person,
                    contact_email: item.company?.contact_email,
                    contact_phone: item.company?.contact_phone
                };

                setOpportunity(mapped);
            }
        } catch (err) {
            console.error('Error fetching opportunity details:', err);
            toast.error('Failed to load opportunity details');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPrice = async (quoteId: string) => {
        try {
            const { error } = await supabase
                .from('quotations')
                .update({ price_confirmed: true })
                .eq('id', quoteId);
            if (error) throw error;
            toast.success('Price confirmed successfully');
            fetchOpportunity();
        } catch (err) {
            console.error('Error confirming price:', err);
            toast.error('Failed to confirm price');
        }
    };

    const handleUnlinkQuote = async (quote: Quotation) => {
        const label = quote.quotation_no || quote.id.slice(0, 8).toUpperCase();
        if (!window.confirm(`Unlink quotation ${label} from this opportunity?`)) return;

        setUnlinkingQuoteId(quote.id);
        try {
            const success = await unlinkQuotationFromOpportunity(quote.id);
            if (success) {
                toast.success('Quotation unlinked');
                fetchOpportunity();
            } else {
                toast.error('Failed to unlink quotation');
            }
        } catch (err) {
            console.error('Error unlinking quotation:', err);
            toast.error('Failed to unlink quotation');
        } finally {
            setUnlinkingQuoteId(null);
        }
    };

    const handleShareLink = (quoteId: string, commodityType?: string) => {
        if (typeof window === 'undefined') return;

        const baseUrl = window.location.origin;
        const commodity = commodityType || 'cannabis';
        const uploadUrl = `${baseUrl}/documents-upload/${quoteId}?company=${encodeURIComponent(opportunity?.companyName || '')}&destination=${encodeURIComponent(opportunity?.destinationName || '')}&commodity=${commodity}`;

        navigator.clipboard.writeText(uploadUrl).then(() => {
            toast.success('Upload link copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy link:', err);
            toast.error('Failed to copy link');
        });
    };

    useEffect(() => {
        if (id) {
            fetchOpportunity();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-50/50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            </div>
        );
    }

    if (!opportunity) {
        return (
            <div className="flex flex-col items-center justify-center h-screen space-y-4">
                <h2 className="text-xl font-semibold">Opportunity not found</h2>
                <Button onClick={() => router.push('/opportunities')}>Return to Board</Button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/30 p-4 md:p-8">
            <style jsx global>{`
                /* Hide sidebar and header on mobile for a clean screenshot report */
                @media (max-width: 1023px) {
                    aside, header, nav[aria-label="Breadcrumb"] {
                        display: none !important;
                    }
                    main {
                        margin: 0 !important;
                        padding: 0 !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        background: white !important;
                    }
                }
            `}</style>

            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header Section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <Button variant="outline" size="sm" onClick={() => router.push('/opportunities')} className="hidden sm:flex">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Return
                        </Button>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 line-clamp-1">
                                {opportunity.topic}
                            </h1>
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <span className="font-extrabold text-blue-600">{opportunity.customerName}</span>
                                <span>•</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-gray-100 border`}>
                                    {opportunity.stage.replace(/_/g, ' ').toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setLinkDialogOpen(true)}
                            className="font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        >
                            <Link2 className="h-4 w-4 mr-2" />
                            <span className="hidden sm:inline">Link Quote</span>
                            <span className="sm:hidden">Link</span>
                        </Button>
                        <Link href={`/shipping-calculator/new?opportunityId=${opportunity.id}&companyId=${opportunity.companyId}&customerName=${opportunity.customerName}&destinationId=${opportunity.destinationId}`}>
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 font-bold">
                                <Edit className="h-4 w-4 mr-2" />
                                <span className="hidden sm:inline">New Quote</span>
                                <span className="sm:hidden">Quote</span>
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Stage Progress Bar */}
                <Card className="shadow-sm border-gray-200 overflow-hidden hidden sm:block">
                    <StageProgressBar currentStage={opportunity.stage} />
                </Card>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Content - Left Column (2/3) */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Quotations Section */}
                        <Card className="shadow-sm border-gray-200 lg:border lg:shadow-sm border-none shadow-none">
                            <CardHeader className="lg:px-6 lg:pt-6 px-0 pt-0 pb-2">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <FileText className="h-5 w-5 text-emerald-600" />
                                    Quotations
                                </CardTitle>
                                <CardDescription className="hidden lg:block">All quotations linked to this opportunity</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6 lg:px-6 px-0 pb-0">
                                {opportunity.quotations && opportunity.quotations.length > 0 ? (
                                    opportunity.quotations.map((quote, index) => (
                                        <div key={quote.id} className="space-y-3">
                                            {opportunity.quotations && opportunity.quotations.length > 1 && (
                                                <div className="flex items-center gap-2 pb-2 border-b hidden lg:flex">
                                                    <div className="font-bold text-lg text-gray-700">Quotation #{index + 1}</div>
                                                    <div className="text-sm text-gray-400 font-mono">{quote.id}</div>
                                                </div>
                                            )}

                                            <Card className="bg-white border-gray-200 shadow-sm">
                                                <CardContent className="p-4">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div>
                                                            <div className="font-semibold text-base flex items-center gap-2">
                                                                <span className="font-mono text-gray-500 text-xs hidden lg:inline">{quote.id}</span>
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${quote.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                                                    quote.status === 'sent' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                        'bg-gray-50 text-gray-600 border-gray-200'
                                                                    }`}>
                                                                    {quote.status.toUpperCase()}
                                                                </span>
                                                                {quote.customer_user_id && (
                                                                    <span
                                                                        className="inline-flex items-center justify-center text-emerald-600"
                                                                        title="Quote originated from a customer request"
                                                                    >
                                                                        <UserCircle2 className="w-4 h-4" />
                                                                    </span>
                                                                )}
                                                                {quote.phyto_required && (
                                                                    <span
                                                                        className="inline-flex items-center justify-center text-emerald-700"
                                                                        title="Customer requested Phytosanitary service"
                                                                    >
                                                                        <Leaf className="w-4 h-4" />
                                                                    </span>
                                                                )}
                                                                {(() => {
                                                                    const comm = normalizeCommodityType(quote.commodity_type);
                                                                    const meta = COMMODITY_META[comm];
                                                                    const Icon = meta.icon;
                                                                    return (
                                                                        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold ${meta.badgeClass}`}>
                                                                            <Icon className="w-3 h-3" />
                                                                            {meta.label}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </div>
                                                            <div className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">
                                                                Created: {new Date(quote.created_at).toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' })}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xl font-black text-emerald-700">
                                                                {getQuotationPayableTotalThb(quote).toLocaleString()} <span className="text-xs font-normal text-gray-400">THB</span>
                                                            </div>
                                                            <div className="text-[10px] text-gray-400 uppercase font-black tracking-tight">Total (incl. VAT)</div>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="mt-1 h-7 px-2 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 lg:hidden"
                                                                disabled={unlinkingQuoteId === quote.id}
                                                                onClick={() => handleUnlinkQuote(quote)}
                                                            >
                                                                {unlinkingQuoteId === quote.id ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <>
                                                                        <Link2Off className="h-3 w-3 mr-1" />
                                                                        Unlink
                                                                    </>
                                                                )}
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    {/* Price Confirmation Status */}
                                                    {quote.price_confirmed ? (
                                                        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
                                                            <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                                            <span className="text-sm font-bold text-emerald-700">Price Confirmed</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border-2 border-amber-300 rounded-lg mb-4">
                                                            <div className="flex items-center gap-2">
                                                                <ShieldCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                                                <span className="text-sm font-semibold text-amber-700">Price not confirmed yet</span>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold"
                                                                onClick={() => handleConfirmPrice(quote.id)}
                                                            >
                                                                <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                                                                Confirm Price
                                                            </Button>
                                                        </div>
                                                    )}

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50/50 p-3 rounded-xl mb-4 border border-slate-100">
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between">
                                                                <span className="text-gray-500 font-medium">Freight Cost:</span>
                                                                <span className="font-black text-gray-900">{(quote.total_freight_cost || 0).toLocaleString()}</span>
                                                            </div>

                                                            {/* Additional Charges */}
                                                            {quote.additional_charges && quote.additional_charges.length > 0 && (
                                                                <div className="pt-2 border-t border-slate-200 mt-2">
                                                                    <div className="text-[9px] font-black text-gray-400 mb-1.5 uppercase tracking-widest">Additional Charges</div>
                                                                    {quote.additional_charges.map((charge, i) => (
                                                                        <div key={i} className="flex justify-between text-[11px] mb-1">
                                                                            <span className="text-gray-600 truncate mr-2 italic">{charge.description}</span>
                                                                            <span className="font-bold text-slate-800">{Number(charge.amount).toLocaleString()}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {(quote.clearance_cost || 0) > 0 && (
                                                                <div className="flex justify-between pt-1 border-t border-slate-200 mt-1">
                                                                    <span className="text-gray-500 font-medium">Clearance:</span>
                                                                    <span className="font-bold text-gray-900">{quote.clearance_cost?.toLocaleString()}</span>
                                                                </div>
                                                            )}
                                                            {(quote.delivery_cost || 0) > 0 && quote.delivery_service_required && (
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-500 font-medium">Delivery:</span>
                                                                    <span className="font-bold text-gray-900">{quote.delivery_cost?.toLocaleString()}</span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="space-y-3 sm:border-l sm:pl-4 border-slate-200">
                                                            {/* Pallet Info */}
                                                            <div>
                                                                <div className="text-[9px] font-black text-gray-400 mb-1 uppercase tracking-widest text-report-mode-essential">Pallet Details</div>
                                                                <div className="font-bold text-gray-900">
                                                                    {quote.pallets?.length || 0} Pallets
                                                                    {quote.pallets && quote.pallets.length > 0 && (
                                                                        <span className="text-slate-400 font-medium ml-1 text-[10px]">
                                                                            ({quote.pallets[0].length}x{quote.pallets[0].width}x{quote.pallets[0].height} cm)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-[10px] text-gray-500 mt-0.5 font-medium">
                                                                    Dest: <span className="text-blue-600 font-bold">{quote.destination}</span>
                                                                </div>
                                                            </div>

                                                            {/* Notes */}
                                                            {quote.notes && (
                                                                <div className="pt-1">
                                                                    <div className="text-[9px] font-black text-gray-400 mb-1 uppercase tracking-widest">Notes</div>
                                                                    <div className="text-[11px] text-gray-700 bg-amber-50/50 p-2 rounded-lg border border-amber-100/50 italic leading-relaxed">
                                                                        {quote.notes}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Attached & Missing Documents */}
                                                    <QuotationDocuments
                                                        quotationId={quote.id}
                                                        requiredDocTypes={quote.required_doc_types}
                                                        commodityType={quote.commodity_type}
                                                    />

                                                    {/* AWB & Customs Declaration - Staff Upload */}
                                                    <ShippingDocumentsUpload
                                                        quotationId={quote.id}
                                                        awbFileUrl={quote.awb_file_url}
                                                        awbFileName={quote.awb_file_name}
                                                        awbUploadedAt={quote.awb_uploaded_at}
                                                        customsDeclarationFileUrl={quote.customs_declaration_file_url}
                                                        customsDeclarationFileName={quote.customs_declaration_file_name}
                                                        customsDeclarationUploadedAt={quote.customs_declaration_uploaded_at}
                                                        storageProvider={quote.storage_provider}
                                                        onUpdate={() => fetchOpportunity()}
                                                    />

                                                    <AwbTrackingPanel
                                                        quotationId={quote.id}
                                                        awbNumber={quote.awb_number}
                                                        omgNumber={quote.quotation_no}
                                                    />

                                                    <div className="flex justify-end gap-2 mt-4 hidden lg:flex">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                                            disabled={unlinkingQuoteId === quote.id}
                                                            onClick={() => handleUnlinkQuote(quote)}
                                                        >
                                                            {unlinkingQuoteId === quote.id ? (
                                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                            ) : (
                                                                <Link2Off className="h-3.5 w-3.5 mr-1.5" />
                                                            )}
                                                            Unlink
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                            onClick={() => handleShareLink(quote.id, quote.commodity_type)}
                                                        >
                                                            <Share2 className="h-3.5 w-3.5 mr-1.5" />
                                                            Share Link
                                                        </Button>
                                                        <Link href={`/debit-note/${quote.id}`}>
                                                            <Button variant="outline" size="sm" className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50">
                                                                <Receipt className="h-3.5 w-3.5 mr-1.5" />
                                                                Debit Note
                                                            </Button>
                                                        </Link>
                                                        <Link href={`/document-comparison?quotation_id=${quote.id}&opportunity_id=${opportunity.id}`}>
                                                            <Button className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 shadow-sm">
                                                                <Eye className="h-3.5 w-3.5 mr-1.5" />
                                                                AI Review
                                                            </Button>
                                                        </Link>
                                                        <Link href={`/shipping-calculator/new?id=${quote.id}`}>
                                                            <Button variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                                                                <Edit className="h-3.5 w-3.5 mr-1.5" />
                                                                Edit
                                                            </Button>
                                                        </Link>
                                                        <Link href={`/shipping-calculator/preview?id=${quote.id}`}>
                                                            <Button variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                                                                <FileText className="h-3.5 w-3.5 mr-1.5" />
                                                                PDF
                                                            </Button>
                                                        </Link>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed">
                                        No quotations created yet.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar Info - Right Column (1/3) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6 content-start lg:space-y-6">
                        {/* Contact Widget */}
                        <div className="lg:contents">
                            <ContactWidget
                                companyName={opportunity.companyName}
                                contactPerson={opportunity.contact_person}
                                contactEmail={opportunity.contact_email}
                                contactPhone={opportunity.contact_phone}
                            />
                        </div>

                        {/* Task Management & Analysis History - Hidden on mobile report */}
                        <div className="hidden lg:block space-y-6">
                            <OpportunityTasks opportunityId={opportunity.id} />
                            <AnalysisHistory opportunityId={opportunity.id} />
                        </div>

                        <Card className="shadow-sm border-gray-200 lg:bg-white bg-slate-50/30 lg:border border-none lg:shadow-sm shadow-none">
                            <CardHeader className="pb-3 border-b border-gray-50 lg:px-6 px-0">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-gray-500">Deal Overview</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 space-y-4 text-sm lg:px-6 px-0">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-gray-500 font-medium">
                                        <Flag className="h-4 w-4" />
                                        <span>Current Stage</span>
                                    </div>
                                    <span className="font-black text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest border border-emerald-200">
                                        {opportunity.stage.replace(/_/g, ' ')}
                                    </span>
                                </div>

                                <div className="border-t border-gray-50 pt-3">
                                    <div className="flex items-center gap-2 text-gray-500 mb-2 font-medium">
                                        <Globe className="h-4 w-4" />
                                        <span>Destination</span>
                                    </div>
                                    <div className="font-bold text-slate-800 pl-6">{opportunity.destinationName || '-'}</div>
                                </div>

                                <div className="border-t border-gray-50 pt-3">
                                    <div className="flex items-center gap-2 text-gray-500 mb-2 font-medium">
                                        <Package className="h-4 w-4" />
                                        <span>Products</span>
                                    </div>
                                    <div className="font-bold text-slate-800 pl-6">
                                        {(Array.isArray(opportunity.productName) ? opportunity.productName : [opportunity.productName]).filter(Boolean).join(', ') || '-'}
                                    </div>
                                </div>

                                <div className="border-t border-gray-50 pt-3 font-medium">
                                    <div className="flex items-center gap-2 text-gray-500 mb-2">
                                        <Calendar className="h-4 w-4" />
                                        <span>Expected Close</span>
                                    </div>
                                    <div className="font-bold text-slate-800 pl-6">{new Date(opportunity.closeDate).toLocaleDateString()}</div>
                                </div>

                                {opportunity.notes && (
                                    <div className="border-t border-gray-50 pt-3">
                                        <div className="text-gray-500 mb-1 font-medium">Notes</div>
                                        <div className="bg-amber-50/50 p-3 rounded text-amber-900 text-[11px] leading-relaxed italic border border-amber-100/50">
                                            {opportunity.notes}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Link Quotation Dialog */}
            <LinkQuotationDialog
                open={linkDialogOpen}
                onOpenChange={setLinkDialogOpen}
                opportunityId={opportunity.id}
                opportunityTopic={opportunity.topic}
                onLinked={() => fetchOpportunity()}
            />
        </div>
    );
}
