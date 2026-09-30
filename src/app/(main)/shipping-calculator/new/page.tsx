'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Checkbox } from "@/components/ui/checkbox";
import { useForm, FormProvider, useFieldArray, useFormContext, SubmitHandler, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowLeft, Plus, Trash, Minus, Loader2, Zap, Layers, Check, Leaf, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    calculateVolumeWeight,
    // getTotalVolumeWeight, // Removed unused import
    // getTotalActualWeight, // Removed unused import
    // getChargeableWeight as calculateChargeableWeightForPallet // Removed unused import
} from '@/lib/calculators';
import { useRouter, useSearchParams } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import {
    getDestinations,
    getFreightRates,
    getCompaniesForDropdown,
    saveQuotation as dbSaveQuotation,
    updateQuotation as dbUpdateQuotation,
    getQuotationById as dbGetQuotationById,
    getProducts,
    getProductWithCharges,
    getDocumentSubmissions,
    getDocumentSubmissionsByOpp,
    Destination,
    FreightRate,
    Company,
    Product,
    Quotation,
    NewQuotationData,
    parseQuotationTaxableLinesToForm,
    buildQuotationTaxableLinesFromForm,
    computeQuotationVatBreakdown,
    getQuotationVatDisplayRows,
    type QuotationTaxableLinesForm,
} from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { ALL_COMMODITY_TYPES, COMMODITY_META, normalizeCommodityType } from '@/lib/document-presets';
import { toast } from 'sonner';
import { AwbTrackingPanel } from '@/components/awb-tracking/awb-tracking-panel';
// import Link from 'next/link'; // Removed unused import

// --- Pallet Schema ---
// Relaxed - allow 0 values for all fields
const palletSchema = z.object({
    length: z.number().min(0),
    width: z.number().min(0),
    height: z.number().min(0),
    weight: z.number().min(0),
    quantity: z.number().int().min(1, { message: 'Quantity must be at least 1' }), // Keep quantity >= 1
    overriddenRate: z.number().min(0).optional(),
});

// --- Additional Charge Schema ---
const additionalChargeSchema = z.object({
    name: z.string(),
    description: z.string(),
    amount: z.number().min(0, { message: 'Amount must be 0 or greater' }),
    productId: z.string().optional(), // Track which product this charge belongs to
}).refine(
    (data) => {
        // If any field is filled, all fields must be filled
        const hasAnyValue = data.name !== '' || data.description !== '' || data.amount > 0;
        if (hasAnyValue) {
            return data.name !== '' && data.description !== '';
        }
        return true; // Allow all empty
    },
    {
        message: 'If adding a charge, both name and description are required',
        path: ['name'], // Show error on name field
    }
);

// --- Quotation Form Schema ---
// Relaxed validation - most fields are optional for flexibility
const quotationFormSchema = z.object({
    commodityType: z.enum(['cannabis', 'hemp', 'kratom', 'general']),
    companyId: z.string().optional(), // Optional - can be filled later
    customerName: z.string().optional(), // Optional - can be filled later
    contactPerson: z.string().optional(),
    consignee: z.string().optional(),
    contractNo: z.string().optional(),
    destinationId: z.string().optional(), // Optional - needed for cost calculation but can save draft without it
    pallets: z.array(palletSchema).min(1, { message: 'At least one pallet is required' }), // Keep at least 1 pallet
    deliveryServiceRequired: z.boolean(),
    deliveryVehicleType: z.enum(['4wheel', '6wheel']).optional(), // Optional - only needed if delivery service is required
    clearanceCost: z.number().min(0, { message: 'Clearance cost must be 0 or greater' }).optional(),
    additionalCharges: z.array(additionalChargeSchema),
    notes: z.string().optional(),
    internalRemark: z.string().optional(),
    opportunityId: z.string().optional(),
    productId: z.string().optional(),
    isChargeableWeightManual: z.boolean().optional(),
    manualChargeableWeight: z.number().min(0).optional(),
    isManualRate: z.boolean().optional(),
    manualRate: z.number().min(0).optional(),
    taxableLines: z.object({
        freight: z.boolean(),
        clearance: z.boolean(),
        delivery: z.boolean(),
        additional: z.array(z.boolean()),
    }),
    whtEnabled: z.boolean().optional(),
});

// Define the type based on the schema
type QuotationFormValues = z.infer<typeof quotationFormSchema>;

// Add type definitions near other interfaces
interface PalletType {
    length: number;
    width: number;
    height: number;
    weight: number;
    quantity?: number;
    id?: string; // Make id optional since it's not used in existing code
    overriddenRate?: number;
}

interface AdditionalChargeType {
    description: string;
    amount: number;
    id?: string; // Make id optional since it's not used in existing code
    productId?: string; // Optional product ID for tracking
}

interface PalletGroup {
    key: string;
    dims: { length: number; width: number; height: number; weight: number };
    indices: number[];
    fieldIds: string[];
    totalChargeableWeight: number;
    totalFreight: number;
}

// Add this helper function after existing utility functions
const formatNumber = (num: number) => {
    if (Math.floor(num) === num) {
        return num.toFixed(0);
    }
    return num.toFixed(2);
};

// --- Helper Function: Calculate single pallet cost ---
function calculateSinglePalletFreightCost(
    pallet: { length?: number; width?: number; height?: number; weight?: number; overriddenRate?: number },
    destinationId: string | undefined,
    freightRates: FreightRate[]
): { volumeWeight: number; actualWeight: number; chargeableWeight: number; freightCost: number; applicableRate: FreightRate | null } {
    const length = pallet.length ?? 0;
    const width = pallet.width ?? 0;
    const height = pallet.height ?? 0;
    const actualWeight = pallet.weight ?? 0;
    const overriddenRate = pallet.overriddenRate;

    // Calculate volume weight regardless of whether destinationId is provided
    const volumeWeight = calculateVolumeWeight(length, width, height);
    const chargeableWeight = Math.max(volumeWeight, actualWeight);

    // Only look up rate if destinationId is provided
    const getApplicableRateFromDb = (destId: string | undefined, weight: number): FreightRate | null => {
        if (!destId) return null;
        const applicableRates = freightRates.filter(
            (rate) =>
                rate.destination_id === destId &&
                (rate.min_weight === null || (typeof rate.min_weight === 'number' && weight >= rate.min_weight)) &&
                (rate.max_weight === null || (typeof rate.max_weight === 'number' && weight <= rate.max_weight))
        );
        return applicableRates.length > 0 ? applicableRates[0] : null;
    };

    const applicableRate = getApplicableRateFromDb(destinationId, chargeableWeight);

    // Use override if provided, otherwise use master rate
    const rateValue = overriddenRate !== undefined && overriddenRate > 0
        ? overriddenRate
        : (applicableRate?.base_rate ?? 0);

    const freightCost = Math.round(chargeableWeight * rateValue);

    return { volumeWeight, actualWeight, chargeableWeight, freightCost, applicableRate };
}

