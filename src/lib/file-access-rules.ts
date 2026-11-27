/** Pure path rules for file routes. No I/O. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHIPMENT_PREFIX = /^(?:documents|shipment-photos|company-documents|qc)\//i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export function normalizeObjectKey(raw: string): string {
  let key = raw.trim();
  if (!key) return '';

  if (key.startsWith('http://') || key.startsWith('https://')) {
    try {
      const url = new URL(key);
      const parts = url.pathname.split('/').filter(Boolean).map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
      const publicIdx = parts.findIndex((part, i) => part === 'public' && parts[i - 1] === 'object');
      key = (publicIdx >= 0 ? parts.slice(publicIdx + 2) : parts).join('/');
    } catch {
      return '';
    }
  }

  key = key.replace(/^\/+/, '');
  try {
    key = decodeURIComponent(key);
  } catch {
    /* keep the raw key */
  }
  return key;
}

export function isSafeKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.includes('..') || key.includes('\\') || key.includes('\0')) return false;
  if (key.startsWith('/') || key.includes('://')) return false;
  return true;
}

/** Blank form templates are public. Shipment folders are not, even if the bucket name says templates. */
export function anonymousMayReadTemplate(key: string, bucketParam: string | null): boolean {
  if (!isSafeKey(key)) return false;
  if (SHIPMENT_PREFIX.test(key)) return false;
  if (key.startsWith('templates/')) return true;
  return bucketParam === 'templates';
}

export function quotationFolderPrefix(quotationId: string): string[] {
  return [`documents/${quotationId}/`, `shipment-photos/${quotationId}/`];
}

export function keyUnderQuotation(key: string, quotationId: string): boolean {
  if (!isUuid(quotationId) || !isSafeKey(key)) return false;
  return quotationFolderPrefix(quotationId).some((prefix) => key.startsWith(prefix));
}

export function keyUnderCompanyUser(key: string, userId: string): boolean {
  if (!isUuid(userId) || !isSafeKey(key)) return false;
  return key.startsWith(`company-documents/${userId}/`);
}

export function keyUnderCompanyRegistration(key: string, companyId: string): boolean {
  if (!isUuid(companyId) || !isSafeKey(key)) return false;
  return key.startsWith(`documents/${companyId}/`);
}

export function qcRequestIdFromKey(key: string): string | null {
  const match = /^qc\/([0-9a-f-]{36})\//i.exec(key);
  return match && isUuid(match[1]) ? match[1] : null;
}

export function quotationIdFromKey(key: string): string | null {
  const match = /^(?:documents|shipment-photos)\/([0-9a-f-]{36})\//i.exec(key);
  return match && isUuid(match[1]) ? match[1] : null;
}
