"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  UserCircle2,
  Leaf,
  Thermometer,
  FileCheck,
  BadgeCheck,
  FileText,
  Truck,
  MapPin,
  Pencil,
  ExternalLink,
} from 'lucide-react';
import {
  Opportunity,
  OpportunityStage,
  STAGE_COLORS,
  STAGE_LABELS,
  isPickupToday,
} from '@/types/opportunity';
import { getQuotationPayableTotalThb } from '@/lib/db';
import { COMMODITY_META, normalizeCommodityType } from '@/lib/document-presets';
import { formatDDMMYYYY } from '@/components/ui/date-picker-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STAGE_DOT: Record<OpportunityStage, string> = {
  inquiry: 'bg-slate-500',
  quoting: 'bg-blue-500',
  pending_docs: 'bg-indigo-500',
  pending_booking: 'bg-purple-500',
  booking_requested: 'bg-violet-500',
  awb_received: 'bg-cyan-500',
  waiting_for_pickup: 'bg-emerald-500',
  picked_up: 'bg-teal-500',
  delivered: 'bg-emerald-600',
  payment_received: 'bg-amber-500',
};

const MAX_VISIBLE_EVENTS = 3;

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDisplayAmount(opp: Opportunity) {
  const quotationPrices =
    opp.quotationDetails?.filter((q) => {
      const linePayable = getQuotationPayableTotalThb({
        total_cost: q.total_cost ?? 0,
        vat_amount: q.vat_amount ?? null,
        grand_total_with_vat: null,
        wht_amount: q.wht_amount ?? null,
        wht_enabled: q.wht_enabled,
      });
      return linePayable > 0;
    }) ?? [];
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
  return {
    amount: hasQuotationPrices ? totalFromQuotations : opp.amount,
    quoteCount: quotationPrices.length,
    hasQuotationPrices,
  };
}

function getOppMeta(opp: Opportunity) {
  const quotes = opp.quotationDetails ?? [];
  return {
    quotes,
    hasFromCustomer: quotes.some((q) => !!q.customer_user_id),
    hasPhyto: quotes.some((q) => q.phyto_required),
    hasDataLogger: quotes.some((q) => q.notes?.includes('[DATA LOGGER]')),
    totalDocs: quotes.reduce((s, q) => s + (q.docs_count || 0), 0),
    allPriceConfirmed: quotes.length > 0 && quotes.every((q) => q.price_confirmed),
    commodities: Array.from(
      new Set(quotes.map((q) => normalizeCommodityType(q.commodity_type ?? undefined)))
    ),
    consignee: quotes[0]?.consignee_name ?? null,
  };
}

function getPrimaryOmgNo(opp: Opportunity): string | null {
  const no = opp.quotationDetails?.[0]?.quotation_no?.trim();
  return no || null;
}

