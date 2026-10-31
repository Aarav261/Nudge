# Nudge — Front-end (Extension) Architecture

## Stack

| Layer | Tech |
|---|---|
| Framework | Plasmo 0.90.5 (Manifest V3) |
| UI | React 18.2 + inline styles (no CSS framework) |
| Language | TypeScript 5.3 |
| State persistence | `chrome.storage.session` (owned by the background worker) |
| Cross-context messaging | `chrome.runtime` message passing |
| Target | Chromium MV3, `https://*/*` pages only |

**Manifest** (declared under `"manifest"` in `package.json`):
`permissions: ["storage", "tabs"]` · `host_permissions: ["https://*/*"]`

---

## File Structure

```
nudge/
├── background.ts                 ← service worker: state machine + toolbar icon
├── popup.tsx                     ← toolbar popup (⚠ still the Plasmo default stub)
├── contents/
│   ├── highlight-detector.ts     ← content script: detects + classifies selections
│   └── compose-popup.tsx         ← Plasmo CSUI: the compose popup (a pure view)
├── lib/
│   ├── types.ts                  ← domain types, NudgeSession, ComposeStatus enum
│   ├── messages.ts               ← content ↔ background message protocol
│   └── classifier.ts             ← regex contact-type classifier
├── assets/
│   ├── icon.png                  ← toolbar icon (recolored / greyed at runtime)
│   └── logo.png                  ← popup brand mark
├── package.json                  ← manifest config under "manifest"
└── tsconfig.json
```

> Plasmo maps files by convention: `background.ts` → service worker,
> `popup.tsx` → toolbar popup, `contents/*` → content scripts. There is no
> separate `components/` or `lib/api.ts` yet — the popup UI is one file with
> inline sub-components, and there are no backend calls wired in.

---

## Architecture Principle: the Background Owns All State

Content scripts are **stateless views**. They never touch `chrome.storage`
directly. Every interaction is a message to the background worker, which runs
the state machine, persists the result, and broadcasts the new `NudgeSession`
back to *every* tab. This is what makes context accumulation work across tabs —
a highlight on tab B updates the popup already rendered on tab A.

```
┌─────────────────────┐         ┌────────────────────┐
│  highlight-detector  │  msg →  │                    │
│  (content script)    │────────▶│   background.ts    │
└─────────────────────┘         │                    │
                                │  • reduce(): the    │
┌─────────────────────┐         │    state machine    │
│   compose-popup      │  msg →  │  • chrome.storage   │
│   (CSUI view)        │────────▶│    .session         │
│                      │◀────────│  • broadcast() to   │
└─────────────────────┘ STATE_  │    every tab        │
        ▲                UPDATE  └─────────┬──────────┘
        │                                  │
        └────────── broadcast to ALL tabs ◀┘
```

Message handling in `background.ts` is a reducer: `reduce(session, msg, sender)`
returns the next session; if it changed, the worker saves it and (for anything
but `GET_STATE`) broadcasts a `STATE_UPDATE` to all tabs. The session is reset
to empty on `chrome.runtime.onStartup`.

---

## State Machine (`ComposeStatus`)

The single source of truth is `NudgeSession`, persisted in
`chrome.storage.session` and reset on browser startup. Seven statuses drive what
the popup renders:

```
        actionable highlight (email/linkedin/twitter/phone/name)
 idle ───────────────────────────────────────▶ detected
   ▲                                              │
   │                          ┌───────────────────┼──────────────────┐
   │                    "Lock & add context"  "Compose now"           │
   │                          │              (LOCK + START_COMPOSE)    │
   │                          ▼                    │      SEND with no │
   │   RESET / DISMISS  context_adding ────────────┤      usable       
   │   (while unlocked) ▲   │   any highlight on    │      email/handle
   │                    │   │   any tab → addContext│            ▼
   │     DISMISS keeps  └───┤   (deduped)           ▼        not_found
   │     a locked       │   └─────────────────▶ composing        │
   │     contact alive  │                          │             │ RESET
   │                    │                   SEND    │  SAVE_DRAFT │
   │                    │                          ▼      ▼      │
   └────────────────────┴──────────────────────  sent  draft_saved
                                                   │      │
                                                   └ RESET ┘ → idle
```

