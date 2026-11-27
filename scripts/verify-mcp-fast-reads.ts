import assert from 'node:assert/strict';
import { withinTrackWindow, trackCutoffYmd, referenceYmd } from '../src/lib/awb-tracking/list-window';
import { quotedIlike, toJobSummary } from '../src/lib/mcp/job-summary';
import type { DocumentRow } from '../src/lib/mcp/replace-document';

const cutoff = trackCutoffYmd(30, new Date('2026-11-27T00:00:00.000Z'));
assert.equal(cutoff, '2026-10-28');

assert.equal(referenceYmd('2026-11-01', '2026-01-01'), '2026-11-01');
assert.equal(referenceYmd('  ', '2026-11-02T03:00:00.000Z'), '2026-11-02');
assert.equal(referenceYmd(null, null), null);

assert.equal(withinTrackWindow('2026-11-01', '2020-01-01', cutoff), true);
assert.equal(withinTrackWindow('2026-01-01', '2026-11-20T00:00:00.000Z', cutoff), false);
assert.equal(withinTrackWindow('', '2026-11-01T00:00:00.000Z', cutoff), true);
assert.equal(withinTrackWindow(null, '2026-01-01T00:00:00.000Z', cutoff), false);
assert.equal(withinTrackWindow(null, null, cutoff), true);
assert.equal(withinTrackWindow('2026-10-28', '2020-01-01', cutoff), true);

const clause = quotedIlike('company_name', 'Acme, "Ltd"');
assert.equal(clause, 'company_name.ilike."*Acme, Ltd*"');
assert.throws(() => quotedIlike('company_name', '***'));

const summary = toJobSummary({
  id: 'q1',
  quotation_no: 'OMG11037',
  status: 'docs_uploaded',
  company_name: 'Acme',
  customer_name: 'Other',
  destination: 'Zurich',
  total_actual_weight: 120,
  chargeable_weight: '140',
  awb_number: '217-1',
  booking_air_freight: { flight_no: 'TG971' },
  created_at: '2026-11-01T00:00:00.000Z',
  opportunity_id: 'opp1',
  customer_signature: 'data:image/png;base64,SECRET',
  opportunities: { id: 'opp1', stage: 'picked_up', pickup_date: '2026-11-02' },
});
const packed = JSON.stringify(summary);
assert.equal(packed.includes('\n'), false);
assert.equal(packed.includes('customer_signature'), false);
assert.equal(packed.includes('base64'), false);
assert.equal(packed.includes('download_url'), false);
assert.equal(packed.includes('http'), false);
assert.equal(summary.customer, 'Acme');
assert.equal(summary.flight_no, 'TG971');
assert.equal(summary.stage, 'picked_up');
assert.equal(summary.net_weight_kg, 120);
assert.equal(summary.chargeable_weight, 140);
assert.equal(summary.documents, undefined);

const withDocs = toJobSummary(
  { id: 'q1', quotation_no: 'OMG1', opportunities: null },
  [{ id: 'd1', document_type: 'packing-list', file_name: 'pl.pdf', submitted_at: null }]
);
assert.equal(withDocs.documents?.length, 1);
assert.equal(JSON.stringify(withDocs).includes('file_path'), false);

const doc: DocumentRow = {
  id: 'd1',
  quotation_id: 'q1',
  document_type: 'packing-list',
  file_name: 'pl.pdf',
  file_path: 'docs/pl.pdf',
  storage_provider: 'r2',
};

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'public-anon-placeholder';
  const { attachmentWithMissingFlag } = await import('../src/lib/mcp/quotation-document-mcp');
  const skipped = await attachmentWithMissingFlag(doc, async () => 'https://signed.example/pl.pdf', {
    checkExists: false,
  });
  assert.equal(skipped.file_missing, false);
  assert.equal(skipped.download_url, 'https://signed.example/pl.pdf');
  assert.equal(Object.prototype.hasOwnProperty.call(skipped, 'file_missing'), true);
  console.log('verify-mcp-fast-reads: ok');
}

main();
