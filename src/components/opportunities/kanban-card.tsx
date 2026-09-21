"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Opportunity, STAGE_COLORS, isPickupToday } from '@/types/opportunity';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GripVertical, ExternalLink, Loader2, MoreHorizontal, Edit, Trash, Plus, CheckCircle, XCircle, RotateCcw, FileText, Palette, UserCircle2, Leaf, FileCheck, BadgeCheck, Banknote, Plane, Mail, Link, Thermometer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { getQuotationPayableTotalThb } from '@/lib/db';
import { getFileUrl } from '@/lib/storage';
import { COMMODITY_META, normalizeCommodityType } from '@/lib/document-presets';

interface KanbanCardProps {
  opportunity: Opportunity;
  onEdit?: (opportunity: Opportunity) => void;
  onDelete?: (id: string) => void;
  onWinCase?: (id: string) => void;
  onLoseCase?: (id: string) => void;
  onReopenCase?: (id: string) => void;
  onRefresh?: () => void;
  /** Patch parent/board state after inline saves — avoids full refetch */
  onOpportunityPatch?: (opportunityId: string, patch: Partial<Opportunity>) => void;
}

const FOCUS_COLORS = [
  { label: 'None', value: null, class: 'bg-transparent' },
  { label: 'Blue', value: '#3b82f6', class: 'bg-blue-500' },
  { label: 'Red', value: '#ef4444', class: 'bg-red-500' },
  { label: 'Green', value: '#10b981', class: 'bg-emerald-500' },
  { label: 'Yellow', value: '#f59e0b', class: 'bg-amber-500' },
  { label: 'Purple', value: '#8b5cf6', class: 'bg-violet-500' },
  { label: 'Orange', value: '#f97316', class: 'bg-orange-500' },
];

