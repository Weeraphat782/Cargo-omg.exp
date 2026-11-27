import assert from 'node:assert/strict';
import {
  customerNeedsCompanySetup,
  customerPortalDestination,
} from '../src/lib/customer-company-gate';

// Google OAuth: trigger stores company as '' and there is no companies row.
assert.equal(
  customerNeedsCompanySetup({ role: 'customer', companyName: '', companyId: null }),
  true,
);
assert.equal(
  customerNeedsCompanySetup({ role: 'customer', companyName: '   ', companyId: null }),
  true,
);
assert.equal(
  customerNeedsCompanySetup({ role: 'customer', companyName: null, companyId: null }),
  true,
);

// Email signup stores a company name and does not create a companies row.
assert.equal(
  customerNeedsCompanySetup({ role: 'customer', companyName: 'Thai Agri Co., Ltd.', companyId: null }),
  false,
);

// Company record counts even when the profile text was never filled.
assert.equal(
  customerNeedsCompanySetup({ role: 'customer', companyName: '', companyId: 'company-1' }),
  false,
);

// Staff, admin, and lab admin are not sent through customer onboarding.
for (const role of ['staff', 'admin', 'lab_admin', null, undefined]) {
  assert.equal(
    customerNeedsCompanySetup({ role, companyName: null, companyId: null }),
    false,
  );
}

assert.equal(
  customerPortalDestination({ role: 'customer', companyName: '', next: '/portal' }),
  '/portal/setup',
);
assert.equal(
  customerPortalDestination({
    role: 'customer',
    companyName: '',
    next: '/portal/qc-requests',
  }),
  '/portal/setup',
);
assert.equal(
  customerPortalDestination({
    role: 'customer',
    companyName: 'Acme',
    next: '/portal/shipments/abc',
  }),
  '/portal/shipments/abc',
);
assert.equal(
  customerPortalDestination({ role: 'customer', companyName: 'Acme', next: 'https://evil.test' }),
  '/portal',
);
assert.equal(
  customerPortalDestination({ role: 'customer', companyName: 'Acme', next: '//evil.test' }),
  '/portal',
);
assert.equal(
  customerPortalDestination({ role: 'staff', companyName: '', next: '/portal' }),
  '/portal',
);

console.log('customer company gate ok');
