# Audit report — Cargo / freight system

**Date:** 27 November 2026
**Site:** [cargo.omgexp.com](https://cargo.omgexp.com) (Next.js on Vercel, Supabase, Resend, LINE, AWB tracking, MCP)
**Scope:** read-only review of this repository. No application code was changed.
**What was checked:** API routes, page guards, Supabase SQL in the repo, file-upload code, webhooks, MCP tools, bundle and query patterns, `npm audit`, and git history for committed secrets.

**What was not checked:** the live Supabase database. Row Level Security (the database’s own permission rules) can differ from the SQL files in this repo, because many of those files are one-off scripts meant to be pasted into the Supabase SQL editor. Findings that depend on which script was run last are marked **confirm in Supabase**. The file and API findings do not depend on that: they are in the application code that Vercel runs.

---

## Executive summary

The app has grown into a real operations system: about **80,000 lines** under `src/`, staff tools, a customer portal, public links, email, LINE, Telegram, and an AI/MCP connection that can create and approve quotations. The browser login screen does check Supabase. A large set of server routes do not. Those routes use the **service-role key**, which skips every database permission rule.

**Can someone who is not logged in read or change bookings, quotations, or prices?**

Yes, on several paths that are in the code today:

1. **Files.** `GET /api/get-signed-url?path=...` returns a one-hour download link for any file path, and the caller can also pass a bucket name. `DELETE /api/delete-file?path=...` deletes that file. `POST /api/generate-upload-url` gives a link that uploads into a folder the caller chooses (`documents/<any quotation id>/...`, company documents, templates, QC). No login is required.
2. **Shipment records.** `POST /api/confirm-upload` writes a document onto any quotation id and can change that quotation’s status. `POST /api/confirm-company-document` writes a company document for any user id the caller sends. `POST /api/upload-shipment-photo` replaces the photos on any quotation id. All three use the service-role key.
3. **Prices and customer rows, if the SQL in this repo is what is live.** The public quotation page loads the **entire quotation row** with the public Supabase key (`select('*')`). The only policy in the repo that makes that page work allows reading **every quotation that has a share link**, not only the link in the URL. Separate scripts (`fix_all_permissions.sql` and others) would let anyone read **and edit** every quotation and opportunity. Confirm this in the Supabase dashboard before assuming it is already closed. See finding S3.
4. **A booking link is a password.** Whoever has `/booking/<token>` or `/booking/view/<token>` gets the shipment, weights, customer and consignee details, and a download link for **every document** on that shipment (invoices, permits, and ID copies if those were uploaded). The edit link can also mark the booking confirmed. The edit action accepts any storage path, so one leaked booking link can be pointed at other files.
5. **The MCP connection is one shared password** (`MCP_API_TOKEN`). Whoever has it can list, read, create, update, and approve quotations, upload and delete documents, and write tracking. There is a second, older MCP server in `mcp-node-server/` with **no password at all**.

The service-role key itself is **not** compiled into the website. No `.env` file is in git, and git history does not contain a Supabase service-role JWT. A **Typhoon API key is committed** in `AI_SETUP_GUIDE.md` and has been there since the first commit. Rotate it.

Login for staff and customer pages is enforced in the browser (`src/app/(main)/layout.tsx`). Middleware does not check a session (`src/middleware.ts`). Hiding a page in the browser does not protect an API.

### Top 10 issues, in the order to fix them

| # | Severity | Issue | Why it matters |
| --- | --- | --- | --- |
| 1 | Critical | Open file download, upload, and delete APIs | Anyone can pull or destroy customer documents, or plant a file in another shipment’s folder. |
| 2 | Critical | Upload-confirm and photo routes write the database with the service-role key and no login | A quotation id in the URL is enough to attach documents, change status, or replace photos. |
| 3 | Critical | Database policies for public links are written too wide, and “dev mode” SQL is still in the repo | If those scripts were applied, the public website key can read every shared quotation, including prices. Confirm in Supabase. |
| 4 | High | Booking and tracking links return every file on the shipment | A forwarded email link exposes invoices, permits, and identity documents. The edit link can also confirm the booking and read other stored files. |
| 5 | High | Telegram webhook does not check that Telegram sent the message | A stranger can attach any quotation to a chat they control and receive the customer name and file links. |
| 6 | High | A live API key is saved in `AI_SETUP_GUIDE.md` | Anyone with the repo (or a copy of it) can use that Typhoon key. It has been in git since the first commit. |
| 7 | High | Admin-style routes with no login: public-bucket upload, artwork library, marketing rebuild | Strangers can host files on the public R2 address, fill storage (videos up to 200 MB), and trigger a GitHub rebuild of the marketing site. |
| 8 | High | One MCP token can read and change every quotation and price | Lose that token and an automated client has staff-level write access. The old `mcp-node-server` has no token. The installed MCP SDK is in a version range with a published cross-client leak. |
| 9 | High | Cancelling a quote trusts a user id sent in the request body | The server checks that the id matches the row, then believes the caller is that user. Combined with any id leak, pending quotes can be cancelled or deleted. |
| 10 | High | Size, dependency risk, and no safety net | ~80k lines, 3,000-line pages, `node_modules` committed (3,054 files), three conflicting SQL folders, no automated tests, and `npm audit` reports 4 critical and 20 high issues (Next.js, jsPDF, SheetJS). |

---

## How to read a finding

**Severity**

- **Critical** — a stranger can read or change customer files, shipments, or prices with information that is easy to get (a quotation id, a file path, or the public Supabase key).
- **High** — serious, but needs a leaked link, a leaked token, or a script that may or may not have been applied in production.
- **Medium** — abuse, cost, or a hole that is smaller on its own.
- **Low** — cleanup, or a problem that needs another hole first.

Each finding has the files, what can go wrong in plain language, and a concrete fix.

---

## 1. Security

### S1. File download, upload, and delete have no login — Critical

**Files**

- `src/app/api/get-signed-url/route.ts` (GET, around lines 24–43)
- `src/app/api/delete-file/route.ts` (DELETE, around lines 22–42)
- `src/app/api/generate-upload-url/route.ts` (POST, around lines 34–84)
- Called from the browser by `src/lib/storage.ts`

**What can go wrong**

These routes exist so the browser never sees the Cloudflare R2 secret. They still do whatever the caller asks:

- Download: the caller passes `path` and, optionally, `bucket`. The server returns a URL that works for one hour. There is no check that this person may see that file.
- Delete: the same, then the object is removed.
- Upload: the caller passes a quotation id, company id, user id, or QC request id. The server returns an upload URL under `documents/<that id>/...`, `company-documents/<user id>/...`, `templates/...`, or `qc/...`. The filename is a random id, so this does not overwrite an existing name, but it does let a stranger store files in another shipment’s folder and fill the bucket.

File paths show up in the database, in emails, and in API responses. Once a path leaks, the file is public. Paths that follow a pattern (`documents/<quotation uuid>/commercial-invoice/...`) are easier to try once any quotation id is known.

**Fix**

One shared check, used by all three routes, before any R2 call:

1. Require a logged-in staff user, **or** a customer session that owns that quotation, **or** a booking/share token that was looked up server-side and matches that quotation.
2. Allow only known prefixes (`documents/<that quotation id>/`, and the same idea for company and QC). Ignore a caller-supplied bucket name; use the server’s bucket.
3. On delete, also check that a database row the caller is allowed to touch points at that path.

Do this before any other cleanup. These three routes are the shortest path to customer documents.

### S2. Confirming an upload writes shipments with the master key — Critical

**Files**

- `src/app/api/confirm-upload/route.ts` (POST, from line 11). Inserts into `document_submissions` and updates the quotation. Uses `getSupabaseServerClient()` (service role).
- `src/app/api/confirm-company-document/route.ts` (POST, lines 14–40). Upserts `company_documents` for the `userId` in the body.
- `src/app/api/upload-shipment-photo/route.ts` (POST). Uploads to R2 under `shipment-photos/<quotationId>/` and sets `quotations.shipment_photo_url`. The public page is `src/app/shipment-photo/[id]/page.tsx`.
- Related public pages that call the upload APIs with only an id in the URL: `src/app/documents-upload/[id]/page.tsx`, `src/app/(public)/company-onboarding/[token]/page.tsx`.

**What can go wrong**

The service-role key ignores Row Level Security. The route trusts the ids in the JSON body. Anyone who knows a quotation UUID can:

- Attach a file record to that shipment and move its status (for example toward `docs_uploaded`).
- Trigger staff email, Telegram, and outbound webhooks (`emitQuotationDocsUploaded`).
- Point a company’s document slot at an attacker-chosen path.
- Replace the shipment photo shown to staff.

The company onboarding page looks up a company by token in the browser, then calls these APIs. The APIs themselves never check the token.

**Fix**

- `confirm-upload` and `upload-shipment-photo`: accept a share token or a logged-in user, load the quotation with that proof, and only then insert. Reject `filePath` values that do not start with `documents/<that quotation id>/` or `shipment-photos/<that quotation id>/`.
- `confirm-company-document`: require the logged-in user, and set `user_id` from the session, not from the body. For onboarding, accept only the company’s `onboarding_token`, check it on the server, and do not let the caller set `is_approved`.
- Stop sending the raw quotation UUID as the only secret on `/documents-upload/<id>` and `/shipment-photo/<id>`. Use the same unguessable token pattern as the booking link, and expire it.

### S3. Public-link database rules are wider than the link — Critical (confirm in Supabase)

**Files**

- `migrations/add_share_token.sql` — policy `public_can_view_by_share_token`
- `migrations/010_add_booking_link.sql` — policy `public_can_view_by_booking_token`
- `src/lib/db.ts` `getQuotationByShareToken` (around line 1433) does `.select('*').eq('share_token', token)` from the **browser** using the public anon key
- Public pages: `src/app/quotation/[token]/page.tsx`, `src/app/track/[token]/page.tsx`
- `src/app/api/quotation-sign/route.ts` — this one is the safer pattern (server looks up the token)

The policies say, in effect: if the row has any non-empty token, **anyone** may read the row. They do not compare the token to the one in the URL. Postgres cannot see the URL. A direct call to the Supabase REST API with the public anon key (that key is inside the website) can list every quotation that has a share link or a booking link, including prices, notes, signatures, and customer fields. The `.eq('share_token', token)` filter is only what the honest page sends. An attacker omits it.

`fix_user_data_isolation_v2.sql` tightens owner-only policies but **does not drop** these two token policies. In Postgres, if any allow-policy matches, the row is visible. Running the isolation script does not close this hole.

**Other scripts that are dangerous if they were applied**

| File | What it does |
| --- | --- |
| `fix_all_permissions.sql` | `quotations`: `FOR ALL TO public USING (true)` (anyone can read, insert, update, delete). Opportunities: anyone can read and write. Companies and destinations: anyone can read. |
| `add_opportunity_id_to_quotations.sql` | Puts the open quotations policy back. |
| `update_opportunities_policies.sql`, `fix_foreign_key_constraint.sql`, `create_opportunities_table.sql` | Opportunities readable and writable by the public role. |
| `create_cms_tables.sql` | News and resources: `FOR ALL USING (true)`. |
| `setup_analysis_history_complete.sql`, `fix_analysis_history_permissions.sql` | AI document-analysis history open to the public. |
| `fix_onboarding_rls.sql` | Any company row that has an onboarding token can be **updated** by anyone. The page also sets `is_approved: true`. Storage policies let anyone upload and read the whole `company-documents` bucket. |
| `create_document_submissions_table.sql` | `Anyone can insert documents` with `WITH CHECK (true)`. |
| `development_mode.sql`, `disable_rls_final.sql` | Turn RLS off on packing-list tables. |

**Freight rates.** `database-schema.sql` limits `freight_rates` to `user_id = auth.uid()`. Nothing in the repo grants that table to anonymous users. Direct anonymous reads of the rate card are not what the SQL shows. Quotation rows are the price leak, because a quotation stores `total_cost`, `manual_rate`, and related fields, and `getQuotationByShareToken` selects every column.

**Fix**

1. In the Supabase SQL editor, run:
   `select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' order by 1, 2;`
   and the same for `storage.objects`.
2. Drop `public_can_view_by_share_token` and `public_can_view_by_booking_token`.
3. Do not let the browser read `quotations` for public links. Keep using a server route (the sign and booking routes already do this) that looks up **one** token and returns only the fields that page needs. Prices and internal remarks stay off the public payload.
4. Move the onboarding update to a server route that matches the token and does not let the visitor approve themselves.
5. Make storage buckets private. Signed URLs only, after the check in S1.
6. Delete or clearly archive the root `fix_*.sql` scripts so nobody pastes `fix_all_permissions.sql` again. One migration history only (see M4).

### S4. A booking link exposes the whole document set — High

**Files**

- `src/app/api/booking/[token]/route.ts` (GET and POST)
- `src/app/api/booking/view/[token]/route.ts` (GET)
- `src/lib/booking-sheet.ts` (`BOOKING_QUOTATION_SELECT`, `buildBookingSheetPayload`)
- Pages: `src/app/booking/[token]/page.tsx`, `src/app/booking/view/[token]/page.tsx`

**What can go wrong**

The token lookup itself is the right idea: the server finds one row by `booking_share_token` or `booking_view_token`. The payload is too wide.

`buildBookingSheetPayload` loads every current `document_submissions` row and turns each `file_path` into a signed download URL. It also returns AWB and customs-file URLs, customer name, company, contact, destination, pallet data, weights, and `booking_details` (shipper, consignee, airline, HS code). The “public view” cleaner only removes a few internal columns (`awb_number_source`, swap timestamps). It still returns the documents.

Commercial invoices in that list contain prices. ID-card and company-registration uploads, if they were stored as shipment documents, are in the same list.

The edit route’s `action: "extract"` takes a `filePath` from the caller, downloads that object with the server’s R2 key, sends it to Gemini, and saves that path onto the quotation as the AWB file. The path is not required to belong to this quotation. Anyone with one booking link can point this at other files in the bucket. `action: "save"` sets `booking_status` to `confirmed` and writes an AWB number the caller supplies.

**Fix**

- On the view link, return shipment facts the consignee needs, and a short list of document types that are meant to be shared. Do not sign URLs for ID copies or internal staff files.
- On extract, allow only paths that start with this quotation’s prefix and that already exist on this row.
- Add an expiry, or a “revoke link” button, on both tokens. Rate-limit guesses (UUID tokens are already hard to guess; the risk is forwarding and logs).

### S5. Telegram webhook accepts any POST — High

**File:** `src/app/api/telegram/webhook/route.ts`

The handler reads the JSON body and uses the service-role client. There is no `X-Telegram-Bot-Api-Secret-Token` check. Telegram’s own docs tell you to set a secret and reject calls that do not send it.

`/setquote <quotation uuid>` stores that quotation on whatever `chat_id` is in the body. `/status` then replies with the customer name and markdown links to `file_url` on each document. A caller who knows a quotation UUID can send a fake update with their own chat id and receive that reply from the bot. The bot token is used server-side to call `sendMessage`, so the reply really goes out.

`POST /api/telegram/notify` (`src/app/api/telegram/notify/route.ts`) has the same gap in a smaller form: any caller can ask the server to message staff, and the text (customer name, destination) comes from the request body.

**Fix**

- In BotFather, set a webhook secret. Reject requests whose `X-Telegram-Bot-Api-Secret-Token` does not match.
- Restrict `/setquote` to a list of staff chat ids.
- `telegram/notify`: call it only from server code after an upload that already passed S2, or require a staff session.

### S6. LINE webhook is in good shape only when the secret is set — Medium

**File:** `src/app/api/line/webhook/route.ts` (lines 54–65)

When `LINE_CHANNEL_SECRET` is set, the route checks `x-line-signature` with HMAC-SHA256 and `timingSafeEqual`. When the variable is missing, it logs a warning and **accepts the body**. Today the handler only logs group ids. If it later updates bookings, the missing-secret path becomes dangerous.

**Fix:** if the secret is unset, return 401. Confirm the variable is set in the Vercel production environment.

### S7. Typhoon API key committed in the repo — High

**File:** `AI_SETUP_GUIDE.md` line 19

A full `TYPHOON_API_KEY` value (`sk-WJ…`) is in the file. `git log` shows it arrived in the initial commit. It is not a placeholder like `your-key-here`.

No `.env`, `.env.local`, or `.env.production` was ever committed. A search of git history for a Supabase service-role JWT (`eyJhbGci…`) found none. The service-role key is read from the environment in `src/lib/supabase/server.ts` and is not referenced as `NEXT_PUBLIC_` inside `src/`.

**Footgun:** `scripts/*.mjs` and `mcp-node-server/server.js` fall back to `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`. Next.js copies every `NEXT_PUBLIC_` variable into the browser bundle. If that name is ever set in Vercel, the master key ships to every visitor.

**Fix**

1. Revoke the Typhoon key in the provider’s dashboard and create a new one. Store it only in Vercel environment variables (not `NEXT_PUBLIC_`).
2. Replace the line in `AI_SETUP_GUIDE.md` with `TYPHOON_API_KEY=`.
3. Rotation matters more than rewriting git history. The old key stays in history until it is revoked.
4. Search Vercel env vars for any `NEXT_PUBLIC_` secret (service role, Resend, R2, Gemini, MCP). Rename them so they do not start with `NEXT_PUBLIC_`.

`mcp-node-server/server.js` also hardcodes a personal Gmail address and a fixed user UUID as a test login. Remove that block. It is not a cloud key, and it does identify a real account.

### S8. More routes that skip login — High

| Route | What a stranger can do |
| --- | --- |
| `src/app/api/cms/upload/route.ts` | Upload an image, PDF, or Word file (up to 10 MB) into the **public** R2 bucket (`src/lib/r2.ts` uses `R2_PUBLIC_BUCKET_NAME`). `folder` is taken from the form and is not cleaned, so the object key is attacker-chosen. The response is a public URL. |
| `src/app/api/social-artwork/library/route.ts` | List, upload, and delete artwork. Videos up to 200 MB. Uses the service role. |
| `src/app/api/social-artwork/unsplash/route.ts` | Spend the Unsplash API quota. |
| `src/app/api/social-artwork/file/route.ts` | Download any object whose key starts with `social-artwork/`. Lower risk if that prefix is only marketing art. |
| `src/app/api/marketing/rebuild/route.ts` | Trigger a GitHub Actions deploy of the marketing site whenever `MARKETING_GITHUB_PAT` is set. The CMS page calls this from the browser with no secret. |
| `src/app/api/notify-quote-request/route.ts` | For any pending quotation id, email staff and fire `emitQuotationCreated`. The HTTP response is only `{ ok: true }`, so this is spam and a “does this id exist?” probe, not a full data download. |
| `src/app/api/notify-docs-uploaded/route.ts` | Fire the “documents uploaded” webhook for a quotation id. |
| `src/app/api/quotation-details/[quotationId]/route.ts` | Look up by **quotation number** (easier to guess than a UUID) and return company name, destination, and dates. No prices in this payload. |
| `src/app/api/public/chat/route.ts` | Public Gemini chat, `maxDuration` 300 seconds. Has an in-memory per-IP cap that resets whenever the serverless function cold-starts, and it trusts `x-forwarded-for`. |
| `src/app/api/track-awb/route.ts` | Public proxy to Thai cargo tracking. Fine as a feature; it can be used to hammer the upstream site. |

**Fix:** staff or admin session on CMS upload, artwork library, Unsplash, and marketing rebuild. Sanitize the R2 key to a prefix you choose. Notify routes should run inside the server after a checked write, not as public URLs. Put a real shared rate limit (Vercel firewall, or a small table) on `/api/public/chat` and `/api/track-awb`.

### S9. MCP can read and write every quotation — High

**Files**

- `src/app/api/mcp/route.ts` — bearer token compared to `MCP_API_TOKEN`. If the env var is missing, the check fails closed (`withMcpAuth` required).
- `src/lib/mcp/register-tools.ts` — tools include `list_new_quotations`, `get_quotation`, `get_quotation_pdf`, `get_quotation_documents`, `create_quotation`, `update_quotation`, `approve_quotation`, `upload_quotation_document`, `delete_quotation_document`, `replace_quotation_document`, `update_quotation_net_weight`, opportunity/case tools, and AWB tracking writes.
- `mcp-node-server/server.js` — Express server, no authentication. `POST /tools/set_user_email` sets a global email, then other routes use the service-role key. One process-wide `currentUserEmail` means two callers share one identity.

The comparison `bearerToken !== expected` is not constant-time. That is a minor issue next to “one token, full write access.”

`npm audit` also flags `@modelcontextprotocol/sdk` at the installed range for a cross-client data leak when one server instance is reused across HTTP requests. This route does that.

**Fix**

- Keep `MCP_API_TOKEN` long and random, only in Vercel, and rotate it if it has been pasted into chat logs or bot configs.
- Upgrade `@modelcontextprotocol/sdk` and `mcp-handler` to versions newer than the advisory (audit says `<=1.31.0` is affected).
- Do not deploy `mcp-node-server` on a public port. If it is still used locally, add a shared secret and stop using one global email.
- Prefer a staff user JWT, or separate read and write tokens, if more than one bot will connect.

### S10. Cancelling a quotation trusts the caller’s user id — High

**File:** `src/app/api/cancel-quote-request/route.ts`

The body is `{ quotationId, userId }`. The server loads the quotation with the service role and checks `quotation.customer_user_id !== userId`. It never checks that the caller **is** that user. If both UUIDs are known (they leak together if S3 is live, or from a customer page), a stranger can set the quote to `cancelled`, or delete the row if the status value is rejected by the database.

**Fix:** use `requireApiUser` from `src/lib/api-auth.ts` and compare `auth.user.id` to `customer_user_id`. Ignore `userId` from the body.

### S11. Auth that does exist

These are in decent shape and are listed so the picture stays accurate.

- `src/lib/api-auth.ts` verifies the bearer token with `auth.getUser(token)`, then loads `profiles.role` with the service role. `requireStaffApiUser`, `requireAdminApiUser`, and `requireLabAdminApiUser` are real checks.
- Routes that use them include document swap and zip download, QC allowlist, admin chat logs, GA analytics, lab Google finish, AI settings, document-comparison analyze, and social-artwork generate.
- `src/app/api/packing-lists/route.ts` requires a user JWT and queries with the anon key, so RLS still applies.
- `src/app/api/awb-tracking/route.ts` and `src/app/api/portal/document-check/route.ts` check a staff or owner token.
- `src/app/api/newsroom/posts/route.ts` requires `OMG_AGENT_TOKEN` and refuses to run if the variable is unset.
- Staff and customer **pages** redirect in the browser when there is no Supabase session (`src/app/(main)/layout.tsx`, `src/contexts/auth-context.tsx`). That protects the UI. It does not protect the routes in S1–S10.
- `src/app/simple-login/page.tsx` still writes `manual_session` to `localStorage`. Nothing else reads that key, so it is not a back door. It does `console.log` the Supabase login response, which includes the access token. Remove this page.

`GET /api/settings/ai` returns the saved Gemini key to the logged-in user (and to an admin for another user id). That matches a settings screen, and it means a phished staff session also steals the key. Prefer “key is set” on GET, and a write-only POST.

### S12. XSS, injection, CORS, headers, rate limits

**XSS — Medium.** Two pages render AI text as HTML:

- `src/app/public/analysis/[historyId]/page.tsx` around line 201
- `src/app/(main)/opportunities/[id]/analysis/[historyId]/page.tsx` around line 227

Both do `dangerouslySetInnerHTML` after only replacing newlines with `<br/>`. They do not escape `<script>` or `<img onerror>`. The public page loads `document_analysis_history` with the anon key by id. If the open policy in `setup_analysis_history_complete.sql` is live, anyone can read those reports, and a poisoned `ai_feedback` value runs in a staff browser.

**Fix:** render the text as text (React’s normal `{feedback}`), or sanitize with a library. Do not insert raw HTML.

**SQL injection.** Application queries go through the Supabase client (parameterized). No string-built SQL was found in `src/app/api`. This is in good shape.

**CORS.** `src/app/api/public/summary/route.ts` sets `Access-Control-Allow-Origin: *`. The payload is marketing copy, so that is acceptable. `src/lib/marketing-cors.ts` allowlists known sites and also **any** `*.vercel.app` origin. Any Vercel preview on the internet can call the public chat API.

**Headers.** `next.config.ts` sets HSTS, `nosniff`, a permissions policy, and a Content-Security-Policy in **report-only** mode. The policy still allows `'unsafe-inline'` and `'unsafe-eval'`. Middleware sets `X-Frame-Options: DENY` while `next.config.ts` sets `SAMEORIGIN`. Pick one. `images.dangerouslyAllowSVG` is on, with a sandbox on the image optimizer.

**Rate limiting — Medium.** The only limiters are in-memory maps (`src/lib/document-comparison-utils.ts`, 10 seconds per user; `src/app/api/public/chat/route.ts`). On Vercel each instance has its own memory, and a new instance starts empty. They will not stop a determined caller. Public Gemini routes (`maxDuration` 120 or 300 on chat, document demo, document comparison, booking extract) are the cost risk.

**Fix:** Vercel Firewall or a shared store (Upstash, or a Supabase counter) on `/api/public/chat`, `/api/track-awb`, `/api/generate-upload-url`, and `/api/booking/*`. Turn the CSP from report-only to enforcing after you watch the reports for a few days.

### S13. Dependency vulnerabilities (`npm audit`) — High

Audit of production dependencies, from the lockfile, on 27 November 2026:

**4 critical, 20 high, 14 moderate, 6 low (44 total).**

The ones that matter for this app:

| Package | Severity | Why it is here | Fix |
| --- | --- | --- | --- |
| `next` `15.2.6` | Critical | Image-optimizer cache-key confusion and content injection. Fix version reported: `15.5.29`. | Upgrade Next.js on a branch and retest login, uploads, and middleware. |
| `jspdf` `<=4.2.0` | Critical | DoS and a local-file / path issue. Used when the MCP tools build a quotation PDF (`src/lib/mcp/quotation-pdf.ts`). | Upgrade past the advisory. |
| `xlsx` `0.18.5` | High | Prototype pollution and ReDoS. **No fix is published.** Imported on the dashboard (`src/app/(main)/dashboard/page.tsx`). | If the dashboard only **writes** spreadsheets, keep the library off any “open an uploaded Excel” path. Longer term, switch export to a maintained library. |
| `@modelcontextprotocol/sdk` | High | Cross-client data leak; DNS-rebinding protection off by default. | Upgrade. See S9. |
| `form-data`, `proxy-addr` | Critical | Transitive. `npm audit` reports a fix. | `npm audit fix` where it stays inside the current major versions. Review the diff. |
| `sharp` | High | Not imported by `src/`, but present. Next’s image optimizer can use it. | Upgrade to the patched `0.35.x` only after checking the Next.js peer range, or remove it if production images work without it. |

`npm audit fix` will not clear the list. `xlsx` has no fix. `zod` and `sharp` want a new major. Do the Next.js bump as its own change so a break is easy to see.

---

## 2. Performance

### P1. Staff screens load entire tables in the browser — High

The staff UI is almost all `'use client'` pages that call Supabase directly. There is no page size.

| Location | What it loads |
| --- | --- |
| `src/app/(main)/opportunities/page.tsx` | All opportunities, with nested quotations and document counts. |
| `src/app/(main)/dashboard/page.tsx` | Unbounded quotation and opportunity reads, then draws charts. Also imports `recharts` and `xlsx` up front, so the dashboard JavaScript is heavy even before the data arrives. |
| `src/lib/db.ts` `getQuotations` | `select('*')` with no limit. The signature image is stripped in JavaScript **after** the download. |
| `src/app/(main)/document-submissions/page.tsx` | Pages through document submissions 1,000 rows at a time until the table is empty. |
| `src/app/(main)/calendar/page.tsx` | `select('*')` for the user’s quotations. |
| `src/lib/packing-list-db.ts` `getPackingListWithDetails` | One extra query per pallet for its products (N+1). `createPackingList` inserts pallet lines one by one. |
| `src/lib/qc-db.ts` | QC request lists with no limit. |

**What can go wrong:** the app feels fine with a few dozen shipments and gets slow, then times out, as history grows. Every row is also a bigger blast radius if a browser session is stolen, because the browser holds the data.

**Fix:** one server route or RPC per screen that returns a page of rows (for example 50) and only the columns the table shows. Load charts and the Excel exporter with `next/dynamic` so they are not in the first dashboard download. Aggregate totals in SQL (`count`, `sum`) instead of downloading every quotation to add them up.

### P2. AWB tracking pulls every open airway bill, then filters in JavaScript — Medium

**Files:** `src/lib/awb-tracking/service.ts` `listAwbsToTrack` (around line 278), `src/app/api/awb-tracking/route.ts`, `src/lib/mcp/register-tools.ts`

`vercel.json` has **no cron**. Nothing in the repo refreshes tracking on a schedule. Tracking runs when a person or the MCP bot calls it.

`listAwbsToTrack` selects every quotation that has an AWB and `delivered_at` is null, then drops rows whose opportunity stage is too early and whose date is outside the window (default 30 days). The database still sends the full open-AWB set.

Indexes that **do** exist in `migrations/`: `share_token`, `booking_share_token`, `booking_view_token`, `awb_normalized`, `customer_user_id`, and a partial index on undelivered AWBs (`migrations/023_awb_tracking_delivered.sql`). There is **no index on `quotation_no`**, which staff screens and MCP use to find a shipment by OMG number.

**Fix:** add `create index if not exists idx_quotations_quotation_no on quotations (quotation_no);`. Move the stage and date filters into the query (or a SQL function). If tracking should run unattended, add a Vercel Cron that calls the staff route with a server secret, with a small batch size.

### P3. Caching and heavy functions — Medium

Marketing news uses `unstable_cache` and `revalidate = 3600` (`src/lib/newsroom-data.ts`). Most of the logged-in app is dynamic on purpose.

These routes set `maxDuration` of 120–300 seconds and call Gemini: `api/public/chat`, `api/public/document-demo`, `api/document-comparison/analyze`, `api/portal/document-check`, `api/booking/[token]`, `api/social-artwork/generate`. A long function is fine for a document the user asked to read. It is expensive if S8’s public routes stay open.

`src/app/api/mcp/route.ts` pulls in the whole tool registry (about 1,160 lines) plus PDF generation, so the MCP function is a large cold start. That is acceptable for an internal bot. It should not be imported by public pages.

**Fix:** leave CRM data uncached. Cache reference data that rarely changes (destinations, document-type labels). Keep Gemini calls behind the auth and rate limits above.

### P4. Libraries that make the browser bundle large — Medium

| Library | Where | Note |
| --- | --- | --- |
| `recharts`, `xlsx` | Dashboard, analytics | Load only when the chart or export is opened. |
| `remotion`, `@remotion/player`, `@remotion/web-renderer` | Social artwork video | Heavy, and isolated to that feature. Keep it out of the main layout. |
| `react-simple-maps` | Maps | Already loaded with `dynamic()`. Good. |
| `html2canvas`, `@react-jvectormap/core`, `@react-jvectormap/world` | In `package.json` | No import under `src/`. Safe to remove after a search. |
| `openai` | In `package.json` | No import under `src/`. The app uses `@google/genai`. |
| `canvas` | In `package.json` | No import under `src/`. It is a native module and slows installs. Confirm nothing in `scripts/` needs it before removing. |

`next.config.ts` only optimizes imports for `lucide-react` and Radix icons.

---

## 3. Structure and maintainability

### M1. How big the code is

Counted with `wc` on `src/` (`.ts`, `.tsx`, `.js`, `.css`), excluding dependencies:

| Area | Lines |
| --- | ---: |
| `src/` total | 80,473 |
| `src/app` | 41,760 |
| of which `(main)` staff app | 21,819 |
| of which `(customer)` portal | 6,174 |
| of which `api` | 5,233 |
| of which `(marketing)` | 4,073 |
| `src/components` | 19,713 |
| `src/lib` | 17,861 |

Largest files:

| Lines | File |
| ---: | --- |
| 2,915 | `src/app/(main)/shipping-calculator/new/page.tsx` |
| 2,349 | `src/lib/db.ts` |
| 1,639 | `src/app/(main)/shipping-calculator/page.tsx` |
| 1,562 | `src/app/(customer)/portal/shipments/[id]/page.tsx` |
| 1,455 | `src/app/(main)/dashboard/page.tsx` |
| 1,452 | `src/app/(main)/packing-list/page.tsx` |
| 1,204 | `src/app/(customer)/portal/quotations/new/page.tsx` |
| 1,161 | `src/lib/mcp/register-tools.ts` |
| 1,137 | `src/app/(main)/document-submissions/page.tsx` |
| 1,042 | `src/components/opportunities/kanban-card.tsx` |

**What can go wrong:** a change to rates or documents means reading a file the size of a short novel. Bugs hide, and the same rule gets copied into the portal and the staff screen.

**Fix (after the security items):** split by feature, not by a new framework. Pull data loading out of the page into one function per screen. Split the calculator page into the form, the rate table, and the save action. Leave `src/lib/db.ts` as a facade only once the new functions exist. Do this one screen at a time.

### M2. `node_modules` is committed — High

`.gitignore` ignores `/node_modules` at the repo root only. `mcp-node-server/node_modules` is **tracked: 3,054 files**. The repo has 3,784 tracked files, so most of the git history weight is dependencies of an old MCP experiment.

**Fix:** add `mcp-node-server/node_modules/` to `.gitignore`, remove those files from the index (`git rm -r --cached mcp-node-server/node_modules`), and commit that deletion as its own change. You do not need to rewrite history for this.

### M3. Duplicated and dead pieces — Medium

- **Several Supabase clients:** `src/lib/supabase.ts` (browser, anon key), `src/lib/supabase/server.ts` (service role), `src/lib/customer-query-client.ts`, `src/lib/api-auth.ts`, plus extra `createClient` calls in packing-list, newsroom, and AWB routes. Two is enough: browser anon, server service-role. New routes should call `requireApiUser` instead of copying the header parsing.
- **Freight rates page is a mock:** `src/app/(main)/settings/freight-rates/page.tsx` keeps `initialRates` in React state (Australia and other sample countries). The real screens are `src/app/(main)/settings/freight-rate/` (singular) and they use the database. Staff can edit the mock page and think rates were saved.
- **Root clutter:** `tsc_output.txt` (a TypeScript log), `ai-doc-review-main/` (a nested app, excluded from `tsconfig.json`), and about **42** SQL files in the repo root (`fix_*.sql`, `create_*.sql`, `database-schema.sql`).
- **PDF:** three generators (`src/lib/mcp/quotation-pdf.ts`, `src/lib/packing-list-pdf.ts`, chart export). They serve different documents. Not worth merging.

**Fix:** delete the mock freight page or redirect it to the real one. Delete `tsc_output.txt`. Decide whether `ai-doc-review-main` and `mcp-node-server` are still used; if not, move them out of this repo.

### M4. SQL has three homes and they disagree — High

| Location | Files | Role |
| --- | ---: | --- |
| `supabase/migrations/` | 5 | What the Supabase CLI would run |
| `migrations/` | 57 | The real history of the product, applied by hand |
| Repo root `*.sql` | 42 | One-off fixes, including scripts that reopen public access |

There is no record in git of which root script was pasted into production. That is why S3 has to be confirmed in the dashboard.

**Fix:** treat `supabase/migrations/` as the only place new SQL goes. Copy the **current live policies** (from the `pg_policies` query) into one new migration named for what you intend, such as “lock quotations to owner, staff, and a token function.” After that migration is applied, move the root scripts to a folder named `sql-archive/` and add a first line: `-- ARCHIVED. Do not run. Superseded by supabase/migrations.`

### M5. Types and tests — Medium

`tsconfig.json` has `"strict": true`. Explicit `any` in `src/` is rare (about five spots, mostly in `src/lib/db.ts`). That is a real strength.

There are **no** project test files (`*.test.ts` / `*.spec.ts`). `package.json` has `verify:*` scripts (booking draft, AWB delivered, quotation create, document swap, and others). Those are manual checks, not a test run in CI. Nothing fails the build if a future edit removes the login check on an API route.

**Fix:** one small test file is enough to start. Call the route handlers for `get-signed-url`, `delete-file`, `confirm-upload`, and `cancel-quote-request` with no `Authorization` header and expect 401. That locks S1, S2, and S10. The existing `verify:*` scripts can stay as manual checks.

### M6. Folder layout — Low

Route groups are clear: `(main)` staff, `(customer)` portal, `(marketing)` public site, `(public)` token pages, `app/api` HTTP. The hard part is that business rules live in all of `src/lib/db.ts`, `src/lib/customer-db.ts`, `src/lib/mcp/*`, and the pages themselves. MCP is a second backend beside the REST routes, and both talk to the same tables with the service role.

**Fix:** when you touch a flow (booking, quotation create, document upload), put the permission check and the database write in one function, and call that function from both the page’s API route and the MCP tool. `src/lib/mcp/create-quotation.ts` is already close to this. The upload routes are not.

---

## What is already in good shape

- The service-role key is not in the browser bundle, and it is not in git history as a JWT.
- `.env` files are gitignored. `.env.example` has empty placeholders.
- Newer routes use `requireApiUser` / staff / admin checks, and those checks call `auth.getUser(token)` rather than trusting a decoded JWT.
- The LINE webhook verifies HMAC when the channel secret is set, using a timing-safe compare.
- The newsroom publish route refuses to run without `OMG_AGENT_TOKEN`.
- The MCP HTTP route refuses to run without `MCP_API_TOKEN`.
- TypeScript strict mode is on.
- Lookup columns for share tokens, booking tokens, AWB, and `customer_user_id` have indexes in `migrations/`.
- HSTS and `X-Content-Type-Options: nosniff` are set.
- Marketing news pages are cached; the staff app is dynamic, which is appropriate for private data.

---

## Step-by-step cleanup

Do these in order. Each step is a small change you can deploy on its own. Stop if a step breaks a real customer flow, and fix that flow with a token or a login rather than by reopening the route.

1. **Rotate the Typhoon key** in the provider dashboard. Delete the value from `AI_SETUP_GUIDE.md`. In Vercel, confirm no secret uses a `NEXT_PUBLIC_` name. This does not require a code deploy to take effect on the provider side.
2. **Close the file APIs (S1).** Add the shared permission check to `get-signed-url`, `delete-file`, and `generate-upload-url`. Deploy. Try a download from a logged-out browser; it should fail. Try from a staff session; it should still work.
3. **Close the write APIs (S2, S10, S8).** Auth on `confirm-upload`, `confirm-company-document`, `upload-shipment-photo`, `cancel-quote-request`, `cms/upload`, `social-artwork/library`, `marketing/rebuild`, and the notify routes. Re-test onboarding, the customer document upload page, and shipment photos with a real token.
4. **Telegram and LINE (S5, S6).** Set the Telegram webhook secret and reject unsigned calls. Make LINE fail closed when its secret is missing.
5. **See the live database (S3).** Run the `pg_policies` query. Drop the two “any row with a token” policies and any `USING (true)` policy on `quotations`, `opportunities`, `companies`, `document_analysis_history`, and storage. Re-test the public quotation link, the tracking link, and a staff login. If staff suddenly see an empty list, add a staff policy (`profiles.role in ('staff','admin')`) instead of turning RLS off.
6. **Shrink the booking payload (S4).** Stop signing every document. Lock `filePath` on AWB extract to that quotation.
7. **Upgrade dependencies (S13).** Bump Next.js to the patched 15.5.x, bump jsPDF, upgrade the MCP SDK, and run `npm audit` again. Keep SheetJS away from untrusted uploads.
8. **Untrack `mcp-node-server/node_modules` (M2)** and archive the root SQL files after step 5 has been copied into `supabase/migrations/` (M4).
9. **Stop loading whole tables (P1, P2).** Paginate opportunities, the dashboard, and document submissions. Index `quotation_no`. Filter AWB tracking in SQL.
10. **Leave a safety net (M5).** Add the four “logged-out request gets 401” checks, then split the shipping-calculator page and `db.ts` only as you next change those screens. Remove the mock freight-rates page, `simple-login`, and unused packages (`html2canvas`, jvectormap, `openai`) once you have confirmed nothing imports them.

Steps 1–4 are the ones that reduce real exposure. Steps 5–6 close the database and the email links. Steps 7–10 make the project smaller and safer to change. Splitting files before the routes are locked would spend the effort in the wrong place.

---

## Short answers to the questions in the request

| Question | Answer |
| --- | --- |
| Leaked secrets in code or history? | One Typhoon API key in `AI_SETUP_GUIDE.md`, present since the first commit. No `.env` committed. No service-role JWT found in history. |
| Can a logged-out caller read or change bookings, quotations, or prices? | Yes. File routes and several write routes are open. Price rows are open if the SQL policies in this repo are what production is running. |
| Service-role key in the browser? | No. It is used on the server, including on routes that do not check who is calling. |
| Public `/booking/<token>` | The token is required. The response includes every document download link and shipment identity fields. The edit token can confirm the booking. |
| File upload and storage | Presign, confirm, and delete routes do not check the caller. Some SQL grants public read/write on a storage bucket. |
| Webhook signatures | LINE: checked when the secret is set, skipped when it is not. Telegram: not checked. Outbound webhooks in `src/lib/webhooks.ts` send a bearer secret when `WEBHOOK_SIGNING_SECRET` is set. |
| Injection / XSS | No SQL injection found. AI feedback is inserted as HTML in two analysis pages. |
| CORS | Marketing summary is `*`. Chat allows listed sites and any `*.vercel.app`. |
| Rate limiting | In-memory only, and only on chat and document comparison. Ineffective across serverless instances. |
| `npm audit` | 4 critical, 20 high, 14 moderate, 6 low. Next.js, jsPDF, and SheetJS are the ones to act on. |
| Slow queries and indexes | Large unbounded reads from the browser. Token and AWB indexes exist. `quotation_no` is not indexed. AWB batch filtering happens in JavaScript. |
| Cron | None in `vercel.json`. Tracking is on demand via the staff API and MCP. |
| Size | ~80k lines in `src/`. Largest file 2,915 lines. |
| Tests | No unit tests. Manual `verify:*` scripts only. |
| Migrations | 5 CLI migrations, 57 hand migrations, 42 root SQL scripts, and they contradict each other. |
