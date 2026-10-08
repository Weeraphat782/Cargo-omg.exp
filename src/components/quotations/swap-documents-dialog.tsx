'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export async function swapApiFetch(init?: RequestInit, query = ''): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`/api/document-submissions/swap${query}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

type Candidate = {
  id: string;
  quotation_no: string | null;
  destination: string | null;
  doc_count: number;
};

interface SwapDocumentsDialogProps {
  quotationId: string;
  quotationNo?: string | null;
  onSuccess: () => void;
}

export function SwapDocumentsDialog({ quotationId, quotationNo, onSuccess }: SwapDocumentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [sourceDocCount, setSourceDocCount] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setSelectedId(null);
    setSearch('');
    try {
      const res = await swapApiFetch(undefined, `?quotationId=${encodeURIComponent(quotationId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not load OMG list');
        return;
      }
      setSourceDocCount(typeof data.doc_count === 'number' ? data.doc_count : 0);
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch {
      toast.error('Could not load OMG list');
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => {
    if (open) loadCandidates();
  }, [open, loadCandidates]);

  const selected = candidates.find((c) => c.id === selectedId);
  const term = search.trim().toLowerCase();
  const filtered = term
    ? candidates.filter((c) =>
        `${c.quotation_no ?? ''} ${c.destination ?? ''}`.toLowerCase().includes(term)
      )
    : candidates;

  const handleSwap = async () => {
    if (!selectedId) return;
    setSwapping(true);
    try {
      const res = await swapApiFetch({
        method: 'POST',
        body: JSON.stringify({ quotationId, otherQuotationId: selectedId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Swap failed');
        return;
      }
      toast.success('Documents swapped — please verify both OMGs');
      setOpen(false);
      onSuccess();
    } catch {
      toast.error('Swap failed');
    } finally {
      setSwapping(false);
    }
  };

  const label = quotationNo || 'this OMG';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[10px] font-bold uppercase tracking-tight border-amber-200 text-amber-800 hover:bg-amber-50"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
          Swap docs
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Swap document sets</DialogTitle>
          <DialogDescription>
            OMG numbers and airline booking stay as-is. All files move to the other quotation ({label}).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other OMG found for this customer.</p>
        ) : (
          <div className="space-y-2">
          <Input
            autoFocus
            placeholder="Search OMG no. or destination"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No OMG matches “{search}”.</p>
            )}
            {filtered.map((c) => {
              const active = selectedId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    active ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-amber-200'
                  }`}
                >
                  <div className="font-bold text-sm">{c.quotation_no || c.id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.destination || '—'} · {c.doc_count} file{c.doc_count === 1 ? '' : 's'}
                  </div>
                </button>
              );
            })}
          </div>
          </div>
        )}

        {selected && (
          <p className="text-xs bg-amber-50 border border-amber-100 rounded-md p-2 text-amber-900">
            <strong>{label}</strong> ({sourceDocCount} file{sourceDocCount === 1 ? '' : 's'}) ↔{' '}
            <strong>{selected.quotation_no}</strong> ({selected.doc_count} file{selected.doc_count === 1 ? '' : 's'}
            ). Entire sets will be exchanged.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedId || swapping}
            onClick={handleSwap}
          >
            {swapping ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm swap'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
