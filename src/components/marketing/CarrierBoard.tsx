'use client';

import Image from "next/image";
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type CarrierBoardRouteRow,
  type CarrierBoardDisplayItem,
  rowToDisplayItem,
} from '@/types/carrier-board';

const ACCENT = '#5BBF21';

/** Offline / error fallback (matches last seeded defaults) */
const FALLBACK_ROWS: Omit<CarrierBoardRouteRow, 'id' | 'created_at' | 'updated_at'>[] = [
  { country: 'Switzerland', city: 'Zurich', carrier_code: 'TG', sort_order: 0, is_active: true },
  { country: 'Macedonia', city: 'Skopje', carrier_code: 'LH', sort_order: 1, is_active: true },
  { country: 'Germany', city: 'Munich, Frankfurt', carrier_code: 'LH', sort_order: 2, is_active: true },
  { country: 'Australia', city: 'Melbourne, Sydney', carrier_code: 'TG', sort_order: 3, is_active: true },
  { country: 'Czech', city: 'Prague', carrier_code: 'QR', sort_order: 4, is_active: true },
  { country: 'Portugal', city: 'Lisbon', carrier_code: 'QR', sort_order: 5, is_active: true },
  { country: 'New Zealand', city: 'Auckland', carrier_code: 'Qantas', sort_order: 6, is_active: true },
  { country: 'Poland', city: 'Warsaw', carrier_code: 'QR', sort_order: 7, is_active: true },
];

function fallbackDisplayItems(): CarrierBoardDisplayItem[] {
  return FALLBACK_ROWS.map((r, i) =>
    rowToDisplayItem({
      ...r,
      id: `fallback-${i}-${r.country}-${r.carrier_code}`,
      created_at: '',
      updated_at: '',
    })
  );
}

function CarrierLogo({ carrier }: { carrier: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="text-xs font-black text-neutral-900 uppercase tracking-tighter sm:text-xs">
        {carrier}
      </span>
    );
  }
  return (
    <Image
      src={`/images/carriers/logo-${carrier.toLowerCase()}.png`}
      alt={carrier}
      fill
      className="object-contain p-0.5"
      sizes="96px"
      onError={() => setFailed(true)}
    />
  );
}

export default function CarrierBoard() {
  const [items, setItems] = useState<CarrierBoardDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('carrier_board_routes')
          .select('*')
          .order('sort_order', { ascending: true });

        if (cancelled) return;

        if (error) {
          console.warn('[CarrierBoard] Using fallback:', error.message);
          setItems(fallbackDisplayItems());
          setUsedFallback(true);
          return;
        }

        const rows = (data ?? []) as CarrierBoardRouteRow[];
        if (rows.length === 0) {
          setItems(fallbackDisplayItems());
          setUsedFallback(true);
          return;
        }

        setItems(rows.map(rowToDisplayItem));
        setUsedFallback(false);
      } catch (e) {
        if (!cancelled) {
          console.warn('[CarrierBoard] Using fallback:', e);
          setItems(fallbackDisplayItems());
          setUsedFallback(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full lg:ml-auto animate-fade-in-up stagger-1">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/50 backdrop-blur-xl shadow-2xl">
        <div
          className="h-0.5 w-full"
          style={{ background: `linear-gradient(90deg, ${ACCENT}, #86ef6c, ${ACCENT})` }}
        />
        <div className="bg-white/5 px-4 py-2.5 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: ACCENT }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: ACCENT }} />
            </div>
            <h3 className="text-sm font-bold tracking-[0.2em] text-white/90 uppercase font-mono">
              Live Shipping Status
            </h3>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest sm:text-xs">
              Real-Time Feed
            </div>
            {loading && (
              <span className="text-[10px] font-mono text-neutral-500 sm:text-xs">Loading…</span>
            )}
            {!loading && usedFallback && (
              <span className="text-[10px] font-mono text-amber-500/90 sm:text-xs">Offline</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-white/5 bg-white/5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 sm:px-4 sm:text-xs">
          <div className="col-span-5">Destination</div>
          <div className="col-span-4 text-center">Carrier</div>
          <div className="col-span-3 text-right">Status</div>
        </div>

        <div className="divide-y divide-white/5">
          {loading && (
            <div className="px-4 py-8 text-center text-xs font-mono text-neutral-500">
              Loading carrier routes…
            </div>
          )}
          {!loading &&
            items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-white/5 transition-colors group"
            >
              <div className="col-span-5 flex flex-col min-w-0">
                <span className="text-sm font-bold text-white transition-colors truncate group-hover:text-[var(--color-accent-ref)]">
                  {item.country}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono truncate italic sm:text-xs">
                  {item.city}
                </span>
              </div>

              <div className="col-span-4 flex justify-center">
                <div className="relative w-16 h-10 bg-white/90 rounded-md flex items-center justify-center border border-white/20 shadow-sm px-2 py-1.5 sm:w-24 sm:h-14 sm:px-3 sm:py-2">
                  <CarrierLogo carrier={item.carrier} />
                </div>
              </div>

              <div className="col-span-3 text-right flex flex-col items-end">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono font-bold uppercase tracking-tighter ${item.status === 'Available' ? '' : 'text-red-500'}`}
                    style={item.status === 'Available' ? { color: ACCENT } : undefined}
                  >
                    {item.status}
                  </span>
                  <div
                    className={`h-2 w-2 rounded-full ${item.status === 'Suspended' ? 'animate-pulse' : ''}`}
                    style={
                      item.status === 'Available'
                        ? { backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}99` }
                        : { backgroundColor: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.6)' }
                    }
                  />
                </div>
              </div>
            </div>
            ))}
        </div>

        <div className="bg-black/20 px-3 py-2 border-t border-white/5 sm:px-4">
          <p className="text-[10px] text-neutral-500 text-center font-mono uppercase tracking-[0.1em] sm:text-xs">
            * Subject to active flight schedules and regional restrictions
          </p>
        </div>
      </div>
    </div>
  );
}
