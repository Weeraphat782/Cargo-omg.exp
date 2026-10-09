/** ponytail: view route must stay GET-only (no AWB upload for consignee links) */
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'app', 'api', 'booking', 'view', '[token]', 'route.ts'),
  'utf8'
);

if (route.includes('export async function POST')) {
  console.error('verify-booking-view: POST must not exist on view route');
  process.exit(1);
}
if (!route.includes('booking_view_token') || !route.includes('publicView: true')) {
  console.error('verify-booking-view: expected booking_view_token + publicView');
  process.exit(1);
}

console.log('verify-booking-view: ok');
