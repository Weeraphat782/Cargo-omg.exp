"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { KanbanBoard } from '@/components/opportunities/kanban-board';
import { ListView } from '@/components/opportunities/list-view';
import { PickupCalendarView } from '@/components/opportunities/pickup-calendar-view';
import { Button } from '@/components/ui/button';
import { RefreshCw, PlusCircle, LayoutGrid, List, Truck, Search, ChevronsUpDown, Check, CalendarDays } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OpportunityDialog } from '@/components/opportunities/new-opportunity-dialog';
import { Opportunity, OpportunityStage, isPickupToday } from '@/types/opportunity';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { getCompaniesForDropdown } from '@/lib/db';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Trophy, XCircle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ViewMode = 'kanban' | 'list' | 'calendar';

function OmgFilterCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate">{value || 'All OMG Nos.'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search OMG no..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onChange(query.trim());
                  setOpen(false);
                }
              }}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="max-h-60 overflow-auto p-1">
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <Check className={`mr-2 h-3.5 w-3.5 ${value ? 'opacity-0' : ''}`} />
            All OMG Nos.
          </button>
          {filtered.map((no) => (
            <button
              key={no}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm font-mono hover:bg-accent"
              onClick={() => {
                onChange(no);
                setOpen(false);
              }}
            >
              <Check className={`mr-2 h-3.5 w-3.5 ${value === no ? '' : 'opacity-0'}`} />
              {no}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching OMG no.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOpportunities = useCallback(async () => {
    setLoading(true);

    // Get current user for filtering
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    let query = supabase
      .from('opportunities')
      // Select opportunity fields AND linked quotations(id)
      .select(`
        *,
        quotations(
          id, price_confirmed, total_cost, vat_amount, wht_amount, wht_enabled, quotation_no,
          customer_user_id, phyto_required, notes, commodity_type, status, consignee_name,
          awb_number, awb_file_url, booking_share_token,
          document_submissions(count)
        ),
        destination:destination_id(country, port),
        opportunity_products(product:products(id, name))
      `);

    // Filter by owner_id if user is logged in
    if (userId) {
      query = query.eq('owner_id', userId);
    }

    const { data, error } = await query.order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching opportunities:', error);
      console.error('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      toast.error(`Failed to fetch opportunities: ${error.message}`);
    } else {
      interface RawSupabaseOpportunity {
        id: string;
        topic: string;
        customer_name: string | null;
        company_id: string | null;
        amount: number;
        currency: string;
        stage: OpportunityStage;
        probability: number;
        created_at: string;
        updated_at: string;
        close_date: string;
        vehicle_type?: string;
        container_size?: string;
        product_details?: string | { description?: string };
        notes?: string;
        destination_id?: string;
        destination?: { country: string; port: string | null };
        product_id?: string | null;
        quotations?: {
          id: string;
          price_confirmed?: boolean;
          total_cost?: number;
          vat_amount?: number | null;
          wht_amount?: number | null;
          wht_enabled?: boolean | null;
          quotation_no?: string;
          customer_user_id?: string | null;
          phyto_required?: boolean | null;
          notes?: string | null;
          commodity_type?: string | null;
          status?: string;
          consignee_name?: string | null;
          awb_number?: string | null;
          awb_file_url?: string | null;
          booking_share_token?: string | null;
          document_submissions?: { count: number }[];
        }[];
        opportunity_products?: { product: { id: string; name: string } }[];
        closure_status?: 'won' | 'lost' | null;
        phyto_done?: boolean | null;
        focus_color?: string | null;
        sort_order?: number | null;
        pickup_date?: string | null;
        payment_date?: string | null;
      }

      // Map DB fields to Frontend types
      const mapped: Opportunity[] = (data as unknown as RawSupabaseOpportunity[]).map((item) => {
        // item.quotations will be an array of objects { id, price_confirmed }
        const quotationIds = item.quotations && item.quotations.length > 0
          ? item.quotations.map(q => q.id)
          : [];
        const quotationDetails = item.quotations && item.quotations.length > 0
          ? item.quotations.map(q => ({
              id: q.id,
              price_confirmed: q.price_confirmed ?? false,
              total_cost: q.total_cost,
              vat_amount: q.vat_amount,
              wht_amount: q.wht_amount,
              wht_enabled: q.wht_enabled,
              quotation_no: q.quotation_no,
              customer_user_id: q.customer_user_id ?? null,
              phyto_required: !!q.phyto_required,
              notes: q.notes ?? null,
              commodity_type: (q.commodity_type as 'cannabis' | 'hemp' | 'kratom' | 'general' | null) ?? null,
              status: q.status,
              consignee_name: q.consignee_name ?? null,
              docs_count: q.document_submissions?.[0]?.count ?? 0,
              awb_number: q.awb_number ?? null,
              awb_file_url: q.awb_file_url ?? null,
              booking_share_token: q.booking_share_token ?? null,
            }))
          : [];

        // Extract destination name
        const dest = item.destination;
        const destinationName = dest ? `${dest.country}${dest.port ? ` (${dest.port})` : ''}` : undefined;

        return {
          id: item.id,
          topic: item.topic,
          customerName: item.customer_name || 'Unknown',
          companyName: item.customer_name || 'Unknown',
          companyId: item.company_id || undefined,
          amount: item.amount,
          currency: item.currency,
          stage: item.stage,
          probability: item.probability,
          closeDate: item.close_date,
          ownerName: 'Me',
          createdAt: item.created_at,
          updatedAt: item.updated_at,

          vehicleType: item.vehicle_type,
          containerSize: item.container_size,
          productDetails: typeof item.product_details === 'object' ? item.product_details?.description || '' : item.product_details || '',
          notes: item.notes,
          destinationId: item.destination_id,
          destinationName,
          productId: item.opportunity_products?.map(op => op.product.id) || [],
          productName: item.opportunity_products?.map(op => op.product.name) || [],

          quotationIds,
          quotationDetails,
          closureStatus: item.closure_status || null,
          phytoDone: item.phyto_done === true,
          focusColor: item.focus_color || null,
          sortOrder: item.sort_order || null,
          pickupDate: item.pickup_date || undefined,
          paymentDate: item.payment_date || undefined
        }
      });
      setOpportunities(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOpportunities();

    // Subscribe to realtime changes in quotations to update the board when a quotation is linked
    const channel = supabase
      .channel('realtime-quotations-opportunities')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quotations' },
        (payload) => {
          console.log('Quotation change detected:', payload);
          fetchOpportunities();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOpportunities]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState<Opportunity | undefined>(undefined);
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [omgSearch, setOmgSearch] = useState('');
  const [keepFilter, setKeepFilter] = useState(false);
  const filterSaveReadyRef = useRef(false);
  const [showWon, setShowWon] = useState<boolean>(false);
  const [showLost, setShowLost] = useState<boolean>(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');

  // Hydrate keep-filter preference from localStorage
  useEffect(() => {
    const savedKeepFilter = localStorage.getItem('opp_keepFilter');
    if (savedKeepFilter === '1') {
      setKeepFilter(true);
      const savedCompany = localStorage.getItem('opp_selectedCompany');
      if (savedCompany) {
        setSelectedCompany(savedCompany);
      }
      const savedOmg = localStorage.getItem('opp_omgSearch');
      if (savedOmg) {
        setOmgSearch(savedOmg);
      }
    }
  }, []);

  // Persist company + OMG filters when keep-filter is enabled
  useEffect(() => {
    if (!filterSaveReadyRef.current) {
      filterSaveReadyRef.current = true;
      return;
    }
    if (keepFilter) {
      localStorage.setItem('opp_keepFilter', '1');
      localStorage.setItem('opp_selectedCompany', selectedCompany);
      localStorage.setItem('opp_omgSearch', omgSearch);
    } else {
      localStorage.setItem('opp_keepFilter', '0');
      localStorage.removeItem('opp_selectedCompany');
      localStorage.removeItem('opp_omgSearch');
    }
  }, [keepFilter, selectedCompany, omgSearch]);

  // Hydrate saved view mode (desktop only — mobile is forced to list below)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) return;
    const saved = localStorage.getItem('opp_viewMode');
    if (saved === 'kanban' || saved === 'list' || saved === 'calendar') {
      setViewMode(saved);
    }
  }, []);

  // Auto-switch to list view on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setViewMode('list');
      }
    };
    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch companies for filter
  useEffect(() => {
    const fetchCompaniesData = async () => {
      const companiesData = await getCompaniesForDropdown();
      setCompanies(companiesData || []);
    };
    fetchCompaniesData();
  }, []);

  const omgOptions = useMemo(() => {
    const nos = new Set<string>();
    for (const opp of opportunities) {
      for (const qd of opp.quotationDetails ?? []) {
        const no = qd.quotation_no?.trim();
        if (no) nos.add(no);
      }
    }
    return Array.from(nos).sort((a, b) => a.localeCompare(b));
  }, [opportunities]);

  const handleEditOpportunity = (opportunity: Opportunity) => {
    console.log('handleEditOpportunity called with:', opportunity);
    setEditingOpportunity(opportunity);
    setIsDialogOpen(true);
  };

  const handleDeleteOpportunity = async (id: string) => {
    try {
      const { error } = await supabase
        .from('opportunities')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting opportunity:', error);
        toast.error(`Failed to delete opportunity: ${error.message}`);
      } else {
        toast.success('Opportunity deleted');
        fetchOpportunities();
      }
    } catch (err) {
      console.error('Error in handleDelete:', err);
    }
  };

  const handleOpportunityPatch = useCallback((opportunityId: string, patch: Partial<Opportunity>) => {
    setOpportunities((prev) =>
      prev.map((o) => (o.id === opportunityId ? { ...o, ...patch } : o))
    );
  }, []);

  const handleReorder = async (updatedSubset: Opportunity[]) => {
    // Update parent state: replace items in their original "slots"
    setOpportunities(prevOpportunities => {
      const newOpportunities = [...prevOpportunities];
      
      // Find the original indices where the visible items were located
      const subsetIds = new Set(updatedSubset.map(opp => opp.id));
      const originalIndices = prevOpportunities
        .map((opp, index) => subsetIds.has(opp.id) ? index : -1)
        .filter(idx => idx !== -1);

      // Map newly ordered items back into those original slots
      updatedSubset.forEach((updatedOpp, i) => {
        if (i < originalIndices.length) {
          newOpportunities[originalIndices[i]] = updatedOpp;
        }
      });
      
      return newOpportunities;
    });

    try {
      // Calculate sort_order based on the reordered subset
      const updates = updatedSubset.map((opp, index) => ({
        id: opp.id,
        sort_order: (index + 1) * 10
      }));

      // Supabase .upsert doesn't easily handle partial updates of specific columns across many rows
      // because it requires all NOT NULL fields to be present for the 'INSERT' part of the operation.
      // We'll use Promise.all for individual updates for now.
      const updatePromises = updates.map(u =>
        supabase
          .from('opportunities')
          .update({ sort_order: u.sort_order })
          .eq('id', u.id)
      );

      const results = await Promise.all(updatePromises);
      const firstError = results.find(r => r.error)?.error;

      if (firstError) throw firstError;

      console.log('Reorder saved successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to save reorder:', message);
      toast.error('Failed to save arrangement: ' + message);
      // Optional: rollback fetchOpportunities();
    }
  };

  const handleSaveOpportunity = async (opportunityData: Partial<Opportunity>) => {
    try {
      console.log('handleSaveOpportunity received:', opportunityData);

      // Validate required fields
      if (!opportunityData.topic || opportunityData.topic.trim() === '') {
        throw new Error('Topic is required');
      }

      if (!opportunityData.customerName || opportunityData.customerName.trim() === '') {
        throw new Error('Customer name is required');
      }

      // Get current user ID for owner_id (optional - RLS disabled)
      const { data: { user } } = await supabase.auth.getUser();

      const payload = {
        topic: opportunityData.topic.trim(),
        customer_name: opportunityData.customerName.trim(),
        company_id: opportunityData.companyId || null,
        amount: opportunityData.amount || 0,
        currency: opportunityData.currency || 'THB',
        stage: opportunityData.stage || 'inquiry',
        probability: opportunityData.probability || 10,
        close_date: opportunityData.closeDate ? new Date(opportunityData.closeDate).toISOString().split('T')[0] : null,
        vehicle_type: opportunityData.vehicleType || null,
        container_size: opportunityData.containerSize || null,
        product_details: opportunityData.productDetails || null,
        notes: opportunityData.notes || null,
        destination_id: opportunityData.destinationId || null,
        owner_id: user?.id || null, // Set owner if available
        pickup_date: opportunityData.pickupDate || null,
      };

      console.log('Payload to save:', payload);

      let oppId: string;

      if (editingOpportunity) {
        console.log('Updating existing opportunity:', editingOpportunity.id);
        const { error } = await supabase
          .from('opportunities')
          .update(payload)
          .eq('id', editingOpportunity.id);

        if (error) {
          console.error('Update error:', error);
          throw error;
        }

        oppId = editingOpportunity.id;
        toast.success('Opportunity updated');
      } else {
        console.log('Creating new opportunity');
        const { data, error } = await supabase
          .from('opportunities')
          .insert([payload])
          .select('id')
          .single();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }

        oppId = data!.id;
        toast.success('Opportunity created');
      }

      // Update product links in junction table
      if (opportunityData.productId && opportunityData.productId.length > 0) {
        console.log('Updating product links for opportunity:', oppId);

        // Delete existing links
        const { error: deleteError } = await supabase
          .from('opportunity_products')
          .delete()
          .eq('opportunity_id', oppId);

        if (deleteError) {
          console.error('Error deleting product links:', deleteError);
          // Don't throw here, continue with insert
        }

        // Insert new links
        const productLinks = opportunityData.productId
          .filter(id => id && id !== 'none')
          .map(productId => ({
            opportunity_id: oppId,
            product_id: productId
          }));

        console.log('Product links to insert:', productLinks);

        if (productLinks.length > 0) {
          const { error: insertError } = await supabase
            .from('opportunity_products')
            .insert(productLinks);

          if (insertError) {
            console.error('Error inserting product links:', insertError);
            throw insertError;
          }
        }
      }

      fetchOpportunities();
      setIsDialogOpen(false);
      setEditingOpportunity(undefined);
    } catch (error: unknown) {
      console.error('Error saving opportunity:', error);

      let errorMessage = 'Failed to save opportunity';

      if (error && typeof error === 'object' && 'message' in error) {
        const err = error as { message?: string; details?: unknown; hint?: unknown; code?: string };
        console.error('Error details:', {
          message: err.message,
          details: err.details,
          hint: err.hint,
          code: err.code
        });

        // Provide more specific error messages
        if (err.code === '23503') {
          errorMessage = 'Invalid reference data. Please check company or destination selection.';
        } else if (err.code === '23505') {
          errorMessage = 'Duplicate data found.';
        } else if (err.message) {
          errorMessage = err.message;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    }
  };

  const handleStageChange = async (opportunityId: string, newStage: OpportunityStage) => {
    // Optimistically update the local state in the parent
    setOpportunities(prev => prev.map(opp =>
      opp.id === opportunityId
        ? { ...opp, stage: newStage, probability: getProbabilityForStage(newStage) }
        : opp
    ));

    const { error } = await supabase
      .from('opportunities')
      .update({
        stage: newStage,
        probability: getProbabilityForStage(newStage)
      })
      .eq('id', opportunityId);

    if (error) {
      toast.error('Failed to update stage');
      fetchOpportunities(); // Revert on error
    }
  };

  const handleWinCase = async (opportunityId: string) => {
    const targetOpp = opportunities.find((o) => o.id === opportunityId);
    const quotesToComplete =
      targetOpp?.quotationDetails?.filter((q) => q.status !== 'rejected') ?? [];
    const completeCount = quotesToComplete.length;

    // Optimistic update — won + linked quotes completed (skip rejected)
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== opportunityId) return opp;
        return {
          ...opp,
          closureStatus: 'won' as const,
          quotationDetails: opp.quotationDetails?.map((q) =>
            q.status === 'rejected' ? q : { ...q, status: 'completed' }
          ),
        };
      })
    );

    const [oppResult, quotesResult] = await Promise.all([
      supabase
        .from('opportunities')
        .update({ closure_status: 'won' })
        .eq('id', opportunityId),
      supabase
        .from('quotations')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('opportunity_id', opportunityId)
        .neq('status', 'rejected'),
    ]);

    if (oppResult.error || quotesResult.error) {
      if (oppResult.error) console.error('Failed to mark opportunity as won:', oppResult.error);
      if (quotesResult.error) console.error('Failed to complete linked quotations:', quotesResult.error);
      toast.error('Failed to mark as won');
      fetchOpportunities();
      return;
    }

    if (completeCount > 0) {
      toast.success(
        `Opportunity marked as WON! ${completeCount} quotation${completeCount === 1 ? '' : 's'} marked complete.`
      );
    } else {
      toast.success('Opportunity marked as WON!');
    }
  };

  const handleLoseCase = async (opportunityId: string) => {
    // Optimistic update
    setOpportunities(prev => prev.map(opp =>
      opp.id === opportunityId ? { ...opp, closureStatus: 'lost' } : opp
    ));

    const { error } = await supabase
      .from('opportunities')
      .update({
        closure_status: 'lost'
      })
      .eq('id', opportunityId);

    if (error) {
      toast.error('Failed to mark as lost');
      fetchOpportunities(); // Revert
    } else {
      toast.success('Opportunity marked as LOST');
    }
  };

  const handleReopenCase = async (opportunityId: string) => {
    setOpportunities(prev => prev.map(opp =>
      opp.id === opportunityId ? { ...opp, closureStatus: null } : opp
    ));

    const { error } = await supabase
      .from('opportunities')
      .update({ closure_status: null })
      .eq('id', opportunityId);

    if (error) {
      toast.error('Failed to reopen');
      fetchOpportunities();
    } else {
      toast.success('Opportunity reopened');
    }
  };

  const getProbabilityForStage = (stage: OpportunityStage): number => {
    switch (stage) {
      case 'inquiry': return 10;
      case 'quoting': return 20;
      case 'pending_docs': return 30;
      case 'pending_booking': return 45;
      case 'booking_requested': return 60;
      case 'awb_received': return 75;
      case 'picked_up': return 80;
      case 'payment_received': return 85;
      default: return 0;
    }
  };

  const pickupTodayCount = opportunities.filter(
    (opp) => opp.closureStatus !== 'lost' && isPickupToday(opp)
  ).length;

  return (
    <div className="h-full flex flex-col space-y-4 p-4 md:p-8 pt-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-900">Booking</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your sales pipeline and track potential deals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={fetchOpportunities} disabled={loading} className="h-9 w-9">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <OpportunityDialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) setEditingOpportunity(undefined);
            }}
            trigger={
              <Button size="sm" className="md:size-default">
                <PlusCircle className="mr-2 h-4 w-4" />
                <span className="hidden xs:inline">New Opportunity</span>
                <span className="xs:hidden">New</span>
              </Button>
            }
            initialData={editingOpportunity}
            mode={editingOpportunity ? 'edit' : 'create'}
            onSubmit={handleSaveOpportunity}
          />
        </div>
      </div>

      {pickupTodayCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-sm">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
          </span>
          <Truck className="h-6 w-6 text-amber-600 shrink-0" />
          <p className="text-base md:text-lg font-bold text-amber-900">
            มีรับของวันนี้ {pickupTodayCount} shipment{pickupTodayCount > 1 ? 's' : ''}
            <span className="ml-2 font-medium text-amber-700 text-sm">— การ์ดถูกดึงขึ้นบนสุดของแต่ละ column แล้ว</span>
          </p>
        </div>
      )}

      {/* Filters Section */}
      <div className="flex flex-col gap-4 bg-white p-3 md:p-4 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 md:gap-6">
          {/* View Toggle - Hidden on very small screens, though we could just keep it */}
          <div className="hidden sm:block">
            <Tabs
              value={viewMode}
              onValueChange={(v) => {
                setViewMode(v as ViewMode);
                if (typeof window !== 'undefined') {
                  localStorage.setItem('opp_viewMode', v);
                }
              }}
            >
              <TabsList className="grid w-[260px] grid-cols-3 h-9 p-1">
                <TabsTrigger value="kanban" className="text-xs flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Kanban
                </TabsTrigger>
                <TabsTrigger value="list" className="text-xs flex items-center gap-1.5">
                  <List className="h-3.5 w-3.5" />
                  List
                </TabsTrigger>
                <TabsTrigger value="calendar" className="text-xs flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Calendar
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* OMG / Quotation searchable dropdown */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px] sm:border-l sm:pl-4">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0">OMG No.</label>
            <div className="flex-1 min-w-[160px] max-w-xs">
              <OmgFilterCombobox
                value={omgSearch}
                onChange={setOmgSearch}
                options={omgOptions}
              />
            </div>
          </div>

          {/* Company Filter */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px] sm:border-l sm:pl-4">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Company</label>
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center space-x-2">
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

          {/* Won/Lost Filters */}
          <div className="flex items-center gap-4 border-t pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2 bg-emerald-50/50 px-3 py-1.5 rounded-lg border border-emerald-100">
              <Checkbox
                id="show-won"
                checked={showWon}
                onCheckedChange={(checked) => setShowWon(checked as boolean)}
              />
              <Label
                htmlFor="show-won"
                className="text-xs font-bold flex items-center gap-1 cursor-pointer text-emerald-700"
              >
                <Trophy className="h-3 w-3" />
                WON ({opportunities.filter(o => o.closureStatus === 'won').length})
              </Label>
            </div>

            <div className="flex items-center space-x-2 bg-red-50/50 px-3 py-1.5 rounded-lg border border-red-100">
              <Checkbox
                id="show-lost"
                checked={showLost}
                onCheckedChange={(checked) => setShowLost(checked as boolean)}
              />
              <Label
                htmlFor="show-lost"
                className="text-xs font-bold flex items-center gap-1 cursor-pointer text-red-600"
              >
                <XCircle className="h-3 w-3" />
                LOST ({opportunities.filter(o => o.closureStatus === 'lost').length})
              </Label>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      ) : (
        <>
          {/* Filter opportunities based on selected filters */}
          {(() => {
            const filteredOpportunities = opportunities.filter(opp => {
              // Filter by linked quotation OMG number
              if (omgSearch.trim()) {
                const q = omgSearch.trim().toLowerCase();
                const hasQuotationMatch = opp.quotationDetails?.some(
                  (qd) =>
                    qd.quotation_no?.toLowerCase().includes(q) ||
                    qd.id?.toLowerCase().includes(q)
                );
                if (!hasQuotationMatch) {
                  return false;
                }
              }
              // Filter by company
              if (selectedCompany !== 'all' && opp.companyId !== selectedCompany) {
                return false;
              }
              // Filter out Won cases unless showWon is checked
              if (opp.closureStatus === 'won' && !showWon) {
                return false;
              }
              // Filter out Lost cases unless showLost is checked
              if (opp.closureStatus === 'lost' && !showLost) {
                return false;
              }
              return true;
            });

            return viewMode === 'kanban' ? (
              <div className="flex-1 overflow-hidden rounded-md border bg-white p-4 shadow-sm h-[calc(100vh-200px)]">
                <KanbanBoard
                  onStageChange={handleStageChange}
                  onEditOpportunity={handleEditOpportunity}
                  onDeleteOpportunity={handleDeleteOpportunity}
                  onWinCase={handleWinCase}
                  onLoseCase={handleLoseCase}
                  onReopenCase={handleReopenCase}
                  onRefresh={fetchOpportunities}
                  onOpportunityPatch={handleOpportunityPatch}
                  onReorder={handleReorder}
                  initialOpportunities={filteredOpportunities}
                />
              </div>
            ) : viewMode === 'list' ? (
              <div className="flex-1 overflow-auto h-[calc(100vh-200px)]">
                <ListView
                  opportunities={filteredOpportunities}
                  onEdit={handleEditOpportunity}
                  onDelete={handleDeleteOpportunity}
                  onWinCase={handleWinCase}
                  onLoseCase={handleLoseCase}
                  onReopenCase={handleReopenCase}
                  onRefresh={fetchOpportunities}
                  onOpportunityPatch={handleOpportunityPatch}
                />
              </div>
            ) : (
              <div className="h-[calc(100vh-200px)]">
                <PickupCalendarView
                  opportunities={filteredOpportunities}
                  onEdit={handleEditOpportunity}
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
