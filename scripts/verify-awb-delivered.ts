import assert from 'node:assert/strict';
import {
  applyTrackingUpdate,
  carrierFromAwb,
  NO_DELIVERED_RECIPIENTS_MSG,
  normalizeAwb,
  nextStageAfterDelivery,
  resendDeliveredEmail,
  resolveDeliveredRecipients,
  type QuotationRow,
  type TrackingDeps,
  type TrackingStatus,
} from '../src/lib/awb-tracking/core';
import {
  buildDeliveredEmailContent,
  effectiveChargeableKg,
  formatDeliveredTimes,
} from '../src/lib/awb-tracking/delivered-email';

assert.equal(normalizeAwb('217-1064 8864'), '21710648864');
assert.equal(normalizeAwb('21710648864'), '21710648864');
assert.equal(normalizeAwb('123'), null);
assert.equal(carrierFromAwb('21710648864'), 'TG');
assert.equal(carrierFromAwb('15710648864'), 'QR');
assert.equal(carrierFromAwb('02010648864'), 'LH');
assert.equal(carrierFromAwb('17610648864'), 'EK');
assert.equal(carrierFromAwb('88810648864'), null);

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

const times = formatDeliveredTimes('2026-09-30T14:20:00+02:00', '+02:00');
assert.match(times.destinationLocal || '', /14:20/);
assert.match(times.bangkok, /19:20/);

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
    delivery_notify_emails: ['notify@example.com'],
    customer_user_id: 'cust1',
    destination: 'ZRH',
    requested_destination: null,
    customer_name: 'Test',
    company_name: 'Co',
    chargeable_weight: 100,
    pallets: [{ quantity: 2 }],
    booking_air_freight: { flight_no: 'TG123', booked_date: '2026-09-28' },
    ...overrides,
  };
}

assert.equal(effectiveChargeableKg(makeQuotation({ chargeable_weight: 50, is_chargeable_weight_manual: true, manual_chargeable_weight: 200 })), 200);

const noFlight = buildDeliveredEmailContent({
  quotation: makeQuotation({ booking_air_freight: null }),
  source_url: '',
  delivered_at: '2026-09-30T14:20:00+02:00',
  delivered_local_offset: '+02:00',
});
assert.ok(!noFlight.text.includes('Flight:'));

const withFlight = buildDeliveredEmailContent({
  quotation: makeQuotation(),
  source_url: '',
  delivered_at: '2026-09-30T14:20:00+02:00',
});
assert.match(withFlight.text, /TG123/);

