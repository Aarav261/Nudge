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
const local = {}
let listener
const noop = { addListener() {} }
const posts = []
let respond = async () => ({ status: 200, ok: true })
globalThis.fetch = async (url, init) => {
  posts.push({ url, init, body: JSON.parse(init.body) })
  return respond()
}
globalThis.chrome = {
  storage: {
    session: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => void Object.assign(store, o)
    },
    local: { get: async (k) => ({ [k]: local[k] }) }
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
// Saving finishes after the message is answered, so wait for the result.
const settled = async () => {
  for (;;) {
    const s = await send({ type: "GET_STATE" })
    if (s.status !== "saving") return s
    await new Promise((resolve) => setTimeout(resolve))
  }
}
const save = async () => {
  await send({ type: "SAVE_LEAD" })
  return settled()
}

;(async () => {
  // No token yet: nothing is posted and the popup says what to do.
  let s = await lock("Jane Doe", "name")
  assert.strictEqual(s.status, "context_adding")
  await highlight("some context")
  s = await save()
  assert.strictEqual(s.status, "save_failed")
  assert.match(s.saveError, /Sign in/)
  assert.strictEqual(posts.length, 0)

  // A saved lead posts the token, the contact and its context.
  local[types.TOKEN_KEY] = "nudge_test"
  s = await save()
  assert.strictEqual(s.status, "saved")
  assert.strictEqual(s.saveError, null)
  assert.strictEqual(posts.length, 1)
  assert.strictEqual(posts[0].url, `${types.APP_URL}/api/capture-lead`)
  assert.strictEqual(posts[0].init.headers.Authorization, "Bearer nudge_test")
  assert.deepStrictEqual(posts[0].body.contact, { text: "Jane Doe", type: "name" })
  assert.strictEqual(posts[0].body.snippets[0].text, "some context")
  assert.strictEqual(posts[0].body.snippets[0].source_url, "https://a.b")
  assert.ok(!isNaN(Date.parse(posts[0].body.snippets[0].captured_at)))

  // A saved session ignores highlights and a second save, and ✕ clears it.
  s = await highlight("later")
  assert.strictEqual(s.context.length, 1)
  await send({ type: "SAVE_LEAD" })
  assert.strictEqual(posts.length, 1)
  s = await send({ type: "DISMISS" })
  assert.strictEqual(s.contact, null)

  // Saving straight from a detection locks the contact first.
  await send({ type: "RESET" })
  await highlight("jane@acme.com", "email")
  s = await save()
  assert.strictEqual(s.status, "saved")
  assert.ok(s.locked)

  // A long selection is cut to the route's limits.
  await lock("jane@acme.com", "email")
  await highlight("x".repeat(6000))
  await save()
  assert.strictEqual(posts.at(-1).body.snippets[0].text.length, 5000)

  // A rejected token and a network failure both keep the lead for a retry.
  await lock("jane@acme.com", "email")
  await highlight("keep me")
  respond = async () => ({ status: 401, ok: false })
  s = await save()
  assert.strictEqual(s.status, "save_failed")
  assert.match(s.saveError, /signed out/)
  respond = async () => {
    throw new Error("offline")
  }
  s = await save()
  assert.match(s.saveError, /Couldn't reach/)
  assert.strictEqual(s.context.length, 1)
  respond = async () => ({ status: 200, ok: true })
  s = await save()
  assert.strictEqual(s.status, "saved")

  // ✕ does nothing while a save is in flight.
  await lock("jane@acme.com", "email")
  let release
  respond = () =>
    new Promise((resolve) => (release = () => resolve({ status: 200, ok: true })))
  s = await send({ type: "SAVE_LEAD" })
  assert.strictEqual(s.status, "saving")
  s = await send({ type: "DISMISS" })
  assert.strictEqual(s.status, "saving")
  release()
  s = await settled()
  assert.strictEqual(s.status, "saved")
  respond = async () => ({ status: 200, ok: true })

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

  console.log("ok")
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
