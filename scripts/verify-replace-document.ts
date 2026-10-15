import assert from 'node:assert/strict';
import {
  docTypeMatchesReplaceTarget,
  parseReplaceDocType,
  replaceQuotationDocumentCore,
  type DocumentRow,
  type QuotationForReplace,
  type ReplaceDocumentDeps,
} from '../src/lib/mcp/replace-document';

type TestReplaceDeps = ReplaceDocumentDeps & {
  _docs: Map<string, DocumentRow>;
  _activity: Record<string, unknown>[];
  _getWebhook: () => string | null;
  _docsUploadedFired: () => boolean;
};

assert.equal(parseReplaceDocType('packing_list'), 'packing_list');
assert.equal(parseReplaceDocType('bad'), null);
assert.ok(docTypeMatchesReplaceTarget('phyto', 'phytosanitary-certificate'));
assert.ok(docTypeMatchesReplaceTarget('packing-list', 'packing-list'));

const Q: QuotationForReplace = {
  id: 'q1',
  quotation_no: 'OMG10074',
  company_name: 'Co',
  customer_name: 'Co',
  opportunity_id: 'opp1',
  status: 'docs_uploaded',
  total_actual_weight: 100,
  destination_id: 'dest1',
};

function makeDeps(overrides: Partial<ReplaceDocumentDeps> = {}): TestReplaceDeps {
  const docs = new Map<string, DocumentRow>();
  let seq = 0;
  const activity: Record<string, unknown>[] = [];
  let webhookEvent: string | null = null;
  let docsUploadedFired = false;

  const base: ReplaceDocumentDeps = {
    loadQuotation: async (ref) => {
      if (ref.quotation_id === 'q1' || ref.omg_number === 'OMG10074') return { ...Q };
      if (ref.omg_number === 'OMG99999') return null;
      return null;
    },
    isOpportunityLost: async () => false,
    uploadBytes: async () => `documents/q1/packing-list/file_${++seq}.pdf`,
    insertDocument: async (row) => {
      const id = `doc-${++seq}`;
      docs.set(id, {
        id,
        quotation_id: String(row.quotation_id),
        document_type: String(row.document_type),
        document_type_name: String(row.document_type_name),
        file_name: String(row.file_name),
        file_path: String(row.file_path),
        file_url: '',
        storage_provider: 'r2',
        submitted_at: new Date().toISOString(),
      });
      return { id };
    },
    listCurrentByQuotation: async () =>
      [...docs.values()].filter((d) => !d.superseded_at && d.quotation_id === 'q1'),
    supersedeRows: async (ids, newId, replacedBy) => {
      for (const id of ids) {
        const d = docs.get(id);
        if (d) {
          d.superseded_at = new Date().toISOString();
          d.superseded_by = newId;
          d.replaced_by = replacedBy;
          docs.set(id, d);
        }
      }
    },
    insertActivityLog: async (entry) => {
      activity.push(entry);
    },
    resolvePublicUrl: async () => 'https://signed.example/new.pdf',
    emitReplaced: async (payload) => {
      webhookEvent = 'quotation.docs_replaced';
      assert.equal(payload.doc_type, 'packing_list');
      assert.equal(payload.omg_number, 'OMG10074');
    },
  };

  const deps = { ...base, ...overrides };

  return Object.assign(deps, {
    _docs: docs,
    _activity: activity,
    _getWebhook: () => webhookEvent,
    _docsUploadedFired: () => docsUploadedFired,
  }) as TestReplaceDeps;
}

