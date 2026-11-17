'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, FileText, Trash, Search, Share2, CheckCircle, Calendar, Mail, Receipt, MoreHorizontal, FileArchive, CalendarDays, Copy, Settings2, Save, ChevronDown, X, UserPlus, Link2, Link2Off, ScrollText, UserCircle2, Leaf, Bookmark, BookmarkX, Thermometer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  getQuotations,
  deleteQuotation as dbDeleteQuotation,
  updateQuotation,
  Quotation,
  getCustomerUsers,
  assignCustomerToQuotation,
  getPendingApprovalQuotations,
  generateShareToken,
  getQuotationPayableTotalThb,
  unlinkQuotationFromOpportunity,
} from '@/lib/db';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileMenuButton } from '@/components/ui/mobile-menu-button';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination } from '@/components/ui/pagination';
import { usePagination, type UsePaginationResult } from '@/hooks/use-pagination';
import { useAuth } from '@/contexts/auth-context';

type DateFilterField = 'created_at' | 'pickup_date';

// Column definitions
const ALL_COLUMNS = [
  { id: 'date', label: 'Date', default: true },
  { id: 'id', label: 'Run No.', default: true },
  { id: 'company', label: 'Company', default: true },
  { id: 'customer', label: 'Customer', default: true },
  { id: 'consignee', label: 'Consignee', default: true },
  { id: 'destination', label: 'Destination', default: true },
  { id: 'internal_remark', label: 'Internal Remark', default: false },
  { id: 'status', label: 'Status', default: true },
  { id: 'net_weight', label: 'Net Weight', default: true },
  { id: 'shipping_date', label: 'Shipping Date', default: true },
  { id: 'total_cost', label: 'Total Cost (incl. VAT)', default: true },
] as const;

type ColumnId = typeof ALL_COLUMNS[number]['id'];

interface ColumnPreset {
  id: string;
  name: string;
  columns: ColumnId[];
}

const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ALL_COLUMNS.filter(c => c.default).map(c => c.id);

