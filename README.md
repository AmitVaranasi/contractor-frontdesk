# Front Desk Co. — an AI-run phone receptionist for independent contractors

A cleaner or plumber can't answer the phone from under a sink. Front Desk Co. gives them a phone number that a voice agent answers: it gives business details, quotes from the owner's prices, **negotiates within the owner's limits**, and books real appointment slots. The owner uses a web portal to set up the business, edit details and see what has been booked.

Behind the line is a five-agent company (hackathon requirement): **Maya (CEO)**, **Leo (COO)**, **Nia (CFO)**, **Arun (CTO)** and **Sam (Front Desk)**.

> Demo businesses (Sparkle Clean Co., FlowRight Plumbing), their websites, prices and customers are fictional fixtures. Bookings, calls and costs shown in the portal are real application records.

## How a call works

```
Caller ── dials free Vapi number ──► Vapi (speech, turn-taking, Claude on Vapi credits)
                                        │  assistant-request (on every call)
                                        ▼
                           POST /api/vapi  (x-vapi-secret checked)
                           → assistant built from the owner's CURRENT active profile
                                        │  tool-calls during the call
                                        ▼
  get_business_info · get_quote · negotiate_price · list_available_times · book_appointment · take_message
                                        │
                  deterministic server code: price rules, negotiation floor, slots,
                  transactional booking (idempotent), tenant bound to the call
                                        ▼
            SQLite: inquiries, quotes, bookings, calls ──► owner portal + n8n follow-up
```

The voice model never computes a price, discount or slot. It can only call tools; the server enforces the owner's rules.

## The owner portal

| Page | What the owner does |
|---|---|
| **Dashboard** `/` | Upcoming bookings (customer, time, type, ZIP), recent calls with summary/recording/transcript, requests that need them |
| **Business setup** `/setup` | First time: submit intake → agents research the website, cost the plan, validate → owner confirms open questions and approves. Afterwards: edit name, hours, ZIPs, prices, extras, **negotiation limits** (max %, floor, step, weekday-only). Each save is a new version the CTO validates before it goes live. |
| **Phone line** `/phone` | Connect the Vapi number, choose which business it answers for, **test call in the browser**, or run a free text/voice practice call against the same engine |
| **Your AI team** `/team` | The five agents with avatars and voices: handoffs, decisions, tool evidence, follow-ups, agency cost ledger |

## Negotiation

The owner sets, per service: max discount %, a "never below" base price, a concession step %, and whether discounts are weekday-only. Sam starts at list price and concedes one step per round. It never goes below `max(list × (1 − max%), floor + add-ons)`, gives a final price after three rounds, and never reveals the limits. A negotiated quote carries its conditions, and booking rejects a weekend slot for a weekday-only price. See `lib/policy/negotiation.ts` and `tests/phone.test.ts`.

Example (Sparkle Clean, $145 list, 10% / $110 floor / 5% step): offer $120 → counter $137.75 → offer $120 again → final $135.00.

## Sponsor tools and what each does here

| Sponsor | Role in the product | Without its key |
|---|---|---|
| **RocketRide** | Runs the executive agents' reasoning (`pipelines/agent-llm-flatkey.pipe`: chat → OpenAI-compatible node → Flatkey; or `agent-llm.pipe` with the Anthropic node) | next provider |
| **Flatkey** | Claude model access for the RocketRide pipeline, plus a direct failover | deterministic rules |
| **Masky** | Faces and voices for the five agents (`npm run masky:setup` generates portraits, creates avatars and picks voices) | browser speech + captions, labelled |
| **Celesto** | CTO runs an independent Python validator on every profile version, and the full test suite from GitHub, in a sandbox | local validator only, labelled |
| **n8n** | Booking → customer confirmation draft + contractor task (`n8n/followup-workflow.json`) | internal follow-up queue |
| **Snyk** | Dependency + code scans (`npm run security`, CI) | `npm audit` |
| **PromptQL** | `/api/wiki`: markdown operations wiki generated from live data, for the team's shared workspace (manual export) | — |
| Vapi *(not a sponsor)* | Phone number, speech, voice model. Chosen because it is the free option: one free US number + trial credit | practice call in portal |

## Run it

