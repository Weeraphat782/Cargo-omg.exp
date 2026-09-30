import assert from 'node:assert/strict';
import {
  applyTrackingUpdate,
  carrierFromAwb,
  normalizeAwb,
  nextStageAfterDelivery,
  resolveDeliveredRecipients,
  type QuotationRow,
  type TrackingDeps,
  type TrackingStatus,
} from '../src/lib/awb-tracking/core';

assert.equal(normalizeAwb('217-1064 8864'), '21710648864');
assert.equal(normalizeAwb('21710648864'), '21710648864');
assert.equal(normalizeAwb('123'), null);
assert.equal(carrierFromAwb('21710648864'), 'TG');
assert.equal(carrierFromAwb('15710648864'), 'QR');
assert.equal(carrierFromAwb('99910648864'), null);

const recipients = resolveDeliveredRecipients({
  notifyEmails: [],
  requesterEmail: 'User@Example.com',
});
assert.deepEqual(recipients, ['user@example.com']);

const recipients2 = resolveDeliveredRecipients({
  notifyEmails: ['a@b.com', 'A@B.com'],
  requesterEmail: 'c@d.com',
});
assert.equal(recipients2.length, 2);

assert.equal(nextStageAfterDelivery('payment_received'), 'payment_received');
assert.equal(nextStageAfterDelivery('picked_up'), 'delivered');

function makeQuotation(overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: 'q1',
    quotation_no: 'OMG00001',
    awb_number: '217-1064 8864',
    opportunity_id: 'opp1',
    carrier_code: 'TG',
    carrier_code_manual: false,
    tracking_status: 'in_transit',
    delivered_at: null,
    delivery_notify_emails: [],
    customer_user_id: 'cust1',
    destination: 'ZRH',
    requested_destination: null,
    customer_name: 'Test',
    company_name: 'Co',
    chargeable_weight: 100,
    pallets: [{ quantity: 2 }],
    booking_air_freight: { flight_no: 'TG123' },
    ...overrides,
  };
}

async function runIdempotencyCheck() {
  let deliveredAt: string | null = null;
  let stage = 'picked_up';
  let sendCount = 0;
  let historyCount = 0;
  let autoLogClaimed = false;

  const q = makeQuotation();

  const deps: TrackingDeps = {
    findQuotationByAwb: async () => ({ ...q, delivered_at: deliveredAt }),
    insertHistory: async () => {
      historyCount++;
    },
    updateStatus: async () => {},
    claimDelivered: async (_id, at) => {
      if (deliveredAt) return false;
      deliveredAt = at;
      return true;
    },
    getOpStage: async () => stage,
    listQuotationsForOp: async () => [{ id: 'q1', awb_number: q.awb_number, delivered_at: deliveredAt }],
    setOpStage: async (_id, s) => {
      stage = s;
    },
    resolveRequesterEmail: async () => 'user@example.com',
    tryClaimAutoEmail: async () => {
      if (autoLogClaimed) return 'already';
      autoLogClaimed = true;
      return 'claimed';
    },
    sendDelivered: async () => {
      sendCount++;
      return { ok: true, messageId: 'msg_1' };
    },
    finalizeAutoLog: async () => {},
    insertManualLog: async () => 'log1',
    updateManualLog: async () => {},
  };

  const input = {
    awb_number: '21710648864',
    status: 'delivered' as TrackingStatus,
    raw_text: 'Delivered',
    source_url: 'https://example.com/track',
    delivered_at: '2026-09-30T14:20:00+02:00',
  };

  const r1 = await applyTrackingUpdate(deps, input);
  assert.equal(r1.email, 'sent');
  assert.equal(sendCount, 1);
  assert.equal(historyCount, 1);
  assert.equal(stage, 'delivered');

  const r2 = await applyTrackingUpdate(deps, input);
  assert.equal(r2.already_delivered, true);
  assert.equal(r2.email, 'skipped');
  assert.equal(sendCount, 1);
  assert.equal(historyCount, 2);

  stage = 'payment_received';
  deliveredAt = '2026-01-01T00:00:00Z';
  const r3 = await applyTrackingUpdate(deps, input);
  assert.equal(stage, 'payment_received');
  assert.equal(r3.email, 'skipped');
}

runIdempotencyCheck()
  .then(() => {
    console.log('verify-awb-delivered: ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
