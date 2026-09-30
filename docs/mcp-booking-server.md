# OMGEXP MCP Booking Server (v1)

Remote **Streamable HTTP** MCP server hosted inside the Next.js app at `https://cargo.omgexp.com/api/mcp`.

Grok Bot connects over the public internet with a static Bearer token. When a customer submits a quotation, the app POSTs a `quotation.created` payload to your Grok routine webhook URL; when Commercial Invoice or packing list docs arrive later, it POSTs `quotation.docs_uploaded`. The bot then calls MCP tools to fetch details, **reads the document URLs itself** to get net weight, and builds a booking email draft (**no mail is sent by MCP**).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_TOKEN` | Yes | **We generate** this (random secret). Set on Vercel only. Give the same value to Grok Bot as `Authorization: Bearer <token>` when connecting `https://cargo.omgexp.com/api/mcp`. Grok does **not** generate this. |
| `QUOTATION_WEBHOOK_URL` | Yes (for push) | **From Grok Bot** — routine webhook POST URL. Set on Vercel only. |
| `WEBHOOK_SIGNING_SECRET` | Yes (for push) | **From Grok Bot** — routine “Webhook key” / sender key (usually `crsr_...`). Set on Vercel only. Sent outbound as `Authorization: Bearer <key>`. We do **not** invent this and cannot configure a custom secret back into Grok. |
| `BOOKING_EMAIL_TO` | No | Default `montri@handleinterfreight.com` |
| `BOOKING_EMAIL_CC` | No | Comma-separated CC list |
| `BOOKING_EMAIL_FROM` | No | Default `cargo@omgexp.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side quotation/doc access |
| `NEXT_PUBLIC_SITE_URL` | Yes | Used for Document List URL (`/booking/{token}`) |
| `OPPORTUNITY_OWNER_EMAIL` | No | Staff email for MCP-created Op cards (default `vieww.weeraphat@gmail.com`). Resolved to `profiles.id` for `owner_id` so cards appear in the Opportunities UI. |

**Where to get Grok webhook values:** Grok Bot desktop app → routine trigger card → copy the POST URL and webhook/sender key.

If `QUOTATION_WEBHOOK_URL` or `WEBHOOK_SIGNING_SECRET` is unset, push is skipped (no error). Grok can still poll `list_new_quotations` via MCP.

Run migration: `Tr/migrations/012_add_booking_email_drafted.sql`

## MCP tools

| Tool | Purpose |
|------|---------|
| `list_new_quotations` | Pending quotes (default `pending_approval`), excludes drafted |
| `get_quotation` | Full detail + attachment metadata |
| `get_quotation_documents` | Signed download URLs |
| `extract_booking_fields` | Net weight (quotation), packaging, routing + doc URLs for Grok to read when pallets are 0 |
| `update_quotation_net_weight` | Write net KG to `total_actual_weight` (not chargeable) |
| `approve_quotation` | Staff approve customer quote (`pending_approval` -> `draft`/`docs_uploaded`); never changes destination or pricing |
| `create_op_card` | Create/link Opportunity from quotation (idempotent); assigns staff `owner_id` |
| `update_op_card` | Update existing Op card stage, pickup_date, notes, payment_date |
| `get_op_card` | Fetch Op card by quotation/OMG/op_card_id (debug visibility + owner_id) |
| `build_booking_email_draft` | Subject + body + to/cc (OMG format); auto net from docs |
| `mark_booking_email_drafted` | Idempotent drafted flag |

Run migrations: `Tr/migrations/023_awb_tracking_delivered.sql`, then `Tr/migrations/024_awb_route.sql`

## Delivery tracking tools (Grok daily AWB check)

The app does **not** scrape airline sites. Grok checks carrier tracking pages and reports status via MCP.

| Tool | Purpose |
|------|---------|
| `list_awbs_to_track` | AWBs on Op at `picked_up`+, not yet `delivered_at`. Optional `days` (default **30**, pickup_date or created_at). `carrier_code` from AWB prefix when not stored. |
| `update_awb_tracking` | Append history + status; `delivered` sets date, advances Op, email **once** unless `send_email: false`. Optional `origin`/`destination` (IATA) for email Route, `flight_no`, `flight_date`, `chargeable_weight_kg`. |
| `get_awb_tracking` | Current status, history, notification log (by AWB or OMG number) |
| `resend_delivered_email` | Resend delivered notification (already delivered); pass `awb_number` or `omg_number`; new manual log row with real To list |
| `update_awb_number` | Fix AWB on a quote (`omg_number` + `awb_number`); resets tracking, clears `delivered_at` when changed, logs old AWB in history |

**`tracking_status` values:** `not_tracked`, `booked`, `departed`, `in_transit`, `arrived`, `delivered`, `exception`

**AWB input:** with or without dash/space (`217-1064 8864` or `21710648864`).

**When reporting delivered**, pass `delivered_at` as ISO datetime **with timezone offset** from the airline (e.g. `2026-09-30T14:20:00+02:00`) so the customer email shows destination local time.

**Suggested daily flow (08:00 Asia/Bangkok):**

1. `list_awbs_to_track({ days: 30 })` — use `days: 3650` to include old backlog; clear with `send_email: false`
2. For each row, open the airline tracking page (use `carrier_code` from the list)
3. If Delivered → `update_awb_tracking({ awb_number, status: "delivered", raw_text, source_url, delivered_at, origin?, destination?, flight_no?, flight_date?, chargeable_weight_kg? })`
4. Otherwise → `update_awb_tracking` with the current status (no `delivered_at` required)

**Idempotency:** Calling `update_awb_tracking` again with `delivered` returns `{ already_delivered: true, email: "skipped" }` — no duplicate email.

Example:

```json
{
  "awb_number": "217-1064 8864",
  "status": "delivered",
  "raw_text": "Shipment delivered to consignee",
  "source_url": "https://www.example-airline.com/track/21710648864",
  "delivered_at": "2026-09-30T14:20:00+02:00",
  "origin": "BKK",
  "destination": "ZRH"
}
```

**Correct route after delivered (no auto email):** call `update_awb_tracking` again with `status: "delivered"`, new `origin`/`destination`, and omit `delivered_at`; then `resend_delivered_email` if customers need the updated email.

```json
{
  "awb_number": "217-1064 8864",
  "status": "delivered",
  "raw_text": "Route corrected from airline tracking",
  "source_url": "https://www.example-airline.com/track/21710648864",
  "origin": "BKK",
  "destination": "ZRH"
}
```

## Connect Grok Bot (xAI API)

```json
{
  "type": "mcp",
  "server_label": "omgexp_booking",
  "server_url": "https://cargo.omgexp.com/api/mcp",
  "authorization": "Bearer YOUR_MCP_API_TOKEN",
  "require_approval": "never"
}
```

Or **grok.com → Connectors → New Connector → Custom** with the same URL and auth header.

## Connect Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "omgexp-booking": {
      "url": "https://cargo.omgexp.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MCP_API_TOKEN}"
      }
    }
  }
}
```

