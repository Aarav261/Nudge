# Nudge on Base44 — Architecture

Tech stack and high-level flow for the hackathon build. Each component gets its
own plan in this folder when we build it.

Status: the app is live at <https://nudge-7850d0c4.base44.app>, app ID
`6ae54349fde0a05b7850d0c4`. This doc was updated on 2026-10-31 to match the real
Base44 template, and test results are in
[01-foundation.md](01-foundation.md#results).

This replaces [Backend_architecture.md](../Backend_architecture.md) for the
hackathon. The Azure stack is not used.

---

## Key decisions

1. **The Base44 app is the product.** It holds the CRM, memory, drafting,
   follow-ups and money tracking, and works on its own at the public link.
2. **The extension only captures.** It saves leads and context to the app. It
   does not draft or send.
3. **The app is built on Base44, not developed locally and deployed.** We use
   the editor, or the Base44 MCP server from Claude Code. The submission needs
   the app ID, dated Version history and the editor, and ejecting creates a new
   app ID. The code lives on Base44, not in this repo.
4. **Manual sending is the default, and Gmail is an upgrade.** Copying the
   message or opening it in a mail app has to work for everyone, because Gmail
   will only work for people we add by hand (see [Email](#email)).
5. **Follow-ups never send themselves.** The agent prepares them and a person
   approves each one.

---

## Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | TanStack Start, hosted by Base44 | React 19 and plain JavaScript, server rendered, with shadcn/ui |
| Auth | Base44 login, with our own auth pages | Every signed-in user is one business |
| Database | Base44 entities | JSON Schema, with row-level security rules |
| Backend logic | TanStack server functions and server routes | Run on Cloudflare Workers, not Deno |
| Scheduled jobs | Base44 workflows | A scheduled trigger calls a server route with `invoke_server_route` |
| LLM | TanStack AI on the Base44 AI gateway | Returns JSON from a zod schema, and needs no API key |
| File reading | Built-in `ExtractDataFromUploadedFile` | Company Memory uploads |
| Email to users | Built-in `SendEmail` | The daily digest only, never outreach |
| Outreach email | Gmail app user connector | Each user connects their own Gmail |
| Payments | Stripe | Two separate uses, see [Money](#money) |
| Capture | Existing Plasmo extension | Calls one public server route |

**Dropped from the old architecture:** Azure Functions, API Management, Cosmos
DB, Blob Storage, the Python NER service, Twilio and the integrations layer.
The extension's regex classifier is enough for capture, and the user corrects
any mistakes in the app.

**Plan needed:** Builder or higher, for connectors, Stripe, the MCP server and
GitHub sync. Third-party guides put it at about $40–50 a month. Check
base44.com/pricing before paying.

---

## System overview

```
┌──────────────────┐
│ Plasmo extension │  optional
│ capture only     │
└────────┬─────────┘
         │ POST with capture token
         ▼
┌─────────────────────────────────────────────────────────┐
│                       Base44 app                         │
│                                                          │
│  ┌──────────────────┐   call      ┌───────────────────┐  │
│  │ React frontend   │────────────▶│ Server functions  │  │
│  │                  │             │ and routes        │  │
│  │ Memory, Leads,   │             │ captureLead       │  │
│  │ Draft + approve, │             │ generateDraft     │  │
│  │ Follow-ups,      │             │ sendMessage       │  │
│  │ Money dashboard  │             │ syncReplies       │  │
│  └────────┬─────────┘             │ prepareFollowUps  │  │
│           │ entity SDK            │ createCaptureToken│  │
│           │ (row-level security)  └───┬───────────┬───┘  │
│           ▼                           │           │      │
│  ┌──────────────────┐                 │           │      │
│  │ Entities         │◀────────────────┘           │      │
│  └──────────────────┘                             │      │
│  ┌──────────────────┐   daily     prepareFollowUps│      │
│  │ Workflow         │─────────────────────────────┤      │
│  └──────────────────┘                             │      │
└───────────────────────────────────────────────────┼──────┘
                       ┌───────────────┬────────────┤
                       ▼               ▼            ▼
                 ┌──────────┐    ┌──────────┐ ┌──────────┐
                 │AI gateway│    │ Gmail API│ │ SendEmail│
                 └──────────┘    └──────────┘ └──────────┘
```

---

## Product flow

```
1 Set up      Sign in → add Company Memory → record revenue baseline
                 │
2 Add lead    Paste, CSV import or extension
                 │
3 Draft       Why you, why them, why now → draft with a source per claim
                 │
4 Approve     User edits and approves ◀───────────────────────┐
                 │                                            │
5 Send        Gmail, or copy and mark as sent                 │
                 │                                            │
6 Follow up   No reply after N days → agent prepares next ────┘
                 │
7 Reply       Detected in Gmail, or marked by hand
                 │
8 Won         Amount recorded → dollars-won dashboard
                 │
9 Learn       Replies and wins become sources for later drafts
```

### 1. Set up

The user adds their profile, offers, past results and sample messages to Company
Memory by paste or upload, and records their revenue before Nudge. That number
is the "before" in the hackathon proof.

### 2. Add a lead

There are three ways in, all creating a `Lead` and its `Snippet`s:

- **Paste** into a form.
- **CSV import**, parsed in the frontend and saved with `bulkCreate`.
- **Extension**, which calls `captureLead`.

### 3. Draft

`generateDraft` loads the whole of Company Memory plus the lead, and asks the AI
gateway for JSON:

```json
{
  "angle": { "why_you": "", "why_them": "", "why_now": "" },
  "subject": "",
  "lines": [
    { "text": "", "kind": "claim", "source_id": "", "quote": "" },
    { "text": "", "kind": "plain" }
  ]
}
```

**"No source, no claim" is enforced in code, not left to the prompt.** The
function checks that each `claim` line's `quote` is found word for word in the
source it cites. In testing, 3 of 30 quotes failed because the model reworded
them, so a failed draft is retried once and any line that still fails is dropped.
The model could still mislabel a claim as `plain`, and the approval step is what
catches that.

Sending all of memory to the model is deliberate. There is no search or vector
store. We add ranking when a real user's memory gets too large for the prompt.

Snippets are text from the open web, so the prompt treats them as data and not
as instructions.

### 4. Approve

The user sees the angle and the draft, and can click a line to see its source.
Nothing leaves without a click here.

### 5. Send

- **Gmail connected:** `sendMessage` sends from the user's account, then stores
  the thread ID.
- **Not connected:** the user copies the message or opens it in their mail app,
  then clicks **Mark as sent**.

Either way, the message is logged and the first follow-up is scheduled.

### 6. Follow up

`prepareFollowUps` is a server route that a daily workflow calls. For each sent
message that has no reply and is past its due date, it drafts the next message
through the same path as step 3 and saves it as `pending_approval`. It then
emails the user a short digest.

### 7. Detect replies

`syncReplies` runs when the user opens the app and checks their stored Gmail
threads. A reply marks the lead as replied and cancels any pending follow-up.
Without Gmail, the user clicks **Mark as replied**.

It can't run in the daily job. Per-user tokens come from
`getCurrentAppUserConnection`, which needs the signed-in user's request, and the
docs list no way to fetch a token by user ID. This costs nothing in practice,
because a person has to open the app to approve anything anyway.

To stop a stale follow-up going out, `sendMessage` checks the thread again
before sending.

### 8. Record the win

The user enters the amount won. The dashboard shows the total, the messages
behind each win, and the before and after against the baseline.

### 9. Learn

A reply or win adds a Company Memory item pointing at the message that worked,
so later drafts can cite it.

---

## Data model

Fields are indicative. Each component plan sets the exact schema.

| Entity | Purpose | Key fields |
|---|---|---|
| `MemoryItem` | Company Memory | `kind`, `title`, `text`, `source_label`, `message_id` |
| `Lead` | One person | `name`, `role`, `company`, `email`, `linkedin_url`, `phone`, `status`, `won_amount`, `won_at` |
| `Snippet` | Saved lead context | `lead_id`, `text`, `source_url`, `source_title`, `captured_at` |
| `Message` | Every draft and send | `lead_id`, `step`, `subject`, `lines`, `status`, `channel`, `gmail_thread_id`, `sent_at`, `follow_up_due_at` |
| `CaptureToken` | Extension access | `owner_id`, `token_hash`, `revoked_at` |

`User` gains `business_name` and `baseline_revenue`.

`Snippet` matches the extension's existing `ContextSnippet` type in
[lib/types.ts](../lib/types.ts).

**Message status:** `draft` → `pending_approval` → `approved` → `sent`, or
`failed` or `cancelled`. A reply is recorded on the sent message.

**Lead status:** `new` → `contacted` → `replied` → `won` or `lost`.

**Account separation:** every entity has an `owner_id`, and its row-level
security rules compare it to `{{user.id}}`. We can't use the usual `created_by`
rule, because `captureLead` and `prepareFollowUps` write as the service role
and not as the user. Testing confirmed this: those rows get a `created_by_id` of
`service_fullstack_serving`. `CaptureToken` denies all client access.

---

## Email

| | Manual | Gmail |
|---|---|---|
| Who can use it | Everyone | Test users we add by hand |
| Sending | Copy or open in mail app | From the user's own account |
| Replies | Marked by hand | Detected when the app opens |
| Setup | None | Google Cloud project and OAuth client |

Sending from each user's own Gmail needs an app user connector, and per the docs
the managed "Let Base44 manage OAuth" option applies to Google Calendar. So we
register our own OAuth client.

Reading threads needs `gmail.readonly`, a restricted scope. Google's verification
can take weeks and may need a yearly security assessment, so we stay in testing
mode for the hackathon. Each Gmail user is added as a test user and sees an
unverified-app warning. From Google's own behaviour rather than the Base44 docs,
testing mode allows 100 test users, and refresh tokens expire after 7 days, so
users may need to reconnect weekly.

`SendEmail` is not used for outreach. It would not come from the user's address.

---

## Extension

```
Highlight → lock contact → gather context → Save to Nudge
                                                 │
       background.ts ── POST /api/capture-lead
                        Authorization: Bearer <capture token>
                                                 │
       hash token → find owner → match or create Lead → add Snippets
```

- The user creates a capture token on `/app` and pastes it into the toolbar
  popup. Each account has one live token, and a new one replaces the old.
- The app stores only a hash of the token, and the user can revoke it.
- `/api/capture-lead` is public, so it validates the token and the payload, and
  limits payload size. The extension cuts long text to fit those limits.
- A lead is matched on email, LinkedIn URL or phone, and otherwise on name. X
  handles go in `name` because `Lead` has no handle field. A repeat capture only
  adds snippets the lead doesn't have, so retrying is safe.
- The call goes from `background.ts`. Its `https://*/*` host permission lets it
  skip CORS, and the app's routes allow any origin anyway.
- The app's personal access token must never go in the extension. It works like
  a password for the whole app.

The compose states in `background.ts` and `compose-popup.tsx` are gone, replaced
by a save action. Highlight detection, the lock, cross-tab context and the popup
all stay.

Status on 2026-10-31: built out of order, ahead of Company Memory and Leads. The
route passed on the preview: bad and revoked tokens, bad input, matching and
retries. It is published, but the extension hasn't been run in a real browser.
The token section on `/app` needs a signed-in test. Captured leads can't
be seen in the app until the Leads step.

---

## Money

Stripe does two unrelated jobs here:

| | Lead pays the user | Someone pays for Nudge |
|---|---|---|
| Purpose | The main proof: money found for a customer | Backup proof: a real Stripe payment |
| Build | User pastes their own payment link into an offer | Install Stripe in the app and add one plan |
| Tracking | User enters the amount won | Stripe checkout confirms it |

We don't connect to users' Stripe accounts. Entering the amount by hand is enough
for the hackathon, and we keep the evidence alongside it.

---

## Test first

Spend the first hour on these, in this order, because each can change the plan.

| # | Test | If it fails |
|---|---|---|
| 1 | Two accounts can't see each other's data, and one can't create records with another's `owner_id` | Route those writes through a function |
| 2 | A service role write with `owner_id` set is readable by that user | Change the account separation design |
| 3 | The AI gateway returns our schema reliably from server code | Connect Claude with our own key |
| 4 | A public server route can be called from `background.ts` | Save through a page in the app instead |
| 5 | Gmail app user connector sends, and can read a thread | Manual sending only, which is already built |
| 6 | Stripe test checkout works on the published app | Use a hand-made Stripe link |
| 7 | Editor or MCP changes appear in Version history with dates | Checkpoint by hand after each change |

Test 1 must pass before any outsider uploads data.

---

## Build order

Each step ends with something usable, and manual sending means the app can win
real money from step 4.

1. **[Foundation](01-foundation.md):** the app, login, entities, security rules
   and the tests above.
2. **Company Memory:** add, upload and list.
3. **Leads:** paste, CSV import, lead page and snippets.
4. **Drafting and approval:** `generateDraft`, source checks, the approval
   screen and manual sending. This is the first real outreach.
5. **Money:** win recording, dashboard, baseline and the before and after.
6. **Follow-ups:** `prepareFollowUps`, the approval queue and the digest.
7. **Gmail:** connector, `sendMessage` and `syncReplies`.
8. **Extension:** capture token, `captureLead`, and the popup changes.
9. **Landing page and Stripe plan:** lead with trying the app, and offer the
   extension as an add-on.
10. **Feedback and proof:** 3 outside builders, one documented change, and the
    submission items.

---

## Open questions

- What are the deadline and judging criteria? They weren't in the brief and I
  couldn't find them publicly, so they need to come from the organisers.
- Can the older extension be used alongside the new app? Ask before step 8. The
  app stands on its own either way.
- How many days should each follow-up wait? We can default to 3 and 7, then two
  follow-ups at most, and tune it with real users.
