import { ensureValidSession } from '@/lib/session-helper';

/** Headers for file/shipment APIs. Session when logged in, plus a public link token when there is one. */
export async function browserAuthHeaders(
  capabilityToken?: string | null,
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const session = await ensureValidSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const token = capabilityToken?.trim();
  if (token) headers['x-capability-token'] = token;
  return headers;
}