## Webhook `quotation.created`

Fired from `POST /api/notify-quote-request` after a customer portal submit. The route **awaits** the outbound POST (with one retry on 5xx/timeout) before returning — required on Vercel so the serverless function is not frozen mid-delivery.

Example payload: [scripts/fixtures/quotation-created-webhook.example.json](../scripts/fixtures/quotation-created-webhook.example.json)

### Delivery verification (admin)

After each customer submit, **Vercel Production logs** should show within seconds:

```text
[webhook] quotation.created OMG09017 id=<uuid> -> 200 in 342ms: ...
```

- **Missing log** or **non-2xx** → Grok was not woken. Check Production env vars `QUOTATION_WEBHOOK_URL` and `WEBHOOK_SIGNING_SECRET` match the **current** Grok routine card (URL + `crsr_...` key), then redeploy.
- Success criteria: each new submit produces a Grok Bot chat notification within ~1 minute (even if booking draft is skipped for missing net/docs).

## Webhook `quotation.docs_uploaded`

Fired when **Commercial Invoice** or **Export Packing List** is uploaded:

- `POST /api/confirm-upload` (public upload link + staff internal upload)
- `POST /api/notify-docs-uploaded` (customer portal authenticated uploads)

Fires even if `quotation.created` already ran and booking email was **not** marked drafted yet. Fires when quotation status stays `pending_approval` (docs inserted, status unchanged).

Example payload:

```json
{
  "event": "quotation.docs_uploaded",
  "emitted_at": "2026-09-08T04:00:00.000Z",
  "quotation_id": "uuid",
  "omg_number": "OMG09014",
  "quotation_no": "OMG09014",
  "status": "pending_approval",
  "updated_at": "2026-09-08T03:55:00.000Z",
  "doc_types_added": ["commercial-invoice"],
  "document_list_url": "https://cargo.omgexp.com/booking/{token}"
}
```

### Outbound auth (cargo.omgexp.com → Grok)

No HMAC. The app sends:

- `Authorization: Bearer $WEBHOOK_SIGNING_SECRET` (Grok-provided webhook key)
- `Content-Type: application/json`
- `X-OMG-Event: quotation.created` or `quotation.docs_uploaded`

HTTP status, response body snippet, and latency (ms) are logged with OMG# and quotation_id (secrets never logged). Non-2xx and timeouts log as errors. Retries once on 5xx/timeout.

Test from your machine (replace URL and key from the Grok routine card):

```bash
curl -X POST "$QUOTATION_WEBHOOK_URL" \
  -H "Authorization: Bearer $WEBHOOK_SIGNING_SECRET" \
  -H "Content-Type: application/json" \
  -H "X-OMG-Event: quotation.docs_uploaded" \
  -d '{"event":"quotation.docs_uploaded","quotation_id":"...","omg_number":"OMG09014","doc_types_added":["commercial-invoice"]}'
```

## Net weight from documents

`extract_booking_fields` returns net weight from the **quotation only**:

1. Sum of `quotations.pallets[].weight × quantity` (if > 0) → `source: quotation_pallets`, confidence `high`
2. `quotations.total_actual_weight` (if > 0) → `source: quotation_actual_weight`, confidence `high`
3. Otherwise `null` → `source: unavailable`, confidence `low`

