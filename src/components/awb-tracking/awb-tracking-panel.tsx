'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

type TrackingPayload = {
  quotation: {
    id: string;
    quotation_no: string | null;
    awb_number: string | null;
    tracking_status: string;
    tracking_status_raw: string | null;
    tracking_checked_at: string | null;
    delivered_at: string | null;
    carrier_code: string | null;
    delivery_notify_emails: string[] | null;
  };
  history: { status: string; raw_text: string | null; source_url: string | null; checked_at: string; created_by: string }[];
  notifications: {
    send_trigger: string;
    status: string;
    recipients: string[];
    sent_at: string | null;
    resend_message_id: string | null;
    created_at: string;
  }[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function AwbTrackingPanel({
  quotationId,
  awbNumber,
  omgNumber,
}: {
  quotationId: string;
  awbNumber?: string | null;
  omgNumber?: string | null;
}) {
  const [data, setData] = useState<TrackingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [notifyInput, setNotifyInput] = useState('');
  const [notifyEmails, setNotifyEmails] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!awbNumber && !omgNumber) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ quotation_id: quotationId });
      const res = await fetch(`/api/awb-tracking?${q}`, { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Load failed');
      setData(json);
      setCarrier(json.quotation?.carrier_code || '');
      setNotifyEmails(json.quotation?.delivery_notify_emails || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [quotationId, awbNumber, omgNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/awb-tracking', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action, quotation_id: quotationId, awb_number: awbNumber, omg_number: omgNumber, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      await load();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (!awbNumber?.trim()) return null;
  if (loading && !data) return <p className="text-sm text-muted-foreground">Loading AWB tracking…</p>;

  const q = data?.quotation;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          AWB tracking
          {q?.tracking_status && (
            <Badge variant="outline" className="font-normal">
              {q.tracking_status.replace(/_/g, ' ')}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        <div className="grid gap-1 text-muted-foreground">
          <p>
            Last checked:{' '}
            {q?.tracking_checked_at ? new Date(q.tracking_checked_at).toLocaleString('en-GB') : '—'}
          </p>
          {q?.tracking_status_raw && <p className="text-foreground">Airline: {q.tracking_status_raw}</p>}
          {q?.delivered_at && (
            <p className="text-emerald-700">
              Delivered: {new Date(q.delivered_at).toLocaleString('en-GB')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Carrier code</span>
            <Input className="h-8 w-24" value={carrier} onChange={(e) => setCarrier(e.target.value.toUpperCase())} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => post('set_carrier', { carrier_code: carrier, carrier_code_manual: true })}
          >
            Save carrier
          </Button>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Notify when delivered</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {notifyEmails.map((email) => (
              <Badge key={email} variant="secondary" className="gap-1">
                {email}
                <button
                  type="button"
                  className="ml-1 opacity-70 hover:opacity-100"
                  onClick={() => setNotifyEmails((list) => list.filter((e) => e !== email))}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Input
              className="h-8 max-w-xs"
              placeholder="Add email"
              value={notifyInput}
              onChange={(e) => setNotifyInput(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || notifyEmails.length >= 10}
              onClick={() => {
                const e = notifyInput.trim().toLowerCase();
                if (!e.includes('@')) return;
                if (!notifyEmails.includes(e)) setNotifyEmails([...notifyEmails, e]);
                setNotifyInput('');
              }}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => post('update_notify_list', { emails: notifyEmails })}
            >
              Save list
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy || Boolean(q?.delivered_at)} onClick={() => post('mark_delivered')}>
            Mark delivered
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !q?.delivered_at}
            onClick={() => post('resend_delivered_email')}
          >
            Resend delivered email
          </Button>
        </div>

        {data?.history && data.history.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">History</p>
            <ul className="max-h-40 overflow-y-auto border rounded-md divide-y text-xs">
              {data.history.map((h, i) => (
                <li key={i} className="px-2 py-1.5">
                  <span className="font-medium">{h.status}</span> · {new Date(h.checked_at).toLocaleString('en-GB')}
                  {h.raw_text && <span className="block text-muted-foreground truncate">{h.raw_text}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data?.notifications && data.notifications.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Email log</p>
            <ul className="border rounded-md divide-y text-xs">
              {data.notifications.map((n, i) => (
                <li key={i} className="px-2 py-1.5">
                  {n.send_trigger} · {n.status} · {n.recipients.join(', ') || '—'}
                  {n.sent_at && ` · ${new Date(n.sent_at).toLocaleString('en-GB')}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TrackingStatusBadge({ status }: { status?: string | null }) {
  if (!status || status === 'not_tracked') return null;
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
