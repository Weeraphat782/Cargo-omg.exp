"use client";

import React, { useEffect, useState } from 'react';
import { Opportunity, STAGE_LABELS, STAGE_COLORS, isPickupToday } from '@/types/opportunity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { usePagination } from '@/hooks/use-pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Edit,
  Trash,
  CheckCircle,
  XCircle,
  RotateCcw,
  FileText,
  ExternalLink,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getFileUrl } from '@/lib/storage';
import { toast } from 'sonner';
import { DatePickerField } from '@/components/ui/date-picker-field';

interface ListViewProps {
  opportunities: Opportunity[];
  onEdit?: (opportunity: Opportunity) => void;
  onDelete?: (id: string) => void;
  onWinCase?: (id: string) => void;
  onLoseCase?: (id: string) => void;
  onReopenCase?: (id: string) => void;
  onRefresh?: () => void;
  onOpportunityPatch?: (opportunityId: string, patch: Partial<Opportunity>) => void;
}

/** Inline editable date cell (payment / pickup) using a DD/MM/YYYY calendar picker */
function EditableDateCell({
  opportunityId,
  initial,
  column,
  successLabel,
  onOpportunityPatch,
}: {
  opportunityId: string;
  initial: string;
  column: 'payment_date' | 'pickup_date';
  successLabel: string;
  onOpportunityPatch?: (opportunityId: string, patch: Partial<Opportunity>) => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const commit = async (date: string) => {
    const previous = value;
    setValue(date);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('opportunities')
        .update({ [column]: date || null })
        .eq('id', opportunityId);
      if (error) throw error;
      toast.success(date ? `${successLabel} saved` : `${successLabel} cleared`);
      onOpportunityPatch?.(opportunityId, {
        ...(column === 'pickup_date'
          ? { pickupDate: date || undefined }
          : { paymentDate: date || undefined }),
      });
    } catch (err) {
      console.error(`Error updating ${column}:`, err);
      setValue(previous);
      toast.error(`Could not save ${successLabel.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <DatePickerField value={value} onChange={commit} disabled={saving} />
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
    </div>
  );
}

/** Inline AWB editor + view file — saves to the first linked quotation */
function AwbCell({ opp }: { opp: Opportunity }) {
  const target = opp.quotationDetails?.[0];
  const [awb, setAwb] = useState(target?.awb_number || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    setAwb(target?.awb_number || '');
  }, [target?.awb_number]);

  if (!target?.id) {
    return <span className="text-xs text-gray-400 italic">—</span>;
  }

  const save = async () => {
    const value = draft.trim();
    const previous = awb;
    setAwb(value);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('quotations')
        .update({
          awb_number: value || null,
          awb_number_source: value ? 'manual' : null,
        })
        .eq('id', target.id);
      if (error) throw error;
      toast.success(value ? 'AWB number saved' : 'AWB number cleared');
      setEditing(false);
    } catch (err) {
      console.error('Error saving AWB:', err);
      setAwb(previous);
      toast.error('Could not save AWB number');
    } finally {
      setSaving(false);
    }
  };

  const viewFile = async () => {
    const path = target.awb_file_url;
    if (!path) return;
    setLoadingFile(true);
    try {
      const url = path.startsWith('http') ? path : await getFileUrl(path, 'r2', 'documents');
      if (!url) throw new Error('No URL');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Error opening AWB file:', err);
      toast.error('Could not open AWB file');
    } finally {
      setLoadingFile(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="AWB no."
          className="h-7 w-[120px] rounded border border-gray-200 px-1.5 text-xs focus:border-blue-400 focus:outline-none"
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {awb ? (
        <button
          type="button"
          onClick={() => {
            setDraft(awb);
            setEditing(true);
          }}
          title="Edit AWB number"
          className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 border border-indigo-100"
        >
          {awb}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setEditing(true);
          }}
          className="flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
        >
          <Plus className="h-3 w-3" /> AWB
        </button>
      )}
      {target.awb_file_url && (
        <button
          type="button"
          onClick={viewFile}
          title="View AWB file"
          className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800"
        >
          {loadingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

/** Clickable quotation-number chips that open the preview */
function QuoteChips({ opp }: { opp: Opportunity }) {
  const router = useRouter();
  const details = opp.quotationDetails || [];

  if (details.length === 0) {
    return <span className="text-xs text-gray-400 italic">No quotes</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {details.map((q, index) => (
        <button
          key={q.id}
          type="button"
          onClick={() => router.push(`/shipping-calculator/preview?id=${q.id}`)}
          title="Open quotation preview"
          className="flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-xs font-bold text-green-700 hover:bg-green-100 border border-green-200"
        >
          <ExternalLink className="h-3 w-3" />
          {q.quotation_no || `Quote ${index + 1}`}
        </button>
      ))}
    </div>
  );
}

export function ListView({ opportunities, onEdit, onDelete, onWinCase, onLoseCase, onReopenCase, onOpportunityPatch }: ListViewProps) {
  const router = useRouter();
  const pager = usePagination(
    'opportunities',
    opportunities,
    [opportunities.map((o) => o.id).join(',')],
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-4">
      {/* Desktop Table - Hidden on Mobile */}
      <div className="hidden md:block rounded-md border bg-white overflow-x-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-[50px]">Status</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-center">Prob.</TableHead>
              <TableHead>Close Date</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Pickup</TableHead>
              <TableHead>AWB</TableHead>
              <TableHead>Quotations</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opportunities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-gray-500">
                  No opportunities found
                </TableCell>
              </TableRow>
            ) : (
              pager.items.map((opp) => (
                <TableRow
                  key={opp.id}
                  className={`hover:bg-slate-50 transition-colors cursor-pointer ${opp.closureStatus === 'won'
                      ? 'bg-emerald-50/50'
                      : opp.closureStatus === 'lost'
                        ? 'bg-red-50/50'
                        : isPickupToday(opp)
                          ? 'bg-amber-50'
                          : ''
                    }`}
                  onClick={() => router.push(`/opportunities/${opp.id}`)}
                >
                  {/* Status Badge */}
                  <TableCell>
                    {opp.closureStatus === 'won' && (
                      <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0">
                        🏆 WON
                      </Badge>
                    )}
                    {opp.closureStatus === 'lost' && (
                      <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">
                        ❌ LOST
                      </Badge>
                    )}
                    {!opp.closureStatus && (
                      <span className="text-xs text-gray-400">Active</span>
                    )}
                  </TableCell>

                  {/* Company */}
                  <TableCell className="font-medium text-blue-600">
                    {opp.companyName}
                  </TableCell>

                  {/* Topic */}
                  <TableCell className="max-w-[200px]">
                    <span className="truncate block font-semibold text-gray-900" title={opp.topic}>
                      {opp.topic}
                    </span>
                  </TableCell>

                  {/* Destination */}
                  <TableCell className="text-sm">
                    {opp.destinationName || '-'}
                  </TableCell>

                  {/* Amount */}
                  <TableCell className="text-right font-semibold">
                    {opp.amount.toLocaleString()} {opp.currency}
                  </TableCell>

                  {/* Stage */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold uppercase tracking-wider ${STAGE_COLORS[opp.stage]}`}
                    >
                      {STAGE_LABELS[opp.stage]}
                    </Badge>
                  </TableCell>

                  {/* Probability */}
                  <TableCell className="text-center">
                    <span className={`text-sm font-medium ${opp.probability >= 70 ? 'text-emerald-600' :
                        opp.probability >= 40 ? 'text-amber-600' :
                          'text-gray-500'
                      }`}>
                      {opp.probability}%
                    </span>
                  </TableCell>

                  {/* Close Date */}
                  <TableCell className="text-sm text-gray-600">
                    {formatDate(opp.closeDate)}
                  </TableCell>

                  {/* Payment Date (editable) */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="align-middle">
                    <EditableDateCell
                      opportunityId={opp.id}
                      initial={opp.paymentDate || ''}
                      column="payment_date"
                      successLabel="Payment date"
                      onOpportunityPatch={onOpportunityPatch}
                    />
                  </TableCell>

                  {/* Pickup Date (editable) */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="align-middle">
                    <EditableDateCell
                      opportunityId={opp.id}
                      initial={opp.pickupDate || ''}
                      column="pickup_date"
                      successLabel="Pickup date"
                      onOpportunityPatch={onOpportunityPatch}
                    />
                  </TableCell>

                  {/* AWB (editable + view file) */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="align-middle">
                    <AwbCell opp={opp} />
                  </TableCell>

                  {/* Quotations */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="align-middle">
                    <QuoteChips opp={opp} />
                  </TableCell>

                  {/* Actions */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!opp.closureStatus && (
                          <>
                            <DropdownMenuItem
                              className="cursor-pointer text-green-600 focus:text-green-600"
                              onClick={() => {
                                if (confirm('Mark this opportunity as WON?')) {
                                  onWinCase?.(opp.id);
                                }
                              }}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Win Case
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="cursor-pointer text-red-600 focus:text-red-600"
                              onClick={() => {
                                if (confirm('Mark this opportunity as LOST?')) {
                                  onLoseCase?.(opp.id);
                                }
                              }}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Lose Case
                            </DropdownMenuItem>
                          </>
                        )}
                        {opp.closureStatus && (
                          <DropdownMenuItem
                            className="cursor-pointer text-blue-600 focus:text-blue-600"
                            onClick={() => {
                              if (confirm('Reopen this opportunity?')) {
                                onReopenCase?.(opp.id);
                              }
                            }}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Reopen
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => onEdit?.(opp)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer text-red-600 focus:text-red-600"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this opportunity?')) {
                              onDelete?.(opp.id);
                            }
                          }}
                        >
                          <Trash className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination pager={pager} />
      </div>

      {/* Mobile Card View - Visible on Mobile */}
      <div className="md:hidden space-y-3">
        {opportunities.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-dashed text-gray-500">
            No opportunities found
          </div>
        ) : (
          pager.items.map((opp) => (
            <div
              key={opp.id}
              className={`p-4 rounded-xl border bg-white shadow-sm transition-all active:scale-[0.98] ${opp.closureStatus === 'won'
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : opp.closureStatus === 'lost'
                    ? 'border-red-200 bg-red-50/20'
                    : isPickupToday(opp)
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-slate-200'
                }`}
              onClick={() => router.push(`/opportunities/${opp.id}`)}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-blue-600 truncate max-w-[150px]">{opp.companyName}</span>
                  <h3 className="font-bold text-gray-900 line-clamp-2 mt-0.5">{opp.topic}</h3>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge
                    variant="outline"
                    className={`text-[9px] font-black uppercase px-2 py-0 border-2 ${STAGE_COLORS[opp.stage]}`}
                  >
                    {STAGE_LABELS[opp.stage]}
                  </Badge>
                  {opp.closureStatus && (
                    <Badge className={`${opp.closureStatus === 'won' ? 'bg-emerald-500' : 'bg-red-500'} text-white text-[9px] px-1.5 py-0`}>
                      {opp.closureStatus.toUpperCase()}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-3 gap-x-1 border-t border-slate-100 pt-3">
                <div>
                  <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-tight">Destination</span>
                  <span className="text-xs font-medium text-gray-700">{opp.destinationName || '-'}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-tight">Amount</span>
                  <span className="text-sm font-black text-slate-800">{opp.amount.toLocaleString()} <span className="text-[10px] font-normal">{opp.currency}</span></span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-tight">Probability</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${opp.probability >= 70 ? 'bg-emerald-500' : opp.probability >= 40 ? 'bg-amber-500' : 'bg-slate-400'}`}
                        style={{ width: `${opp.probability}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-600">{opp.probability}%</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-tight">Quotations</span>
                  <div className="flex justify-end mt-0.5" onClick={(e) => e.stopPropagation()}>
                    <QuoteChips opp={opp} />
                  </div>
                </div>
              </div>

              {/* Mobile editable fields */}
              <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">Payment</span>
                  <EditableDateCell
                    opportunityId={opp.id}
                    initial={opp.paymentDate || ''}
                    column="payment_date"
                    successLabel="Payment date"
                    onOpportunityPatch={onOpportunityPatch}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">Pickup</span>
                  <EditableDateCell
                    opportunityId={opp.id}
                    initial={opp.pickupDate || ''}
                    column="pickup_date"
                    successLabel="Pickup date"
                    onOpportunityPatch={onOpportunityPatch}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">AWB</span>
                  <AwbCell opp={opp} />
                </div>
              </div>

              {/* Mobile Actions Link */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] text-blue-500 font-bold flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-full">
                  Tap to view details <ExternalLink className="h-2.5 w-2.5" />
                </span>
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-100">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {opp.closureStatus && (
                        <DropdownMenuItem
                          className="text-blue-600 focus:text-blue-600"
                          onClick={() => {
                            if (confirm('Reopen this opportunity?')) {
                              onReopenCase?.(opp.id);
                            }
                          }}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Reopen
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onEdit?.(opp)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => onDelete?.(opp.id)}>
                        <Trash className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="md:hidden">
        <Pagination pager={pager} />
      </div>
    </div>
  );
}
