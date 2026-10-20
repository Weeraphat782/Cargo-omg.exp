import {
  GACP_DOCS_FARM,
  GACP_DOCS_STANDARD,
  getAllTemplateDocumentTypes,
} from '@/lib/document-presets';

export type McpDocumentType = { key: string; label: string };

/** Same union the staff upload dialog uses, plus shipping-only types. */
export function listMcpDocumentTypes(): McpDocumentType[] {
  const seen = new Set<string>();
  const out: McpDocumentType[] = [];
  const push = (key: string, label: string) => {
    const k = key.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ key: k, label: label.trim() || k });
  };

  for (const t of getAllTemplateDocumentTypes()) {
    push(t.id, t.name);
  }
  for (const t of GACP_DOCS_STANDARD) push(t.id, t.name);
  for (const t of GACP_DOCS_FARM) push(t.id, t.name);
  push('phyto', 'Phytosanitary Certificate');
  push('other', 'Other');
  push('awb', 'AWB');
  push('customs_declaration', 'Customs Declaration (ใบขน)');

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const LEGACY_SNAKE: Record<string, string> = {
  packing_list: 'packing-list',
  commercial_invoice: 'commercial-invoice',
};

export function normalizeDocumentTypeKey(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (LEGACY_SNAKE[t]) return LEGACY_SNAKE[t];
  if (t.includes('_') && !t.includes('-')) return t.replace(/_/g, '-');
  return t;
}

export function resolveDocumentTypeMeta(raw: string): { slug: string; name: string } | null {
  const slug = normalizeDocumentTypeKey(raw);
  if (!slug) return null;
  const types = listMcpDocumentTypes();
  const hit =
    types.find((d) => d.key === slug) ||
    types.find((d) => d.key === raw.trim()) ||
    types.find((d) => normalizeDocumentTypeKey(d.key) === slug);
  if (hit) return { slug: hit.key, name: hit.label };
  if (slug === 'packing-list' || slug === 'commercial-invoice' || slug === 'phyto' || slug === 'other') {
    const names: Record<string, string> = {
      'packing-list': 'Packing List',
      'commercial-invoice': 'Commercial Invoice',
      phyto: 'Phytosanitary Certificate',
      other: 'Other',
    };
    return { slug, name: names[slug] || slug };
  }
  return null;
}

export function isQuotationColumnDocumentType(slug: string): boolean {
  return slug === 'awb' || slug === 'customs_declaration';
}