export function KanbanCard({ opportunity, onEdit, onDelete, onWinCase, onLoseCase, onReopenCase, onRefresh, onOpportunityPatch }: KanbanCardProps) {
  // console.log(`Card ${opportunity.id}: onEdit is`, !!onEdit);
  const router = useRouter();
  const [creating] = useState(false);
  const [isUpdatingColor, setIsUpdatingColor] = useState(false);
  const [displayColor, setDisplayColor] = useState(opportunity.focusColor);
  const [phytoDone, setPhytoDone] = useState(!!opportunity.phytoDone);
  const [isUpdatingPhyto, setIsUpdatingPhyto] = useState(false);
  const [pickupDate, setPickupDate] = useState(opportunity.pickupDate || '');
  const [isUpdatingPickupDate, setIsUpdatingPickupDate] = useState(false);
  const [paymentDate, setPaymentDate] = useState(opportunity.paymentDate || '');
  const [isUpdatingPaymentDate, setIsUpdatingPaymentDate] = useState(false);
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const targetQuotation = opportunity.quotationDetails?.[0];
  const [awbNumber, setAwbNumber] = useState(targetQuotation?.awb_number || '');
  const [draftAwb, setDraftAwb] = useState('');
  const [isUpdatingAwb, setIsUpdatingAwb] = useState(false);
  const [showAwbInput, setShowAwbInput] = useState(false);
  const [isLoadingAwbFile, setIsLoadingAwbFile] = useState(false);
  const [noteHover, setNoteHover] = useState(false);
  const noteRef = useRef<HTMLDivElement>(null);
  const [notePos, setNotePos] = useState({ top: 0, left: 0, showBelow: false });
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if prop changes (e.g. from elsewhere or after refresh)
  useEffect(() => {
    setDisplayColor(opportunity.focusColor);
  }, [opportunity.focusColor]);

  useEffect(() => {
    setPhytoDone(!!opportunity.phytoDone);
  }, [opportunity.phytoDone]);

  useEffect(() => {
    setPickupDate(opportunity.pickupDate || '');
  }, [opportunity.pickupDate]);

  useEffect(() => {
    setPaymentDate(opportunity.paymentDate || '');
  }, [opportunity.paymentDate]);

  useEffect(() => {
    setAwbNumber(targetQuotation?.awb_number || '');
  }, [targetQuotation?.awb_number, targetQuotation?.id]);

  // Cleanup leave timeout on unmount
  useEffect(() => () => {
    if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
  }, []);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: opportunity.id,
    data: {
      type: 'Opportunity',
      opportunity,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleCreateQuotation = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent drag start

    // Calculate values to pass
    const params = new URLSearchParams();
    if (opportunity.id) params.set('opportunityId', opportunity.id);
    if (opportunity.productId && opportunity.productId.length > 0) params.set('productId', opportunity.productId.join(','));
    if (opportunity.companyId) params.set('companyId', opportunity.companyId);
    if (opportunity.companyName) params.set('customerName', opportunity.companyName);
    if (opportunity.destinationId) params.set('destinationId', opportunity.destinationId); // Pass destination
    // Map optional fields if they align with target form
    // Target form has 'deliveryVehicleType', 'notes'
    if (opportunity.vehicleType) params.set('deliveryVehicleType', opportunity.vehicleType);
    if (opportunity.notes) params.set('notes', opportunity.notes);

    // Navigate to existing creation page
    router.push(`/shipping-calculator/new?${params.toString()}`);
  };

  const quotationCount = opportunity.quotationIds?.length || 0;

  const handleUpdateColor = async (color: string | null) => {
    // Optimistic update
    setDisplayColor(color);

    setIsUpdatingColor(true);
    try {
      const { error } = await supabase
        .from('opportunities')
        .update({ focus_color: color })
        .eq('id', opportunity.id);

      if (error) throw error;

      toast.success('Highlight color updated');
      // We still call onRefresh to keep parent in sync, 
      // but displayColor keeps it looking instant.
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error updating color:', err);
      // Rollback on error
      setDisplayColor(opportunity.focusColor);
      toast.error('Failed to update color');
    } finally {
      setIsUpdatingColor(false);
    }
  };

  const handlePhytoChange = async (checked: boolean) => {
    const next = checked === true;
    setPhytoDone(next);
    setIsUpdatingPhyto(true);
    try {
      const { error } = await supabase
        .from('opportunities')
        .update({ phyto_done: next })
        .eq('id', opportunity.id);

      if (error) throw error;

      toast.success(next ? 'Saved: Phyto marked as done' : 'Phyto mark cleared');
      onOpportunityPatch?.(opportunity.id, { phytoDone: next });
    } catch (err) {
      console.error('Error updating phyto_done:', err);
      setPhytoDone(!!opportunity.phytoDone);
      toast.error('Could not save phyto status');
    } finally {
      setIsUpdatingPhyto(false);
    }
  };

  const handlePickupDateChange = async (date: string) => {
    setPickupDate(date);
    setIsUpdatingPickupDate(true);
    try {
      const { error } = await supabase
        .from('opportunities')
        .update({ pickup_date: date || null })
        .eq('id', opportunity.id);

      if (error) throw error;
      toast.success('Pickup date updated');
      onOpportunityPatch?.(opportunity.id, { pickupDate: date || undefined });
    } catch (err) {
      console.error('Error updating pickup date:', err);
      setPickupDate(opportunity.pickupDate || '');
      toast.error('Could not save pickup date');
    } finally {
      setIsUpdatingPickupDate(false);
    }
  };

  const handleSaveAwb = async () => {
    if (!targetQuotation?.id) return;
    const value = draftAwb.trim();
    const previous = awbNumber;
    setAwbNumber(value);
    setIsUpdatingAwb(true);
    try {
      const { error } = await supabase
        .from('quotations')
        .update({
          awb_number: value || null,
          awb_number_source: value ? 'manual' : null,
        })
        .eq('id', targetQuotation.id);
      if (error) throw error;
      toast.success(value ? 'AWB number saved' : 'AWB number cleared');
      setShowAwbInput(false);
    } catch (err) {
      console.error('Error saving AWB:', err);
      setAwbNumber(previous);
      toast.error('Could not save AWB number');
    } finally {
      setIsUpdatingAwb(false);
    }
  };

  const handleViewAwbFile = async () => {
    const path = targetQuotation?.awb_file_url;
    if (!path) return;
    setIsLoadingAwbFile(true);
    try {
      const url = path.startsWith('http') ? path : await getFileUrl(path, 'r2', 'documents');
      if (!url) throw new Error('No URL');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Error opening AWB file:', err);
      toast.error('Could not open AWB file');
    } finally {
      setIsLoadingAwbFile(false);
    }
  };

  const handlePaymentDateChange = async (date: string) => {
    setPaymentDate(date);
    setIsUpdatingPaymentDate(true);
    try {
      const { error } = await supabase
        .from('opportunities')
        .update({ payment_date: date || null })
        .eq('id', opportunity.id);

      if (error) throw error;
      toast.success(date ? 'Payment date saved' : 'Payment date cleared');
      onOpportunityPatch?.(opportunity.id, { paymentDate: date || undefined });
      if (date) {
        setShowPaymentInput(false);
      }
    } catch (err) {
      console.error('Error updating payment date:', err);
      setPaymentDate(opportunity.paymentDate || '');
      toast.error('Could not save payment date');
    } finally {
      setIsUpdatingPaymentDate(false);
    }
  };

  const quotes = opportunity.quotationDetails || [];
  const quotesWithBookingLink = quotes.filter((q) => !!q.booking_share_token);

  const handleCopyBookingLink = async (token: string) => {
    try {
      const url = `${window.location.origin}/booking/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success('Booking link copied');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const hasFromCustomer = quotes.some((q) => !!q.customer_user_id);
  const hasPhyto = quotes.some((q) => q.phyto_required);
  const hasDataLogger = quotes.some((q) => q.notes?.includes('[DATA LOGGER]'));
  const totalDocs = quotes.reduce((s, q) => s + (q.docs_count || 0), 0);
  const allPriceConfirmed = quotes.length > 0 && quotes.every((q) => q.price_confirmed);
  const commodities = Array.from(
    new Set(quotes.map((q) => normalizeCommodityType(q.commodity_type ?? undefined)))
  );

  const pickupToday = isPickupToday(opportunity);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => router.push(`/opportunities/${opportunity.id}`)}
      className="cursor-pointer active:cursor-grabbing hover:opacity-90 transition-opacity"
    >
      <Card
        data-kanban-card
        className={`premium-shadow-hover transition-all duration-300 ${opportunity.closureStatus === 'won'
          ? 'ring-2 ring-emerald-400 border-emerald-300 bg-emerald-50/30'
          : opportunity.closureStatus === 'lost'
            ? 'ring-2 ring-red-400 border-red-300 bg-red-50/30'
            : pickupToday
              ? 'ring-2 ring-amber-400 border-amber-300 bg-amber-50/60'
              : 'border-none ring-1 ring-slate-100/50'
          } relative overflow-visible pt-1.5`}>
        {/* Color Highlight Bar - Now at the Top and thicker */}
        {displayColor && (
          <div
            className="absolute left-0 top-0 right-0 h-1.5 z-10 opacity-90 shadow-sm"
            style={{ backgroundColor: displayColor }}
          />
        )}
        <CardHeader className="p-3 pb-1 flex flex-row items-start justify-between space-y-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`font-semibold px-2 py-0.5 text-xs rounded-full ${STAGE_COLORS[opportunity.stage]}`}>
              {opportunity.probability}%
            </Badge>
            {/* Won/Lost Badge */}
            {opportunity.closureStatus === 'won' && (
              <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0 h-5 font-bold">
                🏆 WON
              </Badge>
            )}
            {opportunity.closureStatus === 'lost' && (
              <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0 h-5 font-bold">
                ❌ LOST
              </Badge>
            )}
            {pickupToday && !opportunity.closureStatus && (
              <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-5 font-bold animate-pulse">
                PICKUP TODAY
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-0.5 pr-0.5">
            <div className="p-0.5 text-gray-300 cursor-grab opacity-40 hover:opacity-100 transition-opacity">
              <GripVertical className="h-3.5 w-3.5" />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-6 w-6 p-0 hover:bg-gray-100 rounded-full"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-gray-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {opportunity.closureStatus ? (
                  <DropdownMenuItem
                    className="cursor-pointer text-blue-600 focus:text-blue-600"
                    onSelect={() => {
                      if (confirm('Reopen this opportunity?')) {
                        onReopenCase?.(opportunity.id);
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reopen
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="cursor-pointer text-green-600 focus:text-green-600"
                      onSelect={() => {
                        if (confirm('Mark this opportunity as WON?')) {
                          if (onWinCase) onWinCase(opportunity.id);
                        }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Win Case
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer text-red-600 focus:text-red-600"
                      onSelect={() => {
                        if (confirm('Mark this opportunity as LOST?')) {
                          if (onLoseCase) onLoseCase(opportunity.id);
                        }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Lose Case
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => {
                    if (onEdit) onEdit(opportunity);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>

                {/* Create Email Booking — needs a linked quotation */}
                {quotes.length === 1 && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => router.push(`/email-booking/${quotes[0].id}`)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Create Email Booking
                  </DropdownMenuItem>
                )}
                {quotes.length > 1 &&
                  quotes.map((q, i) => (
                    <DropdownMenuItem
                      key={`email-${q.id}`}
                      className="cursor-pointer"
                      onSelect={() => router.push(`/email-booking/${q.id}`)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Email Booking: {q.quotation_no || `Quote #${i + 1}`}
                    </DropdownMenuItem>
                  ))}

                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 cursor-pointer"
                  onSelect={() => {
                    if (confirm('Are you sure you want to delete this opportunity?')) {
                      if (onDelete) onDelete(opportunity.id);
                    }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>

                {/* Focus Color Submenu */}
                <div className="border-t my-1"></div>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 flex items-center gap-1">
                  <Palette className="h-3 w-3" />
                  Focus Color
                </div>
                <div className="flex flex-wrap gap-1 px-2 pb-2 mr-2">
                  {FOCUS_COLORS.map((c) => (
                    <button
                      key={c.label}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateColor(c.value);
                      }}
                      className={`h-5 w-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex items-center justify-center ${c.class}`}
                      title={c.label}
                      disabled={isUpdatingColor}
                    >
                      {displayColor === c.value && (
                        <div className="h-1.5 w-1.5 bg-white rounded-full"></div>
                      )}
                    </button>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-1">
          {/* Company Name - Main Title */}
          <p className="text-sm font-bold text-blue-600 truncate">{opportunity.companyName}</p>

          {/* Topic as subtitle */}
          <h4 className="text-xs text-slate-600 line-clamp-1 mb-1">{opportunity.topic}</h4>

          {/* Amount - Auto-populate from linked quotations */}
          {(() => {
            const quotationPrices =
              opportunity.quotationDetails?.filter((q) => {
                const linePayable = getQuotationPayableTotalThb({
                  total_cost: q.total_cost ?? 0,
                  vat_amount: q.vat_amount ?? null,
                  grand_total_with_vat: null,
                  wht_amount: q.wht_amount ?? null,
                  wht_enabled: q.wht_enabled,
                });
                return linePayable > 0;
              }) || [];
            const hasQuotationPrices = quotationPrices.length > 0;
            const totalFromQuotations = hasQuotationPrices
              ? quotationPrices.reduce(
                  (sum, q) =>
                    sum +
                    getQuotationPayableTotalThb({
                      total_cost: q.total_cost ?? 0,
                      vat_amount: q.vat_amount ?? null,
                      grand_total_with_vat: null,
                      wht_amount: q.wht_amount ?? null,
                      wht_enabled: q.wht_enabled,
                    }),
                  0
                )
              : 0;
            const displayAmount = hasQuotationPrices ? totalFromQuotations : opportunity.amount;
            const showMultiBreakdown = quotationPrices.length > 1;

            return (
              <div className="relative group flex justify-between items-center text-xs mb-2">
                <span className={`font-bold ${hasQuotationPrices ? 'text-emerald-700' : 'text-gray-900'}`}>
                  {displayAmount.toLocaleString()} {opportunity.currency}
                  {showMultiBreakdown && (
                    <span className="ml-1 text-[9px] text-slate-400 font-normal">
                      ({quotationPrices.length} quotes)
                    </span>
                  )}
                </span>
                {/* Hover Tooltip for Multi-Quote Breakdown */}
                {showMultiBreakdown && (
                  <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block bg-white border border-slate-200 rounded-lg shadow-lg p-2 w-52">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Quotation Breakdown</div>
                    {quotationPrices.map((q, i) => (
                      <div key={q.id} className="flex justify-between text-[11px] py-0.5 border-b border-slate-50 last:border-none">
                        <span className="text-slate-600">{q.quotation_no || `Quote #${i + 1}`}</span>
                        <span className="font-semibold text-slate-800">
                          {getQuotationPayableTotalThb({
                            total_cost: q.total_cost ?? 0,
                            vat_amount: q.vat_amount ?? null,
                            grand_total_with_vat: null,
                            wht_amount: q.wht_amount ?? null,
                            wht_enabled: q.wht_enabled,
                          }).toLocaleString()}{' '}
                          THB
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between text-[11px] pt-1 mt-1 border-t border-slate-200 font-bold">
                      <span>Total</span>
                      <span className="text-emerald-700">{totalFromQuotations.toLocaleString()} THB</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {quotes.length > 0 && (
            <div
              className="flex items-center gap-1.5 mb-1.5 flex-wrap"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {quotes.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                  onClick={() => router.push(`/shipping-calculator/preview?id=${q.id}`)}
                  title="View quotation"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[120px]">{q.quotation_no || `Quote #${i + 1}`}</span>
                </button>
              ))}
              {quotesWithBookingLink.map((q, i) => (
                <button
                  key={`booking-${q.id}`}
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors"
                  onClick={() => handleCopyBookingLink(q.booking_share_token!)}
                  title="Copy booking link"
                >
                  <Link className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[120px]">
                    {quotesWithBookingLink.length > 1
                      ? `Booking: ${q.quotation_no || `Quote #${i + 1}`}`
                      : 'Booking Link'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {quotes.length > 0 && (
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {hasFromCustomer && (
                <span title="From customer request" className="inline-flex items-center text-emerald-600">
                  <UserCircle2 className="w-3.5 h-3.5" />
                </span>
              )}
              {hasPhyto && (
                <span title="Phytosanitary service requested" className="inline-flex items-center text-emerald-700">
                  <Leaf className="w-3.5 h-3.5" />
                </span>
              )}
              {hasDataLogger && (
                <span title="Data logger attached (MSDS)" className="inline-flex items-center text-sky-600">
                  <Thermometer className="w-3.5 h-3.5" />
                </span>
              )}
              {totalDocs > 0 && (
                <span
                  title={`${totalDocs} document${totalDocs > 1 ? 's' : ''} uploaded`}
                  className="inline-flex items-center gap-0.5 text-blue-600"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold">{totalDocs}</span>
                </span>
              )}
              {allPriceConfirmed && (
                <span title="Price confirmed by customer" className="inline-flex items-center text-violet-600">
                  <BadgeCheck className="w-3.5 h-3.5" />
                </span>
              )}
              {commodities.map((c) => {
                const meta = COMMODITY_META[c];
                const Icon = meta.icon;
                return (
                  <span
                    key={c}
                    title={meta.label}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full border text-[9px] font-bold ${meta.badgeClass}`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}

          <div
            className="flex items-center gap-2 mb-2"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              id={`phyto-${opportunity.id}`}
              checked={phytoDone}
              disabled={isUpdatingPhyto}
              onCheckedChange={(v) => handlePhytoChange(v === true)}
              className="border-emerald-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
            />
            <Label
              htmlFor={`phyto-${opportunity.id}`}
              className="text-[10px] font-semibold text-slate-600 cursor-pointer leading-tight mb-0"
            >
              Phyto done
            </Label>
          </div>

          {/* Pickup Date Field - Editable on 'waiting_for_pickup', read-only display on other stages */}
          {opportunity.stage === 'waiting_for_pickup' ? (
            <div
              className="mt-1 mb-2 p-1.5 bg-emerald-50/50 border border-emerald-100 rounded-md"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Label htmlFor={`pickup-${opportunity.id}`} className="text-[10px] uppercase font-bold text-emerald-800 mb-1 block">
                Pickup Date
              </Label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  id={`pickup-${opportunity.id}`}
                  className="bg-white border border-emerald-200 rounded px-1.5 py-0.5 text-[10px] w-full focus:ring-1 focus:ring-emerald-500 outline-none"
                  value={pickupDate}
                  onChange={(e) => handlePickupDateChange(e.target.value)}
                />
                {isUpdatingPickupDate && <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />}
              </div>
            </div>
          ) : pickupDate ? (
            <div className="mt-1 mb-2 flex items-center gap-1.5 text-[10px] bg-emerald-50/50 border border-emerald-100 rounded-md px-2 py-1">
              <span className="font-bold text-emerald-800 uppercase">Pickup:</span>
              <span className="text-emerald-700 font-semibold">
                {new Date(pickupDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          ) : null}

          {/* Payment Date - available on all stages */}
          <div
            className="mt-1 mb-2"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {paymentDate && !showPaymentInput ? (
              <button
                type="button"
                className="w-full flex items-center gap-1.5 text-[10px] bg-emerald-50/50 border border-emerald-100 rounded-md px-2 py-1 hover:bg-emerald-100/60 transition-colors text-left"
                onClick={() => setShowPaymentInput(true)}
              >
                <span className="font-bold text-emerald-800 uppercase">Paid:</span>
                <span className="text-emerald-700 font-semibold">
                  {new Date(paymentDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </button>
            ) : showPaymentInput ? (
              <div className="p-1.5 bg-amber-50/50 border border-amber-100 rounded-md">
                <Label htmlFor={`payment-${opportunity.id}`} className="text-[10px] uppercase font-bold text-amber-800 mb-1 block">
                  Payment Date
                </Label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    id={`payment-${opportunity.id}`}
                    className="bg-white border border-amber-200 rounded px-1.5 py-0.5 text-[10px] w-full focus:ring-1 focus:ring-amber-500 outline-none"
                    value={paymentDate}
                    onChange={(e) => handlePaymentDateChange(e.target.value)}
                  />
                  {isUpdatingPaymentDate && <Loader2 className="h-3 w-3 animate-spin text-amber-600 shrink-0" />}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    className="text-[10px] text-amber-700 hover:text-amber-900 underline"
                    onClick={() => handlePaymentDateChange('')}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-gray-500 hover:text-gray-700"
                    onClick={() => setShowPaymentInput(false)}
                    disabled={isUpdatingPaymentDate}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full h-7 text-[10px] font-bold bg-amber-50/50 border-amber-200 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                onClick={() => setShowPaymentInput(true)}
              >
                <Banknote className="h-3 w-3 mr-1" />
                Pending Payment
              </Button>
            )}
          </div>

          {/* AWB number — first linked quotation */}
          {targetQuotation && (
            <div
              className="mt-1 mb-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {awbNumber && !showAwbInput ? (
                <div className="w-full flex items-center gap-1.5 text-[10px] bg-orange-50/80 border border-orange-200 rounded-md px-2 py-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 min-w-0 flex-1 hover:opacity-80 transition-opacity text-left"
                    onClick={() => {
                      setDraftAwb(awbNumber);
                      setShowAwbInput(true);
                    }}
                    title="Edit AWB number"
                  >
                    <Plane className="h-3 w-3 text-orange-700 shrink-0" />
                    <span className="font-bold text-orange-800 uppercase">AWB:</span>
                    <span className="text-orange-900 font-semibold truncate">{awbNumber}</span>
                  </button>
                  {targetQuotation.awb_file_url && (
                    <button
                      type="button"
                      className="ml-auto shrink-0 flex items-center gap-0.5 font-semibold text-orange-700 hover:text-orange-900 disabled:opacity-50"
                      onClick={handleViewAwbFile}
                      disabled={isLoadingAwbFile}
                      title="View AWB file"
                    >
                      {isLoadingAwbFile ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      <span>View</span>
                    </button>
                  )}
                </div>
              ) : showAwbInput ? (
                <div className="p-1.5 bg-orange-50/80 border border-orange-200 rounded-md">
                  <Label htmlFor={`awb-${opportunity.id}`} className="text-[10px] uppercase font-bold text-orange-800 mb-1 block">
                    AWB Number
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      id={`awb-${opportunity.id}`}
                      placeholder="e.g. 123-45678901"
                      className="bg-white border border-orange-200 rounded px-1.5 py-0.5 text-[10px] w-full focus:ring-1 focus:ring-orange-500 outline-none"
                      value={draftAwb}
                      onChange={(e) => setDraftAwb(e.target.value)}
                      disabled={isUpdatingAwb}
                    />
                    {isUpdatingAwb && <Loader2 className="h-3 w-3 animate-spin text-orange-600 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-orange-800 hover:text-orange-950"
                      onClick={handleSaveAwb}
                      disabled={isUpdatingAwb}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-gray-500 hover:text-gray-700"
                      onClick={() => setShowAwbInput(false)}
                      disabled={isUpdatingAwb}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 h-7 text-[10px] font-bold bg-orange-50/50 border-orange-200 text-orange-800 hover:bg-orange-100 hover:text-orange-900"
                    onClick={() => {
                      setDraftAwb('');
                      setShowAwbInput(true);
                    }}
                  >
                    <Plane className="h-3 w-3 mr-1" />
                    Add AWB
                  </Button>
                  {targetQuotation.awb_file_url && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] font-semibold bg-orange-50/50 border-orange-200 text-orange-700 hover:bg-orange-100 hover:text-orange-900"
                      onClick={handleViewAwbFile}
                      disabled={isLoadingAwbFile}
                      title="View AWB file"
                    >
                      {isLoadingAwbFile ? (
                        <Loader2 className="h-3 w-3" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Compact Details - Only show key info */}
          <div className="space-y-0.5 mb-2 text-xs">
            {targetQuotation?.consignee_name && (
              <div className="flex items-center gap-1 text-slate-700 truncate">
                <UserCircle2 className="h-3 w-3 shrink-0 text-slate-500" />
                <span className="font-medium">Consignee:</span>
                <span className="truncate">{targetQuotation.consignee_name}</span>
              </div>
            )}
            {opportunity.destinationName && (
              <div className="text-blue-700 font-medium truncate">
                📍 {opportunity.destinationName}
              </div>
            )}
            {opportunity.productDetails && (
              <div className="text-gray-600 line-clamp-1">
                📦 {opportunity.productDetails}
              </div>
            )}
            {opportunity.notes && (
              <div
                ref={noteRef}
                className="relative"
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  if (leaveTimeoutRef.current) {
                    clearTimeout(leaveTimeoutRef.current);
                    leaveTimeoutRef.current = null;
                  }
                  const rect = noteRef.current?.getBoundingClientRect();
                  if (rect) {
                    const showBelow = rect.top < 200;
                    setNotePos({
                      top: showBelow ? rect.bottom + 4 : rect.top - 4,
                      left: rect.left,
                      showBelow,
                    });
                  }
                  setNoteHover(true);
                }}
                onMouseLeave={() => {
                  leaveTimeoutRef.current = setTimeout(() => setNoteHover(false), 150);
                }}
              >
                <div className="text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 line-clamp-2 mt-1">
                  📝 {opportunity.notes}
                </div>
                {noteHover &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      className="fixed z-[9999] w-72 max-h-60 overflow-y-auto p-3 rounded-lg shadow-lg border border-amber-200 bg-white text-sm text-amber-900 whitespace-pre-wrap"
                      style={{
                        left: notePos.left,
                        top: notePos.top,
                        transform: notePos.showBelow ? undefined : 'translateY(-100%)',
                      }}
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        if (leaveTimeoutRef.current) {
                          clearTimeout(leaveTimeoutRef.current);
                          leaveTimeoutRef.current = null;
                        }
                        setNoteHover(true);
                      }}
                      onMouseLeave={() => {
                        leaveTimeoutRef.current = setTimeout(() => setNoteHover(false), 150);
                      }}
                    >
                      📝 {opportunity.notes}
                    </div>,
                    document.body
                  )}
              </div>
            )}
          </div>

          {/* Product Tags - Compact */}
          {opportunity.productName && opportunity.productName.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {opportunity.productName.slice(0, 2).map((name, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded border border-emerald-100">
                  {name}
                </span>
              ))}
              {opportunity.productName.length > 2 && (
                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded">
                  +{opportunity.productName.length - 2}
                </span>
              )}
            </div>
          )}

          {/* Action Buttons - Support Multiple Quotations */}
          <div className="flex gap-1">
            {quotationCount > 0 ? (
              <>
                {/* View Quotations Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs bg-green-50 text-green-700 hover:bg-green-100 border-green-200"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FileText className="mr-1 h-3 w-3" />
                      {quotationCount} Quotation{quotationCount > 1 ? 's' : ''}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {quotes.map((q, index) => (
                      <DropdownMenuItem
                        key={q.id}
                        className="cursor-pointer text-xs"
                        onSelect={() => router.push(`/shipping-calculator/preview?id=${q.id}`)}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="mr-2 h-3 w-3" />
                        {q.quotation_no || `Quote #${index + 1}`}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Add New Quotation Button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-200"
                  onClick={handleCreateQuotation}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={creating}
                  title="Add New Quotation"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 border-none shadow-sm"
                onClick={handleCreateQuotation}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3 w-3" />
                )}
                {creating ? 'Processing...' : 'Generate Quotation'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
