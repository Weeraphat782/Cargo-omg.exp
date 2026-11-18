'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { Download, Play } from 'lucide-react';
import type { ChangeMoveInput, ChangeSetRow, SlotWithJob } from '@/lib/change-control/types';
import {
  buildNewBookingMove,
  buildReplaceMoves,
  buildSwapMoves,
  buildMoveIntoVacant,
} from '@/lib/change-control/moves';
import { checkGuards, snapshotFromPairs } from '@/lib/change-control/guards';
import {
  addMove,
  applyChangeSet,
  createChangeSet,
  getChangeSet,
  listChangeSets,
  listParkingJobs,
  listSlots,
  slotHistory,
} from '@/lib/change-control/service';

type BuilderMode = 'replace' | 'swap' | 'move' | 'new_booking';

export default function ChangeControlPage() {
  const { user } = useAuth();
  const boardRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<SlotWithJob[]>([]);
  const [parking, setParking] = useState<
    { quotation_id: string; quotation_no?: string; company_name?: string }[]
  >([]);
  const [sets, setSets] = useState<ChangeSetRow[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftMoves, setDraftMoves] = useState<ChangeMoveInput[]>([]);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<BuilderMode>('replace');
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);
  const [timelineOmg, setTimelineOmg] = useState('');
  const [timelineRows, setTimelineRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const deps = useMemo(() => ({ supabase }), []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, cs] = await Promise.all([
        listSlots(deps),
        listParkingJobs(deps),
        listChangeSets(deps),
      ]);
      setSlots(s);
      setParking(p);
      setSets(cs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  const guards = useMemo(() => {
    const pairs = slots
      .filter((s) => s.quotation_id)
      .map((s) => ({ slot_id: s.id, quotation_id: s.quotation_id! }));
    const initial = snapshotFromPairs(pairs);
    const jobPallets = new Map<string, number>();
    const slotBooked = new Map<string, number>();
    for (const s of slots) {
      slotBooked.set(s.id, s.booked_pallets);
      if (s.quotation_id && s.actual_pallets != null) {
        jobPallets.set(s.quotation_id, s.actual_pallets);
      }
    }
    return checkGuards({
      initial,
      moves: draftMoves,
      jobPallets,
      slotBookedPallets: slotBooked,
    });
  }, [slots, draftMoves]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, SlotWithJob[]>();
    for (const s of slots) {
      const key = s.load_date ?? 'no-date';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [slots]);

  const ensureDraft = async () => {
    if (draftId) return draftId;
    if (!user?.id) throw new Error('Not signed in');
    const row = await createChangeSet(deps, { reason, created_by: user.id });
    setDraftId(row.id);
    setSets((prev) => [row, ...prev]);
    return row.id;
  };

  const pushMoves = async (moves: ChangeMoveInput[]) => {
    const id = await ensureDraft();
    for (const m of moves) {
      await addMove(deps, id, m);
    }
    setDraftMoves((prev) => [...prev, ...moves]);
    toast.success(`Added ${moves.length} move(s)`);
  };

  const handleApplyBuilder = async () => {
    try {
      if (mode === 'replace' && pickA && pickB) {
        const slotA = slots.find((s) => s.quotation_id === pickA);
        const slotB = slots.find((s) => s.quotation_id === pickB);
        if (!slotA?.id) {
          toast.error('Pick job currently on a slot (A)');
          return;
        }
        await pushMoves(
          buildReplaceMoves({
            jobInSlotId: pickA,
            jobInSlotFromSlotId: slotA.id,
            replacementJobId: pickB,
            replacementFromSlotId: slotB ? slots.find((s) => s.quotation_id === pickB)?.id : null,
          }),
        );
      } else if (mode === 'swap' && pickA && pickB) {
        const sa = slots.find((s) => s.quotation_id === pickA);
        const sb = slots.find((s) => s.quotation_id === pickB);
        if (!sa?.id || !sb?.id) {
          toast.error('Both jobs must be on slots');
          return;
        }
        await pushMoves(buildSwapMoves({ jobAId: pickA, slotAId: sa.id, jobBId: pickB, slotBId: sb.id }));
      } else if (mode === 'move' && pickA && pickB) {
        const from = slots.find((s) => s.quotation_id === pickA);
        const toSlot = slots.find((s) => s.id === pickB && !s.quotation_id);
        if (!toSlot) {
          toast.error('Pick a vacant slot as target (B = slot id)');
          return;
        }
        await pushMoves([
          buildMoveIntoVacant({
            jobId: pickA,
            fromSlotId: from?.id ?? null,
            toSlotId: toSlot.id,
          }),
        ]);
      } else if (mode === 'new_booking' && pickA) {
        const from = slots.find((s) => s.quotation_id === pickA);
        await pushMoves([
          buildNewBookingMove({
            jobId: pickA,
            fromSlotId: from?.id ?? null,
            new_slot: {
              airline: 'TG',
              flight_no: '',
              load_date: pickB || new Date().toISOString().slice(0, 10),
              booked_pallets: 1,
            },
          }),
        ]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleApplySet = async () => {
    if (!draftId || !user?.id) return;
    if (guards.errors.length) {
      toast.error(guards.errors[0]);
      return;
    }
    try {
      const res = await applyChangeSet(deps, draftId, user.id);
      toast.success(`Applied ${res.code ?? draftId}`);
      setDraftId(null);
      setDraftMoves([]);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Apply failed');
    }
  };

  const exportPng = async () => {
    if (!boardRef.current) return;
    try {
      const dataUrl = await toPng(boardRef.current, { cacheBust: true, pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `slot-board-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch {
      toast.error('PNG export failed');
    }
  };

  const loadTimeline = async () => {
    const q = await supabase
      .from('quotations')
      .select('id')
      .eq('quotation_no', timelineOmg.trim())
      .maybeSingle();
    if (!q.data?.id) {
      toast.error('OMG not found');
      return;
    }
    const rows = await slotHistory(deps, { quotation_id: q.data.id });
    setTimelineRows(rows as Record<string, unknown>[]);
  };

  const loadDraftFromDb = async (id: string) => {
    const data = await getChangeSet(deps, id);
    if (!data) return;
    setDraftId(id);
    setDraftMoves(data.moves);
  };

  const slotClass = (s: SlotWithJob) => {
    if (!s.quotation_id) return 'border-dashed border-slate-300 bg-slate-50';
    if (s.status === 'confirmed') return 'border-emerald-400 bg-emerald-50';
    if (s.status === 'requested') return 'border-sky-300 bg-sky-50';
    return 'border-slate-200 bg-white';
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shipment Change Control</h1>
          <p className="text-sm text-muted-foreground">
            SLOT (AWB / flight) vs JOB (OMG#). Every change is a numbered Change Set.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={exportPng}>
            <Download className="mr-2 h-4 w-4" />
            Export PNG
          </Button>
          <Button type="button" onClick={handleApplySet} disabled={!draftId || guards.errors.length > 0}>
            <Play className="mr-2 h-4 w-4" />
            Apply Change Set
          </Button>
        </div>
      </div>

      {guards.errors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {guards.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {guards.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {guards.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Slot board</CardTitle>
          </CardHeader>
          <CardContent ref={boardRef} className="overflow-x-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="flex gap-4">
                {slotsByDate.map(([date, list]) => (
                  <div key={date} className="min-w-[200px]">
                    <p className="mb-2 text-xs font-medium text-slate-500">{date}</p>
                    <div className="space-y-2">
                      {list.map((s) => (
                        <div
                          key={s.id}
                          className={`rounded-lg border-2 p-2 text-xs ${slotClass(s)}`}
                        >
                          <p className="font-mono font-semibold">{s.awb_number || '—'}</p>
                          <p>
                            {s.flight_no || '—'} · {s.booked_pallets} plt
                          </p>
                          {s.quotation_id ? (
                            <p className="mt-1 text-emerald-900">{s.quotation_no}</p>
                          ) : (
                            <p className="mt-1 text-slate-400">ว่าง</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="min-w-[180px]">
                  <p className="mb-2 text-xs font-medium text-orange-600">Parking</p>
                  <div className="space-y-2">
                    {parking.map((p) => (
                      <div
                        key={p.quotation_id}
                        className="rounded-lg border-2 border-orange-300 bg-orange-50 p-2 text-xs"
                      >
                        <p className="font-mono font-semibold">{p.quotation_no}</p>
                        <p>{p.company_name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change Set builder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <Label>Reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" />
            </div>
            <div className="flex flex-wrap gap-2">
              {(['replace', 'swap', 'move', 'new_booking'] as BuilderMode[]).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={mode === m ? 'default' : 'outline'}
                  onClick={() => setMode(m)}
                >
                  {m}
                </Button>
              ))}
            </div>
            <div>
              <Label>A (quotation id / OMG job)</Label>
              <Input value={pickA ?? ''} onChange={(e) => setPickA(e.target.value || null)} />
            </div>
            <div>
              <Label>B (quotation id, vacant slot id, or load_date)</Label>
              <Input value={pickB ?? ''} onChange={(e) => setPickB(e.target.value || null)} />
            </div>
            <Button type="button" className="w-full" onClick={handleApplyBuilder}>
              Add moves to draft
            </Button>
            <p className="text-muted-foreground">Draft moves: {draftMoves.length}</p>
            <ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs">
              {draftMoves.map((m, i) => (
                <li key={`${m.quotation_id}-${i}`}>
                  {m.move_type} · {m.quotation_id.slice(0, 8)}…
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Change Sets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sets.map((cs) => (
              <button
                key={cs.id}
                type="button"
                className="flex w-full justify-between rounded border px-2 py-1 text-left hover:bg-slate-50"
                onClick={() => (cs.status === 'draft' ? loadDraftFromDb(cs.id) : undefined)}
              >
                <span className="font-mono">{cs.code}</span>
                <span>{cs.status}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>OMG timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <Input
                placeholder="OMG09021"
                value={timelineOmg}
                onChange={(e) => setTimelineOmg(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={loadTimeline}>
                Load
              </Button>
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {timelineRows.map((row) => (
                <li key={String(row.id)}>
                  {(row.change_sets as { code?: string })?.code} · {String(row.event)} ·{' '}
                  {String(row.created_at)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}