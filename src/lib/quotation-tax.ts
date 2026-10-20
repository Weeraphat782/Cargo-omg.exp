/** VAT/WHT helpers for quotations (no Supabase — safe for MCP verify scripts). */

export type QuotationTaxableLines = Partial<Record<string, boolean>>;

export interface QuotationTaxableLinesForm {
  freight: boolean;
  clearance: boolean;
  delivery: boolean;
  additional: boolean[];
}

export const QUOTATION_VAT_RATE = 0.07;
export const QUOTATION_WHT_RATE = 0.03;

export function quotationWhtEnabled(wht_enabled: boolean | null | undefined): boolean {
  return wht_enabled !== false;
}

export function quotationRoundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function quotationLineIsTaxable(
  taxable_lines: QuotationTaxableLines | null | undefined,
  key: string
): boolean {
  return taxable_lines?.[key] !== false;
}

export function parseQuotationTaxableLinesToForm(
  taxable_lines: QuotationTaxableLines | null | undefined,
  additionalChargeCount: number
): QuotationTaxableLinesForm {
  const additional = Array.from({ length: additionalChargeCount }, (_, i) =>
    quotationLineIsTaxable(taxable_lines, `additional:${i}`)
  );
  return {
    freight: quotationLineIsTaxable(taxable_lines, 'freight'),
    clearance: quotationLineIsTaxable(taxable_lines, 'clearance'),
    delivery: quotationLineIsTaxable(taxable_lines, 'delivery'),
    additional,
  };
}

export function buildQuotationTaxableLinesFromForm(
  form: QuotationTaxableLinesForm,
  additionalCharges: { name?: string; description?: string; amount?: number | string }[]
): QuotationTaxableLines {
  const out: QuotationTaxableLines = {};
  out.freight = form.freight !== false;
  out.clearance = form.clearance !== false;
  out.delivery = form.delivery !== false;
  let dbIdx = 0;
  additionalCharges.forEach((charge, formIdx) => {
    const included =
      (charge.name ?? '').trim() !== '' ||
      (charge.description ?? '').trim() !== '' ||
      (Number(charge.amount) || 0) > 0;
    if (included) {
      out[`additional:${dbIdx}`] = form.additional?.[formIdx] !== false;
      dbIdx++;
    }
  });
  return out;
}

export function computeQuotationVatBreakdown(params: {
  total_freight_cost: number;
  clearance_cost: number;
  delivery_amount: number;
  additional_amounts: number[];
  taxable_lines: QuotationTaxableLines | null | undefined;
  wht_enabled?: boolean | null;
}): {
  vat_base: number;
  non_vat_base: number;
  subtotal_pre_vat: number;
  vat_amount: number;
  grand_total_with_vat: number;
  wht_amount: number;
  net_payable: number;
} {
  const tl = params.taxable_lines ?? {};
  let vatBase = 0;
  let nonVatBase = 0;
  const push = (amount: number, taxable: boolean) => {
    const a = Number(amount) || 0;
    if (taxable) vatBase += a;
    else nonVatBase += a;
  };
  push(params.total_freight_cost, tl.freight !== false);
  push(params.clearance_cost, tl.clearance !== false);
  push(params.delivery_amount, tl.delivery !== false);
  params.additional_amounts.forEach((amt, i) => {
    push(amt, tl[`additional:${i}`] !== false);
  });
  const vat_base = quotationRoundMoney(vatBase);
  const non_vat_base = quotationRoundMoney(nonVatBase);
  const subtotal_pre_vat = quotationRoundMoney(vat_base + non_vat_base);
  const vat_amount = quotationRoundMoney(vat_base * QUOTATION_VAT_RATE);
  const grand_total_with_vat = quotationRoundMoney(subtotal_pre_vat + vat_amount);
  const wht_amount = quotationWhtEnabled(params.wht_enabled)
    ? quotationRoundMoney(vat_base * QUOTATION_WHT_RATE)
    : 0;
  const net_payable = quotationRoundMoney(grand_total_with_vat - wht_amount);
  return {
    vat_base,
    non_vat_base,
    subtotal_pre_vat,
    vat_amount,
    grand_total_with_vat,
    wht_amount,
    net_payable,
  };
}
