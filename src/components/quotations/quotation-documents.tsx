"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getDocumentSubmissions, deleteDocumentSubmission, DocumentSubmission } from '@/lib/db';
import { resolveDocumentFileUrl } from '@/lib/storage';
import {
    COMMODITY_META,
    getDocumentCategories,
    countPresetTypes,
    normalizeCommodityType,
    type CommodityType,
} from '@/lib/document-presets';
import { FileText, ExternalLink, Loader2, File, CheckCircle, Trash2, AlertTriangle } from 'lucide-react';
import { SwapDocumentsDialog, swapApiFetch } from './swap-documents-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { InternalUploadDialog } from './internal-upload-dialog';
import { toast } from 'sonner';

export type QuotationDocsSwapInfo = {
    docs_swapped_at?: string | null;
    docs_swapped_with?: string | null;
    docs_swap_checked_at?: string | null;
};

interface QuotationDocumentsProps {
    quotationId: string;
    quotationNo?: string | null;
    requiredDocTypes?: string[] | null;
    commodityType?: CommodityType | string | null;
    swapInfo?: QuotationDocsSwapInfo | null;
    onUpdate?: () => void;
}

export function QuotationDocuments({
    quotationId,
    quotationNo,
    requiredDocTypes,
    commodityType: commodityTypeProp,
    swapInfo,
    onUpdate,
}: QuotationDocumentsProps) {
    const [documents, setDocuments] = useState<DocumentSubmission[]>([]);
    const [loading, setLoading] = useState(true);
    const [includeMsds, setIncludeMsds] = useState(false);
    const [openingDocId, setOpeningDocId] = useState<string | null>(null);
    const [markingChecked, setMarkingChecked] = useState(false);

    const swapPending =
        Boolean(swapInfo?.docs_swapped_at) && !swapInfo?.docs_swap_checked_at;

    const formatSwapDate = (iso: string) =>
        new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    const handleMarkSwapChecked = async () => {
        setMarkingChecked(true);
        try {
            const res = await swapApiFetch({
                method: 'PATCH',
                body: JSON.stringify({ quotationId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.error || 'Could not mark as checked');
                return;
            }
            toast.success('Marked as checked');
            onUpdate?.();
        } catch {
            toast.error('Could not mark as checked');
        } finally {
            setMarkingChecked(false);
        }
    };

    const commodityType = normalizeCommodityType(commodityTypeProp ?? undefined);

    const docCategories = useMemo(
        () => getDocumentCategories(commodityType, includeMsds),
        [commodityType, includeMsds]
    );

    const totalPresetTypes = useMemo(
        () => countPresetTypes(commodityType, includeMsds),
        [commodityType, includeMsds]
    );

    const fetchDocuments = useCallback(async () => {
        setLoading(true);
        try {
            const docs = await getDocumentSubmissions(quotationId);
            if (docs && docs.length > 0) {
                setDocuments(docs);

                const hasMsds = docs.some((d) =>
                    (d.document_type || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'msds'
                );
                if (hasMsds) setIncludeMsds(true);
            } else {
                setDocuments([]);
            }
        } catch (error) {
            console.error("Error fetching documents:", error);
        } finally {
            setLoading(false);
        }
    }, [quotationId]);

    useEffect(() => {
        if (quotationId) {
            fetchDocuments();
        }
    }, [quotationId, fetchDocuments]);

    const openDocument = async (doc: DocumentSubmission) => {
        setOpeningDocId(doc.id);
        try {
            const url = await resolveDocumentFileUrl({
                file_path: doc.file_path,
                file_url: doc.file_url,
                storage_provider: doc.storage_provider || 'r2',
            });
            if (!url) {
                toast.error('Could not open document');
                return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch {
            toast.error('Failed to open document');
        } finally {
            setOpeningDocId(null);
        }
    };

    const handleDelete = async (docId: string, fileName: string) => {
        if (!confirm(`Are you sure you want to delete "${fileName}"?`)) return;

        try {
            const success = await deleteDocumentSubmission(docId);
            if (success) {
                toast.success('Document deleted');
                fetchDocuments();
            } else {
                toast.error('Failed to delete document');
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast.error('An error occurred');
        }
    };

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (loading) {
        return (
            <div className="p-2 text-xs text-gray-400 flex items-center">
                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                Loading documents...
            </div>
        );
    }

    const uploadedTypesNormalized = documents.map(d => normalize(d.document_type || ''));

    const processedCategories = docCategories.map(cat => {
        const types = cat.types.map(type => {
            const isUploaded = uploadedTypesNormalized.some((upType) => upType === normalize(type.id));
            return { ...type, isUploaded };
        });
        const matchedCount = types.filter(t => t.isUploaded).length;
        const isRequired = requiredDocTypes && requiredDocTypes.some(req =>
            cat.types.some(t => normalize(t.id) === normalize(req))
        );
        return { ...cat, types, matchedCount, isRequired };
    });

    const totalMatched = processedCategories.reduce((sum, cat) => sum + cat.matchedCount, 0);

    const formatDocName = (id: string, name?: string) => {
        const docId = id.toLowerCase();
        if (docId === 'commercial-invoice') return 'IV';
        if (docId === 'packing-list') return 'PL';
        if (docId === 'coa') return 'COA';
        if (docId === 'id-card-copy') return 'ID Card';
        if (docId === 'company-registration') return 'Company Reg';

        if (docId.startsWith('tk-')) {
            const baseName = (name || docId).toUpperCase().replace('-ENG', '').replace(' (ENG)', '').replace('TK-', 'TK ');
            return docId.endsWith('-eng') ? `${baseName} (EN)` : `${baseName} (TH)`;
        }

        return name || id;
    };

    return (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            {swapPending && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex gap-2 min-w-0 flex-1">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-950 leading-relaxed">
                            <p className="font-bold uppercase tracking-wide text-amber-800 mb-1">
                                Documents swapped — please verify
                            </p>
                            <p>
                                Exchanged with <strong>{swapInfo?.docs_swapped_with || 'another OMG'}</strong>
                                {swapInfo?.docs_swapped_at ? ` on ${formatSwapDate(swapInfo.docs_swapped_at)}` : ''}.
                                Check weight, Proforma, and run AI Review again.
                            </p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        className="shrink-0 bg-amber-700 hover:bg-amber-800"
                        disabled={markingChecked}
                        onClick={handleMarkSwapChecked}
                    >
                        {markingChecked ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Checked'}
                    </Button>
                </div>
            )}
            {swapInfo?.docs_swapped_at && swapInfo.docs_swap_checked_at && (
                <p className="text-[10px] text-slate-500">
                    Swapped with {swapInfo.docs_swapped_with || 'another OMG'} · checked{' '}
                    {formatSwapDate(swapInfo.docs_swap_checked_at)}
                </p>
            )}
            <div className="bg-slate-900 text-white rounded-xl p-3 shadow-lg flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0 shadow-inner">
                        <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 leading-none">Audit Status</h4>
                        <p className="text-[9px] text-slate-400 font-bold mt-1.5 uppercase tracking-tighter">
                            {totalMatched} / {totalPresetTypes} Matched · {COMMODITY_META[commodityType].label}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex gap-1 bg-white/5 p-1.5 rounded-full border border-white/10">
                        {processedCategories.map((cat) => (
                            <div
                                key={cat.id}
                                className={`h-1.5 w-1.5 rounded-full transition-all duration-500 ${cat.matchedCount > 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`}
                            />
                        ))}
                    </div>
                    <SwapDocumentsDialog
                        quotationId={quotationId}
                        quotationNo={quotationNo}
                        onSuccess={() => {
                            fetchDocuments();
                            onUpdate?.();
                        }}
                    />
                    <InternalUploadDialog
                        quotationId={quotationId}
                        companyName="Internal Upload"
                        commodityType={commodityType}
                        includeMsds={includeMsds}
                        onUploadSuccess={fetchDocuments}
                    />
                </div>
            </div>

            <div className="space-y-2">
                {processedCategories.map(cat => {
                    const missingInCat = cat.types.filter(t => !t.isUploaded);
                    const isFullyUploaded = missingInCat.length === 0;

                    if (isFullyUploaded && documents.length > 5) return null;

                    return (
                        <div key={cat.id} className={`bg-white border rounded-xl p-3 shadow-sm transition-all ${isFullyUploaded ? 'border-emerald-100 bg-emerald-50/10' : 'border-slate-200'}`}>
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <div className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-50 shrink-0">
                                    {isFullyUploaded ? (
                                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                                    ) : (
                                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                                    )}
                                </div>
                                <span className="flex-1 text-xs font-black uppercase tracking-tight text-slate-900 leading-tight">
                                    {cat.name}
                                </span>
                                {cat.id === 'shipping-docs' && COMMODITY_META[commodityType].supportsMsds && (
                                    <div className="flex items-center gap-2 ml-auto">
                                        <Checkbox
                                            id={`msds-toggle-${quotationId}`}
                                            checked={includeMsds}
                                            onCheckedChange={(checked) => setIncludeMsds(checked === true)}
                                        />
                                        <Label
                                            htmlFor={`msds-toggle-${quotationId}`}
                                            className="text-[10px] font-bold text-slate-600 cursor-pointer whitespace-nowrap"
                                        >
                                            Has Data Logger (attach MSDS)
                                        </Label>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-1.5 ml-1">
                                {cat.types.map(type => (
                                    <div
                                        key={type.id}
                                        className={`px-2 py-1 rounded-md text-[9px] font-black border tracking-tighter uppercase transition-all ${type.isUploaded
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm'
                                            : 'bg-red-50 text-red-700 border-red-100'
                                            }`}
                                    >
                                        {formatDocName(type.id, type.name)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {documents.length > 0 && (
                <div className="pt-3">
                    <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                        <h5 className="text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center">
                            <File className="h-4 w-4 mr-2 text-emerald-600" />
                            Verified Files ({documents.length})
                        </h5>
                    </div>
                    <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {documents.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:shadow-md transition-all group overflow-hidden">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-emerald-50 transition-colors">
                                        <FileText className="h-4 w-4 text-slate-600 group-hover:text-emerald-600" />
                                    </div>
                                    <span className="text-[10px] font-black text-slate-900 truncate uppercase mt-0.5" title={doc.document_type}>
                                        {formatDocName(doc.document_type || 'file')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 ml-1 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-full border border-transparent hover:border-emerald-100"
                                        disabled={openingDocId === doc.id}
                                        onClick={() => openDocument(doc)}
                                    >
                                        {openingDocId === doc.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-full"
                                        onClick={() => handleDelete(doc.id, doc.file_name)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

