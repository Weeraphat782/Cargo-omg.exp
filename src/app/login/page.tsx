'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { signInLabAdminWithGoogle } from '@/lib/lab-oauth';
import { ROLES } from '@/lib/roles';

/**
 * If Supabase/Google misconfigure returns PKCE ?code= or ?error= to /login (staff) instead of /site/auth/callback,
 * forward to the customer OAuth handler on the same origin.
 */
function OauthMisrouteRecovery() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const code = searchParams.get('code');
    const err = searchParams.get('error') ?? searchParams.get('error_description');
    if (!code && !err) return;
    const qs = typeof window !== 'undefined' ? window.location.search ?? '' : '';
    window.location.replace(`${window.location.origin}/site/auth/callback${qs}`);
  }, [searchParams]);
  return null;
}

function StaffLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    setDebugInfo('');

    try {
      setDebugInfo((prev) => prev + `\nAttempting login with: ${email}\n`);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        console.error('Login error:', error);
        setErrorMessage(error.message);
        setDebugInfo((prev) => prev + `\nLogin error: ${error.message}\n`);
        setIsLoading(false);
        return;
      }

      setDebugInfo((prev) => prev + `\nLogin response: Session exists: ${!!data?.session}\n`);

      if (data && data.session) {
        localStorage.setItem(
          'auth_session',
          JSON.stringify({
            email: email,
            timestamp: new Date().toISOString(),
          })
        );

        localStorage.setItem(
          'user',
          JSON.stringify({
            email: data.session.user.email,
            id: data.session.user.id,
            isAuthenticated: true,
          })
        );

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.session.user.id)
          .single();

        const role = profile?.role;
        const redirectPath =
          role === ROLES.LAB_ADMIN
            ? '/qc'
            : role === ROLES.CUSTOMER
              ? '/portal'
              : '/shipping-calculator';

        setSuccessMessage('Login successful! Redirecting...');
        setDebugInfo(
          (prev) =>
            prev + `\nRole: ${role}\nRedirecting to ${redirectPath}...\n`
        );

        await new Promise((resolve) => setTimeout(resolve, 500));
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => {
          window.location.href = `${window.location.origin}${redirectPath}`;
        }, 1500);
      } else {
        setErrorMessage('Login failed. No session returned.');
        setDebugInfo((prev) => prev + `\nNo session returned.\n`);
        setIsLoading(false);
      }
    } catch (error: unknown) {
      console.error('Login error:', error);
      setErrorMessage('An unexpected error occurred');
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      setDebugInfo((prev) => prev + `\nUnexpected error: ${message}\n`);
      setIsLoading(false);
    }
  };

  const handleLabGoogleLogin = async () => {
    setGoogleLoading(true);
    setErrorMessage('');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await signInLabAdminWithGoogle(origin);
    if (error) {
      setErrorMessage(error);
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <OauthMisrouteRecovery />
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center">
            <Image src="/logo.png" alt="Cantrak" width={180} height={56} className="h-14 w-auto" />
            <span className="text-lg font-medium text-gray-500 italic mt-1">For Export</span>
            <p className="text-sm text-slate-400 mt-2">Login to your account</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Login</CardTitle>
              <CardDescription>Enter your email and password to access your account</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                {errorMessage && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{errorMessage}</div>
                )}

                {successMessage && (
                  <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">{successMessage}</div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Logging in...' : 'Login'}
                </Button>

                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-slate-400">Lab Admin</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={googleLoading}
                  onClick={handleLabGoogleLogin}
                >
                  {googleLoading ? 'Redirecting…' : 'Sign in with Google (Lab Admin)'}
                </Button>

                <div className="text-xs text-center">
                  <button
                    type="button"
                    onClick={() => setShowDebug(!showDebug)}
                    className="text-slate-500 hover:text-slate-700 underline"
                  >
                    {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
                  </button>
                </div>

                {showDebug && debugInfo && (
                  <div className="p-2 bg-slate-100 rounded text-xs font-mono whitespace-pre-wrap">{debugInfo}</div>
                )}
              </form>
            </CardContent>
            <CardFooter className="flex flex-col space-y-2">
              <div className="text-sm text-center">
                <Link href="/reset-password" className="text-slate-500 hover:text-slate-700 hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-10 w-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      }
    >
      <StaffLoginForm />
    </Suspense>
  );
}