| Status | Popup renders |
|---|---|
| `idle` | nothing (popup hidden) |
| `detected` | contact label + **Lock & add context** / **Compose now** |
| `context_adding` | context list + **Compose (n)** / **Discard** |
| `composing` | editable draft textarea + context list + **Send** / **Save draft** |
| `sent` | ✅ "Sent. Outreach logged." + **Start over** |
| `draft_saved` | 💾 "Draft saved for later." + **Start over** |
| `not_found` | 🔍 "No usable email or handle…" + **Back to draft** / **Start over** |

**Locked vs. unlocked** is the core distinction. While unlocked, only an
*actionable* highlight becomes the contact. Once `LOCK_CONTACT` fires, **every**
highlight on any tab is appended as a context snippet — deduped against the
contact itself and existing snippets (case-insensitive, trimmed). `DISMISS`
sets a locked session to `idle`, which hides the popup but keeps the contact +
its context alive across tabs; the next new highlight brings it back. A `sent`
or `draft_saved` session ignores highlights until `DISMISS` or `RESET` clears
it. `RESET` clears everything back to `idle`.

> Note: there is no `sending` or `failed` status today — `SEND` is synchronous
> and just flips to `sent`. `not_found` is *not* a send failure; it means the
> locked contact is only a name, with no usable email/handle to send to. Async
> `sending` / `failed` states will be needed once real backend calls are wired
> (see below).

---

## Message Protocol (`lib/messages.ts`)

Content scripts call `sendToBackground(msg)`, which resolves with the latest
`NudgeSession` snapshot.

```typescript
ContentToBackground =
  | { type: "HIGHLIGHT_DETECTED"; contact: ContactInfo; position: ScreenPosition }
  | { type: "LOCK_CONTACT" }
  | { type: "ADD_CONTEXT"; text: string }     // ⚠ currently unused (see TODO)
  | { type: "REMOVE_CONTEXT"; index: number }
  | { type: "START_COMPOSE" }
  | { type: "UPDATE_DRAFT"; draft: string }
  | { type: "SEND" }
  | { type: "SAVE_DRAFT" }
  | { type: "DISMISS" }    // hide popup; keep locked contact + context alive
  | { type: "RESET" }      // back to an empty session
  | { type: "GET_STATE" }  // pure read, no broadcast

BackgroundToContent = { type: "STATE_UPDATE"; session: NudgeSession }
```

---

## Contact Classification (`lib/classifier.ts`)

Pure regex, run in the content script *before* any message is sent — so the
background stays quiet for irrelevant selections.

| Type | Heuristic | Actionable? |
|---|---|---|
| `email` | `x@y.z` | ✓ |
| `linkedin` | `linkedin.com/(in\|pub)/` | ✓ |
| `twitter` | `@handle` (≤15 chars) or `x.com` / `twitter.com/…` | ✓ |
| `phone` | 7–15 digits, optional `+` / separators | ✓ |
| `name` | 2–4 capitalized words, minus common UI/place openers like "Read More" | ✓ |
| `url` | `http(s)://…` | ✗ |
| `unknown` | fallback | ✗ |

`isActionable(type)` gates whether an *unlocked* highlight surfaces the popup at
all (everything except `url` and `unknown`). Once locked, this gate is bypassed
and any non-empty text becomes context.

---

## Highlight Detector (`contents/highlight-detector.ts`)

- Listens for `mouseup` (and shift/`a` `keyup` for keyboard selections),
  debounced 150 ms to coalesce double-fires.
- Reads `window.getSelection()`, classifies the text, and computes the
  highlight's page-coordinate anchor (`rect.right/bottom + scroll`).
