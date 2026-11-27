/**
 * ponytail: pure checks for the file-route rules. No network, no framework.
 * Run: npm run verify:file-access
 */
import assert from 'node:assert/strict';
import {
  anonymousMayReadTemplate,
  isSafeKey,
  keyUnderCompanyUser,
  keyUnderQuotation,
  normalizeObjectKey,
} from '../src/lib/file-access-rules';

const q = '11111111-1111-4111-8111-111111111111';

assert.equal(anonymousMayReadTemplate('templates/blank.pdf', null), true);
assert.equal(anonymousMayReadTemplate('templates/blank.pdf', 'templates'), true);
assert.equal(anonymousMayReadTemplate(`documents/${q}/secret.pdf`, null), false);
assert.equal(anonymousMayReadTemplate(`documents/${q}/secret.pdf`, 'templates'), false);
assert.equal(anonymousMayReadTemplate('shipment-photos/x.jpg', 'templates'), false);
assert.equal(isSafeKey('../etc/passwd'), false);
assert.equal(isSafeKey('documents/ok.pdf'), true);
assert.equal(keyUnderQuotation(`documents/${q}/a.pdf`, q), true);
assert.equal(keyUnderQuotation(`documents/${q}/a.pdf`, '22222222-2222-4222-8222-222222222222'), false);
assert.equal(keyUnderCompanyUser(`company-documents/${q}/id.pdf`, q), true);
assert.equal(normalizeObjectKey(`/documents/${q}/a.pdf`), `documents/${q}/a.pdf`);

console.log('verify-file-access: ok');
