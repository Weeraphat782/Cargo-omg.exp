'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { customerPortalDestination } from '@/lib/customer-company-gate';
import { Loader2, AlertCircle } from 'lucide-react';
import type { ReadonlyURLSearchParams } from 'next/navigation';

/** Supabase may return OAuth errors in the URL fragment, not the query. */
function getHashSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

function firstOAuthError(
  searchParams: ReadonlyURLSearchParams,
  hashParams: URLSearchParams
): string | null {
  return (
    searchParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error_description') ||
    hashParams.get('error')
  );
}

async function finishCustomerPortalFlow(
  searchParams: ReadonlyURLSearchParams,
  cancelled: () => boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData.session?.user) {
    return { ok: false, message: 'Could not read session after login.' };
  }

  const userId = sessData.session.user.id;
  let profile: { role: string; company: string | null } | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await supabase.from('profiles').select('role, company').eq('id', userId).single();
    if (res.data) {
      profile = res.data;
      break;
    }
    await new Promise((r) => setTimeout(r, 450));
  }

  if (!profile) {
    await supabase.auth.signOut();
    if (!cancelled()) {
      return {
        ok: false,
        message:
          'Could not verify your account profile. Try again or use email/password registration.',
      };
    }
    return { ok: false, message: '' };
  }

  if (profile.role !== 'customer') {
    await supabase.auth.signOut();
    if (!cancelled()) {
      return {
        ok: false,
        message: 'This login is not a customer portal account. Please use Login for Admin / Staff instead.',
      };
    }
    return { ok: false, message: '' };
  }

  let companyId: string | null = null;
  const { data: companies } = await supabase
    .from('companies')
    .select('id')
    .eq('customer_user_id', userId)
    .limit(1);
  companyId = companies?.[0]?.id ?? null;

  const destination = customerPortalDestination({
    role: profile.role,
    companyName: profile.company,
    companyId,
    next: searchParams.get('next'),
  });
  window.location.replace(`${window.location.origin}${destination}`);
  return { ok: true };
}

function SiteAuthCallbackInner() {
  const searchParams = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const hashParams = getHashSearchParams();
      const errHint = firstOAuthError(searchParams, hashParams);

      if (errHint) {
        setMsg(errHint.trim() || 'Sign-in was cancelled or failed.');
        return;
      }

      const code = searchParams.get('code');

      if (!code) {
        // detectSessionInUrl may have exchanged already; PKCE verifier is same-origin only.
        const { data: early } = await supabase.auth.getSession();
        if (early.session?.user) {
          const result = await finishCustomerPortalFlow(searchParams, () => cancelled);
          if (!result.ok && result.message) {
            if (!cancelled) setMsg(result.message);
          }
          return;
        }
        if (!cancelled) {
          setMsg(
            'Missing authorization code. Finish sign-in on this device in the same tab you started from, or confirm Supabase Redirect URLs and Vercel env match this site.'
          );
        }
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        if (!cancelled) setMsg(error.message);
        return;
      }

      const result = await finishCustomerPortalFlow(searchParams, () => cancelled);
      if (!result.ok && result.message) {
        if (!cancelled) setMsg(result.message);
      }
    }

    finish();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (msg) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-4 bg-neutral-50">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-600" />
          <h1 className="text-lg font-semibold text-red-900">Sign-in issue</h1>
          <p className="mt-2 text-sm text-red-800">{msg}</p>
          <Link
            href="/site/login"
            className="mt-6 inline-block text-sm font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
          >
            Back to customer login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center gap-4 bg-neutral-50">
      <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
      <p className="text-sm text-neutral-600">Completing Google sign-in…</p>
    </div>
  );
}

export default function SiteAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center gap-4 bg-neutral-50">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
          <p className="text-sm text-neutral-600">Loading…</p>
        </div>
      }
    >
      <SiteAuthCallbackInner />
    </Suspense>
  );
}
