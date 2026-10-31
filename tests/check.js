// Runnable check for the classifier and the background state machine:
// `pnpm test`. Loads the real source against a fake `chrome`.

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

function load(file, requireStub) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: "commonjs", target: "es2020" }
  })
  const mod = { exports: {} }
  new Function("module", "exports", "require", outputText)(
    mod,
    mod.exports,
    requireStub
  )
  return mod.exports
}

// ---- classifier ----
const { classifyContact } = load("lib/classifier.ts")
const expected = {
  "jane@acme.com": "email",
  "https://www.linkedin.com/in/jane": "linkedin",
  "linkedin.com/in/jane": "linkedin",
  "@jane": "twitter",
  "https://x.com/jane": "twitter",
  "twitter.com/jane": "twitter",
  "+61 412 345 678": "phone",
  "555-123-4567": "phone",
  "Jane Doe": "name",
  "Newton Smith": "name",
  "https://acme.com": "url",
  "2026-10-31": "unknown",
  "31.10.2026": "unknown",
  "netflix.com/browse": "unknown",
  "dropbox.com/home": "unknown",
  "New York": "unknown",
  "Read More": "unknown",
  "see my profile at linkedin.com/in/jane for details": "unknown"
}
for (const [text, type] of Object.entries(expected))
  assert.strictEqual(classifyContact(text), type, text)

// ---- state machine ----
const store = {}
let listener
const noop = { addListener() {} }
globalThis.chrome = {
  storage: {
    session: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => void Object.assign(store, o)
    }
  },
  tabs: { query: async () => [], onActivated: noop, onUpdated: noop },
  runtime: {
    onMessage: { addListener: (fn) => (listener = fn) },
    onStartup: noop,
    onInstalled: noop
  }
}
const types = load("lib/types.ts")
load("background.ts", (id) => (id === "~lib/types" ? types : ""))

const send = (msg) =>
  new Promise((resolve) =>
    listener(msg, { tab: { url: "https://a.b", title: "t" } }, resolve)
  )
const highlight = (text, type = "unknown") =>
  send({
    type: "HIGHLIGHT_DETECTED",
    contact: { text, type },
    position: { x: 0, y: 0 }
  })
const lock = async (text, type) => {
  await send({ type: "RESET" })
  await highlight(text, type)
  return send({ type: "LOCK_CONTACT" })
}

;(async () => {
  // A name locks and gathers context, and only fails at send.
  let s = await lock("Jane Doe", "name")
  assert.strictEqual(s.status, "context_adding")
  await highlight("some context")
  await send({ type: "START_COMPOSE" })
  s = await send({ type: "SEND" })
  assert.strictEqual(s.status, "not_found")
  s = await send({ type: "START_COMPOSE" })
  assert.strictEqual(s.status, "composing")
  s = await send({ type: "SAVE_DRAFT" })
  assert.strictEqual(s.status, "draft_saved")

  // ✕ hides a locked session, and a new highlight brings it back intact.
  s = await lock("jane@acme.com", "email")
  await highlight("first")
  s = await send({ type: "DISMISS" })
  assert.strictEqual(s.status, "idle")
  assert.ok(s.locked)
  s = await highlight("first") // duplicate: stays hidden
  assert.strictEqual(s.status, "idle")
  s = await highlight("second")
  assert.strictEqual(s.status, "context_adding")
  assert.strictEqual(s.context.length, 2)

  // A sent session ignores highlights, and ✕ clears it.
  await send({ type: "START_COMPOSE" })
  s = await send({ type: "SEND" })
  assert.strictEqual(s.status, "sent")
  s = await highlight("later")
  assert.strictEqual(s.status, "sent")
  assert.strictEqual(s.context.length, 2)
  s = await send({ type: "DISMISS" })
  assert.strictEqual(s.contact, null)

  // An emptied draft stays empty rather than falling back to the template.
  await lock("jane@acme.com", "email")
  s = await send({ type: "UPDATE_DRAFT", draft: "" })
  assert.strictEqual(s.draft ?? "template", "")

  console.log("ok")
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
