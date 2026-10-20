import assert from 'node:assert/strict';
import type { FreightRate } from '../src/lib/mcp/quotation-freight';
import {
  createQuotationCore,
  updateQuotationCore,
  type CreateQuotationDeps,
  type StoredQuotationRow,
} from '../src/lib/mcp/create-quotation';

const DEST = { id: 'dest-zrh', country: 'Switzerland', port: 'ZRH' };
const RATES: FreightRate[] = [
  {
    id: 'r1',
    destination_id: DEST.id,
    min_weight: null,
    max_weight: null,
    base_rate: 100,
  },
];

const basePieces = [
  { length_cm: 100, width_cm: 80, height_cm: 60, gross_weight_kg: 50, qty: 1 },
];

function makeDeps(overrides: Partial<CreateQuotationDeps> = {}) {
  const companies: { id: string; name: string }[] = [{ id: 'co1', name: 'Acme Ltd' }];
  const quotations = new Map<string, StoredQuotationRow>();
  let insertCount = 0;
  let webhookCount = 0;
  const activity: Record<string, unknown>[] = [];
  let seq = 0;

  const deps: CreateQuotationDeps = {
    resolveOwnerId: async () => 'user-staff',
    findByClientRef: async (ref) => {
      for (const q of quotations.values()) {
        if (q.client_ref === ref) return q;
      }
      return null;
    },
    matchCompanies: async (name) =>
      companies.filter((c) => c.name.toLowerCase() === name.trim().toLowerCase()),
    suggestCompanies: async (name) =>
      companies.filter((c) => c.name.toLowerCase().includes(name.toLowerCase())).map((c) => c.name),
    insertCompany: async (row) => {
      const c = { id: `co-${++seq}`, name: row.name };
      companies.push(c);
      return c;
    },
    resolveDestination: async (ref) => {
      if (ref.destination_id === DEST.id) return DEST;
      const iata = ref.destination_iata?.trim().toUpperCase();
      if (iata === 'ZRH') return DEST;
      throw new Error(`Unknown destination IATA: ${iata}`);
    },
    loadFreightRates: async () => RATES,
    insertQuotation: async (row) => {
      insertCount += 1;
      assert.equal(row.quotation_no, undefined);
      const id = `q-${++seq}`;
      const stored: StoredQuotationRow = {
        ...(row as StoredQuotationRow),
        id,
        quotation_no: `OMG${90000 + insertCount}`,
        status: String(row.status || 'draft'),
        booking_share_token: null,
        opportunity_id: null,
      };
      quotations.set(id, stored);
      return stored;
    },
    updateQuotation: async (id, row) => {
      const prev = quotations.get(id);
      assert.ok(prev);
      const next = { ...prev, ...row } as StoredQuotationRow;
      quotations.set(id, next);
      return next;
    },
    loadQuotation: async (ref) => {
      if (ref.quotation_id) return quotations.get(ref.quotation_id) ?? null;
      if (ref.omg_number) {
        for (const q of quotations.values()) {
          if (q.quotation_no === ref.omg_number) return q;
        }
      }
      return null;
    },
    isOpportunityLost: async (oppId) => oppId === 'opp-lost',
    insertActivityLog: async (entry) => {
      activity.push(entry);
    },
    ensureBookingShareToken: async (quotationId) => {
      const q = quotations.get(quotationId);
      if (!q) return null;
      const token = `tok-${quotationId}`;
      q.booking_share_token = token;
      quotations.set(quotationId, q);
      return token;
    },
    emitCreated: async () => {
      webhookCount += 1;
    },
    ...overrides,
  };

  return {
    deps,
    getInsertCount: () => insertCount,
    getWebhookCount: () => webhookCount,
    getActivity: () => activity,
    quotations,
    companies,
  };
}

async function testCreate() {
  const { deps, getInsertCount, getWebhookCount } = makeDeps();
  const result = await createQuotationCore(
    {
      company_name: 'Acme Ltd',
      destination_iata: 'ZRH',
      pieces: basePieces,
    },
    deps
  );
  assert.equal(result.ok, true);
  assert.equal(getInsertCount(), 1);
  assert.equal(result.status, 'draft');
  assert.equal(result.omg_number, 'OMG90001');
  assert.ok(Number(result.chargeable_weight) > 0);
  assert.equal(getWebhookCount(), 1);
  assert.equal(result.webhook_emitted, true);
}

