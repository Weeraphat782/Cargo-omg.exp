/**
 * Call production (or MCP_URL) tools/list with Bearer MCP_API_TOKEN.
 * ponytail: smoke check only — fails if count != 17 or replace_quotation_document missing.
 */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = (process.env.MCP_URL || 'https://cargo.omgexp.com/api/mcp').replace(/\/$/, '');
const token = process.env.MCP_API_TOKEN?.trim();

if (!token) {
  console.error('Set MCP_API_TOKEN (Vercel Production → MCP_API_TOKEN)');
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});

const client = new Client({ name: 'omgexp-verify', version: '1.0.0' });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`MCP ${url}`);
  console.log(`tools: ${names.length}`);
  for (const n of names) console.log(`  - ${n}`);
  assert.equal(names.length, 17, `expected 17 tools, got ${names.length}`);
  assert.ok(names.includes('replace_quotation_document'), 'missing replace_quotation_document');
  console.log('verify:mcp-tools: ok');
} finally {
  await client.close().catch(() => {});
}