async function runIdempotencyCheck() {
  let deliveredAt: string | null = null;
  let stage = 'picked_up';
  let sendCount = 0;
  let historyCount = 0;
  let autoLogClaimed = false;
  let loggedRecipients: string[] = [];

  const q = makeQuotation();

  const deps: TrackingDeps = {
    findQuotationByAwb: async () => ({ ...q, delivered_at: deliveredAt }),
    insertHistory: async () => {
      historyCount++;
    },
    updateStatus: async () => {},
    mergeTrackingHints: async () => {},
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
    tryClaimAutoEmail: async (_id, rec, bcc) => {
      loggedRecipients = rec;
      assert.deepEqual(bcc, []);
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
  assert.equal(loggedRecipients.length, 2);
  assert.ok(loggedRecipients.includes('notify@example.com'));
  assert.ok(loggedRecipients.includes('user@example.com'));

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

async function runNoEmailCheck() {
  let deliveredAt: string | null = null;
  let stage = 'picked_up';
  let sendCount = 0;

  const q = makeQuotation();
  const deps: TrackingDeps = {
    findQuotationByAwb: async () => ({ ...q, delivered_at: deliveredAt }),
    insertHistory: async () => {},
    updateStatus: async () => {},
    mergeTrackingHints: async () => {},
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
    tryClaimAutoEmail: async () => 'claimed',
    sendDelivered: async () => {
      sendCount++;
      return { ok: true };
    },
    finalizeAutoLog: async () => {},
    insertManualLog: async () => 'log1',
    updateManualLog: async () => {},
  };

  const r = await applyTrackingUpdate(deps, {
    awb_number: '21710648864',
    status: 'delivered',
    raw_text: 'Old backlog cleared',
    source_url: '',
    send_email: false,
  });
  assert.equal(r.email, 'skipped');
  assert.equal(sendCount, 0);
  assert.equal(stage, 'delivered');
}

async function runEmptyRecipientsAuto() {
  let claimCount = 0;
  const q = makeQuotation({ delivery_notify_emails: [], customer_user_id: null });
  const deps: TrackingDeps = {
    findQuotationByAwb: async () => q,
    insertHistory: async () => {},
    updateStatus: async () => {},
    mergeTrackingHints: async () => {},
    claimDelivered: async () => true,
    getOpStage: async () => 'picked_up',
    listQuotationsForOp: async () => [{ id: 'q1', awb_number: q.awb_number, delivered_at: 'x' }],
    setOpStage: async () => {},
    resolveRequesterEmail: async () => null,
    tryClaimAutoEmail: async () => {
      claimCount++;
      return 'claimed';
    },
    sendDelivered: async () => ({ ok: true }),
    finalizeAutoLog: async () => {},
    insertManualLog: async () => 'log1',
    updateManualLog: async () => {},
  };
  const r = await applyTrackingUpdate(deps, {
    awb_number: '21710648864',
    status: 'delivered',
    raw_text: 'x',
    source_url: '',
  });
  assert.equal(r.email, 'failed');
  assert.equal(claimCount, 0);
}

async function runResendManualLogRecipients() {
  let logged: string[] = [];
  const q = makeQuotation({ delivered_at: '2026-01-01T00:00:00Z' });
  const deps: TrackingDeps = {
    findQuotationByAwb: async () => q,
    insertHistory: async () => {},
    updateStatus: async () => {},
    mergeTrackingHints: async () => {},
    claimDelivered: async () => false,
    getOpStage: async () => 'delivered',
    listQuotationsForOp: async () => [],
    setOpStage: async () => {},
    resolveRequesterEmail: async () => 'user@example.com',
    tryClaimAutoEmail: async () => 'already',
    sendDelivered: async () => ({ ok: true, messageId: 'm1' }),
    finalizeAutoLog: async () => {},
    insertManualLog: async (_id, rec) => {
      logged = rec;
      return 'log2';
    },
    updateManualLog: async () => {},
  };
  await resendDeliveredEmail(deps, q, 'https://x', q.delivered_at!, ['cargo@omgexp.com']);
  assert.ok(logged.length >= 2);
  assert.ok(logged.includes('notify@example.com'));
}

async function runResendEmptyThrows() {
  const q = makeQuotation({ delivery_notify_emails: [], customer_user_id: null, delivered_at: '2026-01-01T00:00:00Z' });
  const deps: TrackingDeps = {
    findQuotationByAwb: async () => q,
    insertHistory: async () => {},
    updateStatus: async () => {},
    mergeTrackingHints: async () => {},
    claimDelivered: async () => false,
    getOpStage: async () => 'delivered',
    listQuotationsForOp: async () => [],
    setOpStage: async () => {},
    resolveRequesterEmail: async () => null,
    tryClaimAutoEmail: async () => 'already',
    sendDelivered: async () => ({ ok: true }),
    finalizeAutoLog: async () => {},
    insertManualLog: async () => {
      throw new Error('should not insert');
    },
    updateManualLog: async () => {},
  };
  await assert.rejects(
    () => resendDeliveredEmail(deps, q, '', q.delivered_at!, []),
    (err: Error) => err.message === NO_DELIVERED_RECIPIENTS_MSG
  );
}

Promise.all([
  runIdempotencyCheck(),
  runNoEmailCheck(),
  runEmptyRecipientsAuto(),
  runResendManualLogRecipients(),
  runResendEmptyThrows(),
])
  .then(() => {
    console.log('verify-awb-delivered: ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