async function testDryRun() {
  const { deps, getInsertCount, getWebhookCount } = makeDeps();
  const result = await createQuotationCore(
    {
      company_name: 'Acme Ltd',
      destination_iata: 'ZRH',
      pieces: basePieces,
      dry_run: true,
    },
    deps
  );
  assert.equal(result.dry_run, true);
  assert.equal(result.quotation_id, null);
  assert.equal(getInsertCount(), 0);
  assert.equal(getWebhookCount(), 0);
}

async function testClientRef() {
  const { deps, getInsertCount, getWebhookCount } = makeDeps();
  const input = {
    company_name: 'Acme Ltd',
    destination_iata: 'ZRH',
    pieces: basePieces,
    client_ref: 'grok-1',
  };
  const first = await createQuotationCore(input, deps);
  const second = await createQuotationCore(input, deps);
  assert.equal(getInsertCount(), 1);
  assert.equal(first.quotation_id, second.quotation_id);
  assert.equal(second.idempotent, true);
  assert.equal(getWebhookCount(), 1);
  assert.equal(second.webhook_emitted, false);
}

async function testBadDestination() {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      createQuotationCore(
        {
          company_name: 'Acme Ltd',
          destination_iata: 'XXX',
          pieces: basePieces,
          dry_run: true,
        },
        deps
      ),
    /Unknown destination IATA: XXX/
  );
}

async function testCompanyNotFound() {
  const { deps, getInsertCount } = makeDeps();
  const result = await createQuotationCore(
    {
      company_name: 'Unknown Co',
      destination_iata: 'ZRH',
      pieces: basePieces,
    },
    deps
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'company_not_found');
  assert.ok(Array.isArray(result.company_suggestions));
  assert.equal(getInsertCount(), 0);
}

async function testCreateCompany() {
  const { deps, companies, getInsertCount } = makeDeps();
  const result = await createQuotationCore(
    {
      company_name: 'New Shipper',
      destination_iata: 'ZRH',
      pieces: basePieces,
      create_company: true,
    },
    deps
  );
  assert.equal(result.ok, true);
  assert.equal(getInsertCount(), 1);
  assert.ok(companies.some((c) => c.name === 'New Shipper'));
}

async function testUpdateLoseCase() {
  const { deps, getActivity } = makeDeps();
  const created = await createQuotationCore(
    {
      company_name: 'Acme Ltd',
      destination_iata: 'ZRH',
      pieces: basePieces,
    },
    deps
  );
  const qid = created.quotation_id as string;
  const row = (await deps.loadQuotation({ quotation_id: qid }))!;
  row.opportunity_id = 'opp-lost';
  await deps.updateQuotation(qid, { opportunity_id: 'opp-lost' });

  await assert.rejects(
    () =>
      updateQuotationCore(
        { quotation_id: qid, net_weight_kg: 200 },
        deps
      ),
    /Lose Case/
  );
  assert.equal(getActivity().length, 0);
}

async function testUpdatePricing() {
  const { deps, getActivity } = makeDeps();
  const created = await createQuotationCore(
    {
      company_name: 'Acme Ltd',
      destination_iata: 'ZRH',
      pieces: basePieces,
    },
    deps
  );
  const qid = created.quotation_id as string;

  const heavier = [{ length_cm: 100, width_cm: 80, height_cm: 60, gross_weight_kg: 120, qty: 1 }];
  const dry = await updateQuotationCore(
    { quotation_id: qid, pieces: heavier, dry_run: true },
    deps
  );
  assert.equal(dry.dry_run, true);
  assert.ok(dry.pricing_before);
  assert.ok(dry.pricing_after);
  assert.equal(getActivity().length, 0);

  const updated = await updateQuotationCore({ quotation_id: qid, pieces: heavier }, deps);
  assert.ok(updated.pricing_before);
  assert.ok(updated.pricing_after);
  assert.notEqual(
    updated.pricing_before.chargeable_weight,
    updated.pricing_after.chargeable_weight
  );
  assert.ok(getActivity().some((a) => a.event === 'quotation_updated'));
}

async function main() {
  await testCreate();
  await testDryRun();
  await testClientRef();
  await testBadDestination();
  await testCompanyNotFound();
  await testCreateCompany();
  await testUpdateLoseCase();
  await testUpdatePricing();
  console.log('verify-create-quotation: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