function OmgTag({ no, className = '' }: { no: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded border border-slate-300/80 bg-white/70 px-1 py-px font-mono text-[9px] font-semibold text-slate-700 ${className}`}
    >
      {no}
    </span>
  );
}

interface PickupCalendarViewProps {
  opportunities: Opportunity[];
  onEdit: (opp: Opportunity) => void;
}

export function PickupCalendarView({ opportunities, onEdit }: PickupCalendarViewProps) {
  const router = useRouter();
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const todayIso = toISO(new Date());

  const byDate = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const opp of opportunities) {
      if (!opp.pickupDate) continue;
      const list = map.get(opp.pickupDate) ?? [];
      list.push(opp);
      map.set(opp.pickupDate, list);
    }
    return map;
  }, [opportunities]);

  const monthPickupCount = useMemo(() => {
    const key = monthKey(viewDate);
    let count = 0;
    for (const [date, opps] of byDate) {
      if (date.startsWith(key)) count += opps.length;
    }
    return count;
  }, [byDate, viewDate]);

  const grid = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewDate]);

  const weeks = grid.length / 7;
  const dayListOpps = selectedDay ? byDate.get(selectedDay) ?? [] : [];

  const goToday = () => setViewDate(new Date());

  const handleEdit = (opp: Opportunity) => {
    setSelectedOpp(null);
    setSelectedDay(null);
    onEdit(opp);
  };

  const handleOpen = (opp: Opportunity) => {
    setSelectedOpp(null);
    setSelectedDay(null);
    router.push(`/opportunities/${opp.id}`);
  };

  return (
    <>
      <div className="flex h-full flex-col rounded-xl border bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              className="rounded p-1.5 hover:bg-slate-100"
              title="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="min-w-[160px] text-center text-lg font-bold text-gray-900">
              {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </h2>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              className="rounded p-1.5 hover:bg-slate-100"
              title="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              {monthPickupCount} pickup{monthPickupCount !== 1 ? 's' : ''} this month
            </span>
            <button
              type="button"
              onClick={goToday}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Today
            </button>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-7 border-b bg-slate-50/80">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="border-r border-slate-100 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 last:border-r-0"
            >
              {w}
            </div>
          ))}
        </div>

        <div
          className="grid min-h-0 flex-1 grid-cols-7"
          style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
        >
          {grid.map((d, i) => {
            if (!d) {
              return (
                <div
                  key={`empty-${i}`}
                  className="min-h-0 border-b border-r border-slate-100 bg-slate-50/40 last:border-r-0"
                />
              );
            }
            const iso = toISO(d);
            const dayOpps = byDate.get(iso) ?? [];
            const isToday = iso === todayIso;
            const visible = dayOpps.slice(0, MAX_VISIBLE_EVENTS);
            const more = dayOpps.length - visible.length;
            const inCurrentMonth = d.getMonth() === viewDate.getMonth();

            return (
              <div
                key={iso}
                className={`flex min-h-0 flex-col overflow-hidden border-b border-r border-slate-100 p-1 last:border-r-0 ${
                  isToday ? 'bg-amber-50/50' : inCurrentMonth ? 'bg-white' : 'bg-slate-50/30'
                }`}
              >
                <div className="mb-0.5 flex shrink-0 items-center justify-between">
                  <button
                    type="button"
                    onClick={() => dayOpps.length > 0 && setSelectedDay(iso)}
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday
                        ? 'bg-amber-500 text-white'
                        : dayOpps.length > 0
                          ? 'text-gray-800 hover:bg-slate-100'
                          : 'text-gray-500'
                    }`}
                    title={dayOpps.length > 0 ? `${dayOpps.length} pickup(s)` : undefined}
                  >
                    {d.getDate()}
                  </button>
                  {dayOpps.length > 0 && (
                    <span className="text-[9px] font-medium text-gray-400">{dayOpps.length}</span>
                  )}
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                  {visible.map((opp) => {
                    const omgNo = getPrimaryOmgNo(opp);
                    return (
                    <button
                      key={opp.id}
                      type="button"
                      onClick={() => setSelectedOpp(opp)}
                      title={`${opp.companyName}${omgNo ? ` · ${omgNo}` : ''} — ${opp.topic}`}
                      className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight hover:opacity-90 ${STAGE_COLORS[opp.stage]}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[opp.stage]}`} />
                      <span className="min-w-0 flex-1 truncate font-medium">{opp.companyName}</span>
                      {omgNo && <OmgTag no={omgNo} />}
                    </button>
                    );
                  })}
                  {more > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDay(iso)}
                      className="w-full px-0.5 text-left text-[10px] font-semibold text-blue-600 hover:underline"
                    >
                      +{more} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day list dialog */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pickups — {selectedDay ? formatDDMMYYYY(selectedDay) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {dayListOpps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pickups on this day.</p>
            ) : (
              dayListOpps.map((opp) => {
                const omgNo = getPrimaryOmgNo(opp);
                return (
                <button
                  key={opp.id}
                  type="button"
                  onClick={() => {
                    setSelectedDay(null);
                    setSelectedOpp(opp);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-slate-50 ${STAGE_COLORS[opp.stage]}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[opp.stage]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-bold">{opp.companyName}</p>
                      {omgNo && <OmgTag no={omgNo} className="text-[10px]" />}
                    </div>
                    <p className="truncate text-xs opacity-80">{opp.topic}</p>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium">{STAGE_LABELS[opp.stage]}</span>
                </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* OP detail dialog */}
      <Dialog open={!!selectedOpp} onOpenChange={(open) => !open && setSelectedOpp(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {selectedOpp && (() => {
            const headerOmg = getPrimaryOmgNo(selectedOpp);
            return (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-start gap-2 pr-6">
                  <DialogTitle className="text-blue-600">{selectedOpp.companyName}</DialogTitle>
                  {headerOmg && <OmgTag no={headerOmg} className="text-[10px]" />}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STAGE_COLORS[selectedOpp.stage]}`}
                  >
                    {STAGE_LABELS[selectedOpp.stage]}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{selectedOpp.topic}</p>
              </DialogHeader>

              <OpportunityDetailBody opp={selectedOpp} />

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => handleEdit(selectedOpp)}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
                <Button onClick={() => handleOpen(selectedOpp)}>
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Open
                </Button>
              </DialogFooter>
            </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpportunityDetailBody({ opp }: { opp: Opportunity }) {
  const router = useRouter();
  const { amount, quoteCount, hasQuotationPrices } = getDisplayAmount(opp);
  const meta = getOppMeta(opp);
  const pickupToday = isPickupToday(opp);

  return (
    <div className="space-y-3 text-sm">
      {opp.pickupDate && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
            pickupToday ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <Truck className="h-4 w-4 shrink-0" />
          <span className="font-medium">Pickup:</span>
          <span>{formatDDMMYYYY(opp.pickupDate)}</span>
          {pickupToday && (
            <span className="ml-auto text-xs font-bold text-amber-700">Today</span>
          )}
        </div>
      )}

      <div className="flex justify-between items-baseline">
        <span className="text-xs font-semibold uppercase text-slate-500">Amount</span>
        <span className={`font-bold ${hasQuotationPrices ? 'text-emerald-700' : 'text-gray-900'}`}>
          {amount.toLocaleString()} {opp.currency}
          {quoteCount > 1 && (
            <span className="ml-1 text-xs font-normal text-slate-400">({quoteCount} quotes)</span>
          )}
        </span>
      </div>

      {opp.destinationName && (
        <div className="flex items-start gap-2 text-blue-700">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{opp.destinationName}</span>
        </div>
      )}

      {meta.consignee && (
        <div className="flex items-start gap-2 text-slate-700">
          <UserCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div>
            <span className="font-medium">Consignee: </span>
            {meta.consignee}
          </div>
        </div>
      )}

      {opp.productDetails && (
        <p className="text-gray-600">
          <span className="font-medium">Product: </span>
          {opp.productDetails}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {meta.hasFromCustomer && (
          <span title="From customer request" className="inline-flex text-emerald-600">
            <UserCircle2 className="h-4 w-4" />
          </span>
        )}
        {meta.hasPhyto && (
          <span title="Phytosanitary service" className="inline-flex text-emerald-700">
            <Leaf className="h-4 w-4" />
          </span>
        )}
        {meta.hasDataLogger && (
          <span title="Data logger (MSDS)" className="inline-flex text-sky-600">
            <Thermometer className="h-4 w-4" />
          </span>
        )}
        {meta.totalDocs > 0 && (
          <span title="Documents uploaded" className="inline-flex items-center gap-0.5 text-blue-600">
            <FileCheck className="h-4 w-4" />
            <span className="text-xs font-bold">{meta.totalDocs}</span>
          </span>
        )}
        {meta.allPriceConfirmed && (
          <span title="Price confirmed" className="inline-flex text-violet-600">
            <BadgeCheck className="h-4 w-4" />
          </span>
        )}
        {meta.commodities.map((c) => {
          const cm = COMMODITY_META[c];
          const Icon = cm.icon;
          return (
            <span
              key={c}
              title={cm.label}
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[9px] font-bold ${cm.badgeClass}`}
            >
              <Icon className="h-2.5 w-2.5" />
              {cm.label}
            </span>
          );
        })}
      </div>

      {meta.quotes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.quotes.map((q, i) => (
            <button
              key={q.id}
              type="button"
              onClick={() => router.push(`/shipping-calculator/preview?id=${q.id}`)}
              className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 hover:bg-green-100"
            >
              <FileText className="h-3 w-3" />
              {q.quotation_no || `Quote #${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {opp.notes && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900 whitespace-pre-wrap">
          {opp.notes}
        </div>
      )}
    </div>
  );
}