```bash
npm install          # .npmrc sets legacy-peer-deps (npm 10.9 peer-resolution crash)
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Everything works offline with the rules fallback. Then connect services in this order:

1. **Phone (Vapi):** create an account, add `VAPI_API_KEY`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and a random `VAPI_SERVER_SECRET`.
   - `brew install cloudflared && npm run tunnel` → copy the `https://….trycloudflare.com` URL to `PUBLIC_BASE_URL`, then restart `npm run dev`.
   - In the Vapi dashboard: Phone Numbers → Create → **Free Vapi Number**.
   - In the portal: set up and approve a business, then Phone line → "Answer calls for …".
   - `npm run phone:setup` routes the number to `/api/vapi`; add the printed `VAPI_PHONE_NUMBER` to `.env.local`.
   - Call the number.
2. **Masky:** `MASKY_API_KEY`, then `npm run masky:setup` and paste the printed `MASKY_AVATAR_*` lines.
3. **RocketRide + Flatkey:** `ROCKETRIDE_APIKEY`, `FLATKEY_API_KEY`, `FLATKEY_MODEL`.
4. **Celesto:** `CELESTO_API_KEY` (+ `CELESTO_REPO_URL` once the repo is public).
5. **n8n:** import `n8n/followup-workflow.json`, set its `FRONTDESK_SECRET` env, then put its webhook URL in `N8N_WEBHOOK_URL` and the same secret in `N8N_WEBHOOK_SECRET`.

## Three-minute demo

1. **Setup (40s):** Business setup → Sparkle Clean → "Set up my business". Listen as Leo flags two website contradictions and a hidden prompt-injection line. Nia rejects the "unlimited" plan (37% margin), Maya picks Pro, and Arun rejects unconfirmed website prices. Leo fixes them. Owner ticks the oven extra and approves.
2. **Edit (20s):** set negotiation to 10% / $110 floor / weekday only → Save & go live (v5, validated).
3. **Call (80s):** phone the number (or "Test call in browser"). Ask for a 2-bed/1-bath clean with the oven in 94110 → $145. Ask for $120 → $137.75 → accept → book Thursday 8 AM, give a name.
4. **Plumber (20s):** switch the line to FlowRight. "Sink leaking, how much?" → assessment only, $89 fee, no repair estimate, and no haggling.
5. **Proof (20s):** Dashboard shows the booking + call summary. Your AI team shows the ledger (job value ≠ agency revenue), follow-up, sandbox and validation evidence.

## Engineering checks

```bash
npm run check        # eslint + tsc + vitest (33 tests) + next build
npm run security     # npm audit + snyk test + snyk code test → evidence/
```

Tests cover the $145 quote, missing facts, out-of-area/exclusions, plumber assessment, slot conflicts, idempotent retries, stale-policy and expired quotes, follow-up reconciliation, tenant isolation, tool permissions, SSRF blocking, onboarding loop, negotiation floor/steps/weekday rule, phone tool flow, webhook auth, call-tenant binding, and owner-edit validation.

**Security findings (real, from this build):**
- `npm audit` at scaffold time showed 8 issues, including a critical tinypool RCE gadget and a moderate vitest path traversal, both pulled in through vitest 3. Fixed by upgrading to vitest 4.1.12 (`evidence/npm-audit-before.json` → `-after.json`).
- 5 high-severity findings remain in the `braces → micromatch → fast-glob → eslint-config-next` chain. The advisory covers every `braces` version, so no fix exists upstream. It's a lint-time DoS in dev tooling; runtime dependencies audit clean (`npm audit --omit=dev`: 0). Accepted and tracked.
- Code review fixes made during the build: the browser test-call endpoint first returned the full assistant config including the webhook secret. It now returns only a saved assistant ID, and the config stays server-side. Call tenant is bound at call start and can't be moved by later events. Research fetches block private/loopback addresses.

## Limits (honest)

- Portal has **no login** yet; run it locally or behind auth before real use.
- One free Vapi number serves one business at a time (switchable). Real deployments give each contractor their own number.
- SQLite file storage; fine for a single-process demo, swap for Postgres to deploy serverless.
- Calendar is internal (one crew resource), not Google Calendar.
- Agency subscription billing is not implemented; projected plan revenue is never shown as cash.