async function runReplaceSuccess() {
  const deps = makeDeps();
  const oldId = (await deps.insertDocument({
    quotation_id: 'q1',
    document_type: 'packing-list',
    document_type_name: 'Packing List',
    file_name: 'old.pdf',
    file_path: 'documents/q1/packing-list/old.pdf',
    file_url: '',
    company_name: 'Co',
    storage_provider: 'r2',
  })).id;

  const beforeWeight = Q.total_actual_weight;
  const beforeStatus = Q.status;

  const result = await replaceQuotationDocumentCore(
    {
      omg_number: 'OMG10074',
      doc_type: 'packing_list',
      file_base64: Buffer.from('%PDF-1.4').toString('base64'),
      filename: 'revised-pl.pdf',
    },
    deps
  );

  assert.equal(result.ok, true);
  assert.equal(result.old_document_id, oldId);
  assert.ok(result.suggestions?.note.includes('update_quotation_net_weight'));
  assert.equal(deps._getWebhook(), 'quotation.docs_replaced');
  assert.equal(deps._docsUploadedFired(), false);
  assert.equal(Q.total_actual_weight, beforeWeight);
  assert.equal(Q.status, beforeStatus);

  const old = deps._docs.get(oldId)!;
  assert.ok(old.superseded_at);
  assert.equal(old.replaced_by, 'mcp');
  assert.equal(deps._activity.length, 1);
  assert.equal(deps._activity[0].event, 'document_replaced');

  const current = [...deps._docs.values()].filter((d) => !d.superseded_at);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, result.new_document_id);

  const all = [...deps._docs.values()];
  const listedCurrent = all.filter((d) => !d.superseded_at);
  assert.equal(listedCurrent.length, 1);
  assert.equal(all.length, 2);
}

async function runWrongOmg() {
  const deps = makeDeps();
  let uploaded = false;
  deps.uploadBytes = async () => {
    uploaded = true;
    return 'x';
  };
  await assert.rejects(
    () =>
      replaceQuotationDocumentCore(
        {
          quotation_id: 'q1',
          omg_number: 'OMG99999',
          doc_type: 'packing_list',
          file_base64: Buffer.from('x').toString('base64'),
          filename: 'a.pdf',
        },
        deps
      ),
    /OMG number does not match/
  );
  assert.equal(uploaded, false);
  assert.equal(deps._activity.length, 0);
}

async function runUnknownDocType() {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      replaceQuotationDocumentCore(
        {
          omg_number: 'OMG10074',
          doc_type: 'invoice',
          file_base64: Buffer.from('x').toString('base64'),
          filename: 'a.pdf',
        },
        deps
      ),
    /Unknown doc_type/
  );
}

async function runLoseCase() {
  const deps = makeDeps({
    isOpportunityLost: async () => true,
  });
  let uploaded = false;
  deps.uploadBytes = async () => {
    uploaded = true;
    return 'x';
  };
  await assert.rejects(
    () =>
      replaceQuotationDocumentCore(
        {
          omg_number: 'OMG10074',
          doc_type: 'commercial_invoice',
          file_base64: Buffer.from('x').toString('base64'),
          filename: 'ci.pdf',
        },
        deps
      ),
    /Lose Case/
  );
  assert.equal(uploaded, false);
}

async function runListingAfterReplace() {
  const deps = makeDeps();
  await deps.insertDocument({
    quotation_id: 'q1',
    document_type: 'packing-list',
    document_type_name: 'Packing List',
    file_name: 'v1.pdf',
    file_path: 'p1',
    file_url: '',
    company_name: 'Co',
    storage_provider: 'r2',
  });

  await replaceQuotationDocumentCore(
    {
      omg_number: 'OMG10074',
      doc_type: 'packing_list',
      file_base64: Buffer.from('v2').toString('base64'),
      filename: 'v2.pdf',
    },
    deps
  );

  const currentOnly = [...deps._docs.values()].filter((d) => !d.superseded_at);
  const withHistory = [...deps._docs.values()];
  assert.equal(currentOnly.length, 1);
  assert.equal(withHistory.length, 2);
  assert.ok(withHistory.some((d) => d.superseded_at));
}

Promise.all([runReplaceSuccess(), runWrongOmg(), runUnknownDocType(), runLoseCase(), runListingAfterReplace()])
  .then(() => {
    console.log('verify-replace-document: ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
