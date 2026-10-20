import assert from 'node:assert/strict';
import { listMcpDocumentTypes } from '../src/lib/mcp/document-catalog';
import {
  replaceQuotationDocumentCore,
  type DocumentRow,
  type QuotationForReplace,
  type ReplaceDocumentDeps,
} from '../src/lib/mcp/replace-document';

assert.ok(listMcpDocumentTypes().some((t) => t.key === 'purchase-order'));
assert.ok(listMcpDocumentTypes().some((t) => t.key === 'awb'));

const Q: QuotationForReplace = {
  id: 'q1',
  quotation_no: 'OMG10074',
  company_name: 'Co',
  customer_name: 'Co',
  opportunity_id: 'opp1',
  status: 'docs_uploaded',
};

function makeReplaceDeps() {
  const docs = new Map<string, DocumentRow>();
  let seq = 0;
  const deps: ReplaceDocumentDeps = {
    loadDocumentById: async (id) => docs.get(id) ?? null,
    loadQuotation: async () => ({ ...Q }),
    isOpportunityLost: async () => false,
    uploadBytes: async () => `documents/q1/packing-list/n.pdf`,
    insertDocument: async (row) => {
      const id = `doc-${++seq}`;
      docs.set(id, {
        id,
        quotation_id: 'q1',
        document_type: String(row.document_type),
        file_name: String(row.file_name),
        original_file_name: String(row.file_name),
        file_path: String(row.file_path),
        file_url: '',
        storage_provider: 'r2',
        submitted_at: new Date().toISOString(),
      });
      return { id };
    },
    listCurrentByQuotation: async () => [...docs.values()].filter((d) => !d.superseded_at),
    supersedeRows: async (ids, newId) => {
      for (const id of ids) {
        const d = docs.get(id);
        if (d) {
          d.superseded_at = new Date().toISOString();
          d.superseded_by = newId;
          docs.set(id, d);
        }
      }
    },
    insertActivityLog: async () => {},
    resolvePublicUrl: async () => 'https://signed.example/x.pdf',
    emitReplaced: async () => {},
  };
  return { deps, docs };
}

async function replaceByDocumentId() {
  const { deps, docs } = makeReplaceDeps();
  const old = await deps.insertDocument({
    quotation_id: 'q1',
    document_type: 'packing-list',
    file_name: 'old.pdf',
    file_path: 'p/old.pdf',
  });
  const currentBefore = (await deps.listCurrentByQuotation('q1')).length;
  const result = await replaceQuotationDocumentCore(
    {
      document_id: old.id,
      filename: 'new.pdf',
      file_base64: Buffer.from('%PDF-1.4').toString('base64'),
    },
    deps
  );
  assert.equal(result.old_file_name, 'old.pdf');
  assert.equal(result.new_file_name, 'new.pdf');
  const currentAfter = (await deps.listCurrentByQuotation('q1')).length;
  assert.equal(currentAfter, currentBefore);
  assert.ok(docs.get(old.id)?.superseded_at);
}

async function main() {
  await replaceByDocumentId();
  console.log('verify-quotation-documents: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
