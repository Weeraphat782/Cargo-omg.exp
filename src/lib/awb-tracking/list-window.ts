/** Pure date window for list_awbs_to_track. No Supabase. */

export const AWB_TRACK_STAGES = ['picked_up', 'delivered', 'payment_received'] as const;

export function trackCutoffYmd(days: number, now = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

/** Pickup date when set, otherwise quotation created_at. Both compared as YYYY-MM-DD. */
export function referenceYmd(
  pickup: string | null | undefined,
  createdAt: string | null | undefined
): string | null {
  const p = pickup?.trim();
  if (p) return p.slice(0, 10);
  const created = createdAt?.trim();
  return created ? created.slice(0, 10) : null;
}

/** Same rule as the old in-memory loop: missing ref date stays in the list. */
export function withinTrackWindow(
  pickup: string | null | undefined,
  createdAt: string | null | undefined,
  cutoffYmd: string
): boolean {
  const ref = referenceYmd(pickup, createdAt);
  return !(ref && ref < cutoffYmd);
}
