'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import MainLayout from '@/components/layout/MainLayout';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import { isLabAdminPath, ROLES } from '@/lib/roles';

function StaffRouteGuard({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      window.location.href = '/login';
      return;
    }

    let cancelled = false;

    const checkRole = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (cancelled) return;

        const role = data?.role;

        if (role === ROLES.LAB_ADMIN) {
          if (!isLabAdminPath(pathname)) {
            window.location.href = '/qc';
            return;
          }
        } else if (role !== ROLES.STAFF && role !== ROLES.ADMIN) {
          window.location.href = '/portal';
          return;
        }

        setAuthorized(true);
        setChecking(false);
      } catch {
        if (!cancelled) window.location.href = '/login';
      }
    };

    checkRole();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, pathname]);

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authorized) return null;

  return <>{children}</>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <StaffRouteGuard>
        <MainLayout>
          {children}
        </MainLayout>
      </StaffRouteGuard>
    </AuthProvider>
  );
}
