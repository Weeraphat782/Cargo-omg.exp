'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChevronDown,
  ChevronRight,
  Settings,
  Building,
  Globe,
  DollarSign,
  Calculator,
  Menu,
  FileText,
  LayoutDashboard,
  Calendar,
  FileCheck,
  Sparkles,
  ListChecks,
  Package,
  X,
  Newspaper,
  BookOpen,
  Plane,
  ScrollText,
  FlaskConical,
  ClipboardList,
  BarChart3,
  UserCog,
  Palette,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import { ROLES } from '@/lib/roles';

const MENU_GROUPS = [
  {
    title: 'MAIN',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/analytics', icon: BarChart3, label: 'Analytics' },
      { href: '/opportunities', icon: Sparkles, label: 'Booking' },
      { href: '/packing-lists', icon: FileText, label: 'Packing Lists' },
    ]
  },
  {
    title: 'TOOLS',
    items: [
      { href: '/shipping-calculator', icon: Calculator, label: 'Shipping Calculator' },
      { href: '/proforma-invoices', icon: ScrollText, label: 'Proforma Invoices' },
      { href: '/document-submissions', icon: FileText, label: 'Document Submissions' },
      { href: '/document-comparison', icon: FileCheck, label: 'Document Comparison' },
      { href: '/calendar', icon: Calendar, label: 'Calendar' },
      { href: '/social-artwork', icon: Palette, label: 'Social Artwork' },
    ]
  },
  {
    title: 'CONTENT',
    items: [
      { href: '/cms/news', icon: Newspaper, label: 'Newsroom' },
      { href: '/cms/resources', icon: BookOpen, label: 'Resources' },
    ]
  }
];

const QC_MENU_GROUP = {
  title: 'QC LAB',
  items: [
    { href: '/qc/templates', icon: FlaskConical, label: 'QC Templates' },
    { href: '/qc/requests', icon: ClipboardList, label: 'QC Requests' },
  ],
};

const SETTINGS_ITEMS = [
  { href: '/settings/company', icon: Building, label: 'Company' },
  { href: '/settings/destination', icon: Globe, label: 'Destination' },
  { href: '/settings/freight-rate', icon: DollarSign, label: 'Freight Rate' },
  { href: '/settings/products', icon: Package, label: 'Product Master' },
  { href: '/settings/ai', icon: Sparkles, label: 'AI Settings' },
  { href: '/document-comparison/rules', icon: ListChecks, label: 'Comparison Rules' },
  { href: '/settings/carrier-board', icon: Plane, label: 'Carrier board' },
];

const ADMIN_ONLY_SETTINGS = [
  { href: '/chat-logs', icon: MessageSquare, label: 'Chat Logs' },
  { href: '/settings/qc-lab-admins', icon: UserCog, label: 'QC Lab Admins' },
];

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  isMobile: boolean;
  className?: string;
}

const Sidebar = ({ isCollapsed, toggleSidebar, isMobile, className }: SidebarProps) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const pathname = usePathname();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setUserRole(data?.role ?? null));
  }, [user]);

  const isLabAdmin = userRole === ROLES.LAB_ADMIN;
  const isAdmin = userRole === ROLES.ADMIN;
  const menuGroups = isLabAdmin ? [QC_MENU_GROUP] : [...MENU_GROUPS, QC_MENU_GROUP];
  const settingsItems = isAdmin ? [...SETTINGS_ITEMS, ...ADMIN_ONLY_SETTINGS] : SETTINGS_ITEMS;
  const showSettings = !isLabAdmin;

  // Expand Settings when user is on any settings route (incl. carrier-board) or comparison rules
  useEffect(() => {
    if (isCollapsed) return;
    if (
      pathname?.startsWith('/settings') ||
      pathname?.startsWith('/document-comparison/rules')
    ) {
      setSettingsOpen(true);
    }
  }, [pathname, isCollapsed]);

  if (isCollapsed && settingsOpen) {
    setSettingsOpen(false);
  }

  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <div
      className={cn(
        "h-full flex flex-col transition-all duration-300 ease-in-out",
        "bg-white border-r border-gray-200",
        isCollapsed ? "w-[70px]" : "w-[280px]",
        isMobile ? "fixed left-0 top-0 z-50 h-screen shadow-xl" : "relative",
        isMobile && isCollapsed ? "hidden" : "flex",
        className
      )}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-gray-100",
        isCollapsed ? "justify-center px-3 h-16" : "justify-between px-5 h-16"
      )}>
        {!isCollapsed ? (
          <div className="flex w-full items-center justify-center p-2">
            <Image src="/logo.png" alt="OMGEXP" width={140} height={44} className="h-10 w-auto" />
          </div>
        ) : (
          <Button variant="ghost" size="icon" onClick={toggleSidebar}
            className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 h-10 w-10">
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {!isMobile && !isCollapsed && (
          <Button variant="ghost" size="icon" onClick={toggleSidebar}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 h-9 w-9">
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {isMobile && !isCollapsed && (
          <Button variant="ghost" size="icon" onClick={toggleSidebar}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 h-9 w-9">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {menuGroups.map((group) => (
          <div key={group.title} className="mb-5">
            {!isCollapsed && (
              <div className="px-3 mb-2">
                <span className="text-xs font-semibold text-gray-400 tracking-wider uppercase">{group.title}</span>
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} title={item.label}
                  className={cn(
                    "flex items-center rounded-lg transition-all duration-150",
                    isCollapsed ? "justify-center p-3 mx-1" : "px-4 py-3",
                    isActive(item.href)
                      ? "bg-[#215497] text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-100"
                  )}>
                  <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive(item.href) ? "text-white" : "text-gray-500")} />
                  {!isCollapsed && <span className="ml-3 text-[15px] font-medium">{item.label}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Settings */}
        {showSettings && (
        <div className="mb-5">
          {!isCollapsed && (
            <div className="px-3 mb-2">
              <span className="text-xs font-semibold text-gray-400 tracking-wider uppercase">SETTINGS</span>
            </div>
          )}
          <div className="space-y-1">
            <button onClick={() => !isCollapsed && setSettingsOpen(!settingsOpen)} title="Settings" disabled={isCollapsed}
              className={cn(
                "flex items-center w-full rounded-lg transition-all duration-150",
                isCollapsed ? "justify-center p-3 mx-1" : "px-4 py-3",
                pathname?.startsWith("/settings") || pathname?.startsWith("/document-comparison/rules")
                  ? "bg-[#215497] text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
              )}>
              <Settings className={cn("h-5 w-5 flex-shrink-0",
                pathname?.startsWith("/settings") ? "text-white" : "text-gray-500")} />
              {!isCollapsed && (
                <>
                  <span className="ml-3 text-[15px] font-medium">Settings</span>
                  <div className="ml-auto">{settingsOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</div>
                </>
              )}
            </button>

            {!isCollapsed && settingsOpen && (
              <div className="ml-4 pl-4 border-l-2 border-gray-200 space-y-1 mt-2">
                {settingsItems.map((item) => (
                  <Link key={item.href} href={item.href}
                    className={cn(
                      "flex items-center px-3 py-2.5 rounded-lg transition-all duration-150",
                      isActive(item.href) ? "text-[#215497] bg-blue-50 font-medium" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    )}>
                    <item.icon className="h-[18px] w-[18px] mr-3" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-gray-100 py-3", isCollapsed ? "px-3" : "px-5")}>
        <div className={cn("text-xs text-gray-400", isCollapsed ? "text-center" : "")}>
          {isCollapsed ? "v1.0" : "Version 1.0.0"}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