export default function ShippingCalculatorPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateField, setDateField] = useState<DateFilterField>('created_at');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keepFilter, setKeepFilter] = useState(false);
  const filterSaveReadyRef = useRef(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string>('');
  const [completedDate, setCompletedDate] = useState<Date>(new Date());
  const [isUpdating, setIsUpdating] = useState(false);
  const [isShippingDateDialogOpen, setIsShippingDateDialogOpen] = useState(false);
  const [selectedShippingDate, setSelectedShippingDate] = useState('');
  const [quotationForShipping, setQuotationForShipping] = useState<string>('');

  // Assign Customer state
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assignQuotationId, setAssignQuotationId] = useState('');
  const [customerUsers, setCustomerUsers] = useState<{ id: string; email: string; full_name: string; company: string }[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  // Column visibility and presets
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnPresets, setColumnPresets] = useState<ColumnPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState('');


  // Hydrate keep-filter preference from localStorage
  useEffect(() => {
    const savedKeepFilter = localStorage.getItem('calc_keepFilter');
    if (savedKeepFilter === '1') {
      setKeepFilter(true);
      const savedSearch = localStorage.getItem('calc_searchTerm');
      if (savedSearch) {
        setSearchTerm(savedSearch);
      }
      const savedDateField = localStorage.getItem('calc_dateField');
      if (savedDateField === 'created_at' || savedDateField === 'pickup_date') {
        setDateField(savedDateField);
      }
      const savedDateFrom = localStorage.getItem('calc_dateFrom');
      if (savedDateFrom) {
        setDateFrom(savedDateFrom);
      }
      const savedDateTo = localStorage.getItem('calc_dateTo');
      if (savedDateTo) {
        setDateTo(savedDateTo);
      }
    }
  }, []);

  // Persist search term and date filter when keep-filter is enabled
  useEffect(() => {
    if (!filterSaveReadyRef.current) {
      filterSaveReadyRef.current = true;
      return;
    }
    if (keepFilter) {
      localStorage.setItem('calc_keepFilter', '1');
      localStorage.setItem('calc_searchTerm', searchTerm);
      localStorage.setItem('calc_dateField', dateField);
      if (dateFrom) {
        localStorage.setItem('calc_dateFrom', dateFrom);
      } else {
        localStorage.removeItem('calc_dateFrom');
      }
      if (dateTo) {
        localStorage.setItem('calc_dateTo', dateTo);
      } else {
        localStorage.removeItem('calc_dateTo');
      }
    } else {
      localStorage.setItem('calc_keepFilter', '0');
      localStorage.removeItem('calc_searchTerm');
      localStorage.removeItem('calc_dateField');
      localStorage.removeItem('calc_dateFrom');
      localStorage.removeItem('calc_dateTo');
    }
  }, [keepFilter, searchTerm, dateField, dateFrom, dateTo]);

  // Load column presets from Supabase
  useEffect(() => {
    async function loadPresets() {
      try {
        const userId = user?.id;
        if (!userId) return;

        // Load presets from Supabase
        const { data, error } = await supabase
          .from('column_presets')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: true });

        if (error) {
          console.error('Error loading presets:', error);
          return;
        }

        if (data) {
          const presets: ColumnPreset[] = data.map(p => ({
            id: p.id,
            name: p.name,
            columns: p.columns as ColumnId[]
          }));
          setColumnPresets(presets);
        }
      } catch (e) {
        console.error('Error loading column presets:', e);
      }
    }

    // Load visible columns from localStorage (for quick access)
    const savedColumns = localStorage.getItem('visibleColumns');
    if (savedColumns) {
      try {
        const parsed = JSON.parse(savedColumns);
        setVisibleColumns(parsed);
      } catch (e) {
        console.error('Error loading visible columns:', e);
      }
    }

    const savedActivePreset = localStorage.getItem('activePresetId');
    if (savedActivePreset) {
      setActivePresetId(savedActivePreset);
    }

    loadPresets();
  }, [user?.id]);

  // Save visible columns to localStorage when changed
  useEffect(() => {
    localStorage.setItem('visibleColumns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // Column management functions
  const toggleColumn = (columnId: ColumnId) => {
    setVisibleColumns(prev => {
      if (prev.includes(columnId)) {
        return prev.filter(c => c !== columnId);
      } else {
        // Add column in correct order
        const orderedColumns = ALL_COLUMNS.map(c => c.id).filter(
          id => prev.includes(id) || id === columnId
        );
        return orderedColumns as ColumnId[];
      }
    });
    setActivePresetId(null); // Clear active preset when manually changing columns
  };

  const savePreset = async () => {
    if (!newPresetName.trim()) return;

    try {
      const userId = user?.id;
      if (!userId) {
        toast.error('User not authenticated');
        return;
      }

      // Save to Supabase
      const { data, error } = await supabase
        .from('column_presets')
        .insert({
          user_id: userId,
          name: newPresetName.trim(),
          columns: visibleColumns
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving preset:', error);
        toast.error('Failed to save preset');
        return;
      }

      const newPreset: ColumnPreset = {
        id: data.id,
        name: data.name,
        columns: data.columns as ColumnId[]
      };

      setColumnPresets(prev => [...prev, newPreset]);
      setActivePresetId(newPreset.id);
      localStorage.setItem('activePresetId', newPreset.id);
      setNewPresetName('');
      toast.success('Preset Saved', { description: `"${newPreset.name}" has been saved.` });
    } catch (e) {
      console.error('Error saving preset:', e);
      toast.error('Failed to save preset');
    }
  };

  const loadPreset = (preset: ColumnPreset) => {
    setVisibleColumns(preset.columns);
    setActivePresetId(preset.id);
    localStorage.setItem('activePresetId', preset.id);
    toast.success('Preset Loaded', { description: `"${preset.name}" applied.` });
  };

  const deletePreset = async (presetId: string) => {
    try {
      const { error } = await supabase
        .from('column_presets')
        .delete()
        .eq('id', presetId);

      if (error) {
        console.error('Error deleting preset:', error);
        toast.error('Failed to delete preset');
        return;
      }

      setColumnPresets(prev => prev.filter(p => p.id !== presetId));
      if (activePresetId === presetId) {
        setActivePresetId(null);
        localStorage.removeItem('activePresetId');
      }
      toast.success('Preset Deleted');
    } catch (e) {
      console.error('Error deleting preset:', e);
      toast.error('Failed to delete preset');
    }
  };

  const resetToDefault = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    setActivePresetId(null);
    localStorage.removeItem('activePresetId');
  };

  const isColumnVisible = (columnId: ColumnId) => visibleColumns.includes(columnId);

  useEffect(() => {
    const staffId = user?.id;
    if (!staffId) return;

    async function loadQuotationsFromDB(uid: string) {
      try {
        const [quotationData, pendingData] = await Promise.all([
          getQuotations(uid),
          getPendingApprovalQuotations(),
        ]);

        if (quotationData) {
          // Merge: staff quotations + pending approval (customer-created)
          const allQuotations = [...(pendingData || []), ...(quotationData || [])];
          setQuotations(allQuotations);
        } else {
          // Fallback to localStorage if database fetch fails
          const savedQuotations = localStorage.getItem('quotations');
          if (savedQuotations) {
            const parsedQuotations = JSON.parse(savedQuotations);
            setQuotations(parsedQuotations);
          } else {
            setQuotations([]);
          }
        }
      } catch {
        console.error('Error loading quotations from database:');
        setQuotations([]);
      } finally {
        setLoading(false);
      }
    }

    setLoading(true);
    loadQuotationsFromDB(staffId);
  }, [user?.id]);

  // Format number as currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    try {
      // Handle different date formats and fix timezone issue
      if (dateString.includes('T')) {
        // If it's a full datetime string, parse normally
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('th-TH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }).format(date);
      } else {
        // If it's just a date string (YYYY-MM-DD), parse as local date to avoid timezone issues
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        return new Intl.DateTimeFormat('th-TH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }).format(date);
      }
    } catch {
      return dateString; // Return original string if parsing fails
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'draft':
        return 'warning';
      case 'sent':
        return 'warning';
      case 'accepted':
        return 'success';
      case 'rejected':
        return 'destructive';
      case 'docs_uploaded':
        return 'purple'; // Use the new purple variant
      case 'completed':
        return 'success';
      case 'pending_approval':
        return 'destructive';
      case 'signed':
        return 'success';
      default:
        return 'outline';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'sent':
        return 'Submitted';
      case 'accepted':
        return 'Accepted';
      case 'rejected':
        return 'Rejected';
      case 'docs_uploaded':
        return 'Documents Uploaded';
      case 'completed':
        return 'Completed';
      case 'pending_approval':
        return '⏳ Customer Request';
      case 'signed':
        return 'Signed';
      default:
        return status;
    }
  };

  const isBooking = (q: Quotation) =>
    Boolean(q.opportunity_id) ||
    q.is_booking === true;

  const handleCopySignLink = async (quotationId: string) => {
    const token = await generateShareToken(quotationId);
    if (!token) {
      toast.error('Could not create sign link');
      return;
    }
    const url = `${window.location.origin}/quotation/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success('Sign link copied', { description: 'Send this link to the customer to e-sign.' });
  };

  // ============ ASSIGN CUSTOMER ============
  const handleOpenAssignDialog = async (quotationId: string) => {
    setAssignQuotationId(quotationId);
    setSelectedCustomerId('');
    setCustomerSearchTerm('');
    setIsAssignDialogOpen(true);

    // Load customer users
    const customers = await getCustomerUsers();
    setCustomerUsers(customers);

    // Pre-select if already assigned
    const quotation = quotations.find(q => q.id === quotationId);
    if (quotation?.customer_user_id) {
      setSelectedCustomerId(quotation.customer_user_id);
    }
  };

  const handleAssignCustomer = async () => {
    if (!assignQuotationId) return;
    setIsAssigning(true);

    const success = await assignCustomerToQuotation(
      assignQuotationId,
      selectedCustomerId || null
    );

    if (success) {
      // Update local state
      setQuotations(prev =>
        prev.map(q =>
          q.id === assignQuotationId
            ? { ...q, customer_user_id: selectedCustomerId || null }
            : q
        )
      );
      toast.success(selectedCustomerId ? 'Customer assigned successfully' : 'Customer unassigned');
      setIsAssignDialogOpen(false);
    } else {
      toast.error('Failed to assign customer');
    }

    setIsAssigning(false);
  };

  const handleDeleteQuotation = async (id: string) => {
    // ขอการยืนยันก่อนลบ
    const isConfirmed = window.confirm(`คุณต้องการลบใบเสนอราคา ${id} ใช่หรือไม่?`);

    if (!isConfirmed) {
      return; // ยกเลิกการลบถ้าไม่ยืนยัน
    }

    // Remove quotation from UI immediately for responsive feel
    setQuotations(quotations.filter(q => q.id !== id));

    // Delete from Supabase
    try {
      const success = await dbDeleteQuotation(id);

      if (!success) {
        console.error('Failed to delete quotation from database');
        // Restore UI if database delete fails
        const savedQuotations = localStorage.getItem('quotations');
        if (savedQuotations) {
          const parsedQuotations = JSON.parse(savedQuotations);
          setQuotations(parsedQuotations);
        }
      } else {
        console.log('Quotation deleted successfully from database');

        // Also remove from localStorage for sync
        try {
          const savedQuotations = localStorage.getItem('quotations');
          if (savedQuotations) {
            const parsedQuotations = JSON.parse(savedQuotations);
            const updatedQuotations = parsedQuotations.filter((q: { id: string }) => q.id !== id);
            localStorage.setItem('quotations', JSON.stringify(updatedQuotations));
          }
        } catch (error) {
          console.error('Error removing quotation from localStorage:', error);
        }
      }
    } catch (error) {
      console.error('Error deleting quotation:', error);
    }
  };

  const handleUnlinkFromOpportunity = async (quotation: Quotation) => {
    if (!quotation.opportunity_id) return;

    const label = quotation.quotation_no || quotation.id.slice(0, 8).toUpperCase();
    const isConfirmed = window.confirm(`Unlink quotation ${label} from the opportunity card?`);
    if (!isConfirmed) return;

    const previousQuotations = quotations;
    setQuotations((prev) =>
      prev.map((q) => (q.id === quotation.id ? { ...q, opportunity_id: null } : q))
    );

    try {
      const success = await unlinkQuotationFromOpportunity(quotation.id);
      if (success) {
        toast.success('Quotation unlinked from opportunity');
      } else {
        setQuotations(previousQuotations);
        toast.error('Failed to unlink quotation');
      }
    } catch (error) {
      console.error('Error unlinking quotation:', error);
      setQuotations(previousQuotations);
      toast.error('Failed to unlink quotation');
    }
  };

  const handleViewQuotation = async (id: string) => {
    // Find quotation in our list
    const quotation = quotations.find(q => q.id === id);
    if (quotation) {
      // คำนวณ freight cost ใหม่ตามน้ำหนักที่มี
      const chargeableWeight = quotation.chargeable_weight || 0;

      // ถ้ามี total_cost แต่ไม่มี freight cost ให้ประมาณค่า
      // โดยอ้างอิงจากค่า total_cost หักลบค่าอื่นๆ
      let totalFreightCost = quotation.total_freight_cost || 0;

      if (totalFreightCost === 0 && chargeableWeight > 0) {
        // ประมาณฟรีทคอสต์จาก total_cost
        // ลบค่า clearance_cost และ delivery_cost (ถ้ามี)
        const clearanceCost = quotation.clearance_cost || 0;
        const deliveryCost = quotation.delivery_service_required ?
          (quotation.delivery_vehicle_type === '4wheel' ? 3500 : 6500) : 0;

        // คำนวณผลรวมของ additional charges
        let additionalChargesTotal = 0;
        if (Array.isArray(quotation.additional_charges)) {
          additionalChargesTotal = quotation.additional_charges.reduce((sum, charge) => {
            const amount = typeof charge.amount === 'number' ? charge.amount : parseFloat(charge.amount) || 0;
            return sum + amount;
          }, 0);
        }

        // ประมาณฟรีทคอสต์
        totalFreightCost = quotation.total_cost - clearanceCost - deliveryCost - additionalChargesTotal;

        // กรณีคำนวณแล้วติดลบ ให้กำหนดเป็น 0
        totalFreightCost = Math.max(0, totalFreightCost);
      }

      // เพิ่มค่า freight cost และข้อมูลอื่นๆ ที่จำเป็น
      const enhancedQuotation = {
        ...quotation,
        totalFreightCost: totalFreightCost,
        totalVolumeWeight: quotation.total_volume_weight || 0,
        totalActualWeight: quotation.total_actual_weight || 0,
        chargeableWeight: chargeableWeight,
        clearanceCost: quotation.clearance_cost || 0,
        deliveryCost: quotation.delivery_service_required ?
          (quotation.delivery_vehicle_type === '4wheel' ? 3500 : 6500) : 0
      };

      // Set the quotation data in sessionStorage for the preview page
      sessionStorage.setItem('quotationData', JSON.stringify(enhancedQuotation));
      router.push(`/shipping-calculator/preview?id=${id}`);
    }
  };

  // Handle shipping date assignment
  const handleOpenShippingDateDialog = (id: string) => {
    setQuotationForShipping(id);
    // Get current shipping date if exists
    const quotation = quotations.find(q => q.id === id);
    setSelectedShippingDate(quotation?.shipping_date || '');
    setIsShippingDateDialogOpen(true);
  };

  const handleSaveShippingDate = async () => {
    if (!quotationForShipping || !selectedShippingDate) return;

    setIsUpdating(true);
    try {
      // Fix timezone issue by ensuring we save the date as-is without timezone conversion
      const dateToSave = selectedShippingDate; // Keep as string format YYYY-MM-DD

      // Update quotation shipping date in the database
      const result = await updateQuotation(quotationForShipping, {
        shipping_date: dateToSave
      });

      if (result) {
        // Update local state
        setQuotations(prev =>
          prev.map(q =>
            q.id === quotationForShipping
              ? { ...q, shipping_date: dateToSave }
              : q
          )
        );

        toast.success('Shipping Date Assigned', {
          description: `Shipping date has been assigned successfully.`
        });
      } else {
        toast.error('Failed to assign shipping date');
      }
    } catch (error) {
      console.error('Error assigning shipping date:', error);
      toast.error('An error occurred');
    } finally {
      setIsUpdating(false);
      setIsShippingDateDialogOpen(false);
    }
  };

  // Handle complete quotation
  const handleOpenCompleteDialog = (id: string) => {
    setSelectedQuotationId(id);
    setCompletedDate(new Date());
    setIsCompleteDialogOpen(true);
  };

  const handleCompleteQuotation = async () => {
    if (!selectedQuotationId || !completedDate) return;

    setIsUpdating(true);
    try {
      // Update quotation status in the database
      const result = await updateQuotation(selectedQuotationId, {
        status: 'completed',
        completed_at: completedDate.toISOString()
      });

      if (result) {
        // Update local state
        setQuotations(prev =>
          prev.map(q =>
            q.id === selectedQuotationId
              ? { ...q, status: 'completed', completed_at: completedDate.toISOString() }
              : q
          )
        );

        toast.success('Quotation Completed', {
          description: `Quotation has been marked as completed.`
        });
      } else {
        toast.error('Failed to complete quotation');
      }
    } catch (error) {
      console.error('Error completing quotation:', error);
      toast.error('An error occurred');
    } finally {
      setIsUpdating(false);
      setIsCompleteDialogOpen(false);
    }
  };

  const handleToggleBookingFlag = async (id: string, markAsBooking: boolean) => {
    const previousQuotations = [...quotations];
    setQuotations(prev =>
      prev.map(q =>
        q.id === id ? { ...q, is_booking: markAsBooking } : q
      )
    );

    try {
      const result = await updateQuotation(id, { is_booking: markAsBooking });

      if (result) {
        toast.success(markAsBooking ? 'Marked as Booking' : 'Booking flag removed', {
          description: markAsBooking
            ? 'This quotation is now shown as Booking.'
            : 'Manual booking flag has been cleared.',
        });
      } else {
        setQuotations(previousQuotations);
        toast.error('Failed to update booking flag');
      }
    } catch (error) {
      console.error('Error updating booking flag:', error);
      setQuotations(previousQuotations);
      toast.error('An error occurred');
    }
  };

  const handleSubmitQuotation = async (id: string) => {
    // Optimistic UI update
    const previousQuotations = [...quotations];
    setQuotations(prev =>
      prev.map(q =>
        q.id === id ? { ...q, status: 'sent' } : q // Assuming 'sent' is the active status
      )
    );

    try {
      const result = await updateQuotation(id, { status: 'sent' });

      if (result) {
        toast.success('Quotation Submitted', {
          description: 'Quotation moved to Booking list.'
        });
      } else {
        // Revert on failure
        setQuotations(previousQuotations);
        toast.error('Failed to submit quotation');
      }
    } catch (error) {
      console.error('Error submitting quotation:', error);
      setQuotations(previousQuotations);
      toast.error('An error occurred');
    }
  };

  // Separate quotations by status
  const draftQuotations = quotations.filter(quotation => quotation.status === 'draft');
  const activeQuotations = quotations.filter(quotation => quotation.status !== 'completed' && quotation.status !== 'draft');
  const completedQuotations = quotations.filter(quotation => quotation.status === 'completed');

  // Filter function for search and date range
  const hasDateFilter = Boolean(dateFrom || dateTo);
  const hasActiveFilters = Boolean(searchTerm || hasDateFilter);

  const inDateRange = (quotation: Quotation) => {
    if (!hasDateFilter) return true;
    const raw = dateField === 'created_at' ? quotation.created_at : quotation.opportunities?.pickup_date;
    if (!raw) return false;
    const d = raw.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const filterQuotations = (quotationsList: Quotation[]) => {
    const list = quotationsList.filter(inDateRange);

    if (!searchTerm) return list;

    const searchTermLower = searchTerm.toLowerCase();
    const searchDigits = searchTerm.replace(/[^0-9]/g, '');

    return list.filter(quotation => {
      const textMatch =
        quotation.id?.toLowerCase().includes(searchTermLower) ||
        quotation.quotation_no?.toLowerCase().includes(searchTermLower) ||
        quotation.company_name?.toLowerCase().includes(searchTermLower) ||
        quotation.customer_name?.toLowerCase().includes(searchTermLower);

      if (textMatch) return true;

      if (searchDigits) {
        const amountDigits = String(Math.round(getQuotationPayableTotalThb(quotation)));
        return amountDigits.includes(searchDigits);
      }
      return false;
    });
  };

  const clearDateFilter = () => {
    setDateField('created_at');
    setDateFrom('');
    setDateTo('');
  };

  const filteredDraftQuotations = filterQuotations(draftQuotations);
  const filteredActiveQuotations = filterQuotations(activeQuotations);
  const filteredCompletedQuotations = filterQuotations(completedQuotations);

  const filterResetDeps = [searchTerm, dateFrom, dateTo, dateField];
  const draftPager = usePagination('quotations-draft', filteredDraftQuotations, filterResetDeps);
  const activePager = usePagination('quotations-active', filteredActiveQuotations, filterResetDeps);
  const completedPager = usePagination('quotations-completed', filteredCompletedQuotations, filterResetDeps);

  // Function to render quotations table
  const renderQuotationsTable = (pager: UsePaginationResult<Quotation>, showCompleteButton: boolean = true) => {
    if (pager.total === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium">No quotations found</h3>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            {hasActiveFilters ? 'Try adjusting your search or date range.' : 'No quotations in this category yet.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {isColumnVisible('date') && <TableHead className="min-w-[90px] text-xs sm:text-sm">Date</TableHead>}
              {isColumnVisible('id') && <TableHead className="min-w-[80px] text-xs sm:text-sm">ID</TableHead>}
              {isColumnVisible('company') && <TableHead className="min-w-[120px] text-xs sm:text-sm">Company</TableHead>}
              {isColumnVisible('customer') && <TableHead className="min-w-[120px] text-xs sm:text-sm">Customer</TableHead>}
              {isColumnVisible('consignee') && <TableHead className="min-w-[120px] text-xs sm:text-sm">Consignee</TableHead>}
              {isColumnVisible('destination') && <TableHead className="min-w-[100px] text-xs sm:text-sm">Destination</TableHead>}
              {isColumnVisible('internal_remark') && <TableHead className="min-w-[120px] text-xs sm:text-sm">Internal Remark</TableHead>}
              {isColumnVisible('status') && <TableHead className="min-w-[80px] text-xs sm:text-sm">Status</TableHead>}
              {isColumnVisible('net_weight') && <TableHead className="min-w-[100px] text-xs sm:text-sm">Net Weight</TableHead>}
              {isColumnVisible('shipping_date') && <TableHead className="min-w-[100px] text-xs sm:text-sm">Shipping Date</TableHead>}
              {isColumnVisible('total_cost') && <TableHead className="min-w-[100px] text-xs sm:text-sm">Total Cost (incl. VAT)</TableHead>}
              <TableHead className="min-w-[140px] text-right text-xs sm:text-sm">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.items.map((quotation) => (
              <TableRow key={quotation.id}>
                {isColumnVisible('date') && <TableCell className="text-xs sm:text-sm">{formatDate(quotation.created_at)}</TableCell>}
                {isColumnVisible('id') && <TableCell className="text-xs sm:text-sm font-mono">{quotation.quotation_no || quotation.id.slice(0, 8)}</TableCell>}
                {isColumnVisible('company') && (
                  <TableCell className="text-xs sm:text-sm">
                    {quotation.company_name || (
                      <span className="text-gray-400 italic">— (no company)</span>
                    )}
                  </TableCell>
                )}
                {isColumnVisible('customer') && <TableCell className="text-xs sm:text-sm">{quotation.customer_name || '-'}</TableCell>}
                {isColumnVisible('consignee') && (
                  <TableCell className="text-xs sm:text-sm">
                    <div className="max-w-[240px] sm:max-w-[280px]">
                      {quotation.consignee_name ? (
                        <div className="truncate" title={quotation.consignee_name}>
                          {quotation.consignee_name}
                        </div>
                      ) : (
                        '-'
                      )}
                    </div>
                  </TableCell>
                )}
                {isColumnVisible('destination') && (
                  <TableCell className="text-xs sm:text-sm">
                    <div className="max-w-[240px] sm:max-w-[280px]">
                      {quotation.destination ? (
                        <div className="truncate" title={quotation.destination}>
                          {quotation.destination}
                        </div>
                      ) : quotation.requested_destination ? (
                        <div className="flex flex-col min-w-0">
                          <span
                            className="font-medium text-emerald-700 truncate"
                            title={quotation.requested_destination}
                          >
                            {quotation.requested_destination}
                          </span>
                          <span className="text-[10px] text-emerald-500 uppercase font-bold tracking-tight">
                            (Customer Req)
                          </span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </div>
                  </TableCell>
                )}
                {isColumnVisible('internal_remark') && (
                  <TableCell className="text-xs sm:text-sm italic text-blue-600 max-w-[150px] truncate" title={quotation.internal_remark || ''}>
                    {quotation.internal_remark || '-'}
                  </TableCell>
                )}
                {isColumnVisible('status') && (
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={getStatusBadgeVariant(quotation.status)} className="text-xs">
                        {getStatusText(quotation.status)}
                      </Badge>
                      {quotation.status !== 'draft' && isBooking(quotation) && (
                        <Badge variant="orange" className="text-xs">
                          Booking
                        </Badge>
                      )}
                      {quotation.customer_user_id && (
                        <span
                          className="inline-flex items-center justify-center text-emerald-600"
                          title="Quote originated from a customer request"
                        >
                          <UserCircle2 className="w-4 h-4" />
                        </span>
                      )}
                      {quotation.phyto_required && (
                        <span
                          className="inline-flex items-center justify-center text-emerald-700"
                          title="Customer requested Phytosanitary Certificate service"
                        >
                          <Leaf className="w-4 h-4" />
                        </span>
                      )}
                      {quotation.notes?.includes('[DATA LOGGER]') && (
                        <span
                          className="inline-flex items-center justify-center text-sky-600"
                          title="Customer will attach data logger (MSDS)"
                        >
                          <Thermometer className="w-4 h-4" />
                        </span>
                      )}
                      {quotation.opportunity_id ? (
                        <Link
                          href={`/opportunities/${quotation.opportunity_id}`}
                          className="inline-flex items-center justify-center text-violet-600 hover:text-violet-800 transition-colors"
                          title="Linked to opportunity — click to open"
                        >
                          <Link2 className="w-4 h-4" />
                        </Link>
                      ) : (
                        <span
                          className="inline-flex items-center justify-center text-gray-300"
                          title="Not linked to any opportunity"
                        >
                          <Link2Off className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                  </TableCell>
                )}
                {isColumnVisible('net_weight') && (
                  <TableCell className="text-xs sm:text-sm">
                    {(() => {
                      // Use stored total_actual_weight if available
                      if (quotation.total_actual_weight) {
                        return `${quotation.total_actual_weight} kg`;
                      }

                      // Calculate from pallets if no stored value
                      if (quotation.pallets && quotation.pallets.length > 0) {
                        const calculatedWeight = quotation.pallets.reduce((total, pallet) => {
                          const weight = typeof pallet.weight === 'number' ? pallet.weight : parseFloat(pallet.weight) || 0;
                          const quantity = typeof pallet.quantity === 'number' ? pallet.quantity : parseInt(pallet.quantity) || 1;
                          return total + (weight * quantity);
                        }, 0);
                        return calculatedWeight > 0 ? `${calculatedWeight} kg` : '-';
                      }

                      return '-';
                    })()}
                  </TableCell>
                )}
                {isColumnVisible('shipping_date') && (
                  <TableCell className="text-xs sm:text-sm">
                    {quotation.shipping_date ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenShippingDateDialog(quotation.id)}
                        className="h-auto p-1 flex items-center gap-2 text-green-700 hover:text-green-800 hover:bg-green-50"
                      >
                        <CalendarDays className="h-3 w-3" />
                        <span className="text-xs">
                          {formatDate(quotation.shipping_date)}
                        </span>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenShippingDateDialog(quotation.id)}
                        className="h-6 text-xs px-2 py-1"
                      >
                        <Calendar className="h-3 w-3 mr-1" />
                        Assign
                      </Button>
                    )}
                  </TableCell>
                )}
                {isColumnVisible('total_cost') && <TableCell className="text-xs sm:text-sm">{formatCurrency(getQuotationPayableTotalThb(quotation))}</TableCell>}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 sm:gap-2">
                    {/* View Quotation Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewQuotation(quotation.id)}
                      title="View quotation"
                      className="h-7 w-7 sm:h-9 sm:w-9 p-0"
                    >
                      <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>

                    {/* View Documents Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      title="View Documents"
                      className="h-7 w-7 sm:h-9 sm:w-9 p-0"
                    >
                      <Link href={`/document-submissions?quotation=${quotation.id}`}>
                        <FileArchive className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Link>
                    </Button>

                    {/* Share Upload Link Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const url = `${window.location.origin}/documents-upload/${quotation.id}?company=${encodeURIComponent(quotation.company_name || '')}&destination=${encodeURIComponent(quotation.destination || '')}&commodity=${quotation.commodity_type || 'cannabis'}`;
                        navigator.clipboard.writeText(url);
                        toast.success('Link Copied', {
                          description: 'Document upload link copied to clipboard!'
                        });
                      }}
                      title="Share Upload Link"
                      className="h-7 w-7 sm:h-9 sm:w-9 p-0"
                    >
                      <Share2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>

                    {/* Copy E-sign link */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopySignLink(quotation.id)}
                      title="Copy sign link (customer e-sign)"
                      className="h-7 w-7 sm:h-9 sm:w-9 p-0"
                    >
                      <Link2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>

                    {/* Actions Dropdown Menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 sm:h-9 sm:w-9 p-0"
                        >
                          <MoreHorizontal className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {/* Review & Approve customer request */}
                        {quotation.status === 'pending_approval' && (
                          <DropdownMenuItem asChild>
                            <Link href={`/shipping-calculator/new?approve_from=${quotation.id}`} className="flex items-center text-orange-600 font-semibold">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Review & Approve
                            </Link>
                          </DropdownMenuItem>
                        )}

                        {/* Submit Draft */}
                        {quotation.status === 'draft' && (
                          <DropdownMenuItem onClick={() => handleSubmitQuotation(quotation.id)}>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Submit (Make Active)
                          </DropdownMenuItem>
                        )}

                        {/* Mark / Unmark as Booking (manual flag) */}
                        {!isBooking(quotation) && (
                          <DropdownMenuItem onClick={() => handleToggleBookingFlag(quotation.id, true)}>
                            <Bookmark className="h-4 w-4 mr-2" />
                            Mark as Booking
                          </DropdownMenuItem>
                        )}
                        {quotation.is_booking === true && (
                          <DropdownMenuItem onClick={() => handleToggleBookingFlag(quotation.id, false)}>
                            <BookmarkX className="h-4 w-4 mr-2" />
                            Unmark Booking
                          </DropdownMenuItem>
                        )}

                        {/* Create Booking Email */}
                        <DropdownMenuItem asChild>
                          <Link href={`/email-booking/${quotation.id}`} className="flex items-center">
                            <Mail className="h-4 w-4 mr-2" />
                            Create Booking Email
                          </Link>
                        </DropdownMenuItem>

                        {/* Create Debit Note */}
                        <DropdownMenuItem asChild>
                          <Link href={`/debit-note/${quotation.id}`} className="flex items-center">
                            <Receipt className="h-4 w-4 mr-2" />
                            Create Debit Note
                          </Link>
                        </DropdownMenuItem>

                        {/* Create Proforma Invoice */}
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/proforma-invoices/new?quotation_id=${quotation.id}`}
                            className="flex items-center"
                          >
                            <ScrollText className="h-4 w-4 mr-2" />
                            Create Proforma Invoice
                          </Link>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {/* Clone Quotation */}
                        <DropdownMenuItem asChild>
                          <Link href={`/shipping-calculator/new?clone_from=${quotation.id}`} className="flex items-center">
                            <Copy className="h-4 w-4 mr-2" />
                            Clone Quotation
                          </Link>
                        </DropdownMenuItem>

                        {/* Assign Customer */}
                        <DropdownMenuItem onClick={() => handleOpenAssignDialog(quotation.id)}>
                          <UserPlus className="h-4 w-4 mr-2" />
                          {quotation.customer_user_id ? 'Change Customer' : 'Assign Customer'}
                        </DropdownMenuItem>

                        {quotation.opportunity_id && (
                          <DropdownMenuItem onClick={() => handleUnlinkFromOpportunity(quotation)}>
                            <Link2Off className="h-4 w-4 mr-2" />
                            Unlink from OP Card
                          </DropdownMenuItem>
                        )}

                        {/* Mark as Completed */}
                        {showCompleteButton && quotation.status !== 'completed' && (
                          <DropdownMenuItem
                            onClick={() => handleOpenCompleteDialog(quotation.id)}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Mark as Completed
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />

                        {/* Delete */}
                        <DropdownMenuItem
                          onClick={() => handleDeleteQuotation(quotation.id)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Delete Quotation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination pager={pager} />
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col space-y-4 sm:flex-row sm:justify-between sm:items-center sm:space-y-0">
        <div className="flex items-center gap-3">
          <MobileMenuButton />
          <h1 className="text-2xl sm:text-3xl font-bold">Shipping Calculator</h1>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <Link href="/shipping-calculator/new">
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
            <span className="text-sm sm:text-base">New Calculation</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col space-y-4 sm:flex-row sm:justify-between sm:items-start sm:space-y-0">
            <div>
              <CardTitle className="text-lg sm:text-xl">Quotations Management</CardTitle>
              <CardDescription className="text-sm">View and manage your shipping quotations by status</CardDescription>
            </div>

            {/* Column Settings */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Settings2 className="h-4 w-4" />
                  Columns
                  {activePresetId && columnPresets.find(p => p.id === activePresetId) && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {columnPresets.find(p => p.id === activePresetId)?.name}
                    </Badge>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-4">
                  <div className="font-medium text-sm">Show/Hide Columns</div>

                  {/* Column Checkboxes */}
                  <div className="space-y-2">
                    {ALL_COLUMNS.map((column) => (
                      <div key={column.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`col-${column.id}`}
                          checked={isColumnVisible(column.id)}
                          onCheckedChange={() => toggleColumn(column.id)}
                        />
                        <label
                          htmlFor={`col-${column.id}`}
                          className="text-sm cursor-pointer"
                        >
                          {column.label}
                        </label>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Presets</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetToDefault}
                        className="h-7 text-xs"
                      >
                        Reset Default
                      </Button>
                    </div>

                    {/* Saved Presets */}
                    {columnPresets.length > 0 && (
                      <div className="space-y-1 mb-3">
                        {columnPresets.map((preset) => (
                          <div
                            key={preset.id}
                            className={`flex items-center justify-between p-2 rounded-md text-sm cursor-pointer hover:bg-slate-100 ${activePresetId === preset.id ? 'bg-green-50 border border-green-200' : ''
                              }`}
                            onClick={() => loadPreset(preset)}
                          >
                            <span className="truncate">{preset.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-red-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePreset(preset.id);
                              }}
                            >
                              <X className="h-3 w-3 text-red-500" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Save New Preset */}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Preset name..."
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && savePreset()}
                      />
                      <Button
                        size="sm"
                        onClick={savePreset}
                        disabled={!newPresetName.trim()}
                        className="h-8 bg-[#7CB342] hover:bg-[#689F38]"
                      >
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Search Input */}
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div className="relative flex-1 min-w-[200px] sm:max-w-[33%]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by ID, Company, Customer, or Amount..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-full text-sm"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="calc-date-field" className="text-xs text-gray-500">Filter by</Label>
                <Select value={dateField} onValueChange={(v) => setDateField(v as DateFilterField)}>
                  <SelectTrigger id="calc-date-field" size="sm" className="w-[140px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_at">Date</SelectItem>
                    <SelectItem value="pickup_date">Pick up date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="calc-date-from" className="text-xs text-gray-500">From</Label>
                <Input
                  id="calc-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[140px] text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="calc-date-to" className="text-xs text-gray-500">To</Label>
                <Input
                  id="calc-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[140px] text-sm"
                />
              </div>
              {hasDateFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={clearDateFilter}
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear dates
                </Button>
              )}
            </div>
            <div className="flex items-center space-x-2 pb-1">
              <Checkbox
                id="keep-filter"
                checked={keepFilter}
                onCheckedChange={(checked) => setKeepFilter(checked as boolean)}
              />
              <Label
                htmlFor="keep-filter"
                className="text-xs font-medium cursor-pointer text-gray-600 whitespace-nowrap"
              >
                Keep filter
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-pulse">Loading quotations...</div>
            </div>
          ) : quotations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium">No quotations yet</h3>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                Create your first shipping calculation to generate a quotation.
              </p>
              <Button asChild>
                <Link href="/shipping-calculator/new">
                  <Plus className="h-4 w-4 mr-2" />
                  New Calculation
                </Link>
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="drafts" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger
                  value="drafts"
                  className="flex items-center gap-2 data-[state=active]:bg-yellow-100 data-[state=active]:text-yellow-800 data-[state=active]:border-yellow-200"
                >
                  <FileArchive className="h-4 w-4" />
                  Quoting ({filteredDraftQuotations.length})
                </TabsTrigger>
                <TabsTrigger
                  value="active"
                  className="flex items-center gap-2 data-[state=active]:bg-orange-100 data-[state=active]:text-orange-800 data-[state=active]:border-orange-200"
                >
                  <FileText className="h-4 w-4" />
                  Booking ({filteredActiveQuotations.length})
                </TabsTrigger>
                <TabsTrigger
                  value="completed"
                  className="flex items-center gap-2 data-[state=active]:bg-green-100 data-[state=active]:text-green-800 data-[state=active]:border-green-200"
                >
                  <CheckCircle className="h-4 w-4" />
                  Completed ({filteredCompletedQuotations.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="drafts" className="mt-4">
                {renderQuotationsTable(draftPager, true)}
              </TabsContent>

              <TabsContent value="active" className="mt-4">
                {renderQuotationsTable(activePager, true)}
              </TabsContent>

              <TabsContent value="completed" className="mt-4">
                {renderQuotationsTable(completedPager, false)}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Shipping Date Assignment Dialog */}
      <Dialog open={isShippingDateDialogOpen} onOpenChange={setIsShippingDateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Shipping Date</DialogTitle>
            <DialogDescription>
              Select the shipping date for this quotation. This will be displayed in the Calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="space-y-2">
              <Label htmlFor="shipping-date">Shipping Date</Label>
              <Input
                id="shipping-date"
                type="date"
                value={selectedShippingDate}
                onChange={(e) => setSelectedShippingDate(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <DialogFooter>
            <div className="flex justify-between w-full">
              <div>
                {quotations.find(q => q.id === quotationForShipping)?.shipping_date && (
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      setIsUpdating(true);
                      try {
                        const result = await updateQuotation(quotationForShipping, {
                          shipping_date: null
                        });
                        if (result) {
                          setQuotations(prev =>
                            prev.map(q =>
                              q.id === quotationForShipping
                                ? { ...q, shipping_date: null }
                                : q
                            )
                          );
                          toast.success('Shipping date removed');
                          setIsShippingDateDialogOpen(false);
                        }
                      } catch {
                        toast.error('Failed to remove date');
                      } finally {
                        setIsUpdating(false);
                      }
                    }}
                    disabled={isUpdating}
                  >
                    Remove Date
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsShippingDateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveShippingDate}
                  disabled={isUpdating || !selectedShippingDate}
                  className="bg-[#7CB342] hover:bg-[#689F38]"
                >
                  {isUpdating ? 'Saving...' : 'Assign Date'}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Confirmation Dialog */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Quotation as Completed</DialogTitle>
            <DialogDescription>
              This will mark the quotation as completed. The completion date will be set to today.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span>Completion Date: {completedDate.toLocaleDateString()}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCompleteQuotation}
              disabled={isUpdating}
              className="bg-green-600 hover:bg-green-700"
            >
              {isUpdating ? 'Processing...' : 'Complete Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ============ ASSIGN CUSTOMER DIALOG ============ */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Customer</DialogTitle>
            <DialogDescription>
              Select a customer to assign this quotation to. The customer will be able to view this quotation in their portal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search customer..."
                value={customerSearchTerm}
                onChange={(e) => setCustomerSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            {/* Customer List */}
            <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {/* Unassign option */}
              <button
                onClick={() => setSelectedCustomerId('')}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${selectedCustomerId === '' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-500'
                  }`}
              >
                <div className="font-medium">— No customer (Unassign)</div>
              </button>

              {customerUsers
                .filter(c => {
                  if (!customerSearchTerm) return true;
                  const q = customerSearchTerm.toLowerCase();
                  return (
                    c.full_name.toLowerCase().includes(q) ||
                    c.email.toLowerCase().includes(q) ||
                    c.company.toLowerCase().includes(q)
                  );
                })
                .map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => setSelectedCustomerId(customer.id)}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${selectedCustomerId === customer.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                      }`}
                  >
                    <div className="font-medium text-gray-900">{customer.full_name || customer.email}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {customer.company && <span>{customer.company} &middot; </span>}
                      {customer.email}
                    </div>
                  </button>
                ))}

              {customerUsers.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  No customer accounts found. Customers need to register first.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignCustomer}
              disabled={isAssigning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isAssigning ? 'Assigning...' : selectedCustomerId ? 'Assign Customer' : 'Unassign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 