- Keeps a local mirror of the background's `locked` flag (synced via
  `STATE_UPDATE` + an initial `GET_STATE`): unlocked → only actionable
  selections are reported; locked → everything is reported as context.
- Sends `HIGHLIGHT_DETECTED`; failures are swallowed (the worker may be asleep
  and will re-fire on the next selection).

---

## Compose Popup (`contents/compose-popup.tsx`)

- **Plasmo CSUI** in an isolated shadow DOM → all styles are inline (no page CSS
  to lean on). Brand palette is indigo (`#4741A4`) with a translucent
  `backdrop-filter: blur` "glass" surface.
- A **pure view** over `NudgeSession`: it subscribes to `STATE_UPDATE`, seeds
  itself with `GET_STATE` on mount, and every button just sends a message and
  re-renders from the next broadcast.
- Promoted into the browser **top layer** via the Popover API (`showPopover`)
  so site modals (e.g. LinkedIn "Contact info") can't paint over it; falls back
  to max `z-index` on old Chrome.
- **Anchored** at the highlight: page coords converted to viewport coords by
  subtracting current scroll, then clamped on-screen.
- **Draggable by the header** once locked (`dragPos` overrides the anchor);
  the custom position clears on unlock so it re-anchors next time.
- `draftStub(session)` builds the draft locally from the contact + context —
  this is the explicit seam for an LLM call (see integration boundary).

---

## Toolbar Icon State (`background.ts`)

The action icon is recolored at runtime to signal where Nudge can act:

- The logo is decoded once and pre-rendered into **color** and **greyscale**
  `ImageData` for every size (16/32/48/128) via `OffscreenCanvas` (luminance
  conversion + 55% alpha for the "disabled" look).
- On tab activation / navigation / install / startup, the icon is set to
  **color** on `https://` pages and **faded grey** everywhere else (`http`,
  `chrome://`, `file://`, new tab, web store) — because the content scripts only
  run on `https://*/*`.

---

## Integration Boundary with the Backend

The front-end is currently **self-contained** — `SEND` / `SAVE_DRAFT` only flip
session status, and the draft is generated locally. The seams where the
[Backend architecture](./Backend_architecture.md) plugs in:

| Front-end seam | Today | Backend endpoint to wire |
|---|---|---|
| `draftStub()` in `compose-popup.tsx` | local string template | `POST /draft-message` (Claude) |
| `classifyContact()` | regex only | `POST /extract-contact` (Python NER) to enrich |
| `SEND` case in `reduce()` | flips status to `sent` | `POST /send` (orchestrator: LinkedIn→Gmail→Twilio→draft) |
| `SAVE_DRAFT` case | flips status to `draft_saved` | `POST /send` falling through to draft |
| — | no auth | `APIM_SUBSCRIPTION_KEY` / per-user OAuth |

**Recommended call site:** make network calls from `background.ts` (the worker
already owns the session and survives popup re-renders), surfacing progress as
new `ComposeStatus` values (`sending`, `failed`), rather than calling the API
from the content-script view.

---

## Known Gaps / TODO

1. **`popup.tsx` is still the default Plasmo "Welcome" stub** — needs to become
   the real toolbar surface (recent outreach log, settings, auth status).
2. **No `sending` / `failed` statuses** — `SEND` is synchronous today; real
   network calls need async states and error rendering.
3. **No auth/identity** on the client — required before any backend call.
4. **`linkedin` channel** is "prefill compose URL" on the backend, but the
   front-end has no flow yet to open that URL or handle the not-logged-in case.
5. **`ADD_CONTEXT` message type is unused** — context is added implicitly via
   `HIGHLIGHT_DETECTED` while locked; either remove it or add an explicit
   "add selection" affordance.
6. **Draft is recomputed in render** until edited
   (`session.draft ?? draftStub(session)`) — once an LLM call exists, the draft
   must be generated once and stored, not regenerated on every keystroke.
7. **Tests are one script** — `pnpm test` runs `tests/check.js` over
   `classifyContact()` and the `reduce()` state machine. The popup and detector
   aren't covered.
