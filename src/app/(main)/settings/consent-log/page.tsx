'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { usePagination } from '@/hooks/use-pagination';
import { ScrollText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

type ConsentLogRow = {
  id: string;
  quotation_no: string | null;
  company_name: string | null;
  customer_name: string | null;
  consignee_name: string | null;
  requested_destination: string | null;
  destination: string | null;
  change_policy_ack_at: string;
  change_policy_ack_by: string | null;
  change_policy_version: string | null;
  ackEmail?: string | null;
};

function formatAckAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function ConsentLogPage() {
  const [rows, setRows] = useState<ConsentLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: quotes, error: qErr } = await supabase
          .from('quotations')
          .select(
            'id, quotation_no, company_name, customer_name, consignee_name, requested_destination, destination, change_policy_ack_at, change_policy_ack_by, change_policy_version'
          )
          .not('change_policy_ack_at', 'is', null)
          .order('change_policy_ack_at', { ascending: false });

        if (qErr) throw qErr;

        const ackByIds = [...new Set((quotes ?? []).map((q) => q.change_policy_ack_by).filter(Boolean))] as string[];

        let emailById: Record<string, string> = {};
        if (ackByIds.length > 0) {
          const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', ackByIds);
          if (pErr) throw pErr;
          emailById = Object.fromEntries(
            (profiles ?? []).map((p) => [p.id as string, (p.email as string) || ''])
          );
        }

        const merged: ConsentLogRow[] = (quotes ?? []).map((q) => ({
          ...q,
          ackEmail: q.change_policy_ack_by ? emailById[q.change_policy_ack_by] ?? null : null,
        }));

        if (!cancelled) setRows(merged);
      } catch (err) {
        console.error('consent-log load:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load consent log');
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

  const pager = usePagination('consent-log', rows);

  const empty = !loading && !error && rows.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScrollText className="h-8 w-8 text-[#215497]" />
          LOG — Change policy consent
        </h1>
        <p className="text-slate-500 mt-1">
          ประวัติลูกค้ายอมรับเงื่อนไขการเปลี่ยนแปลง 48–72 ชม. ก่อนส่งคำขอใบเสนอราคา
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consent records</CardTitle>
          <CardDescription>
            Who submitted, destination, consignee, and acknowledgment time (Bangkok).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {error && <p className="text-red-500">Error: {error}</p>}
          {empty && (
            <p className="text-slate-500 text-center py-8">ยังไม่มีประวัติการยอมรับเงื่อนไข</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>OMG</TableHead>
                      <TableHead>บริษัท</TableHead>
                      <TableHead>ผู้กดส่ง</TableHead>
                      <TableHead>ส่งไป</TableHead>
                      <TableHead>Consignee</TableHead>
                      <TableHead>เวลายอมรับ</TableHead>
                      <TableHead>เวอร์ชัน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pager.items.map((row) => {
                      const shipTo = row.destination?.trim() || row.requested_destination?.trim() || '—';
                      const submitter = row.customer_name?.trim() || '—';
                      const email = row.ackEmail?.trim();
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-sm">
                            {row.quotation_no ? (
                              <Link
                                href={`/shipping-calculator`}
                                className="text-[#215497] hover:underline"
                                title="Open shipping calculator"
                              >
                                {row.quotation_no}
                              </Link>
                            ) : (
                              <span className="text-slate-400">ยังไม่มีเลข</span>
                            )}
                          </TableCell>
                          <TableCell>{row.company_name?.trim() || '—'}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {submitter}
                              {email ? (
                                <span className="block text-xs text-slate-500">{email}</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate" title={shipTo}>
                            {shipTo}
                          </TableCell>
                          <TableCell className="max-w-[160px] truncate" title={row.consignee_name || ''}>
                            {row.consignee_name?.trim() || '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatAckAt(row.change_policy_ack_at)}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.change_policy_version || '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination pager={pager} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}