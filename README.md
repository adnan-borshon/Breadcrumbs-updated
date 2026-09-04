# Breadcrumbs

A private, permissioned, custom-built hash-chain for garment supply chains — covering factory
audits, materials and chemicals, contracts, invoices, transactions and payments on one ledger.

Every entry is signed on the submitter's own device, hashed onto the block before it, and checked
by a small anomaly model before it is committed. Altering anything afterwards breaks the chain in
a way anyone can verify from the browser.

The interface is built to answer three questions on every screen:

> **who submitted this record, has it been altered, and did a person review it?**

---

## Running it — development

Requires **Node 20.19+**. Nothing else — no database server, no compiler toolchain.

```bash
npm install
npm run dev
```

- Web app — <http://localhost:5173>
- API — <http://localhost:3001>

`npm run dev` runs two **development** servers: Vite's dev server for the web app (unbundled,
hot-reloading) and `tsx watch` for the API (restarts on every file change). Both are correct and
complete for local use — this is the one command you need — but neither is what you'd run behind
real traffic. See [Running it — production](#running-it--production) for that.

The first start lays down a 90-day demo history (165 blocks across four factories) automatically,
the moment the API notices the ledger is empty. Every one of those blocks is genuinely signed and
hashed; nothing is fixture data pasted into a table.

Everything below is optional — the app runs correctly without any of it:

| Command | What it does | Why you'd run it |
| --- | --- | --- |
| `npm test` | 57 tests — chain, signatures, permissions, AI rules, projections | Before trusting a code change. Doesn't run itself, and skipping it never stops the app running. |
| `npm run typecheck` | `tsc --noEmit` across all three packages | Same — a static check, not part of runtime. Vite and `tsx` transpile regardless of type errors. |
| `npm run db:reset` | Wipes the ledger and re-lays the demo history | To get back to a clean demo after using the Integrity Lab's tamper button, without restarting the server. |
| `npm run db:migrate` | Creates tables if they don't exist (idempotent) | Not needed manually — `npm run dev` / `npm start` do this on boot. |

## Running it — production

`npm run dev` is a development mode and should not be what serves real traffic. For a live
deployment, build the web app and run the API without its file-watcher:

```bash
npm run build                          # apps/web/dist — minified, hashed filenames
npm run start -w @breadcrumbs/api      # tsx src/server.ts, no watch/restart-on-change
```

`apps/web/dist` then needs serving by an actual static file server (nginx, a CDN, any static
host) with `/api` proxied through to the API process — which is exactly what the Docker setup
below does. That compose file **is** the production path; it has not been run end-to-end on the
machine this was built on because Docker isn't installed there, so treat it as built-but-unverified
rather than proven.

### Docker

```bash
docker compose up --build     # web on :8080, API behind it on the same origin
```

Boots the API (with the ledger persisted in a named volume so restarts don't lose it) and an
nginx container serving the built web app, `/api` proxied through to the API. Same auto-seed
behaviour as running the API directly — an empty ledger gets the demo history on first boot.

---

## Signing in

No passwords — pick an identity. Everything after that point is enforced for real.

| Role | Sign in as | Can commit |
| --- | --- | --- |
| Factory | Rashida Akter · Imran Hossain · Nusrat Jahan · Tanvir Rahman | Audit records, stock movements, invoices, counter-signatures |
| Auditor | Farhana Chowdhury · Michael Osei | Confirm / dispute flagged records — nothing else |
| Brand | Lena Bergström · Diego Marques | Contracts, invoice approval, payments |

On first sign-in your browser generates an ECDSA P-256 keypair. The private half is created
**non-extractable**, so it has no serialisable form and cannot leave the device even if this code
tried to send it. Only the public JWK is registered with the server.

---

## The five things worth demonstrating

**1 — Break the chain.** Explorer → *Integrity lab* → tamper with a block → *Verify chain
integrity*. The altered block fails on both its hash and its signature, and every block after it
is marked invalidated. Pick an inventory receipt and the derived stock level visibly shifts too —
tampering does not stay contained to the row it touched. *Restore clean ledger* puts it back.

**2 — Watch a forgery bounce.** The server holds no private keys, so it can check a signature but
never produce one. A record altered between signing and submission is refused with
`bad_signature`, and nothing is written.

**3 — Prove the numbers come from the chain.** *Integrity lab* → *Rebuild projections from chain*.
Every stock level, invoice balance and contract status in the app is dropped and recomputed from
the blocks alone. If nothing moves, they were genuinely derived.

**4 — Trip the anomaly checks.** Sign in as Rashida Akter and submit a production report with
~35,000 units against a ~10,000 baseline. It commits, flags with a real z-score, and appears in
Farhana Chowdhury's review queue. Four such anomalies are already in the seeded history:

| Record | Caught by |
| --- | --- |
| `FAC-MEGHNA-PR-SPIKE` | Output 3.4× the factory's own average |
| `FAC-ASHULIA-CC-OFFBALANCE` | Dye per unit 3.8× normal — undeclared production or undeclared chemicals |
| `INV-ASH-0221-ISSUE` | Duplicate invoice, same value two days apart |
| `INV-CTG-0325-ISSUE` | Cumulative billing at 117% of the contract value |

**5 — Follow the money.** Contract → invoice → payment, each a signed block. Contract value,
invoiced total, settled, in-flight and outstanding all reconcile because they are folded from the
same events.

---

## How it is built

```
packages/shared/     types · chain · AI · zod schemas   ← imported by BOTH sides
apps/api/            Hono · Drizzle · SQLite (libsql)
apps/web/            React 19 · Vite · Tailwind v4
```

`crypto.subtle` is identical in Node 20 and in every browser, so canonicalisation, hashing,
signing and verification are written **once** in `packages/shared` and imported by both sides with
no environment branching. The client and server cannot disagree about what a block hashes to.

### Two rules everything else follows from

> **The chain is append-only. Nothing is ever mutated or deleted.**
> **All state is derived by folding the chain.**

Stock levels, invoice balances and contract status are not editable columns — they are projections
replayed from ledger events. An auditor's confirm or dispute is itself a signed block, not a status
update, which is how "records are never deleted" becomes structural rather than a promise.

There is exactly **one write path**: `POST /api/chain/commit`. Audit records, stock movements,
contracts, invoices, payments and review decisions all travel through it, so these checks apply
uniformly:

| # | Check | Rejected with |
| --- | --- | --- |
| 1 | Role may submit this event type | `403 forbidden_event_type` |
| 2 | Signed identity matches the bearer token | `403 identity_mismatch` |
| 3 | Factory user is writing to their own factory | `403 wrong_factory` |
| 4 | `data_fields` match the schema, unchanged by parsing | `400 invalid_data_fields` |
| 5 | Signing key is registered to that identity | `401 unknown_key` |
| 6 | Signature verifies | `401 bad_signature` |
| 7 | `event_id` is unused | `409 duplicate_event` |
| 8 | Domain preconditions hold | `422` |
| 9 | AI check runs — **flags, never blocks** | — |
| 10 | Block is hashed onto the head and appended | — |

Step 4 is subtler than it looks: the signature covers the exact bytes submitted, so the server
refuses a record whose `data_fields` would *change* under schema parsing rather than silently
normalising it into something the signature no longer covers.

### Event taxonomy — one chain, six families

| Family | Events |
| --- | --- |
| `audit` | inspection · production report · certification · shipment |
| `inventory` | material receipt / issue · chemical receipt / consumption / disposal · stock adjustment |
| `contract` | created · signed · amended · closed |
| `invoice` | issued · approved · disputed · settled |
| `payment` | initiated · settled · failed |
| `governance` | review confirmed · review disputed |

### The AI layer

Seven pure rules, one file, ~5% of the codebase — deliberately small, and deliberately advisory.
A flagged record still goes on the chain and is routed to an auditor, because dropping records
would defeat the point of an immutable ledger.

`production_volume_zscore` · `working_hours_zscore` · `invoice_exceeds_contract` ·
`duplicate_invoice` · `chemical_mass_balance` · `payment_mismatch` · `negative_stock`

Statistical rules refuse to guess on thin data: fewer than three prior records and the result is
an explicit *"insufficient history"* rather than a silent pass.

---

## Design

Palette, type and surface treatment follow the brief exactly: deep navy `#0F2540`, warm off-white
`#F7F5EF`, muted gold `#C9A24B` for trust cues, teal `#1D6E63` for verified, and soft red
`#B23A2E` reserved **only** for flagged and tampered states — so red always means one thing.
Lora for headings, Inter for UI, IBM Plex Mono for anything cryptographic.

Deliberately a single light theme: the warm ground is what makes this read as a compliance
dashboard rather than a crypto app, and a dark variant would undo it.

- Status is always **colour + icon + label**, never colour alone — it survives greyscale.
- Hashes and signatures are muted, monospace and middle-truncated by default; detail is opt-in.
- One solid navy primary action per screen.
- Cards for records; dense tables only where scanning matters.
- Mobile-first on the public lookup, where buyers arrive by QR scan.
- Route transitions use the View Transitions API, behind `prefers-reduced-motion`. No animation
  library — CSS does it in a fraction of the bytes.

---

## Known limits

This is a working system, not a production deployment. Specifically:

- **Login is mocked.** Choosing an identity issues a real JWT with no credential check. Everything
  downstream of the token is enforced; the front door is not.
- **One writer.** Appends are ordered by an in-process lock, which is correct for a single API
  process and would need a database-level lock to scale out.
- **Seed keys are generated then discarded.** The seeder signs historical fixtures on behalf of
  seeded identities and throws those private keys away; only public halves persist. Signing in as
  one of those identities registers a fresh key for your browser.
- **The demo tamper endpoint is real.** `POST /api/admin/tamper` genuinely corrupts a block. Set
  `BREADCRUMBS_ADMIN_TOOLS=false` to remove that whole group.
- **Chemical restricted-substance data is illustrative.** The CAS numbers and MRSL flags are
  realistic but are demo fixtures, not a maintained compliance dataset.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `BREADCRUMBS_DB` | `apps/api/data/breadcrumbs.db` | Ledger file |
| `BREADCRUMBS_JWT_SECRET` | dev secret | **Must be set in any real deployment** |
| `BREADCRUMBS_ADMIN_TOOLS` | `true` | `false` removes tamper / restore / rebuild |
| `BREADCRUMBS_SEED_ON_EMPTY` | `true` | Seeds only when the ledger has no blocks |
