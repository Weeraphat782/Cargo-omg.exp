import assert from 'node:assert/strict';
import {
  completeCaseCore,
  markLoseCaseCore,
  reopenCaseCore,
  type CaseClosureDeps,
  type OpportunityClosureRow,
  type QuoteLinkRow,
} from '../src/lib/mcp/case-closure';

type Store = {
  opp: OpportunityClosureRow;
  quotes: Map<string, QuoteLinkRow>;
  byOmg: Map<string, string>;
  activity: Record<string, unknown>[];
};

function makeDeps(store: Store): CaseClosureDeps {
  return {
    resolveOpCardId: async (ref) => {
      if (ref.op_card_id) return ref.op_card_id;
      if (ref.omg_number) {
        const id = store.byOmg.get(ref.omg_number);
        if (!id) throw new Error('Quotation not found.');
        return store.opp.id;
      }
      throw new Error('Quotation not found.');
    },
    loadOpportunity: async (id) => (id === store.opp.id ? { ...store.opp } : null),
    listQuotations: async () =>
      [...store.quotes.values()].sort((a, b) => a.quotation_no!.localeCompare(b.quotation_no!)),
    updateOpportunity: async (id, patch) => {
      assert.equal(id, store.opp.id);
      store.opp = {
        ...store.opp,
        ...patch,
        updated_at: new Date().toISOString(),
      } as OpportunityClosureRow;
      return { ...store.opp };
    },
    setQuotationStatus: async (quotationId, status) => {
      const row = store.quotes.get(quotationId);
      if (!row) throw new Error('quotation missing');
      store.quotes.set(quotationId, { ...row, status });
    },
    completeLinkedQuotations: async () => {
      for (const [id, q] of store.quotes) {
        if (q.status !== 'rejected') {
          store.quotes.set(id, { ...q, status: 'completed' });
        }
      }
    },
    logActivity: async (quotationId, event, payload) => {
      store.activity.push({ quotationId, event, payload });
    },
  };
}

function freshStore(stage = 'delivered'): Store {
  const opp: OpportunityClosureRow = {
    id: 'opp-1',
    stage,
    closure_status: null,
    closure_snapshot: null,
    notes: null,
    customer_name: 'Acme',
    updated_at: new Date().toISOString(),
  };
  const q1: QuoteLinkRow = {
    id: 'q1',
    status: 'docs_uploaded',
    quotation_no: 'OMG11059',
  };
  return {
    opp,
    quotes: new Map([['q1', { ...q1 }]]),
    byOmg: new Map([['OMG11059', 'q1']]),
    activity: [],
  };
}

async function main(): Promise<void> {
  {
    const store = freshStore('payment_received');
    const deps = makeDeps(store);
    const lost = await markLoseCaseCore(deps, { omg_number: 'OMG11059' }, 'duplicate');
    assert.equal(lost.status, 'Lose Case');
    assert.ok(lost.notes?.includes('Lose Case: duplicate'));

    const reopened = await reopenCaseCore(deps, { omg_number: 'OMG11059' }, 'customer back');
    assert.equal(reopened.status, 'Open');
    assert.equal(store.quotes.get('q1')?.status, 'docs_uploaded');
    assert.ok(reopened.notes?.includes('Reopened: customer back'));
  }

  {
    const store = freshStore('waiting_for_pickup');
    const deps = makeDeps(store);
    await assert.rejects(
      () => completeCaseCore(deps, { op_card_id: 'opp-1' }, {}),
      /Cannot complete: current stage is "waiting_for_pickup"/
    );
  }

  {
    const store = freshStore('waiting_for_pickup');
    const deps = makeDeps(store);
    const done = await completeCaseCore(deps, { omg_number: 'OMG11059' }, { force: true });
    assert.equal(done.status, 'Completed');
    assert.equal(store.quotes.get('q1')?.status, 'completed');
  }

  {
    const store = freshStore();
    const deps = makeDeps(store);
    const lost = await markLoseCaseCore(deps, { omg_number: 'OMG11059' }, 'cancelled');
    assert.equal(lost.omg_number, 'OMG11059');
  }

  {
    const store = freshStore();
    const deps = makeDeps(store);
    await markLoseCaseCore(deps, { op_card_id: 'opp-1' }, 'x');
    await assert.rejects(
      () => markLoseCaseCore(deps, { op_card_id: 'opp-1' }, 'y'),
      /already Lose Case/
    );
    store.opp.closure_status = null;
    await assert.rejects(
      () => reopenCaseCore(deps, { op_card_id: 'opp-1' }, 'nope'),
      /nothing to reopen/
    );
  }

  console.log('verify-case-closure: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});