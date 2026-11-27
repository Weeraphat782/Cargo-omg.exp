'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Plane,
  User,
  LogOut,
  Menu,
  X,
  Bell,
  PlusCircle,
  FlaskConical,
  Search,
  Loader2,
} from 'lucide-react';
import { CustomerAuthProvider, useCustomerAuth } from '@/contexts/customer-auth-context';
import { customerNeedsCompanySetup } from '@/lib/customer-company-gate';
import { customerHasCompanyRecord } from '@/lib/customer-db';

const QC_FEATURE_SEEN_KEY = 'qc_feature_seen';

const navItems = [
  { href: '/portal', label: 'My Shipments', icon: Plane },
  { href: '/portal/quotations/new', label: 'Request Quote', icon: PlusCircle },
  { href: '/portal/tracking', label: 'AWB Tracking', icon: Search },
  { href: '/portal/qc-requests', label: 'QC Request', icon: FlaskConical, isNew: true },
  { href: '/portal/profile', label: 'My Profile', icon: User },
] as const;

// ============ SIDEBAR ============
function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { profile, signOut } = useCustomerAuth();
  const [qcFeatureSeen, setQcFeatureSeen] = useState(true);

  useEffect(() => {
    setQcFeatureSeen(localStorage.getItem(QC_FEATURE_SEEN_KEY) === '1');
  }, []);

  useEffect(() => {
    if (!pathname.startsWith('/portal/qc-requests')) return;
    localStorage.setItem(QC_FEATURE_SEEN_KEY, '1');
    setQcFeatureSeen(true);
  }, [pathname]);

  const markQcFeatureSeen = () => {
    localStorage.setItem(QC_FEATURE_SEEN_KEY, '1');
    setQcFeatureSeen(true);
  };

  const initials = profile?.company
    ? profile.company.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : profile?.full_name
      ? profile.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      : '?';

  return (
    <>
      {/* Overlay for mobile */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />
      )}

      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`} style={{ borderColor: 'var(--line)' }}>
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <Link href="/portal" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="OMGEXP" className="h-10 w-auto" />
          </Link>
          <div className="flex-1" />
          <button className="lg:hidden p-1 rounded hover:bg-gray-100" onClick={onClose}>
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="p-3 space-y-1 mt-2">
          {navItems.map((item) => {
            const isActive = item.href === '/portal'
              ? pathname === '/portal' || pathname.startsWith('/portal/shipments')
              : item.href === '/portal/quotations/new'
                ? pathname === '/portal/quotations/new'
                : item.href === '/portal/tracking'
                  ? pathname.startsWith('/portal/tracking')
                : item.href === '/portal/qc-requests'
                  ? pathname.startsWith('/portal/qc-requests')
                  : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if ('isNew' in item && item.isNew) markQcFeatureSeen();
                  onClose();
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors border-l-4 ${isActive
                  ? 'border-[var(--green-500)] bg-[var(--info-bg)] text-[var(--navy-700)]'
                  : 'border-transparent text-[#5c656e] hover:bg-[var(--paper-muted)] hover:text-[var(--navy-950)]'
                  }`}
              >
                <item.icon className={`w-[18px] h-[18px] ${isActive ? 'text-[var(--navy-700)]' : 'text-[#9aa2aa]'}`} />
                <span className="flex-1">{item.label}</span>
                {'isNew' in item && item.isNew && !qcFeatureSeen && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--success)]" style={{ background: 'var(--success-bg)' }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                    New
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-3 p-3 rounded-sm bg-[var(--paper-muted)]">
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm text-[var(--navy-700)]" style={{ background: 'var(--info-bg)' }} suppressHydrationWarning>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate" suppressHydrationWarning>{profile?.company || profile?.full_name || 'Customer'}</div>
              <div className="text-xs text-gray-500 truncate" suppressHydrationWarning>{profile?.email || ''}</div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2 w-full mt-2 px-3 py-2 text-sm text-[#5c656e] hover:text-[var(--error)] hover:bg-[var(--error-bg)] rounded-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

// ============ HEADER ============
function PortalHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const [notifOpen, setNotifOpen] = useState(false);
  const { profile } = useCustomerAuth();

  const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'Customer';
  const initials = profile?.company
    ? profile.company.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-4 sm:px-6 lg:px-8" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3">
        <button className="lg:hidden p-2 rounded-lg hover:bg-gray-100" onClick={onMenuClick}>
          <Menu className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-sm font-semibold text-gray-400">Welcome back,</h1>
          <p className="text-base font-bold text-gray-900 -mt-0.5" suppressHydrationWarning>{displayName}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative">
          <button
            className="p-2 rounded-lg hover:bg-gray-100 relative"
            onClick={() => setNotifOpen(!notifOpen)}
          >
            <Bell className="w-5 h-5 text-gray-600" />
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-sm shadow-[0_8px_24px_rgba(13,44,77,0.1)] border py-2 z-50" style={{ borderColor: 'var(--line)' }}>
              <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--line)' }}>
                <span className="text-sm font-semibold text-gray-900">Notifications</span>
              </div>
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No notifications yet
              </div>
            </div>
          )}
        </div>

        {/* User avatar */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm ml-1 text-[var(--navy-700)]" style={{ background: 'var(--info-bg)' }} suppressHydrationWarning>
          {initials}
        </div>
      </div>
    </header>
  );
}

function GateHold({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--paper-muted)] px-4">
      {children ?? <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
    </div>
  );
}

// Portal shell stays unmounted until a customer has a company. The old gate
// redirected in useEffect after My Shipments had already rendered.
function CustomerLayoutInner({ children }: { children: React.ReactNode }) {
  const { isLoading, user, profile } = useCustomerAuth();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const nameMissing = !!profile && customerNeedsCompanySetup({
    role: profile.role,
    companyName: profile.company,
  });
  const [linkedCompany, setLinkedCompany] = useState<'unknown' | 'yes' | 'no'>('unknown');

  useEffect(() => {
    if (!nameMissing) return;
    let cancelled = false;
    setLinkedCompany('unknown');
    customerHasCompanyRecord().then((has) => {
      if (!cancelled) setLinkedCompany(has ? 'yes' : 'no');
    });
    return () => {
      cancelled = true;
    };
  }, [nameMissing, user?.id]);

  const checkingLink = nameMissing && linkedCompany === 'unknown';
  const needsSetup = nameMissing && linkedCompany === 'no';
  const onSetup = pathname === '/portal/setup';

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      window.location.replace('/site/login');
      return;
    }
    if (profile && profile.role !== 'customer') {
      window.location.replace('/shipping-calculator');
      return;
    }
    if (needsSetup && !onSetup) {
      window.location.replace('/portal/setup');
    }
  }, [isLoading, user, profile, needsSetup, onSetup]);

  if (isLoading || !user || (profile && profile.role !== 'customer') || checkingLink || (needsSetup && !onSetup)) {
    return <GateHold />;
  }

  if (!profile) {
    return (
      <GateHold>
        <p className="text-sm text-gray-600 text-center">
          Could not load your account.{' '}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </GateHold>
    );
  }

  if (needsSetup) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[var(--paper-muted)]" data-portal-shell>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:ml-64 min-h-screen flex flex-col">
        <PortalHeader onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// ============ LAYOUT (wraps with CustomerAuthProvider) ============
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerAuthProvider>
      <CustomerLayoutInner>{children}</CustomerLayoutInner>
    </CustomerAuthProvider>
  );
}
