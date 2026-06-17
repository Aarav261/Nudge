// Content-script UI: the compose popup, anchored at the highlight. It is a
// pure view over the background's NudgeSession — every button sends a message
// and re-renders from the broadcast STATE_UPDATE.

import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useRef, useState } from "react"

import { sendToBackground } from "~lib/messages"
import type { BackgroundToContent } from "~lib/messages"
import { emptySession, type ContactType, type NudgeSession } from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["https://*/*"],
  all_frames: false
}

const CONTACT_LABEL: Record<ContactType, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  phone: "Phone",
  name: "Name",
  url: "Link",
  unknown: "Selection"
}

const draftStub = (s: NudgeSession): string => {
  // Extension point: swap this for an LLM call seeded with the locked contact
  // and accumulated context. Kept synchronous + local for now.
  const who = s.contact?.text ?? "there"
  const ctx = s.context
    .map((c) => `- ${c.text} (${c.sourceTitle || c.sourceUrl})`)
    .join("\n")
  return [
    `Hi ${who},`,
    "",
    "I came across your work and wanted to reach out.",
    ctx ? `\nContext I gathered:\n${ctx}` : "",
    "",
    "Best,"
  ]
    .filter(Boolean)
    .join("\n")
}

function ComposePopup() {
  const [session, setSession] = useState<NudgeSession>(emptySession)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMsg = (msg: BackgroundToContent) => {
      if (msg.type === "STATE_UPDATE") setSession(msg.session)
    }
    chrome.runtime.onMessage.addListener(onMsg)
    sendToBackground({ type: "GET_STATE" }).then(setSession).catch(() => {})
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  const send = (msg: Parameters<typeof sendToBackground>[0]) =>
    sendToBackground(msg).then(setSession).catch(() => {})

  const active = session.status !== "idle" && !!session.contact

  // Promote the popup into the browser's top layer so site modals (e.g.
  // LinkedIn's "Contact info") can't paint over it — z-index alone loses to
  // top-layer dialogs. The element stays mounted; we toggle popover visibility.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual")
    try {
      const open = el.matches(":popover-open")
      if (active && !open) el.showPopover()
      else if (!active && open) el.hidePopover()
    } catch {
      // showPopover/hidePopover unsupported (very old Chrome) — z-index fallback.
    }
  })

  // Top-layer elements are positioned against the viewport, so convert the
  // stored page coordinates by subtracting the current scroll offset.
  const pos = session.position ?? { x: 16, y: 16 }
  const left = Math.min(
    Math.max(8, pos.x - window.scrollX),
    window.innerWidth - 316
  )
  const top = Math.max(8, pos.y - window.scrollY + 8)

  return (
    <div ref={ref} style={{ ...shell, left, top }}>
      {active && session.contact && (
        <>
      <div style={header}>
        <strong style={{ fontSize: 13 }}>Nudge</strong>
        <button style={iconBtn} onClick={() => send({ type: "DISMISS" })}>
          ✕
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
        {CONTACT_LABEL[session.contact.type]}:{" "}
        <span style={{ color: "#111" }}>{session.contact.text}</span>
        {session.locked && (
          <span style={lockPill}>🔒 locked · {session.context.length} ctx</span>
        )}
      </div>

      {session.status === "detected" && (
        <div style={col}>
          <p style={hint}>
            Lock this contact to start gathering context across tabs.
          </p>
          <div style={row}>
            <button style={primary} onClick={() => send({ type: "LOCK_CONTACT" })}>
              Lock & add context
            </button>
            <button
              style={secondary}
              onClick={() =>
                send({ type: "LOCK_CONTACT" }).then(() =>
                  send({ type: "START_COMPOSE" })
                )
              }>
              Compose now
            </button>
          </div>
        </div>
      )}

      {session.status === "context_adding" && (
        <div style={col}>
          <p style={hint}>
            Highlight anything on any tab — it's collected as context.
          </p>
          <ContextList session={session} />
          <div style={row}>
            <button style={primary} onClick={() => send({ type: "START_COMPOSE" })}>
              Compose ({session.context.length})
            </button>
            <button style={secondary} onClick={() => send({ type: "RESET" })}>
              Done
            </button>
          </div>
        </div>
      )}

      {session.status === "composing" && (
        <div style={col}>
          <textarea
            style={textarea}
            value={session.draft || draftStub(session)}
            onChange={(e) => send({ type: "UPDATE_DRAFT", draft: e.target.value })}
          />
          <ContextList session={session} />
          <div style={row}>
            <button style={primary} onClick={() => send({ type: "SEND" })}>
              Send
            </button>
            <button style={secondary} onClick={() => send({ type: "SAVE_DRAFT" })}>
              Save draft
            </button>
          </div>
        </div>
      )}

      {session.status === "sent" && (
        <Done
          icon="✅"
          msg="Sent. Outreach logged."
          onReset={() => send({ type: "RESET" })}
        />
      )}

      {session.status === "draft_saved" && (
        <Done
          icon="💾"
          msg="Draft saved for later."
          onReset={() => send({ type: "RESET" })}
        />
      )}

      {session.status === "not_found" && (
        <Done
          icon="🔍"
          msg={`No usable email or handle in "${session.contact.text}". Try highlighting their email.`}
          onReset={() => send({ type: "RESET" })}
        />
      )}
        </>
      )}
    </div>
  )
}

