import { calculateVolumeWeight } from '@/lib/calculators';

export type FreightRate = {
  id: string;
  destination_id: string;
  min_weight?: number | null;
  max_weight?: number | null;
  base_rate: number;
};

export type FreightPalletInput = {
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity?: number;
  overriddenRate?: number;
};

export type StaffFreightCalcResult = {
  totalVolumeWeight: number;
  totalActualWeight: number;
  totalChargeableWeight: number;
  totalFreightCost: number;
  finalTotalCost: number;
  effectiveRate: number | null;
};

function singlePalletFreightCost(
  pallet: FreightPalletInput,
  destinationId: string,
  freightRates: FreightRate[]
): { chargeableWeight: number; freightCost: number; applicableRate: FreightRate | null } {
  const qty = Math.max(1, Math.floor(pallet.quantity || 1));
  const length = pallet.length ?? 0;
  const width = pallet.width ?? 0;
  const height = pallet.height ?? 0;
  const actualWeight = pallet.weight ?? 0;
  const volumeWeight = calculateVolumeWeight(length, width, height);
  const chargeableWeight = Math.max(volumeWeight, actualWeight);

  const applicableRates = freightRates.filter(
    (rate) =>
      rate.destination_id === destinationId &&
      (rate.min_weight === null ||
        (typeof rate.min_weight === 'number' && chargeableWeight >= rate.min_weight)) &&
      (rate.max_weight === null ||
        (typeof rate.max_weight === 'number' && chargeableWeight <= rate.max_weight))
  );
  const applicableRate = applicableRates.length > 0 ? applicableRates[0] : null;

  const rateValue =
    pallet.overriddenRate !== undefined && pallet.overriddenRate > 0
      ? pallet.overriddenRate
      : (applicableRate?.base_rate ?? 0);

  const freightCost = Math.round(chargeableWeight * rateValue) * qty;
  return { chargeableWeight: chargeableWeight * qty, freightCost, applicableRate };
}

/** Matches staff New Quotation freight math (per-pallet bands + manual overrides). */
export function calculateStaffQuotationFreight(
  pallets: FreightPalletInput[],
  freightRates: FreightRate[],
  destinationId: string,
  opts: {
    isChargeableWeightManual?: boolean;
    manualChargeableWeight?: number | null;
    isManualRate?: boolean;
    manualRate?: number | null;
    clearanceCost?: number;
    additionalChargesTotal?: number;
  } = {}
): StaffFreightCalcResult {
  const totalWeight = pallets.reduce(
    (acc, p) => acc + (p.weight ?? 0) * Math.max(1, Math.floor(p.quantity || 1)),
    0
  );
  const totalVolumeCm3 = pallets.reduce(
    (acc, p) =>
      acc + p.length * p.width * p.height * Math.max(1, Math.floor(p.quantity || 1)),
    0
  );
  const legacyAggregateVolumeWeight = totalVolumeCm3 / 6000;
  const roundedLegacyAggregateVolumeWeight =
    Math.abs(legacyAggregateVolumeWeight - Math.round(legacyAggregateVolumeWeight)) < 0.01
      ? Math.round(legacyAggregateVolumeWeight)
      : legacyAggregateVolumeWeight;

  const perPalletVolumeWeight = pallets.reduce((acc, pallet) => {
    const qty = Math.max(1, Math.floor(pallet.quantity || 1));
    const volWt = calculateVolumeWeight(pallet.length, pallet.width, pallet.height);
    return acc + volWt * qty;
  }, 0);

  const hasManualChargeable =
    opts.isChargeableWeightManual &&
    opts.manualChargeableWeight != null &&
    opts.manualChargeableWeight > 0;
  const hasManualRate =
    opts.isManualRate && opts.manualRate != null && opts.manualRate > 0;

  const manualRateBillingWeight = hasManualChargeable
    ? opts.manualChargeableWeight!
    : Math.max(roundedLegacyAggregateVolumeWeight, totalWeight);

  let totalVolumeWeight: number;
  let totalChargeableWeight: number;

  if (hasManualChargeable) {
    totalChargeableWeight = opts.manualChargeableWeight!;
    totalVolumeWeight = roundedLegacyAggregateVolumeWeight;
  } else if (hasManualRate) {
    totalVolumeWeight = roundedLegacyAggregateVolumeWeight;
    totalChargeableWeight = Math.max(roundedLegacyAggregateVolumeWeight, totalWeight);
  } else {
    totalVolumeWeight = perPalletVolumeWeight;
    totalChargeableWeight = Math.max(perPalletVolumeWeight, totalWeight);
  }

  let totalFreightCost = 0;
  if (hasManualRate) {
    totalFreightCost = Math.round(manualRateBillingWeight * opts.manualRate!);
  } else if (freightRates.length > 0 && destinationId) {
    totalFreightCost = pallets.reduce((acc, pallet) => {
      const { freightCost } = singlePalletFreightCost(pallet, destinationId, freightRates);
      return acc + freightCost;
    }, 0);
  }

  const clearanceCost = opts.clearanceCost ?? 0;
  const additional = opts.additionalChargesTotal ?? 0;
  const finalTotalCost = totalFreightCost + clearanceCost + additional;

  const effectiveRate =
    hasManualRate && opts.manualRate
      ? opts.manualRate
      : totalChargeableWeight > 0
        ? Math.round((totalFreightCost / totalChargeableWeight) * 100) / 100
        : null;

  return {
    totalVolumeWeight,
    totalActualWeight: totalWeight,
    totalChargeableWeight,
    totalFreightCost,
    finalTotalCost,
    effectiveRate,
  };
}

export function explodePallets(
  pieces: { length_cm: number; width_cm: number; height_cm: number; gross_weight_kg: number; qty?: number }[]
): { length: number; width: number; height: number; weight: number; quantity: number }[] {
  return pieces.flatMap((p) => {
    const qty = Math.max(1, Math.floor(p.qty ?? 1));
    return Array.from({ length: qty }, () => ({
      length: p.length_cm,
      width: p.width_cm,
      height: p.height_cm,
      weight: p.gross_weight_kg,
      quantity: 1,
    }));
  });
}
