/** ponytail: static smoke — fails if swap migration/API pieces are removed */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'migrations', '026_swap_quotation_documents.sql'),
  'utf8'
);
const route = fs.readFileSync(
  path.join(root, 'src', 'app', 'api', 'document-submissions', 'swap', 'route.ts'),
  'utf8'
);

const need = [
  ['migration', migration, 'swap_quotation_documents'],
  ['migration', migration, 'quotations_same_customer'],
  ['migration', migration, 'docs_swapped_at'],
  ['route', route, 'export async function GET'],
  ['route', route, 'export async function POST'],
  ['route', route, 'export async function PATCH'],
  ['route', route, 'swap_quotation_documents'],
];

for (const [label, text, snippet] of need) {
  if (!text.includes(snippet)) {
    console.error(`verify-swap-documents: missing "${snippet}" in ${label}`);
    process.exit(1);
  }
}

console.log('verify-swap-documents: ok');