**Never** uses `chargeable_weight`, `manual_chargeable_weight`, or volume as net. `chargeable_weight` is returned as info only.

When net is `unavailable`, **Grok reads the documents itself**: `extract_booking_fields` returns `verify_from_documents[]` with signed `download_url`s (Commercial Invoice first, then Export Packing List). Grok reads the total net / QTY KG from the CI and then either:

- calls `update_quotation_net_weight` to persist it (so `get_quotation` / future drafts show it), and/or
- passes `net_weight_kg` directly to `build_booking_email_draft`.

Document List URL in the email body is enough — **no file attachments** in MCP or Grok Gmail drafts.

## Packaging (Pallet vs Box)

- Default `packaging_type: "pallet"` — NUMBER OF PIECE renders as `"N Pallets"`.
- Pass `packaging_type: "box"` or `"carton"` + `pieces` to `build_booking_email_draft` for `"N Boxes"` / `"N Cartons"`.
- When Grok reads the CI/PL and sees the customer meant boxes/cartons (UI default left it as pallets by mistake), it passes `packaging_type` + `pieces` to `build_booking_email_draft`.
- **Do not** auto-convert a real pallet booking to boxes; only override when documents clearly show boxes/cartons. No UI packaging-default change.

## Suggested Grok routine flow

1. Receive `quotation.created` or `quotation.docs_uploaded` webhook (or poll `list_new_quotations`)
2. `approve_quotation` — staff approve customer quote (if still `pending_approval`); optional `company_name` override; destination/pricing left untouched
3. `extract_booking_fields` — get quotation net + `verify_from_documents` URLs; **Grok reads the Commercial Invoice** for total net KG
4. `update_quotation_net_weight` — persist correct net (`source: "commercial-invoice"`)
5. `create_op_card` — create/link Opportunity (idempotent if already exists)
6. `update_op_card` — move stage / set pickup_date after booking email drafted (e.g. `waiting_for_pickup`)
7. `build_booking_email_draft` — optional `packaging_type` / `pieces` if doc mismatch
8. **Grok creates Gmail draft** in cargo@omgexp.com (MCP never sends email; no attachments)
9. `mark_booking_email_drafted` (idempotent)

MCP **never sends email**. Pricing / rates are out of scope (handled by humans).

Fallback: poll `list_new_quotations` if webhook missed.

### Example tool calls

**Approve customer quote (staff):**

```json
{
  "omg_number": "OMG09014",
  "company_name": "PACCAN GROW Co., Ltd."
}
```

Returns `status_before`, `status_after` (`draft` or `docs_uploaded` if CI/PL uploaded), `company_name`, `destination_id`, `destination_untouched: true`. Second call returns `already_approved: true`. Never changes destination, rates, or chargeable weight. Reassigns `user_id` to staff from `OPPORTUNITY_OWNER_EMAIL`.

**Update net weight from Commercial Invoice:**

```json
{
  "omg_number": "OMG09014",
  "net_weight_kg": 341.6,
  "source": "commercial-invoice",
  "note": "Total QTY KG from CI page 1"
}
```

**Build draft with box packaging override:**

```json
{
  "omg_number": "OMG09014",
  "packaging_type": "box",
  "pieces": 48
}
```

**Create Op card:**

```json
{
  "omg_number": "OMG09014"
}
```

Second call with same OMG# returns the same `op_card_id` with `"created": false`. If an existing card has the wrong `owner_id` (e.g. customer instead of staff), the second call **repairs** it and returns `"repaired": true`. Pass `stage`/`notes` on create to patch an already-linked card; use `update_op_card` for `pickup_date` / `payment_date`.

**Update Op card (stage + pickup):**

```json
{
  "omg_number": "OMG09014",
  "stage": "waiting_for_pickup",
  "pickup_date": "2026-09-11"
}
```

Returns the full opportunity row (same shape as `get_op_card`) after update.

**Debug Op card visibility:**

```json
{
  "omg_number": "OMG09017"
}
```

Use `get_op_card` — check `owner_id` matches the staff profile for `OPPORTUNITY_OWNER_EMAIL`. Cards only appear in the Opportunities UI when `owner_id` equals the logged-in staff user's id.

## Op card owner (visibility)

The Opportunities list filters by `owner_id = logged-in staff user`. MCP `create_op_card` resolves owner in this order:

1. Explicit `owner_id` in tool args
2. Explicit `owner_email` in tool args
3. `OPPORTUNITY_OWNER_EMAIL` env var
4. Hardcoded fallback `vieww.weeraphat@gmail.com`

Set `OPPORTUNITY_OWNER_EMAIL=vieww.weeraphat@gmail.com` on Vercel Production. Re-call `create_op_card` for OMG09017 / OMG09014 to repair existing cards with wrong owner.

## Local check

```bash
npm run verify:booking-draft
```

## Example tool call (curl smoke test)

MCP uses Streamable HTTP JSON-RPC — use an MCP client (Grok, Cursor, MCP Inspector) rather than raw curl for full handshake.