// --- Helper Component for Pallet Input ---
const PalletItem = ({
    index,
    removePallet,
    destinationId,
    freightRates,
}: {
    index: number;
    removePallet: (index: number) => void;
    destinationId: string | undefined;
    freightRates: FreightRate[];
}) => {
    const { control, watch } = useFormContext<QuotationFormValues>();
    const pallet = watch(`pallets.${index}`);

    // Calculate these values directly to ensure they update immediately when pallet dimensions change
    const length = pallet.length || 0;
    const width = pallet.width || 0;
    const height = pallet.height || 0;
    const weight = pallet.weight || 0;

    // Calculate volume weight directly - this will update whenever any dimension changes
    const volumeWeight = React.useMemo(() => {
        return calculateVolumeWeight(length, width, height);
    }, [length, width, height]);

    const chargeableWeight = React.useMemo(() => {
        return Math.max(volumeWeight, weight);
    }, [volumeWeight, weight]);

    // Only calculate freight cost if destination is selected
    const { applicableRate, freightCost } = React.useMemo(() => {
        if (!destinationId) return { applicableRate: null, freightCost: 0 };

        const getApplicableRateFromDb = (destId: string, weight: number): FreightRate | null => {
            const applicableRates = freightRates.filter(
                (rate) =>
                    rate.destination_id === destId &&
                    (rate.min_weight === null || (typeof rate.min_weight === 'number' && weight >= rate.min_weight)) &&
                    (rate.max_weight === null || (typeof rate.max_weight === 'number' && weight <= rate.max_weight))
            );
            return applicableRates.length > 0 ? applicableRates[0] : null;
        };

        const foundRate = getApplicableRateFromDb(destinationId, chargeableWeight);
        const overriddenRate = pallet.overriddenRate;

        // Use override if provided, otherwise use master rate
        const rateValue = overriddenRate !== undefined && overriddenRate > 0
            ? overriddenRate
            : (foundRate?.base_rate ?? 0);

        const cost = Math.round(chargeableWeight * rateValue);

        return { applicableRate: foundRate, freightCost: cost };
    }, [chargeableWeight, destinationId, freightRates, pallet.overriddenRate]);

    // Total cost for this item
    const totalItemCost = React.useMemo(() => {
        return freightCost;
    }, [freightCost]);

    // Format the display values to show integers without decimal places
    const displayVolumeWeight = formatNumber(volumeWeight);
    const displayChargeableWeight = formatNumber(chargeableWeight);

    return (
        <div className="border rounded-md p-4 my-2 bg-gray-50 shadow-sm">
            <div className="flex justify-between items-center mb-3">
                <div className="font-semibold text-md">Pallet {index + 1}</div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePallet(index)}
                    className="text-red-600 hover:bg-red-100 px-2 py-1 h-auto"
                    disabled={watch('pallets')?.length <= 1}
                >
                    <Trash className="h-4 w-4" />
                </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <FormField
                    control={control}
                    name={`pallets.${index}.length`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Length (cm)</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    type="number"
                                    placeholder="0"
                                    value={field.value || ''}
                                    onChange={(e) => {
                                        // Update field value
                                        field.onChange(parseFloat(e.target.value) || 0);
                                    }}
                                    className="h-9"
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
                <FormField
                    control={control}
                    name={`pallets.${index}.width`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Width (cm)</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    type="number"
                                    placeholder="0"
                                    value={field.value || ''}
                                    onChange={(e) => {
                                        // Update field value
                                        field.onChange(parseFloat(e.target.value) || 0);
                                    }}
                                    className="h-9"
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
                <FormField
                    control={control}
                    name={`pallets.${index}.height`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Height (cm)</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    type="number"
                                    placeholder="0"
                                    value={field.value || ''}
                                    onChange={(e) => {
                                        // Update field value
                                        field.onChange(parseFloat(e.target.value) || 0);
                                    }}
                                    className="h-9"
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
                <FormField
                    control={control}
                    name={`pallets.${index}.weight`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Weight (kg)</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    type="number"
                                    placeholder="0"
                                    value={field.value || ''}
                                    onChange={(e) => {
                                        // Update field value
                                        field.onChange(parseFloat(e.target.value) || 0);
                                    }}
                                    className="h-9"
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 border-t pt-3">
                <FormField
                    control={control}
                    name={`pallets.${index}.overriddenRate`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs font-semibold text-blue-600">Manual Rate Override (THB/kg)</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    type="number"
                                    placeholder={applicableRate ? `${applicableRate.base_rate.toFixed(2)}` : "0.00"}
                                    value={field.value || ''}
                                    onChange={(e) => {
                                        field.onChange(parseFloat(e.target.value) || 0);
                                    }}
                                    className="h-9 border-blue-200 focus:border-blue-500 bg-blue-50/30"
                                />
                            </FormControl>
                            <p className="text-[10px] text-gray-500 italic">Leave at 0 or empty to use suggested rate.</p>
                        </FormItem>
                    )}
                />
            </div>

            <div className="text-xs space-y-1 mt-2 p-2 border-t border-dashed">
                <p>Volume Wt: <span className="font-medium">{displayVolumeWeight} kg</span></p>
                <p>Chargeable Wt: <span className="font-medium">{displayChargeableWeight} kg</span></p>
                <p>Applicable Rate: <span className="font-medium">{applicableRate ? `${applicableRate.base_rate.toFixed(2)} THB/kg` : 'N/A'}</span></p>
                <p>Freight Cost: <span className="font-medium">{freightCost.toFixed(2)} THB</span></p>
                <p className="font-semibold">Item Total: <span className="font-bold">{totalItemCost.toFixed(2)} THB</span></p>
            </div>
        </div>
    );
};

// --- Collapsed pallet group card (identical dimensions) ---
const PalletGroupCard = ({
    dims,
    count,
    isExpanded,
    onToggle,
    onDuplicate,
    onRemoveGroup,
    totalChargeableWeight,
    totalFreight,
    children,
}: {
    dims: { length: number; width: number; height: number; weight: number };
    count: number;
    isExpanded: boolean;
    onToggle: () => void;
    onDuplicate: () => void;
    onRemoveGroup: () => void;
    totalChargeableWeight: number;
    totalFreight: number;
    children?: React.ReactNode;
}) => (
    <div className="border rounded-md my-2 bg-gray-50 shadow-sm overflow-hidden">
        <div className="flex w-full items-center justify-between p-4 gap-2">
            <button
                type="button"
                onClick={onToggle}
                className="flex flex-1 items-center gap-3 min-w-0 text-left"
            >
                <ChevronRight
                    className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform', isExpanded && 'rotate-90')}
                />
                <div className="min-w-0">
                    <div className="font-semibold text-md">
                        {dims.length}×{dims.width}×{dims.height} cm · {formatNumber(dims.weight)} kg
                        <span className="ml-2 text-blue-600 font-bold">× {count}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                        Total chargeable: {formatNumber(totalChargeableWeight)} kg · Freight:{' '}
                        {totalFreight.toLocaleString()} THB
                    </div>
                </div>
            </button>
            <div className="flex gap-1 shrink-0">
                <Button type="button" size="sm" variant="outline" onClick={onDuplicate}>
                    + Add same
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:bg-red-100"
                    onClick={onRemoveGroup}
                >
                    Remove group
                </Button>
            </div>
        </div>
        {isExpanded && children ? <div className="border-t px-2 pb-2">{children}</div> : null}
    </div>
);

// --- Additional Charge Item ---
const AdditionalChargeItem = ({
    index,
    removeChargeRow
}: {
    index: number;
    removeChargeRow: (index: number) => void;
}) => {
    const { control } = useFormContext<QuotationFormValues>();

    return (
        <div className="flex flex-row items-center gap-2 mb-2">
            <FormField
                control={control}
                name={`additionalCharges.${index}.name`}
                render={({ field }) => (
                    <FormItem className="flex-[2] min-w-0 mb-0">
                        <FormLabel className="sr-only">Name</FormLabel>
                        <FormControl>
                            <Input {...field} placeholder="Name" className="h-9" />
                        </FormControl>
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`additionalCharges.${index}.description`}
                render={({ field }) => (
                    <FormItem className="flex-[2] min-w-0 mb-0">
                        <FormLabel className="sr-only">Description</FormLabel>
                        <FormControl>
                            <Input {...field} placeholder="Description" className="h-9" />
                        </FormControl>
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`additionalCharges.${index}.amount`}
                render={({ field }) => (
                    <FormItem className="w-28 shrink-0 mb-0">
                        <FormLabel className="sr-only">Amount (THB)</FormLabel>
                        <FormControl>
                            <Input
                                {...field}
                                type="number"
                                placeholder="0.00 THB"
                                value={field.value || ''}
                                onChange={(e) => {
                                    field.onChange(parseFloat(e.target.value) || 0);
                                }}
                                className="h-9"
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`taxableLines.additional.${index}`}
                render={({ field }) => (
                    <FormItem className="mb-0 shrink-0">
                        <FormLabel className="sr-only">VAT 7% Taxable</FormLabel>
                        <label
                            className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background cursor-pointer select-none whitespace-nowrap"
                            htmlFor={`add-taxable-${index}`}
                        >
                            <Checkbox
                                id={`add-taxable-${index}`}
                                checked={field.value !== false}
                                onCheckedChange={(v) => field.onChange(v === true)}
                            />
                            <span className="text-sm">Taxable</span>
                        </label>
                    </FormItem>
                )}
            />
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeChargeRow(index)}
                className="text-red-600 hover:bg-red-100 h-9 w-9 shrink-0"
            >
                <Minus className="h-4 w-4" />
            </Button>
        </div>
    );
};

// --- Type for Calculation Results ---
interface CalculationResult {
    totalVolume: number;
    totalWeight: number;
    totalVolumeWeight: number;
    totalActualWeight: number;
    totalChargeableWeight: number;
    totalFreightCost: number;
    clearanceCost: number;
    deliveryCost: number;
    subTotal: number;
    totalAdditionalCharges: number;
    finalTotalCost: number;
}

// Add this function before the NewQuotationPage component
function calculateTotalFreightCost(
    pallets: PalletType[] = [],
    additionalCharges: AdditionalChargeType[] = [],
    options: { 
        clearanceCost?: number; 
        deliveryRequired?: boolean; 
        deliveryType?: string; 
        deliveryRates?: Record<string, number>; 
        destinationId?: string; 
        freightRates?: FreightRate[];
        isChargeableWeightManual?: boolean;
        manualChargeableWeight?: number;
        isManualRate?: boolean;
        manualRate?: number;
    } = {}
): CalculationResult {
    // Calculate total volume (in cubic centimeters)
    const totalVolumeCm3 = pallets.reduce((acc, pallet) => {
        const volume = (pallet.length * pallet.width * pallet.height * (pallet.quantity || 1));
        return acc + volume;
    }, 0);

    // Calculate total weight
    const totalWeight = pallets.reduce((acc, pallet) => {
        return acc + (pallet.weight * (pallet.quantity || 1));
    }, 0);

    // Legacy aggregate volume weight (total cm³ / 6000) — kept for manual-rate billing and manual-CW display
    const legacyAggregateVolumeWeight = totalVolumeCm3 / 6000;
    const roundedLegacyAggregateVolumeWeight =
        Math.abs(legacyAggregateVolumeWeight - Math.round(legacyAggregateVolumeWeight)) < 0.01
            ? Math.round(legacyAggregateVolumeWeight)
            : legacyAggregateVolumeWeight;

    // Per-pallet volume weight: ceil each pallet, then sum × quantity (matches band-rate freight & customer portal)
    const perPalletVolumeWeight = pallets.reduce((acc, pallet) => {
        const qty = pallet.quantity || 1;
        const volWt = calculateVolumeWeight(pallet.length, pallet.width, pallet.height);
        return acc + volWt * qty;
    }, 0);

    const hasManualChargeable =
        options.isChargeableWeightManual &&
        options.manualChargeableWeight !== undefined &&
        options.manualChargeableWeight > 0;
    const hasManualRate =
        options.isManualRate && options.manualRate !== undefined && options.manualRate > 0;

    // Weight used only for manual-rate freight billing — must stay on legacy aggregate to avoid changing existing money
    const manualRateBillingWeight = hasManualChargeable
        ? options.manualChargeableWeight!
        : Math.max(roundedLegacyAggregateVolumeWeight, totalWeight);

    let totalVolumeWeight: number;
    let totalChargeableWeight: number;

    if (hasManualChargeable) {
        totalChargeableWeight = options.manualChargeableWeight!;
        totalVolumeWeight = roundedLegacyAggregateVolumeWeight;
    } else if (hasManualRate) {
        totalVolumeWeight = roundedLegacyAggregateVolumeWeight;
        totalChargeableWeight = Math.max(roundedLegacyAggregateVolumeWeight, totalWeight);
    } else {
        totalVolumeWeight = perPalletVolumeWeight;
        totalChargeableWeight = Math.max(perPalletVolumeWeight, totalWeight);
    }

    // Calculate freight cost for each pallet using the proper rates and sum them
    let totalFreightCost = 0;

    // Use manual rate override if enabled (billing weight stays on legacy aggregate)
    if (hasManualRate) {
        totalFreightCost = Math.round(manualRateBillingWeight * options.manualRate!);
    } 
    // Otherwise calculate based on db rates
    else if (options.freightRates && options.freightRates.length > 0 && options.destinationId) {
        // Sum up individual pallet freight costs
        totalFreightCost = pallets.reduce((acc, pallet) => {
            const { freightCost } = calculateSinglePalletFreightCost(pallet, options.destinationId, options.freightRates || []);
            return acc + freightCost;
        }, 0);
    } else {
        // No destination or rates - freight cost is 0 (draft mode)
        totalFreightCost = 0;
    }

    // Use provided clearance cost or default to 0 (no clearance cost)
    const clearanceCost = options.clearanceCost || 0;

    // Calculate delivery cost based on settings
    let deliveryCost = 0;
    if (options.deliveryRequired) {
        // Only apply delivery cost if delivery is required
        if (options.deliveryType && options.deliveryRates && options.deliveryRates[options.deliveryType]) {
            // Use the specific rate for the selected vehicle type
            deliveryCost = options.deliveryRates[options.deliveryType];
        } else {
            // Fallback default if rates aren't provided
            deliveryCost = 3000;
        }
    } // If deliveryRequired is false, deliveryCost remains 0

    // Calculate subtotal (before additional charges)
    const subTotal = totalFreightCost + clearanceCost + deliveryCost;

    // Calculate total additional charges
    const totalAdditionalCharges = additionalCharges.reduce((sum, charge) => sum + (charge.amount || 0), 0);

    // Calculate final total cost
    const finalTotalCost = subTotal + totalAdditionalCharges;

    // Return all fields needed for the interface
    return {
        totalVolume: totalVolumeCm3 / 1000000, // Convert to cubic meters for display
        totalWeight,
        totalVolumeWeight,
        totalActualWeight: totalWeight, // Aliasing for backward compatibility
        totalChargeableWeight,
        totalFreightCost,
        clearanceCost,
        deliveryCost,
        subTotal,
        totalAdditionalCharges,
        finalTotalCost
    };
}

// --- Main Page Component ---
function ShippingCalculatorPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const quotationId = searchParams.get('id');
    const cloneFromId = searchParams.get('clone_from');
    const approveFromId = searchParams.get('approve_from');
    const isEditMode = !!quotationId;
    const isApproveMode = !!approveFromId;

    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [freightRates, setFreightRates] = useState<FreightRate[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [hasDocuments, setHasDocuments] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(null);
    const [existingQuotation, setExistingQuotation] = useState<Quotation | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const prevProductIdsRef = React.useRef<string[]>([]);

    // Update the useEffect for recalculating costs to prevent infinite loops
    // Use useRef instead of useState for lastCalculatedValues to avoid effect re-runs
    const lastCalculatedValues = React.useRef<{
        pallets: PalletType[],
        additionalCharges: AdditionalChargeType[],
        destinationId?: string
    }>({
        pallets: [],
        additionalCharges: [],
        destinationId: undefined
    });

    const paramOpportunityId = searchParams.get('opportunityId');
    const paramCompanyId = searchParams.get('companyId');
    const paramCustomerName = searchParams.get('customerName');
    const paramNotes = searchParams.get('notes');
    const paramDestinationId = searchParams.get('destinationId'); // Read param
    const paramVehicleType = searchParams.get('deliveryVehicleType');
    const paramProductId = searchParams.get('productId');

    // --- React Hook Form Setup ---
    const form = useForm<QuotationFormValues>({
        resolver: zodResolver(quotationFormSchema),
        defaultValues: {
            commodityType: 'cannabis',
            companyId: paramCompanyId || '',
            customerName: paramCustomerName || '',
            contactPerson: '',
            consignee: '',
            contractNo: '',
            destinationId: paramDestinationId || '', // Set default
            pallets: [{ length: 0, width: 0, height: 0, weight: 0, quantity: 1 }],
            deliveryServiceRequired: false,
            deliveryVehicleType: paramVehicleType as '4wheel' | '6wheel' | undefined, // Don't set default - let user choose if needed
            clearanceCost: 0, // Default to 0, user can add via button
            additionalCharges: [{ name: '', description: '', amount: 0 }],
            notes: paramNotes || '',
            opportunityId: paramOpportunityId || '',
            productId: paramProductId || '',
            taxableLines: {
                freight: false,
                clearance: true,
                delivery: true,
                additional: [true],
            },
            whtEnabled: true,
        },
        mode: 'onChange',
    });

    // --- State for Bulk Actions ---
    const [bulkLength, setBulkLength] = useState(0);
    const [bulkWidth, setBulkWidth] = useState(0);
    const [bulkHeight, setBulkHeight] = useState(0);
    const [bulkWeight, setBulkWeight] = useState(0);
    const [bulkQuantity, setBulkQuantity] = useState(1);
    const [bulkRate, setBulkRate] = useState(0);

    const handleBulkAdd = () => {
        if (bulkQuantity <= 0) {
            toast.error("Invalid Quantity", { description: "Quantity must be at least 1." });
            return;
        }

        // Add multiple pallets with the same dimensions
        for (let i = 0; i < bulkQuantity; i++) {
            appendPallet({
                length: bulkLength,
                width: bulkWidth,
                height: bulkHeight,
                weight: bulkWeight,
                quantity: 1, // Individual pallets in the list generally have qty 1
                overriddenRate: bulkRate > 0 ? bulkRate : 0
            });
        }

        toast.success(`Added ${bulkQuantity} Pallets`, {
            description: `${bulkLength}x${bulkWidth}x${bulkHeight} cm, ${bulkWeight} kg`
        });

        // Optional: Reset bulk inputs (except dimensions maybe?)
        // setBulkQuantity(1);
    };

    const handleBulkRateOverride = () => {
        const currentPallets = getValues('pallets');
        if (!currentPallets || currentPallets.length === 0) return;

        // Apply bulk rate to all pallets currently in the form
        const updatedPallets = currentPallets.map(pallet => ({
            ...pallet,
            overriddenRate: bulkRate
        }));

        // Use reset with keepValues: false might be tricky, let's use setValue instead
        form.setValue('pallets', updatedPallets, { shouldValidate: true, shouldDirty: true });

        toast.success("Bulk Rate Applied", {
            description: `All pallets set to ${bulkRate.toFixed(2)} THB/kg`
        });
    };

    // Destructure methods and formState
    const {
        control,
        handleSubmit,
        getValues,
        setValue,
        watch,
        reset,
        formState: { errors /*, isValid, isDirty*/ }
    } = form;

    // Field Arrays
    const { fields: palletFields, append: appendPallet, remove: removePallet } = useFieldArray({
        control: control,
        name: "pallets",
    });

    const { fields: chargeFields, append: appendCharge, remove: removeCharge } = useFieldArray({
        control: control,
        name: "additionalCharges",
    });

    const [expandedGroupKeys, setExpandedGroupKeys] = React.useState<Set<string>>(() => new Set());

    const appendChargeRow = React.useCallback(
        (row: { name: string; description: string; amount: number; productId?: string }) => {
            appendCharge(row);
            const t = getValues('taxableLines');
            setValue(
                'taxableLines',
                {
                    freight: t?.freight ?? true,
                    clearance: t?.clearance ?? true,
                    delivery: t?.delivery ?? true,
                    additional: [...(t?.additional ?? []), true],
                },
                { shouldDirty: true }
            );
        },
        [appendCharge, getValues, setValue]
    );

    const removeChargeRow = React.useCallback(
        (index: number) => {
            removeCharge(index);
            const t = getValues('taxableLines');
            if (t?.additional && t.additional.length > index) {
                const next = [...t.additional];
                next.splice(index, 1);
                setValue(
                    'taxableLines',
                    { ...t, additional: next },
                    { shouldDirty: true }
                );
            }
        },
        [removeCharge, getValues, setValue]
    );

    // Watch relevant fields for recalculation
    const watchedDestinationId = watch('destinationId');
    const watchedDeliveryRequired = watch('deliveryServiceRequired');
    const watchedDeliveryVehicle = watch('deliveryVehicleType');
    const watchedProductId = watch('productId');
    const watchedTaxableLines = useWatch({ control, name: 'taxableLines' });
    const watchedWhtEnabled = useWatch({ control, name: 'whtEnabled' });
    const watchedClearanceCost = useWatch({ control, name: 'clearanceCost' });
    const watchedAdditionalCharges = useWatch({ control, name: 'additionalCharges' });
    const watchedPalletsRaw = useWatch({ control, name: 'pallets' });
    const watchedPallets = useMemo(() => watchedPalletsRaw ?? [], [watchedPalletsRaw]);

    const palletGroups = React.useMemo((): PalletGroup[] => {
        const map = new Map<string, PalletGroup>();
        const order: string[] = [];

        palletFields.forEach((field, idx) => {
            const p = watchedPallets[idx] ?? {};
            const l = p.length || 0;
            const w = p.width || 0;
            const h = p.height || 0;
            const wt = p.weight || 0;
            const key = `${l}-${w}-${h}-${wt}`;

            if (!map.has(key)) {
                map.set(key, {
                    key,
                    dims: { length: l, width: w, height: h, weight: wt },
                    indices: [],
                    fieldIds: [],
                    totalChargeableWeight: 0,
                    totalFreight: 0,
                });
                order.push(key);
            }

            const group = map.get(key)!;
            group.indices.push(idx);
            group.fieldIds.push(field.id);

            const calc = calculateSinglePalletFreightCost(p, watchedDestinationId, freightRates);
            group.totalChargeableWeight += calc.chargeableWeight;
            group.totalFreight += calc.freightCost;
        });

        return order.map((k) => map.get(k)!);
    }, [palletFields, watchedPallets, watchedDestinationId, freightRates]);

    const togglePalletGroup = React.useCallback((key: string) => {
        setExpandedGroupKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const duplicatePalletGroup = React.useCallback(
        (dims: PalletGroup['dims']) => {
            appendPallet({
                length: dims.length,
                width: dims.width,
                height: dims.height,
                weight: dims.weight,
                quantity: 1,
            });
        },
        [appendPallet]
    );

    const removePalletGroup = React.useCallback(
        (indices: number[]) => {
            const total = palletFields.length;
            const sorted = [...indices].sort((a, b) => b - a);
            const toRemove = sorted.length >= total ? sorted.slice(0, sorted.length - 1) : sorted;
            toRemove.forEach((i) => removePallet(i));
        },
        [palletFields.length, removePallet]
    );

    React.useEffect(() => {
        if (isEditMode || isApproveMode || cloneFromId) {
            setExpandedGroupKeys(new Set());
        }
    }, [isEditMode, isApproveMode, cloneFromId, quotationId, approveFromId]);

    const quotationVatBreakdown = React.useMemo(() => {
        if (!calculationResult) return null;
        const tlForm = (watchedTaxableLines ?? {
            freight: false,
            clearance: true,
            delivery: true,
            additional: [],
        }) as QuotationTaxableLinesForm;
        const ac = watchedAdditionalCharges ?? [];
        const taxable_map = buildQuotationTaxableLinesFromForm(tlForm, ac);
        const filtered = ac.filter(
            (c) => (c.name ?? '').trim() !== '' || (c.description ?? '').trim() !== '' || (Number(c.amount) || 0) > 0
        );
        return computeQuotationVatBreakdown({
            total_freight_cost: calculationResult.totalFreightCost,
            clearance_cost: Number(watchedClearanceCost) || 0,
            delivery_amount: watchedDeliveryRequired ? calculationResult.deliveryCost : 0,
            additional_amounts: filtered.map((c) => Number(c.amount) || 0),
            taxable_lines: taxable_map,
            wht_enabled: watchedWhtEnabled !== false,
        });
    }, [
        calculationResult,
        watchedTaxableLines,
        watchedClearanceCost,
        watchedAdditionalCharges,
        watchedDeliveryRequired,
        watchedWhtEnabled,
    ]);

    const vatDisplayRows = React.useMemo(() => {
        if (!calculationResult) return [];
        const tl = (watchedTaxableLines ?? {
            freight: false,
            clearance: true,
            delivery: true,
            additional: [],
        }) as QuotationTaxableLinesForm;
        return getQuotationVatDisplayRows(calculationResult, {
            clearanceCost: Number(watchedClearanceCost) || 0,
            deliveryServiceRequired: watchedDeliveryRequired,
            additionalCharges: watchedAdditionalCharges ?? [],
            taxableLines: tl,
        });
    }, [
        calculationResult,
        watchedTaxableLines,
        watchedClearanceCost,
        watchedAdditionalCharges,
        watchedDeliveryRequired,
    ]);

    // --- Product Master Auto-fill Effect ---
    useEffect(() => {
        const syncProductCharges = async () => {
            const currentIds = watchedProductId ? watchedProductId.split(',').filter(id => id.trim() !== '' && id !== 'none') : [];
            const prevIds = prevProductIdsRef.current;

            // Find added and removed IDs
            const addedIds = currentIds.filter(id => !prevIds.includes(id));
            const removedIds = prevIds.filter(id => !currentIds.includes(id));

            if (addedIds.length === 0 && removedIds.length === 0) return;

            // 1. Remove charges for products that were unselected
                    if (removedIds.length > 0) {
                        // We need to iterate backwards to avoid index shifting issues
                        const currentCharges = getValues('additionalCharges');
                        for (let i = currentCharges.length - 1; i >= 0; i--) {
                            if (currentCharges[i].productId && removedIds.includes(currentCharges[i].productId!)) {
                                removeChargeRow(i);
                            }
                        }
                    }

                    // 2. Add charges for new products
                    if (addedIds.length > 0) {
                        try {
                            const productsWithCharges = await Promise.all(
                                addedIds.map(id => getProductWithCharges(id))
                            );

                            let appliedCount = 0;
                            productsWithCharges.forEach(product => {
                                if (product && product.product_charges && product.product_charges.length > 0) {
                                    appliedCount++;
                                    product.product_charges.forEach(pc => {
                                        appendChargeRow({
                                            name: pc.name,
                                            description: pc.description || '',
                                            amount: pc.amount,
                                            productId: product.id // Tag it
                                        });
                                    });
                                }
                            });

                            // Handle empty first row if we just added something
                            if (appliedCount > 0) {
                                const chargesAfterAdd = getValues('additionalCharges');
                                // If the first row is empty and it's not the only row (meaning we just added more)
                                if (chargesAfterAdd.length > 1 &&
                                    chargesAfterAdd[0].name === '' &&
                                    chargesAfterAdd[0].amount === 0 &&
                                    !chargesAfterAdd[0].productId) {
                                    removeChargeRow(0);
                                }
                            }
                } catch (error) {
                    console.error('Error syncing product charges:', error);
                    toast.error("Failed to sync product charges");
                }
            }

            prevProductIdsRef.current = currentIds;
        };

        syncProductCharges();
    }, [watchedProductId, getValues, removeChargeRow, appendChargeRow]);

    // --- Fetch Initial Data (Runs once on mount) ---
    useEffect(() => {
        const fetchData = async () => {
            console.log("Effect 1: Fetching initial data...");
            setIsLoading(true); // Start loading
            try {
                // 1. Get User
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    setUserId(user.id);
                    console.log("Effect 1: User ID set:", user.id);
                } else {
                    throw new Error("User not logged in.");
                }

                // 2. Fetch other data concurrently
                const [destinationsData, freightRatesData, companiesData, productsData] = await Promise.all([
                    getDestinations(true),
                    getFreightRates(),
                    getCompaniesForDropdown(),
                    getProducts()
                ]);

                // 3. Set state for fetched data
                if (destinationsData) {
                    setDestinations(destinationsData);
                    console.log("Effect 1: Destinations loaded:", destinationsData.length);
                } else {
                    toast.error("Failed to load destinations.");
                }
                if (freightRatesData) {
                    setFreightRates(freightRatesData);
                    console.log("Effect 1: Freight rates loaded:", freightRatesData.length);
                } else {
                    toast.error("Failed to load freight rates.");
                }
                if (companiesData) {
                    setCompanies(companiesData);
                    console.log("Effect 1: Companies loaded:", companiesData.length);
                } else {
                    toast.error("Failed to load companies.");
                }

                if (productsData) {
                    setProducts(productsData);
                    console.log("Effect 1: Products loaded:", productsData.length);
                }

                // 4. Finish loading only after all fetches and state sets are done
                console.log("Effect 1: All data fetched, setting isLoading to false.");
                setIsLoading(false);

            } catch (error: unknown) {
                console.error('Error fetching initial data:', error);
                // Type check for error message
                const message = error instanceof Error ? error.message : "Failed to load required data.";
                toast.error("Initialization Error", { description: message });
                if (error instanceof Error && error.message === "User not logged in.") {
                    router.push('/login');
                }
                // Keep loading true or set an error state if fetching fails critically
                // setIsLoading(false); // Or potentially set an error flag instead
            }
        };

        fetchData();
        // Run only once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Set Form Values (Runs after data is loaded or when ID changes) ---
    useEffect(() => {
        // Only run if initial data loading is complete
        if (isLoading) {
            console.log("Effect 2: Waiting for initial data...");
            return;
        }

        console.log(`Effect 2: Running. Mode: ${isEditMode ? 'Edit' : 'New'}, ID: ${quotationId}`);

        const setFormDefaults = async () => {
            try {
                if (isEditMode && quotationId && userId) {
                    console.log(`Effect 2: Fetching existing quotation ${quotationId}`);
                    const fetchedQuotation = await dbGetQuotationById(quotationId);

                    if (fetchedQuotation) {
                        console.log("Effect 2: Existing quotation found, resetting form.");
                        // Store existing quotation for status preservation
                        setExistingQuotation(fetchedQuotation);

                        // Use more specific type if possible, otherwise suppress error
                        // Assuming dbGetQuotationById returns Quotation | null
                        const typedExistingQuotation = fetchedQuotation as Quotation;
                        const loadedAdditionalCharges = Array.isArray(typedExistingQuotation.additional_charges)
                            ? typedExistingQuotation.additional_charges.map((c) => ({
                                name: c.name || '',
                                description: c.description || '',
                                amount: Number(c.amount) || 0,
                                productId: (c as { productId?: string }).productId || undefined,
                            }))
                            : [{ name: '', description: '', amount: 0 }];
                        reset({
                            commodityType: normalizeCommodityType(typedExistingQuotation.commodity_type),
                            companyId: typedExistingQuotation.company_id || '',
                            customerName: typedExistingQuotation.customer_name || '',
                            contactPerson: typedExistingQuotation.contact_person || '',
                            consignee: typedExistingQuotation.consignee_name || '',
                            contractNo: typedExistingQuotation.contract_no || '',
                            destinationId: typedExistingQuotation.destination_id || '',
                            pallets: Array.isArray(typedExistingQuotation.pallets) && typedExistingQuotation.pallets.length > 0
                                ? typedExistingQuotation.pallets.map(p => ({
                                    length: Number(p.length) || 0,
                                    width: Number(p.width) || 0,
                                    height: Number(p.height) || 0,
                                    weight: Number(p.weight) || 0,
                                    quantity: Number(p.quantity) || 1,
                                    overriddenRate: Number(p.overridden_rate) || 0
                                }))
                                : [{ length: 0, width: 0, height: 0, weight: 0, quantity: 1 }],
                            deliveryServiceRequired: typedExistingQuotation.delivery_service_required ?? false,
                            deliveryVehicleType: typedExistingQuotation.delivery_vehicle_type as '4wheel' | '6wheel' | undefined,
                            clearanceCost: Number(typedExistingQuotation.clearance_cost) || 0, // Load clearance cost from DB
                            additionalCharges: loadedAdditionalCharges,
                            taxableLines: parseQuotationTaxableLinesToForm(
                                typedExistingQuotation.taxable_lines,
                                loadedAdditionalCharges.length
                            ),
                            notes: typedExistingQuotation.notes || '',
                            productId: typedExistingQuotation.product_id || '',
                            opportunityId: typedExistingQuotation.opportunity_id || '', // IMPORTANT: Preserve opportunity link
                            isChargeableWeightManual: typedExistingQuotation.is_chargeable_weight_manual ?? false,
                            manualChargeableWeight: Number(typedExistingQuotation.manual_chargeable_weight) || 0,
                            isManualRate: typedExistingQuotation.is_manual_rate ?? false,
                            manualRate: Number(typedExistingQuotation.manual_rate) || 0,
                            internalRemark: typedExistingQuotation.internal_remark || '',
                            whtEnabled: typedExistingQuotation.wht_enabled !== false,
                        });

                        // Set the ref to prevent initial sync if products are already loaded
                        prevProductIdsRef.current = typedExistingQuotation.product_id ? typedExistingQuotation.product_id.split(',').filter(Boolean) : [];

                        // Force initial calculation after setting defaults
                        console.log("Effect 2: Triggering initial calculation.");
                        const initialCalculation = calculateTotalFreightCost(
                            Array.isArray(typedExistingQuotation.pallets) ? typedExistingQuotation.pallets.map(p => ({
                                length: Number(p.length) || 0,
                                width: Number(p.width) || 0,
                                height: Number(p.height) || 0,
                                weight: Number(p.weight) || 0,
                                quantity: Number(p.quantity) || 1,
                                overriddenRate: Number(p.overridden_rate) || 0
                            })) : [],
                            Array.isArray(typedExistingQuotation.additional_charges) ? typedExistingQuotation.additional_charges.map(c => ({
                                name: c.name || '',
                                description: c.description || '',
                                amount: Number(c.amount) || 0
                            })) : [],
                            {
                                clearanceCost: Number(typedExistingQuotation.clearance_cost) || 0,
                                deliveryRequired: typedExistingQuotation.delivery_service_required,
                                deliveryType: typedExistingQuotation.delivery_vehicle_type || '4wheel',
                                deliveryRates: { '4wheel': 3500, '6wheel': 6500 }, // Hardcoded for now as per useMemo below
                                destinationId: typedExistingQuotation.destination_id || undefined,
                                freightRates: freightRates,
                                isChargeableWeightManual: typedExistingQuotation.is_chargeable_weight_manual,
                                manualChargeableWeight: Number(typedExistingQuotation.manual_chargeable_weight),
                                isManualRate: typedExistingQuotation.is_manual_rate,
                                manualRate: Number(typedExistingQuotation.manual_rate)
                            }
                        );
                        setCalculationResult(initialCalculation);

                        // Update last calculated values to prevent double calculation
                        // IMPORTANT: Use JSON.parse(JSON.stringify(...)) to create a deep copy and break reference links
                        // This prevents react-hook-form mutations from implicitly updating our "last known" state
                        lastCalculatedValues.current = {
                            pallets: JSON.parse(JSON.stringify(
                                Array.isArray(typedExistingQuotation.pallets) ? typedExistingQuotation.pallets.map(p => ({
                                    length: Number(p.length) || 0,
                                    width: Number(p.width) || 0,
                                    height: Number(p.height) || 0,
                                    weight: Number(p.weight) || 0,
                                    quantity: Number(p.quantity) || 1,
                                    overriddenRate: Number(p.overridden_rate) || 0
                                })) : []
                            )),
                            additionalCharges: JSON.parse(JSON.stringify(
                                Array.isArray(typedExistingQuotation.additional_charges) ? typedExistingQuotation.additional_charges.map(c => ({
                                    name: c.name || '',
                                    description: c.description || '',
                                    amount: Number(c.amount) || 0
                                })) : []
                            )),
                            destinationId: typedExistingQuotation.destination_id || ''
                        };
                    } else {
                        console.error(`Effect 2: Quotation ${quotationId} NOT FOUND or RLS blocked access. Current User: ${userId}`);
                        toast.error("Quotation not found or access denied.", {
                            description: "If this is a customer request, please ensure database RLS policies allow staff access."
                        });
                        router.push('/shipping-calculator');
                    }
                } else if (cloneFromId && userId) {
                    // --- CLONE MODE ---
                    console.log(`Effect 2: Cloning from quotation ${cloneFromId}`);
                    const fetchedQuotation = await dbGetQuotationById(cloneFromId);

                    if (fetchedQuotation) { // We might not check user_id strict equality for cloning if sharing is allowed, but safe to check
                        console.log("Effect 2: Source quotation found for cloning.");

                        // Do NOT set existingQuotation, so it saves as new
                        setExistingQuotation(null);

                        const typedExistingQuotation = fetchedQuotation as Quotation;

                        const cloneAdditionalCharges = Array.isArray(typedExistingQuotation.additional_charges)
                            ? typedExistingQuotation.additional_charges.map((c) => ({
                                name: c.name || '',
                                description: c.description || '',
                                amount: Number(c.amount) || 0,
                                productId: (c as { productId?: string }).productId || undefined,
                            }))
                            : [{ name: '', description: '', amount: 0 }];

                        // Reset form with fetched data
                        reset({
                            commodityType: normalizeCommodityType(typedExistingQuotation.commodity_type),
                            companyId: typedExistingQuotation.company_id || '',
                            customerName: typedExistingQuotation.customer_name || '',
                            contactPerson: typedExistingQuotation.contact_person || '',
                            consignee: typedExistingQuotation.consignee_name || '',
                            contractNo: typedExistingQuotation.contract_no || '',
                            destinationId: typedExistingQuotation.destination_id || '',
                            pallets: Array.isArray(typedExistingQuotation.pallets) && typedExistingQuotation.pallets.length > 0
                                ? typedExistingQuotation.pallets.map(p => ({
                                    length: Number(p.length) || 0,
                                    width: Number(p.width) || 0,
                                    height: Number(p.height) || 0,
                                    weight: Number(p.weight) || 0,
                                    quantity: Number(p.quantity) || 1,
                                    overriddenRate: Number(p.overridden_rate) || 0
                                }))
                                : [{ length: 0, width: 0, height: 0, weight: 0, quantity: 1, overriddenRate: 0 }],
                            deliveryServiceRequired: typedExistingQuotation.delivery_service_required ?? false,
                            deliveryVehicleType: typedExistingQuotation.delivery_vehicle_type as '4wheel' | '6wheel' | undefined,
                            clearanceCost: Number(typedExistingQuotation.clearance_cost) || 0,
                            additionalCharges: cloneAdditionalCharges,
                            taxableLines: parseQuotationTaxableLinesToForm(
                                typedExistingQuotation.taxable_lines,
                                cloneAdditionalCharges.length
                            ),
                            notes: typedExistingQuotation.notes || '',
                            opportunityId: typedExistingQuotation.opportunity_id || '', // Clone also gets the opportunity link (optional)
                        });

                        // Pre-set product ID ref for clone? Actually clone doesn't copy product_id often but let's be safe
                        prevProductIdsRef.current = [];

                        // Force initial calculation
                        console.log("Effect 2: Triggering initial calculation for Clone.");
                        const initialCalculation = calculateTotalFreightCost(
                            Array.isArray(typedExistingQuotation.pallets) ? typedExistingQuotation.pallets.map(p => ({
                                length: Number(p.length) || 0,
                                width: Number(p.width) || 0,
                                height: Number(p.height) || 0,
                                weight: Number(p.weight) || 0,
                                quantity: Number(p.quantity) || 1,
                                overriddenRate: Number(p.overridden_rate) || 0
                            })) : [],
                            Array.isArray(typedExistingQuotation.additional_charges) ? typedExistingQuotation.additional_charges.map(c => ({
                                name: c.name || '',
                                description: c.description || '',
                                amount: Number(c.amount) || 0
                            })) : [],
                            {
                                clearanceCost: Number(typedExistingQuotation.clearance_cost) || 0,
                                deliveryRequired: typedExistingQuotation.delivery_service_required,
                                deliveryType: typedExistingQuotation.delivery_vehicle_type || '4wheel',
                                deliveryRates: { '4wheel': 3500, '6wheel': 6500 },
                                destinationId: typedExistingQuotation.destination_id || undefined,
                                freightRates: freightRates
                            }
                        );
                        setCalculationResult(initialCalculation);

                        // Update lastCalculatedValues for deep copy
                        lastCalculatedValues.current = {
                            pallets: JSON.parse(JSON.stringify(
                                Array.isArray(typedExistingQuotation.pallets) ? typedExistingQuotation.pallets.map(p => ({
                                    length: Number(p.length) || 0,
                                    width: Number(p.width) || 0,
                                    height: Number(p.height) || 0,
                                    weight: Number(p.weight) || 0,
                                    quantity: Number(p.quantity) || 1,
                                    overriddenRate: Number(p.overridden_rate) || 0
                                })) : []
                            )),
                            additionalCharges: JSON.parse(JSON.stringify(
                                Array.isArray(typedExistingQuotation.additional_charges) ? typedExistingQuotation.additional_charges.map(c => ({
                                    name: c.name || '',
                                    description: c.description || '',
                                    amount: Number(c.amount) || 0
                                })) : []
                            )),
                            destinationId: typedExistingQuotation.destination_id || ''
                        };

                        toast.success("Quotation Cloned", { description: "Data copied from existing quotation. Ready to edit." });

                    } else {
                        toast.error("Source quotation not found.");
                    }
                } else if (approveFromId) {
                    // --- APPROVE MODE (Customer-created quote request) ---
                    console.log(`Effect 2: Loading customer quote request ${approveFromId} for approval`);
                    const fetchedQuotation = await dbGetQuotationById(approveFromId);

                    if (fetchedQuotation && fetchedQuotation.status === 'pending_approval') {
                        console.log("Effect 2: Customer quote request found for approval.");
                        const typedQ = fetchedQuotation as Quotation;

                        // Set existing quotation so it updates (not creates new)
                        setExistingQuotation(typedQ);

                        const approveAdditionalCharges = Array.isArray(typedQ.additional_charges) && typedQ.additional_charges.length > 0
                            ? typedQ.additional_charges.map(c => ({
                                name: c.name || '',
                                description: c.description || '',
                                amount: Number(c.amount) || 0,
                                productId: (c as { productId?: string }).productId || undefined
                            }))
                            : [{ name: '', description: '', amount: 0 }];

                        reset({
                            commodityType: normalizeCommodityType(typedQ.commodity_type),
                            companyId: typedQ.company_id || '',
                            customerName: typedQ.customer_name || '',
                            contactPerson: typedQ.contact_person || '',
                            consignee: typedQ.consignee_name || '',
                            contractNo: typedQ.contract_no || '',
                            destinationId: typedQ.destination_id || '',
                            pallets: Array.isArray(typedQ.pallets) && typedQ.pallets.length > 0
                                ? typedQ.pallets.map(p => ({
                                    length: Number(p.length) || 0,
                                    width: Number(p.width) || 0,
                                    height: Number(p.height) || 0,
                                    weight: Number(p.weight) || 0,
                                    quantity: Number(p.quantity) || 1,
                                    overriddenRate: Number(p.overridden_rate) || 0
                                }))
                                : [{ length: 0, width: 0, height: 0, weight: 0, quantity: 1, overriddenRate: 0 }],
                            deliveryServiceRequired: typedQ.delivery_service_required ?? false,
                            deliveryVehicleType: typedQ.delivery_vehicle_type as '4wheel' | '6wheel' | undefined,
                            clearanceCost: Number(typedQ.clearance_cost) || 0,
                            additionalCharges: approveAdditionalCharges,
                            taxableLines: parseQuotationTaxableLinesToForm(
                                typedQ.taxable_lines,
                                approveAdditionalCharges.length
                            ),
                            notes: typedQ.notes || '',
                            opportunityId: typedQ.opportunity_id || '',
                        });

                        toast.info("Customer Quote Request", {
                            description: `Review pallet dimensions from ${typedQ.customer_name || 'customer'}. Select destination & rate, then approve.`,
                            duration: 6000
                        });
                        // Check if this quotation has any documents uploaded (by Quotation ID or Opportunity ID)
                        try {
                            const [docsByQ, docsByOpp] = await Promise.all([
                                getDocumentSubmissions(approveFromId),
                                typedQ.opportunity_id ? getDocumentSubmissionsByOpp(typedQ.opportunity_id) : Promise.resolve([])
                            ]);
                            
                            const totalDocs = (docsByQ?.length || 0) + (docsByOpp?.length || 0);
                            if (totalDocs > 0) {
                                console.log(`Effect 2: Found ${totalDocs} documents (${docsByQ?.length || 0} by Q, ${docsByOpp?.length || 0} by Opp).`);
                                setHasDocuments(true);
                            }
                        } catch (docErr) {
                            console.error("Error checking documents for approval:", docErr);
                        }
                    } else {
                        toast.error("Quote request not found or already processed.");
                        router.push('/shipping-calculator');
                    }
                } else {
                    console.log("Effect 2: New quotation mode, resetting to defaults (with params).");
                    // Clear existing quotation for new mode
                    setExistingQuotation(null);

                    reset({
                        companyId: paramCompanyId || '',
                        customerName: paramCustomerName || '',
                        contactPerson: '',
                        consignee: '',
                        contractNo: '',
                        destinationId: paramDestinationId || '',
                        pallets: [{ length: 0, width: 0, height: 0, weight: 0, quantity: 1 }],
                        deliveryServiceRequired: false,
                        deliveryVehicleType: paramVehicleType as '4wheel' | '6wheel' | undefined,
                        clearanceCost: 0, // Default to 0, user can add via button
                        additionalCharges: [{ name: '', description: '', amount: 0 }],
                        notes: paramNotes || '',
                        opportunityId: paramOpportunityId || '',
                        taxableLines: {
                            freight: false,
                            clearance: true,
                            delivery: true,
                            additional: [true],
                        },
                    });
                }
            } catch (error: unknown) {
                // Use unknown and check type
                console.error('Error setting form defaults:', error);
                const errorMessage = error instanceof Error ? error.message : "Could not set default values for the form.";
                toast.error("Form Setup Error", { description: errorMessage });
            }
        };

        setFormDefaults();

        // Depend on isLoading, isEditMode, quotationId, cloneFromId, and potentially userId
    }, [isLoading, isEditMode, quotationId, cloneFromId, approveFromId, userId, router, reset, freightRates, paramCompanyId, paramCustomerName, paramDestinationId, paramNotes, paramOpportunityId, paramVehicleType]); // Add missing dependencies

    // --- Delivery Rates ---
    // Wrap deliveryRates in useMemo
    const deliveryRates = React.useMemo(() => ({
        '4wheel': 3500,
        '6wheel': 6500
    }), []);

    // --- Recalculate Costs ---
    useEffect(() => {
        const subscription = watch((value, { name /*, type*/ }) => {
            // Skip if still loading initial data
            if (isLoading) return;

            const formValues = value as QuotationFormValues;
            const { pallets, additionalCharges, destinationId, deliveryServiceRequired, deliveryVehicleType, clearanceCost } = formValues;

            // Skip if missing basic required values
            if (!pallets?.length) return;

            // Always force calculation when pallet fields change
            const isPalletChange = name && name.startsWith('pallets');

            // Allow calculation even without destination (freight cost will be 0)
            // This allows saving draft quotations without all information

            // Skip if nothing relevant has changed and it's not a direct pallet change
            if (
                !isPalletChange &&
                JSON.stringify(pallets) === JSON.stringify(lastCalculatedValues.current.pallets) &&
                JSON.stringify(additionalCharges) === JSON.stringify(lastCalculatedValues.current.additionalCharges) &&
                destinationId === lastCalculatedValues.current.destinationId &&
                deliveryServiceRequired === watchedDeliveryRequired &&
                deliveryVehicleType === watchedDeliveryVehicle
            ) {
                return;
            }

            // If we reach here, calculate costs - even for the first pallet
            console.log("Recalculating costs due to field change:", name);

            // Update last calculated values
            // IMPORTANT: Deep copy here is CRITICAL. Without it, we store a reference that RHF mutates,
            // making the NEXT comparison (current vs last) always return true (equal), thus skipping calculation.
            lastCalculatedValues.current = {
                pallets: pallets ? JSON.parse(JSON.stringify(pallets)) : [],
                additionalCharges: additionalCharges ? JSON.parse(JSON.stringify(additionalCharges)) : [],
                destinationId
            };

            // Calculate total costs
            const calculationResult = calculateTotalFreightCost(
                pallets || [],
                additionalCharges || [],
                {
                    clearanceCost: clearanceCost || 0, // Use form value or 0 if undefined
                    deliveryRequired: deliveryServiceRequired,
                    deliveryType: deliveryVehicleType,
                    deliveryRates: deliveryRates,
                    destinationId: destinationId,
                    freightRates: freightRates,
                    isChargeableWeightManual: formValues.isChargeableWeightManual,
                    manualChargeableWeight: formValues.manualChargeableWeight,
                    isManualRate: formValues.isManualRate,
                    manualRate: formValues.manualRate
                }
            );

            // Set calculation result
            setCalculationResult(calculationResult);
        });

        return () => subscription.unsubscribe();
        // Add deliveryRates to dependency array (it's memoized now)
    }, [watch, isLoading, watchedDeliveryRequired, watchedDeliveryVehicle, deliveryRates, freightRates]);

    // --- Generate Data for DB --- 
    // This function now creates the full data object required for insertion
    // based on the updated NewQuotationData type (which matches the Quotation interface minus id/created_at)
    const generateQuotationDataForDB = (formData: QuotationFormValues, calcResult: CalculationResult, finalHasDocs?: boolean): NewQuotationData | null => {
        if (!userId || !calcResult) {
            console.error("Cannot generate quotation data: missing user ID or calculation results");
            return null;
        }

        // Find company and destination names for snapshot
        const selectedCompany = companies.find(c => c.id === formData.companyId);
        const selectedDestination = destinations.find(d => d.id === formData.destinationId);

        // Explode pallets: if any row has quantity > 1, convert it to multiple rows with quantity 1
        // This ensures the backend data is always distributed for tracking.
        const explodedPallets = formData.pallets.flatMap(p => {
            const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
            return Array(qty).fill(null).map(() => ({
                ...p,
                quantity: 1
            }));
        });

        // Map pallets to ensure field names match Quotation interface (snake_case)
        const convertedPallets = explodedPallets.map(p => ({
            length: p.length,
            width: p.width,
            height: p.height,
            weight: p.weight,
            quantity: 1, // Already 1 from explosion, but explicit is better
            overridden_rate: p.overriddenRate
        }));
        // Filter out empty additional charges (where name and description are empty)
        const convertedAdditionalCharges = formData.additionalCharges.filter(
            charge => charge.name !== '' || charge.description !== '' || charge.amount > 0
        );

        const tlForm = (formData.taxableLines ?? {
            freight: false,
            clearance: true,
            delivery: true,
            additional: [],
        }) as QuotationTaxableLinesForm;
        const acForm = formData.additionalCharges ?? [];
        const paddedAdditional = [...(tlForm.additional ?? [])];
        while (paddedAdditional.length < acForm.length) paddedAdditional.push(true);
        const tlSafe: QuotationTaxableLinesForm = {
            freight: tlForm.freight !== false,
            clearance: tlForm.clearance !== false,
            delivery: tlForm.delivery !== false,
            additional: paddedAdditional.slice(0, acForm.length),
        };
        const taxable_lines = buildQuotationTaxableLinesFromForm(tlSafe, acForm);
        const additional_amounts = convertedAdditionalCharges.map((c) => Number(c.amount) || 0);
        const vatComputed = computeQuotationVatBreakdown({
            total_freight_cost: calcResult.totalFreightCost,
            clearance_cost: Number(formData.clearanceCost) || 0,
            delivery_amount: formData.deliveryServiceRequired ? calcResult.deliveryCost : 0,
            additional_amounts,
            taxable_lines,
            wht_enabled: formData.whtEnabled !== false,
        });

        // Construct the full data object matching NewQuotationData with snake_case field names
        const dataForDB: NewQuotationData = {
            user_id: userId,
            commodity_type: formData.commodityType || 'cannabis',
            company_id: formData.companyId || '',
            customer_name: formData.customerName || '',
            contact_person: formData.contactPerson || '',
            consignee_name: formData.consignee || '',
            contract_no: formData.contractNo || null,
            destination_id: formData.destinationId || null,
            pallets: convertedPallets,
            delivery_service_required: formData.deliveryServiceRequired,
            delivery_vehicle_type: formData.deliveryVehicleType || '4wheel',
            clearance_cost: formData.clearanceCost, // Use formData
            additional_charges: convertedAdditionalCharges,
            notes: formData.notes || null,
            internal_remark: formData.internalRemark || null, // Map internalRemark -> internal_remark
            opportunity_id: formData.opportunityId || null, // Added field
            product_id: formData.productId ? formData.productId.split(',')[0] : null,
            total_cost: calcResult.finalTotalCost,
            total_freight_cost: calcResult.totalFreightCost,
            delivery_cost: calcResult.deliveryCost,
            total_volume_weight: calcResult.totalVolumeWeight,
            total_actual_weight: calcResult.totalActualWeight,
            chargeable_weight: calcResult.totalChargeableWeight,
            is_chargeable_weight_manual: formData.isChargeableWeightManual || false,
            manual_chargeable_weight: formData.manualChargeableWeight || null,
            is_manual_rate: formData.isManualRate || false,
            manual_rate: formData.manualRate || null,
            // Preserve existing status if in edit mode; for approve mode set to 'docs_uploaded' if has documents, otherwise 'draft'
            // Determine status for Approve mode: use finalHasDocs if provided, otherwise fallback to state
            status: isApproveMode 
                ? ((finalHasDocs ?? hasDocuments) ? 'docs_uploaded' : 'draft') 
                : (isEditMode && existingQuotation ? existingQuotation.status : 'draft'),
            company_name: selectedCompany?.name || formData.companyId,
            destination: selectedDestination
                ? `${selectedDestination.country}${selectedDestination.port ? `, ${selectedDestination.port}` : ''}`
                : null,
            taxable_lines,
            vat_amount: vatComputed.vat_amount,
            grand_total_with_vat: vatComputed.grand_total_with_vat,
            wht_enabled: formData.whtEnabled !== false,
            wht_amount: vatComputed.wht_amount,
        };
        return dataForDB;
    };

    // --- Save/Update Quotation Logic ---
    const handleSave = async () => {
        try {
            // Skip validation - allow saving as draft with any data
            setIsSaving(true);
            const loadingToastId = toast.loading(isApproveMode ? "Approving Quote Request..." : isEditMode ? "Updating Quotation..." : "Saving Quotation...");

            // Check prerequisites
            if (!userId) {
                toast.error("Authentication Error", {
                    id: loadingToastId,
                    description: "User not logged in. Please log in and try again."
                });
                return;
            }

            const formData = getValues();

            // Perform a fresh calculation to ensure we have the absolute latest data
            // This fixes the race condition where typing -> save immediately uses stale state
            const freshCalculationResult = calculateTotalFreightCost(
                formData.pallets || [],
                formData.additionalCharges || [],
                {
                    clearanceCost: formData.clearanceCost || 0,
                    deliveryRequired: formData.deliveryServiceRequired,
                    deliveryType: formData.deliveryVehicleType,
                    deliveryRates: deliveryRates,
                    destinationId: formData.destinationId,
                    freightRates: freightRates,
                    isChargeableWeightManual: formData.isChargeableWeightManual,
                    manualChargeableWeight: formData.manualChargeableWeight,
                    isManualRate: formData.isManualRate,
                    manualRate: formData.manualRate
                }
            );

            // Also update local state to match (optional but good for consistency UI)
            setCalculationResult(freshCalculationResult);

            if (!freshCalculationResult) {
                toast.error("Calculation Error", {
                    id: loadingToastId,
                    description: "Calculation results are missing. Please ensure all required fields are filled."
                });
                return;
            }

            // Log form values to help debug
            console.log("Form values being saved:", formData);
            console.log("Fresh Calculation results:", freshCalculationResult);

            // If in Approve mode, do one final check for documents to be absolutely sure
            let finalHasDocs = hasDocuments;
            if (isApproveMode && approveFromId) {
                console.log("Final check for documents before approval (Q & Opp)...");
                const oppId = existingQuotation?.opportunity_id;
                const [docsByQ, docsByOpp] = await Promise.all([
                    getDocumentSubmissions(approveFromId),
                    oppId ? getDocumentSubmissionsByOpp(oppId) : Promise.resolve([])
                ]);
                
                finalHasDocs = (docsByQ && docsByQ.length > 0) || (docsByOpp && docsByOpp.length > 0);
                console.log(`Final check result: ${finalHasDocs ? 'Documents found' : 'No documents'}`);
            }

            // Use the updated function to get the full data object, passing the FRESH result
            const quotationDataForDB = generateQuotationDataForDB(formData, freshCalculationResult, finalHasDocs);

            if (!quotationDataForDB) {
                toast.error("Data Preparation Error", {
                    id: loadingToastId,
                    description: "Failed to generate data for saving. Please check console for details."
                });
                return;
            }

            let savedQuotation: Quotation | null = null;

            if (isApproveMode && approveFromId && existingQuotation) {
                // --- APPROVE MODE: Update customer-created quote ---
                const {
                    ...updateDataForDB
                } = quotationDataForDB;

                // Ensure we keep the customer_user_id from original request
                (updateDataForDB as Record<string, unknown>).customer_user_id = existingQuotation.customer_user_id;

                savedQuotation = await dbUpdateQuotation(approveFromId, updateDataForDB);

                if (!savedQuotation) {
                    throw new Error("Failed to approve quote request. The database operation returned null.");
                }
            } else if (isEditMode && quotationId) {
                // Prepare update data - Omit fields not meant for update
                const {
                    /* user_id: ignoredUserId, */
                    /* company_name: ignoredCompName, */
                    /* destination: ignoredDestName, */
                    ...updateDataForDB
                } = quotationDataForDB;

                // Pass the rest of the data for update
                savedQuotation = await dbUpdateQuotation(quotationId, updateDataForDB);

                if (!savedQuotation) {
                    throw new Error("Failed to update quotation. The database operation returned null.");
                }
            } else {
                // Save new quotation using the full data object
                try {
                    savedQuotation = await dbSaveQuotation(quotationDataForDB);

                    if (!savedQuotation) {
                        throw new Error("Failed to save quotation. The database operation returned null.");
                    }
                } catch (saveError: unknown) {
                    // Handle specific save errors
                    console.error("Save quotation error details:", saveError);
                    throw new Error(saveError instanceof Error ? saveError.message : "Database save operation failed");
                }
            }

            // Success path
            toast.success(isApproveMode ? "Quote Request Approved" : isEditMode ? "Quotation Updated" : "Quotation Saved", {
                id: loadingToastId,
                description: `Quotation ${savedQuotation.id} saved.`, // Clearer message
                action: {
                    label: "View List",
                    onClick: () => router.push('/shipping-calculator'),
                },
            });

            // Prepare quotation data for preview
            const previewData = {
                ...savedQuotation,
                // Add calculation results that might not be in the DB record
                totalVolumeWeight: freshCalculationResult.totalVolumeWeight,
                totalActualWeight: freshCalculationResult.totalActualWeight,
                chargeableWeight: freshCalculationResult.totalChargeableWeight,
                totalFreightCost: freshCalculationResult.totalFreightCost,
                deliveryCost: freshCalculationResult.deliveryCost,
                totalAdditionalCharges: freshCalculationResult.totalAdditionalCharges,
                // Ensure we have good conversion between snake_case and camelCase
                companyName: savedQuotation.company_name,
                deliveryVehicleType: savedQuotation.delivery_vehicle_type,
                deliveryServiceRequired: savedQuotation.delivery_service_required,
                additionalCharges: savedQuotation.additional_charges,
                contactPerson: savedQuotation.contact_person,
                consignee: savedQuotation.consignee_name,
                freightRate: (freshCalculationResult.totalFreightCost / (freshCalculationResult.totalChargeableWeight || 1)) || 0
            };

            // Store in sessionStorage for preview
            sessionStorage.setItem('quotationData', JSON.stringify(previewData));

            // Navigate to preview
            router.push(`/shipping-calculator/preview?id=${savedQuotation.id}`);

        } catch (error: unknown) {
            console.error('Error saving quotation:', error);

            // Get a more descriptive error message if possible
            const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";

            // Show a toast with the error
            toast.error(isEditMode ? "Update Failed" : "Save Failed", {
                description: errorMessage,
            });
        } finally {
            setIsSaving(false);
        }
    };

    // --- Form Submission Handler (for Enter key - generally unused due to buttons) ---
    const onSubmit: SubmitHandler<QuotationFormValues> = (data) => {
        console.log("Form submitted via Enter key (not recommended):", data);
        // Add type assertion for data if needed, though SubmitHandler should match
        // const typedData = data as QuotationFormValues;
        toast.info("Submit Action", { description: "Please use the 'Submit Quotation' button." })
    };

    // --- Loading State --- (Simplify back to just isLoading)
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                <p className="ml-3 text-gray-600">Loading Calculator Data...</p>
            </div>
        );
    }

    // --- Render Form ---
    return (
        <FormProvider {...form} key={quotationId || 'new'}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-4 md:p-8 max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <Button type="button" variant="outline" size="sm" onClick={() => router.back()} className="flex items-center gap-1">
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </Button>
                    <h1 className="text-2xl font-semibold">
                        {isApproveMode ? '⏳ Review & Approve Customer Request' : isEditMode ? 'Edit Quotation' : 'New Quotation'}
                    </h1>
                    <div className="w-20"></div> {/* Spacer */}
                </div>

                {/* Approve Mode Banner */}
                {isApproveMode && existingQuotation && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                            <span className="text-lg">📋</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-orange-800">Customer Quote Request</h3>
                            <p className="text-sm text-orange-700 mt-1">
                                <strong>{existingQuotation.customer_name}</strong> submitted a quote request with pallet dimensions.
                                You can approve without selecting a destination — the customer will not see any price until you fill in destination &amp; rate later.
                            </p>
                            {existingQuotation.notes && (
                                <p className="text-sm text-orange-600 mt-2 bg-orange-100 rounded px-3 py-1.5">
                                    <strong>Customer Note:</strong> {existingQuotation.notes}
                                </p>
                            )}
                            {existingQuotation.phyto_required && (
                                <p className="text-sm text-emerald-700 mt-2 bg-emerald-100 rounded px-3 py-1.5 flex items-center gap-2">
                                    <Leaf className="w-4 h-4 shrink-0" />
                                    <span><strong>Phytosanitary service requested</strong> — add this to your quote.</span>
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Column 1: Customer & Destination */}
                    <Card className="md:col-span-1">
                        <CardHeader>
                            <CardTitle className="text-lg">Customer & Destination</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={control}
                                name="commodityType"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Commodity Type *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select commodity" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {ALL_COMMODITY_TYPES.map((type) => (
                                                    <SelectItem key={type} value={type}>
                                                        {COMMODITY_META[type].label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="companyId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Company *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select company" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {companies.map((company) => (
                                                    <SelectItem key={company.id} value={company.id}>
                                                        {company.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.companyId && <p className="text-red-500 text-xs mt-1">{errors.companyId.message}</p>}
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="productId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Product Master (Optional)</FormLabel>
                                        <div className="border border-emerald-100 rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-slate-50">
                                            {products.length === 0 ? (
                                                <p className="text-xs text-muted-foreground italic">No products found.</p>
                                            ) : (
                                                products.map((product) => {
                                                    const selectedIds = field.value ? field.value.split(',') : [];
                                                    return (
                                                        <div key={product.id} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`prod-${product.id}`}
                                                                checked={selectedIds.includes(product.id)}
                                                                onCheckedChange={(checked) => {
                                                                    let current = field.value ? field.value.split(',').filter(id => id && id !== 'none') : [];
                                                                    if (checked) {
                                                                        current.push(product.id);
                                                                    } else {
                                                                        current = current.filter(id => id !== product.id);
                                                                    }
                                                                    field.onChange(current.join(','));
                                                                }}
                                                            />
                                                            <label htmlFor={`prod-${product.id}`} className="text-sm cursor-pointer">{product.name}</label>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                        <p className="text-[10px] text-emerald-600 italic">Choosing a product will auto-fill standard charges.</p>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="customerName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Customer Name *</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter customer name" {...field} />
                                        </FormControl>
                                        {errors.customerName && <p className="text-red-500 text-xs mt-1">{errors.customerName.message}</p>}
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="contactPerson"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Contact Person *</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., John Doe" {...field} />
                                        </FormControl>
                                        {errors.contactPerson && <p className="text-red-500 text-xs mt-1">{errors.contactPerson.message}</p>}
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="consignee"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Consignee (Optional)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Party receiving the shipment" {...field} />
                                        </FormControl>
                                        {errors.consignee && <p className="text-red-500 text-xs mt-1">{errors.consignee.message}</p>}
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="contractNo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Contract No (Optional)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., C12345" {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="destinationId"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex items-center justify-between mb-1">
                                            <FormLabel>Destination *</FormLabel>
                                            {existingQuotation?.requested_destination && !watch('destinationId') && (
                                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 uppercase tracking-tight">
                                                    Customer Req
                                                </span>
                                            )}
                                        </div>
                                        {existingQuotation?.requested_destination && !watch('destinationId') && (
                                            <div className="mb-2 p-2 bg-emerald-50 border border-emerald-100 rounded text-xs text-emerald-800 italic">
                                                <strong>Customer Requested:</strong> {existingQuotation.requested_destination}
                                            </div>
                                        )}
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select destination" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {destinations.map((dest) => (
                                                    <SelectItem key={dest.id} value={dest.id}>
                                                        {`${dest.country}${dest.port ? `, ${dest.port}` : ''}`}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.destinationId && <p className="text-red-500 text-xs mt-1">{errors.destinationId.message}</p>}
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    {/* Column 2: Pallet Details */}
                    <Card className="md:col-span-2">
                        <CardHeader>
                            <CardTitle className="text-lg">Shipment Details (Pallets)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* Bulk Action Tools */}
                            <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl shadow-sm">
                                <div className="flex items-center gap-2 mb-4 text-slate-700 font-bold border-b pb-2">
                                    <Zap className="h-4 w-4 text-amber-500 fill-amber-500" />
                                    <span>Bulk Action Tools</span>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Sub-section: Bulk Add */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            <Layers className="h-3 w-3" />
                                            <span>Bulk Add Pallets</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-slate-400">Length (cm)</label>
                                                <Input type="number" value={bulkLength} onChange={(e) => setBulkLength(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-slate-400">Width (cm)</label>
                                                <Input type="number" value={bulkWidth} onChange={(e) => setBulkWidth(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-slate-400">Height (cm)</label>
                                                <Input type="number" value={bulkHeight} onChange={(e) => setBulkHeight(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-slate-400">Weight (kg)</label>
                                                <Input type="number" value={bulkWeight} onChange={(e) => setBulkWeight(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-slate-400">Quantity</label>
                                                <Input type="number" value={bulkQuantity} onChange={(e) => setBulkQuantity(parseInt(e.target.value) || 1)} className="h-8 text-xs" min="1" />
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={handleBulkAdd}
                                            className="w-full h-8 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                                        >
                                            <Plus className="h-3 w-3 mr-1" /> Add {bulkQuantity} Pallets
                                        </Button>
                                    </div>

                                    {/* Sub-section: Bulk Override */}
                                    <div className="space-y-3 border-l pl-6 hidden lg:block">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            <Zap className="h-3 w-3" />
                                            <span>Bulk Rate Override</span>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-slate-400">New Rate (THB/kg)</label>
                                            <Input
                                                type="number"
                                                value={bulkRate}
                                                onChange={(e) => setBulkRate(parseFloat(e.target.value) || 0)}
                                                className="h-9 border-blue-200 focus:border-blue-500 bg-blue-50/10"
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div className="pt-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleBulkRateOverride}
                                                className="w-full h-9 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                                                disabled={palletFields.length === 0}
                                            >
                                                <Check className="h-3 w-3 mr-1" /> Apply to All {palletFields.length} Pallets
                                            </Button>
                                            <p className="text-[10px] text-slate-400 mt-1.5 italic text-center">This will update all manual rate fields below.</p>
                                        </div>
                                    </div>

                                    {/* Mobile version of Bulk Override (no border-l) */}
                                    <div className="space-y-3 pt-4 border-t lg:hidden">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            <Zap className="h-3 w-3" />
                                            <span>Bulk Rate Override</span>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-slate-400">New Rate (THB/kg)</label>
                                            <Input
                                                type="number"
                                                value={bulkRate}
                                                onChange={(e) => setBulkRate(parseFloat(e.target.value) || 0)}
                                                className="h-9"
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleBulkRateOverride}
                                            className="w-full text-xs"
                                            disabled={palletFields.length === 0}
                                        >
                                            Apply to All Pallets
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {palletGroups.map((group) => {
                                if (group.indices.length === 1) {
                                    const idx = group.indices[0];
                                    return (
                                        <PalletItem
                                            key={group.fieldIds[0]}
                                            index={idx}
                                            removePallet={removePallet}
                                            destinationId={watchedDestinationId}
                                            freightRates={freightRates}
                                        />
                                    );
                                }

                                const isExpanded = expandedGroupKeys.has(group.key);

                                return (
                                    <PalletGroupCard
                                        key={group.key}
                                        dims={group.dims}
                                        count={group.indices.length}
                                        isExpanded={isExpanded}
                                        onToggle={() => togglePalletGroup(group.key)}
                                        onDuplicate={() => duplicatePalletGroup(group.dims)}
                                        onRemoveGroup={() => removePalletGroup(group.indices)}
                                        totalChargeableWeight={group.totalChargeableWeight}
                                        totalFreight={group.totalFreight}
                                    >
                                        {isExpanded
                                            ? group.indices.map((idx, i) => (
                                                  <PalletItem
                                                      key={group.fieldIds[i]}
                                                      index={idx}
                                                      removePallet={removePallet}
                                                      destinationId={watchedDestinationId}
                                                      freightRates={freightRates}
                                                  />
                                              ))
                                            : null}
                                    </PalletGroupCard>
                                );
                            })}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => appendPallet({ length: 0, width: 0, height: 0, weight: 0, quantity: 1 })}
                                className="mt-3 w-full flex items-center justify-center gap-1"
                            >
                                <Plus className="h-4 w-4" /> Add Pallet
                            </Button>
                            {errors.pallets?.root && <p className="text-red-500 text-xs mt-1">{errors.pallets.root.message}</p>}
                            {/* Check message type before displaying */}
                            {errors.pallets?.message && typeof errors.pallets.message === 'string' && <p className="text-red-500 text-xs mt-1">{errors.pallets.message}</p>}

                            {/* Display Total Weights */}
                            {calculationResult && (
                                <div className="mt-4 p-4 bg-blue-50/50 rounded-xl text-sm space-y-2 border border-blue-100 shadow-sm glass">
                                    <div className="flex justify-between items-center text-slate-600">
                                        <span>Total Volume Weight:</span>
                                        <span className="font-bold text-slate-800">{formatNumber(calculationResult.totalVolumeWeight)} kg</span>
                                    </div>
                                    <div className="flex justify-between items-center text-slate-600">
                                        <span>Total Actual Weight:</span>
                                        <span className="font-bold text-slate-800">{formatNumber(calculationResult.totalActualWeight)} kg</span>
                                    </div>
                                    
                                    <Separator className="bg-blue-200/50" />
                                    
                                    {/* Manual Chargeable Weight Override UI */}
                                    <div className="space-y-3 py-1">
                                        <FormField
                                            control={control}
                                            name="isChargeableWeightManual"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between space-y-0 p-0">
                                                    <div className="space-y-0.5">
                                                        <FormLabel className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                                                            <Zap className="h-3 w-3 fill-blue-500 text-blue-500" />
                                                            Manual Chargeable Weight?
                                                        </FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        {watch('isChargeableWeightManual') && (
                                            <FormField
                                                control={control}
                                                name="manualChargeableWeight"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                                    className="h-9 pr-6 font-bold border-blue-300 focus:border-blue-500 bg-white"
                                                                    placeholder="Weight"
                                                                />
                                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">kg</span>
                                                            </div>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        )}

                                        <FormField
                                            control={control}
                                            name="isManualRate"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between space-y-0 p-0">
                                                    <div className="space-y-0.5">
                                                        <FormLabel className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                                                            <Zap className="h-3 w-3 fill-amber-500 text-amber-500" />
                                                            Manual Rate Override?
                                                        </FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        {watch('isManualRate') && (
                                            <FormField
                                                control={control}
                                                name="manualRate"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                                    className="h-9 pr-12 font-bold border-blue-300 focus:border-blue-500 bg-white"
                                                                    placeholder="Rate"
                                                                />
                                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">THB/kg</span>
                                                            </div>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                    </div>

                                    <Separator className="bg-blue-200/50" />
                                    <div className="flex justify-between items-center pt-1 text-blue-700">
                                        <span className="font-bold">Aggregate Chargeable Wt:</span>
                                        <span className="font-black text-lg">{formatNumber(calculationResult.totalChargeableWeight)} kg</span>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Row 2 / Column 3 Equivalent: Services & Costs */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="text-lg">Additional Services & Costs</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left side: Services, Charges, Notes */}
                            <div className="space-y-4">
                                <h3 className="font-medium mb-2">Services</h3>
                                <FormField
                                    control={control}
                                    name="deliveryServiceRequired"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    id="deliveryServiceRequired"
                                                />
                                            </FormControl>
                                            <label htmlFor="deliveryServiceRequired" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                Delivery Service Required?
                                            </label>
                                        </FormItem>
                                    )}
                                />
                                {watchedDeliveryRequired && (
                                    <FormField
                                        control={control}
                                        name="deliveryVehicleType"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Delivery Vehicle Type</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select vehicle type" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="4wheel">4-Wheel Truck ({deliveryRates['4wheel']} THB)</SelectItem>
                                                        <SelectItem value="6wheel">6-Wheel Truck ({deliveryRates['6wheel']} THB)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Clearance Cost Section */}
                                <div className="space-y-2 pt-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-medium mb-1">Clearance Cost</h3>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const currentValue = getValues('clearanceCost');
                                                if (currentValue && currentValue > 0) {
                                                    reset({ ...getValues(), clearanceCost: 0 });
                                                } else {
                                                    reset({ ...getValues(), clearanceCost: 5000 });
                                                }
                                            }}
                                        >
                                            {getValues('clearanceCost') && getValues('clearanceCost')! > 0 ? 'Remove' : 'Add Default'}
                                        </Button>
                                    </div>
                                    <FormField
                                        control={control}
                                        name="clearanceCost"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Clearance Cost (THB)</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        placeholder="Enter clearance cost (0 for no clearance)"
                                                        {...field}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            // Allow empty string, otherwise parse as number
                                                            field.onChange(val === '' ? 0 : parseFloat(val) || 0);
                                                        }}
                                                        value={field.value ?? ''}
                                                    />
                                                </FormControl>
                                                {errors.clearanceCost && (
                                                    <p className="text-sm text-red-600">{errors.clearanceCost.message}</p>
                                                )}
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name="taxableLines.clearance"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm bg-white">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value !== false}
                                                        onCheckedChange={(v) => field.onChange(v === true)}
                                                        id="clearanceTaxable"
                                                    />
                                                </FormControl>
                                                <label htmlFor="clearanceTaxable" className="text-sm font-medium leading-none">
                                                    VAT 7% on clearance
                                                </label>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="space-y-2 pt-4">
                                    <h3 className="font-medium mb-1">Additional Charges</h3>
                                    {chargeFields.map((field, index) => (
                                        <AdditionalChargeItem key={field.id} index={index} removeChargeRow={removeChargeRow} />
                                    ))}
                                    {chargeFields.length === 0 && <p className="text-xs text-gray-500 italic">No additional charges added.</p>}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => appendChargeRow({ name: '', description: '', amount: 0 })}
                                        className="mt-2 w-full flex items-center justify-center gap-1 text-xs"
                                    >
                                        <Plus className="h-3 w-3" /> Add Charge
                                    </Button>
                                </div>
                                <FormField
                                    control={control}
                                    name="notes"
                                    render={({ field }) => (
                                        <FormItem className="mt-4">
                                            <FormLabel>Notes (Optional)</FormLabel>
                                            <FormControl>
                                                <Textarea placeholder="Add any relevant notes here..." {...field} rows={3} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="internalRemark"
                                    render={({ field }) => (
                                        <FormItem className="mt-4 p-3 bg-blue-50/50 border border-blue-100 rounded-md">
                                            <FormLabel className="text-blue-700 font-semibold flex items-center gap-2">
                                                Internal Remark (Staff Only)
                                                <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded uppercase">Private</span>
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    placeholder="Add internal notes that won't be seen by customers..."
                                                    {...field}
                                                    rows={2}
                                                    className="bg-white border-blue-200 focus-visible:ring-blue-500"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Right side: Cost Summary */}
                            <div className="space-y-4 p-6 glass rounded-2xl border border-blue-100 shadow-xl h-fit sticky top-4 self-start overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100/30 rounded-full -mr-16 -mt-16 blur-3xl pointer-events-none"></div>
                                <h3 className="font-extrabold text-xl mb-4 text-blue-900 border-b border-blue-100 pb-2 relative z-10">
                                    Quotation Summary
                                </h3>
                                {calculationResult ? (
                                    <div className="space-y-3 relative z-10">
                                        <div className="flex justify-between text-sm text-slate-600 items-center gap-2 flex-wrap">
                                            <span>Freight Cost</span>
                                            <div className="flex items-center gap-2">
                                                <FormField
                                                    control={control}
                                                    name="taxableLines.freight"
                                                    render={({ field }) => (
                                                        <FormItem className="flex flex-row items-center space-x-1.5 space-y-0 m-0">
                                                            <FormLabel className="text-[10px] text-slate-500 m-0">Taxable</FormLabel>
                                                            <FormControl>
                                                                <Checkbox
                                                                    className="h-4 w-4"
                                                                    checked={field.value !== false}
                                                                    onCheckedChange={(v) => field.onChange(v === true)}
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span className="font-bold text-slate-900 tabular-nums">
                                                    {calculationResult.totalFreightCost.toLocaleString()} THB
                                                </span>
                                            </div>
                                        </div>
                                        {calculationResult.clearanceCost > 0 && (
                                            <div className="flex justify-between text-sm text-slate-600">
                                                <span>Clearance Cost:</span>
                                                <span className="font-bold text-slate-900 tabular-nums">
                                                    {calculationResult.clearanceCost.toLocaleString()} THB
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-sm text-slate-600 items-center gap-2 flex-wrap">
                                            <span>Delivery Fee</span>
                                            <div className="flex items-center gap-2">
                                                <FormField
                                                    control={control}
                                                    name="taxableLines.delivery"
                                                    render={({ field }) => (
                                                        <FormItem className="flex flex-row items-center space-x-1.5 space-y-0 m-0">
                                                            <FormLabel className="text-[10px] text-slate-500 m-0">Taxable</FormLabel>
                                                            <FormControl>
                                                                <Checkbox
                                                                    className="h-4 w-4"
                                                                    checked={field.value !== false}
                                                                    onCheckedChange={(v) => field.onChange(v === true)}
                                                                    disabled={!watchedDeliveryRequired}
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span className="font-bold text-slate-900 tabular-nums">
                                                    {watchedDeliveryRequired
                                                        ? calculationResult.deliveryCost.toLocaleString()
                                                        : '0'}{' '}
                                                    THB
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-sm text-slate-600">
                                            <span>Additional Charges (sum):</span>
                                            <span className="font-bold text-slate-900 tabular-nums">
                                                {calculationResult.totalAdditionalCharges.toLocaleString()} THB
                                            </span>
                                        </div>

                                        {vatDisplayRows.length > 0 && quotationVatBreakdown && (
                                            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2 text-xs">
                                                <p className="font-semibold text-slate-700 mb-1.5">VAT split (by line)</p>
                                                <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-0.5 text-[11px]">
                                                    <span className="text-slate-500 font-medium">Charge</span>
                                                    <span className="text-right text-emerald-700 font-medium">VAT base</span>
                                                    <span className="text-right text-amber-800 font-medium">Non-VAT</span>
                                                    {vatDisplayRows.map((row, ri) => (
                                                        <React.Fragment key={`${row.label}-${ri}`}>
                                                            <span className="text-slate-600 truncate" title={row.label}>
                                                                {row.label}
                                                            </span>
                                                            <span className="text-right tabular-nums">
                                                                {row.vatPart > 0 ? row.vatPart.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                                                            </span>
                                                            <span className="text-right tabular-nums">
                                                                {row.nonVatPart > 0 ? row.nonVatPart.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                                                            </span>
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                                <Separator className="my-2" />
                                                <div className="flex justify-between text-slate-700">
                                                    <span>VAT 7% (on VAT base)</span>
                                                    <span className="font-bold tabular-nums">
                                                        {quotationVatBreakdown.vat_amount.toLocaleString(undefined, {
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        THB
                                                    </span>
                                                </div>
                                                {quotationVatBreakdown.wht_amount > 0 && (
                                                    <div className="flex justify-between text-slate-700">
                                                        <span>Tax 3% (WHT)</span>
                                                        <span className="font-bold tabular-nums text-red-600">
                                                            (
                                                            {quotationVatBreakdown.wht_amount.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                            ) THB
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between text-slate-800 font-semibold mt-1">
                                                    <span>NET TO PAY</span>
                                                    <span className="tabular-nums">
                                                        {quotationVatBreakdown.net_payable.toLocaleString(undefined, {
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        THB
                                                    </span>
                                                </div>
                                                <FormField
                                                    control={control}
                                                    name="whtEnabled"
                                                    render={({ field }) => (
                                                        <FormItem className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                                                            <FormControl>
                                                                <Checkbox
                                                                    checked={field.value !== false}
                                                                    onCheckedChange={(v) => field.onChange(v === true)}
                                                                />
                                                            </FormControl>
                                                            <FormLabel className="!mt-0 text-[11px] font-medium text-slate-600 cursor-pointer">
                                                                Apply 3% withholding tax (on VAT-taxable amount)
                                                            </FormLabel>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        )}

                                        <Separator className="my-4 bg-blue-200/50" />
                                        <div className="bg-blue-600 rounded-xl p-4 text-white shadow-lg space-y-1 transform transition-all duration-300 hover:scale-[1.02]">
                                            {quotationVatBreakdown ? (
                                                <>
                                                    <p className="text-[11px] text-blue-100/90 leading-snug">
                                                        Subtotal{' '}
                                                        {calculationResult.finalTotalCost.toLocaleString(undefined, {
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        THB · VAT 7%{' '}
                                                        {quotationVatBreakdown.vat_amount.toLocaleString(undefined, {
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        THB
                                                    </p>
                                                    <p className="text-xs text-blue-100 font-medium uppercase tracking-wider">
                                                        NET TO PAY
                                                    </p>
                                                    <div className="flex justify-between items-baseline">
                                                        <span className="text-3xl font-black tabular-nums">
                                                            {(quotationVatBreakdown.net_payable ?? calculationResult.finalTotalCost).toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </span>
                                                        <span className="text-sm font-bold text-blue-200 ml-1">THB</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-xs text-blue-100 font-medium uppercase tracking-wider">
                                                        Final Total (Excl. VAT)
                                                    </p>
                                                    <div className="flex justify-between items-baseline">
                                                        <span className="text-3xl font-black">
                                                            {calculationResult.finalTotalCost.toLocaleString()}
                                                        </span>
                                                        <span className="text-sm font-bold text-blue-200 ml-1">THB</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 space-y-3">
                                        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                                        <p className="text-slate-400 text-sm font-medium">Calculating pricing...</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Footer Buttons */}
                <CardFooter className="flex justify-end gap-3 pt-6 border-t mt-6">
                    <Button type="button" variant="outline" onClick={() => router.push('/shipping-calculator')} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="h-11 px-8 bg-blue-700 hover:bg-blue-800 text-white font-extrabold shadow-lg hover:shadow-xl transition-all rounded-xl min-w-[180px]"
                    >
                        {isSaving ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Saving...</span>
                            </div>
                        ) : (isApproveMode
                            ? (watchedDestinationId ? 'Approve & Save' : 'Approve without pricing')
                            : isEditMode ? 'Update Quotation' : 'Confirm & Save')}
                    </Button>
                </CardFooter>

                {isEditMode && quotationId && existingQuotation?.awb_number && (
                    <AwbTrackingPanel
                        quotationId={quotationId}
                        awbNumber={existingQuotation.awb_number}
                        omgNumber={existingQuotation.quotation_no}
                    />
                )}
            </form>
        </FormProvider>
    );
}

// Wrapper with Suspense boundary
export default function ShippingCalculatorPage() {
    return (
        <Suspense fallback={
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                <p className="ml-3 text-gray-600">Loading Calculator...</p>
            </div>
        }>
            <ShippingCalculatorPageContent />
        </Suspense>
    );
}
