# Step 1 — Foundation

Part of [Nudge on Base44](base44-architecture.md). Built on 2026-10-31. The app
is live at <https://nudge-7850d0c4.base44.app>, app ID
`6ae54349fde0a05b7850d0c4`. The Foundation is not finished: see
[What's left](#whats-left).

The plan below was written before the app existed. The template turned out to be
TanStack Start, so the backend code became server functions and server routes,
and AI drafting uses the AI gateway. Test names below use the plan's wording.

## Goal

A published Nudge app where anyone can register, with all data entities in
place, proof that one account can't reach another's data, and the seven risky
platform assumptions tested.

**Done means:**

- [x] The app is published at a public link, and the app ID is recorded.
- [ ] Register, verify email, sign in and sign out all work on the published app.
- [x] All five entities and the `User` fields exist with their security rules.
- [ ] Every check in [Separation check](#separation-check) passes on the
      published app.
- [ ] All seven tests from the architecture doc have a recorded result.
- [ ] Temporary test functions and test data are deleted.

**Not in this step:** Memory, Leads, drafting and all other product screens.
The signed-in home page is a placeholder.

---

## Setup

Only you can do these, because they involve your account and payment:

1. Check base44.com/pricing and take the Builder plan.
2. Create the app, named **Nudge**, and record the app ID.
3. Connect the Base44 MCP server so Claude Code can do the build steps. It uses
   `https://app.base44.com/mcp` with a one-time OAuth sign-in. Allow
   `sandbox:write` at consent. If you'd rather not, paste the same steps into the
   editor's AI chat.
4. In **Overview > App Visibility**, choose **Public**. Don't use the deprecated
   Public (login required) option, which needs a Base44 account.
5. In **Dashboard > Settings > Authentication**, turn on email and password, and
   Google. The default Google credentials are fine, though the sign-in screen
   shows base44.com until we add our own.
6. Create two non-admin test accounts on the published app: A and B.

---

## App shell

| Route | Access | Content |
|---|---|---|
| `/` | Public | Placeholder landing page with a **Try Nudge** button |
| `/login`, `/register`, `/forgot-password` | Public | Base44's custom login pages |
| `/reset-password` | Public | Base44 requires this exact path |
| `/app` | Signed in | Placeholder home with the user's name and sign out |
| `/app/check` | Signed in | The separation check, see below |

Public visibility means Base44 won't require sign-in for us, so the `/app` routes
must redirect signed-out visitors to `/login`. That redirect is only for the user
experience. Row-level security is what protects the data.

**Brand:** tokens from [brand_guideline.md](../brand_guideline.md): Indigo 600
`#4741A4` for primary actions, hover `#36317B`, focus `#7C76D6`, the system font
stack, sentence-case headings and action-led button text. Use `assets/logo.png`.

---

## Entities

Each file goes in `base44/entities/`. Don't define the built-in fields: `id`,
`created_date`, `updated_date`, `created_by` and `created_by_id`.

Every entity except `CaptureToken` uses the same rules:

```json
"rls": {
  "create": { "data.owner_id": "{{user.id}}" },
  "read": { "data.owner_id": "{{user.id}}" },
  "update": { "data.owner_id": "{{user.id}}" },
  "delete": { "data.owner_id": "{{user.id}}" }
}
```

Base44 reads schema fields as `data.*` in these rules. The docs don't say whether
a `create` rule checks the incoming record, or whether `update` stops someone
changing `owner_id`, so the separation check tests both.

Email and URL fields are plain strings on purpose. A `format` check would reject
messy CSV rows and captured text before anyone could fix them.

**`MemoryItem.json`**

```json
{
  "name": "MemoryItem",
  "type": "object",
  "title": "Memory item",
  "properties": {
    "owner_id": { "type": "string" },
    "kind": {
      "type": "string",
      "enum": ["profile", "offer", "process", "result", "tone_sample", "what_worked"]
    },
    "title": { "type": "string", "maxLength": 200 },
    "text": { "type": "string" },
    "source_label": { "type": "string" },
    "message_id": { "type": "string" }
  },
  "required": ["owner_id", "kind", "text"]
}
```

**`Lead.json`**

```json
{
  "name": "Lead",
  "type": "object",
  "title": "Lead",
  "properties": {
    "owner_id": { "type": "string" },
    "name": { "type": "string", "maxLength": 200 },
    "role": { "type": "string" },
    "company": { "type": "string" },
    "email": { "type": "string" },
    "linkedin_url": { "type": "string" },
    "phone": { "type": "string" },
    "origin": { "type": "string", "enum": ["manual", "csv", "extension"] },
    "status": {
      "type": "string",
      "enum": ["new", "contacted", "replied", "won", "lost"],
      "default": "new"
    },
    "won_amount": { "type": "number", "minimum": 0 },
    "won_at": { "type": "string", "format": "date-time" }
  },
  "required": ["owner_id", "name"]
}
```

**`Snippet.json`**

```json
{
  "name": "Snippet",
  "type": "object",
  "title": "Snippet",
  "properties": {
    "owner_id": { "type": "string" },
    "lead_id": { "type": "string" },
    "text": { "type": "string" },
    "source_url": { "type": "string" },
    "source_title": { "type": "string" },
    "captured_at": { "type": "string", "format": "date-time" }
  },
  "required": ["owner_id", "lead_id", "text"]
}
```

**`Message.json`**

```json
{
  "name": "Message",
  "type": "object",
  "title": "Message",
  "properties": {
    "owner_id": { "type": "string" },
    "lead_id": { "type": "string" },
    "step": { "type": "integer", "minimum": 1, "default": 1 },
    "angle": {
      "type": "object",
      "properties": {
        "why_you": { "type": "string" },
        "why_them": { "type": "string" },
        "why_now": { "type": "string" }
      }
    },
    "subject": { "type": "string" },
    "lines": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "kind": { "type": "string", "enum": ["claim", "plain"] },
          "source_id": { "type": "string" },
          "quote": { "type": "string" }
        },
        "required": ["text", "kind"]
      }
    },
    "status": {
      "type": "string",
      "enum": ["draft", "pending_approval", "approved", "sent", "failed", "cancelled"],
      "default": "draft"
    },
    "channel": { "type": "string", "enum": ["gmail", "manual"] },
    "gmail_thread_id": { "type": "string" },
    "sent_at": { "type": "string", "format": "date-time" },
    "replied_at": { "type": "string", "format": "date-time" },
    "follow_up_due_at": { "type": "string", "format": "date-time" }
  },
  "required": ["owner_id", "lead_id"]
}
```

**`CaptureToken.json`** is only touched by backend functions, so all client
access is denied.

```json
{
  "name": "CaptureToken",
  "type": "object",
  "title": "Capture token",
  "properties": {
    "owner_id": { "type": "string" },
    "token_hash": { "type": "string" },
    "revoked_at": { "type": "string", "format": "date-time" }
  },
  "required": ["owner_id", "token_hash"],
  "rls": { "create": false, "read": false, "update": false, "delete": false }
}
```

**`User.json`** adds only our custom fields.

```json
{
  "name": "User",
  "type": "object",
  "properties": {
    "business_name": { "type": "string" },
    "baseline_revenue": { "type": "number", "minimum": 0 }
  }
}
```

**Client writes:** one small frontend helper adds `owner_id` from the signed-in
user to every create. Reads need no filter, because the rules already limit them.

---

## Separation check

`/app/check` runs these as the signed-in user on every entity except where noted,
and shows pass or fail per row. It tags its rows and deletes them at the end.
Paste in the other account's user ID to run the cross-account cases.

Base44 keeps `dev` and `prod` data apart, so run it on the published app, not in
the preview.

| # | Signed in as | Action | Expected |
|---|---|---|---|
| 1 | A | Create a record with A's `owner_id` | Works |
| 2 | B | `list` and `filter` | A's record is missing |
| 3 | B | `get` A's record | 404 |
| 4 | B | `update` A's record | Denied |
| 5 | B | `delete` A's record | Denied |
| 6 | B | Create a record with A's `owner_id` | Denied |
| 7 | B | Change their own record's `owner_id` to A | Denied |
| 8 | Signed out | Read each entity | Nothing returned |
| 9 | A | Read or create `CaptureToken` | Empty, denied |
| 10 | B | Read A's `User` record | Denied |
| 11 | A | Read a record a service role function wrote with A's `owner_id` | Works |

Case 8 runs in a private window, because a signed-out user can't open `/app`. Case
11 uses a temporary function, `checkServiceWrite`, which takes the user from
`auth.me()` and writes one row owned by that user.

**If 6 or 7 fails:** a user could plant records in another account, including
Memory that would feed that person's drafts. Then set the `create` and `update`
rules to `false` and add one backend function, `saveRecord`. It takes the user
from `auth.me()`, always sets `owner_id` itself, and checks ownership before an
update. All client writes then go through it.

**If 1–5, 8, 9, 10 or 11 fails:** stop and redesign before building further.

Keep `/app/check` after this step. It only does what the signed-in user is
allowed to do, and we should rerun it after any entity change.

---

## Platform tests

These are tests 3–7 from the [architecture doc](base44-architecture.md#test-first).
The separation check covers tests 1 and 2. Use throwaway functions and record each
result in the table at the bottom of this file.

**3. Structured LLM output.** A temporary function calls `InvokeLLM` with the
draft schema and a small fake memory and lead, 10 times. Pass: every result
parses, and every `quote` is found word for word in its source. Also note the
credits used per call.

**4. Extension to app.** Add a temporary public function, `pingCapture`, and call
it from `background.ts` with a Bearer header, on a local branch that doesn't get
merged. Pass: the function receives the header and body, and the extension gets
the response.

**5. Gmail.** Only you can do the Google Cloud part: create a project, enable the
Gmail API, set up the consent screen in testing mode, add yourself as a test user,
and add `https://connectors.base44.com/api/oauth/callback` as a redirect URI.
Register the client under **Workspace Settings** with `gmail.send` and
`gmail.readonly`. Then a temporary page and function connect your account, send
one email to yourself, and read the thread back. Pass: the email sends and the
reply shows up on the thread. Record how long it took, and leave the connection
in place for step 7 if it works.

**6. Stripe.** Ask the AI chat to install Stripe and add one test product. Pay with
the test card on the published app, since checkout doesn't run in the preview.
Pass: the payment is confirmed on the success page. The sandbox must be claimed
within 60 days to take real money.

**7. Version history.** Make a small change through the MCP server, create a
checkpoint, and look in the editor. Pass: the change shows with a date. MCP
changes don't appear in Version history until a checkpoint is made, so we
checkpoint after every change from now on.

---

## Order of work

1. Setup (you).
2. Check Version history early (test 7), since it decides how we work.
3. Add the entities and `User` fields, and push the rules.
4. Build the app shell and auth redirect, then publish.
5. Build `/app/check` and `checkServiceWrite`, then run the separation check.
6. Fix anything it finds before moving on.
7. Run tests 3, 4, 6 and 5, in that order. Gmail is last because it takes the most
   setup.
8. Delete the temporary functions and test data.
9. Update the architecture doc with anything that changed, and fill in the results
   below.

---

## Results

| Test | Result | Date | Notes |
|---|---|---|---|
| 1. Separation | Partly done | 2026-10-31 | Signed-out reads return nothing and creates get a 403. The A and B cases need two accounts |
| 2. Service role write | Partly done | 2026-10-31 | The write works with no signed-in user. Reading it back as its owner is case 11 of the check |
| 3. Structured LLM output | Works, with a catch | 2026-10-31 | 10 of 10 runs returned valid JSON in 2–3 seconds. 27 of 30 quotes matched exactly, so the plan's strict pass was missed. All 3 misses changed "her team" to "your team". Credits used weren't measured |
| 4. Extension to app | Passed, not from a real extension | 2026-10-31 | A server route received the Bearer token and body from `curl` with an extension `Origin`. Preflight allows any origin |
| 5. Gmail | Not run | | Needs your Google Cloud project. The Gmail connector is available for this app |
| 6. Stripe | Partly done | 2026-10-31 | Sandbox installed with a $1 test product. The test checkout is on `/app/check` and needs you to pay with Stripe's test card |
| 7. Version history | Passed | 2026-10-31 | Checkpoints are listed with dates by the API. Not yet viewed in the editor |

**Extra finding:** workflows can't call a URL directly, but `invoke_server_route`
is available on this app, so `prepareFollowUps` can be a server route. A real
scheduled run hasn't been tried yet.

## What's left

1. Create two non-admin accounts on the published app, which also tests register
   and email verification.
2. Run `/app/check` as A, then as B using A's text, then clean up as A.
3. Run the Stripe test on the same page, using Stripe's published test card.
4. Set up the Google Cloud project for test 5.
5. Then delete `checkServiceWrite`, `startTestCheckout`, `confirmTestCheckout`,
   the Stripe section of `/app/check`, and the Nudge test product.
