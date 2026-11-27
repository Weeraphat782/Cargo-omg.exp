/** Customer must create a company before the portal. Email signup stores the name on the profile; Google does not. */

export const COMPANY_SETUP_PATH = '/portal/setup';

export function companyNamePresent(company: string | null | undefined): boolean {
  return typeof company === 'string' && company.trim().length > 0;
}

export function customerNeedsCompanySetup(input: {
  role?: string | null;
  companyName?: string | null;
  companyId?: string | null;
}): boolean {
  if (input.role !== 'customer') return false;
  if (typeof input.companyId === 'string' && input.companyId.trim().length > 0) return false;
  return !companyNamePresent(input.companyName);
}

/** Portal path after login. Missing company always wins over `next`. */
export function customerPortalDestination(input: {
  role?: string | null;
  companyName?: string | null;
  companyId?: string | null;
  next?: string | null;
}): string {
  if (customerNeedsCompanySetup(input)) return COMPANY_SETUP_PATH;

  const next = input.next;
  if (
    next &&
    next.startsWith('/portal') &&
    !next.startsWith('//') &&
    !next.includes('://')
  ) {
    return next;
  }
  return '/portal';
}
