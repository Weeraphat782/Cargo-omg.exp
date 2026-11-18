import assert from 'node:assert/strict';
import {
  buildNewBookingMove,
  buildReplaceMoves,
} from '../src/lib/change-control/moves';
import { checkGuards, snapshotFromPairs, simulateAssignments } from '../src/lib/change-control/guards';
import { applyMovesLocally } from '../src/lib/change-control/apply-local';

const slot1 = 'slot-a';
const slot2 = 'slot-b';
const jobA = 'job-11031';
const jobB = 'job-10125';

const initial = snapshotFromPairs([
  { slot_id: slot1, quotation_id: jobA },
  { slot_id: slot2, quotation_id: 'other' },
]);

const replaceOnly = buildReplaceMoves({
  jobInSlotId: jobA,
  jobInSlotFromSlotId: slot1,
  replacementJobId: jobB,
  replacementFromSlotId: slot2,
});

const noTarget = checkGuards({
  initial,
  moves: replaceOnly,
  jobPallets: new Map([[jobA, 2], [jobB, 2]]),
  slotBookedPallets: new Map([[slot1, 2]]),
});
assert.ok(noTarget.errors.some((e) => e.includes('Parking')));

const chain = [
  ...replaceOnly,
  buildNewBookingMove({
    jobId: jobA,
    fromSlotId: slot1,
    new_slot: { load_date: '2026-02-12', booked_pallets: 2, airline: 'TG' },
  }),
];

const ok = checkGuards({
  initial,
  moves: chain,
  jobPallets: new Map([[jobA, 2], [jobB, 2]]),
  slotBookedPallets: new Map([[slot1, 2]]),
});
assert.equal(ok.errors.length, 0);

const palletWarn = checkGuards({
  initial,
  moves: chain,
  jobPallets: new Map([[jobA, 2], [jobB, 3]]),
  slotBookedPallets: new Map([[slot1, 2], [slot2, 2]]),
});
assert.ok(palletWarn.warnings.some((w) => w.includes('forwarder')));

const applied = applyMovesLocally(
  [
    { slot_id: slot1, quotation_id: jobA },
    { slot_id: slot2, quotation_id: 'other' },
  ],
  chain,
);
assert.equal(applied.ok, true);
if (applied.ok) {
  assert.equal(applied.state.events.length, chain.length);
  const final = simulateAssignments(initial, chain);
  assert.equal(final.jobToSlot.get(jobB), slot1);
  assert.ok(final.jobToSlot.has(jobA));
}

const fail = applyMovesLocally(
  [{ slot_id: slot1, quotation_id: jobA }],
  replaceOnly,
);
assert.equal(fail.ok, false);

console.log('verify-change-control: ok');