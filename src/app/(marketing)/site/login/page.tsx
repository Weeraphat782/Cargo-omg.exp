'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, CheckCircle2, BookOpen, PlayCircle } from 'lucide-react';
import { TOUR_POSTER_URL, TOUR_VIDEO_URL } from '@/lib/site';
import { signInCustomerWithGoogle } from '@/lib/customer-oauth';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function GoogleMark() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.98 37.98 48 31.8 48 24c0-.45-.02-.9-.02-1.45z"
      />
      <path
        fill="#FBBC05"
        d="M6.62 13.22c-1.4 3.43-2.02 7.06-2.02 10.78s.62 7.34 2.03 10.76l8.06-6.06c-.8-2.54-.8-5.62 0-8.2l-7.07-5.48z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const verified = searchParams.get('verified');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showTour, setShowTour] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setOauthLoading(true);
    try {
      const { error: oauthError } = await signInCustomerWithGoogle(window.location.origin);
      if (oauthError) {
        setError(oauthError);
        setOauthLoading(false);
      }
    } catch {
      setError('Unable to start Google sign-in.');
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setIsLoading(false);
        return;
      }

      if (data?.session) {
        // Check if user is a customer
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.session.user.id)
          .single();

        if (profileError || !profile) {
          setError('Could not verify your account. Please contact support.');
          await supabase.auth.signOut();
          setIsLoading(false);
          return;
        }

        if (profile.role !== 'customer') {
          setError('This account is not registered as a customer. If you are staff, please use the internal login.');
          await supabase.auth.signOut();
          setIsLoading(false);
          return;
        }

        // Success — redirect to portal
        window.location.href = '/portal';
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-80px)] items-center justify-center">
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 bg-[var(--paper-muted)]">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="font-display text-2xl font-bold text-[var(--navy-950)]">Welcome back</h1>
            <p className="text-sm text-neutral-500 mt-1">Sign in to your customer portal</p>
          </div>

          {verified && (
            <div className="flex items-center gap-2 p-3 bg-[var(--success-bg)] border border-[var(--success)] rounded-sm mb-6">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-[var(--success)]">Email verified! You can now sign in.</p>
            </div>
          )}

          <div className="bg-white rounded-sm shadow-sm border border-[var(--line)] p-8">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading || oauthLoading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-sm border border-[var(--line)] bg-white text-neutral-900 font-semibold hover:bg-[var(--paper-muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <GoogleMark />
              {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[var(--line)]" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs uppercase tracking-wide text-neutral-400">or email</span>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-[var(--error-bg)] border-l-4 border-[var(--error)] rounded-sm">
                  <AlertCircle className="w-5 h-5 text-[var(--error)] shrink-0 mt-0.5" />
                  <p className="text-sm text-[#a12727]">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full pl-10 pr-4 py-3 text-sm border border-[var(--line)] rounded-sm focus:outline-none focus:ring-2 transition-colors"
                    style={{ "--tw-ring-color": "rgba(33,84,151,0.15)" } as React.CSSProperties}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-primary-ref)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-10 pr-12 py-3 text-sm border border-[var(--line)] rounded-sm focus:outline-none focus:ring-2 transition-colors"
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-primary-ref)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || oauthLoading}
                className="w-full py-3 text-white font-semibold rounded-sm transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: "var(--color-accent-ref)", boxShadow: "0 4px 14px rgba(91,191,33,0.3)" }}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Sign In <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </form>

            <div className="mt-6 text-center space-y-4">
              <p className="text-sm text-neutral-500">
                Don&apos;t have an account?{' '}
                <Link href="/site/register" className="font-semibold hover:opacity-80 transition-opacity" style={{ color: "var(--color-primary-ref)" }}>
                  Register here
                </Link>
              </p>
              <div className="pt-3 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowTour((v) => !v)}
                  className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 text-sm font-semibold rounded-sm border transition-colors hover:bg-neutral-50"
                  style={{ borderColor: 'var(--line)', color: 'var(--color-primary-ref)' }}
                >
                  <PlayCircle className="w-4 h-4" />
                  {showTour ? 'Hide tour video' : 'Watch the 1-minute tour'}
                </button>
                {showTour && (
                  <video
                    className="w-full rounded-sm border border-neutral-200 aspect-video bg-black"
                    controls
                    preload="none"
                    playsInline
                    poster={TOUR_POSTER_URL}
                    src={TOUR_VIDEO_URL}
                  />
                )}
                <a
                  href="/manual/index.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 text-sm font-semibold text-white rounded-sm transition-all hover:opacity-90 hover:shadow-lg"
                  style={{
                    background: "linear-gradient(135deg, var(--color-primary-ref) 0%, #2c6bb8 100%)",
                    boxShadow: "0 4px 14px rgba(33,84,151,0.35)",
                  }}
                >
                  <BookOpen className="w-4 h-4" />
                  View User Manual
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
              <div className="pt-4 border-t border-neutral-100">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 text-sm font-medium text-neutral-600 bg-[var(--paper-muted)] hover:bg-neutral-100 border border-[var(--line)] rounded-sm transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  Login for Admin / Staff
                </Link>
              </div>
            </div>
          </div>

          <div className="text-center mt-6">
            <Link href="/site" className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors">
              ← Back to website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[var(--success)] border-t-emerald-600 rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