function ContextList({ session }: { session: NudgeSession }) {
  if (!session.context.length) return null
  return (
    <ul style={ctxList}>
      {session.context.slice(-4).map((c, i) => (
        <li key={i} style={ctxItem} title={c.sourceUrl}>
          {c.text.length > 60 ? c.text.slice(0, 60) + "…" : c.text}
        </li>
      ))}
    </ul>
  )
}

function Done({
  icon,
  msg,
  onReset
}: {
  icon: string
  msg: string
  onReset: () => void
}) {
  return (
    <div style={col}>
      <p style={{ ...hint, fontSize: 13 }}>
        {icon} {msg}
      </p>
      <button style={primary} onClick={onReset}>
        Start over
      </button>
    </div>
  )
}

// ---- inline styles (CSUI is isolated; no global CSS to lean on) ----
const shell: React.CSSProperties = {
  // Popover element: viewport-positioned and reset of the UA popover defaults
  // (which otherwise center it via inset:0 / margin:auto).
  position: "fixed",
  right: "auto",
  bottom: "auto",
  margin: 0,
  width: 300,
  maxWidth: "calc(100vw - 16px)",
  zIndex: 2147483647,
  background: "#fff",
  border: "1px solid #e3e3e3",
  borderRadius: 10,
  boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
  padding: 12,
  font: "13px/1.4 -apple-system, system-ui, sans-serif",
  color: "#111"
}
const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 6
}
const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 }
const row: React.CSSProperties = { display: "flex", gap: 8 }
const hint: React.CSSProperties = { margin: 0, fontSize: 12, color: "#666" }
const primary: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  border: "none",
  borderRadius: 7,
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12
}
const secondary: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  border: "1px solid #d4d4d4",
  borderRadius: 7,
  background: "#fff",
  color: "#333",
  cursor: "pointer",
  fontSize: 12
}
const iconBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#999",
  fontSize: 12
}
const lockPill: React.CSSProperties = {
  marginLeft: 6,
  padding: "1px 6px",
  borderRadius: 99,
  background: "#f1f5f9",
  fontSize: 11,
  color: "#475569"
}
const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 110,
  resize: "vertical",
  border: "1px solid #d4d4d4",
  borderRadius: 7,
  padding: 8,
  font: "13px/1.45 ui-monospace, monospace",
  boxSizing: "border-box"
}
const ctxList: React.CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  fontSize: 11,
  color: "#666",
  maxHeight: 70,
  overflowY: "auto"
}
const ctxItem: React.CSSProperties = { marginBottom: 2 }

export default ComposePopup
