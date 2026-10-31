// Content-script UI: the compose popup, anchored at the highlight. It is a
// pure view over the background's NudgeSession — every button sends a message
// and re-renders from the broadcast STATE_UPDATE.

import logoUrl from "data-base64:~assets/logo.png"
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

function ComposePopup() {
  const [session, setSession] = useState<NudgeSession>(emptySession)
  // User-chosen position (viewport coords). Only set by dragging once locked;
  // null means "anchored at the originating highlight".
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
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

  // Dragging is only allowed once a contact is locked; clear any custom
  // position when we unlock (e.g. after RESET) so it re-anchors next time.
  useEffect(() => {
    if (!session.locked) setDragPos(null)
  }, [session.locked])

  // Top-layer elements are positioned against the viewport, so convert the
  // stored page coordinates by subtracting the current scroll offset.
  const pos = session.position ?? { x: 16, y: 16 }
  const anchoredLeft = Math.min(
    Math.max(8, pos.x - window.scrollX),
    window.innerWidth - 316
  )
  const anchoredTop = Math.max(8, pos.y - window.scrollY + 8)
  const left = dragPos ? dragPos.x : anchoredLeft
  const top = dragPos ? dragPos.y : anchoredTop

  const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), max)

  // Drag-to-reposition by the header. Enabled only while locked.
  const startDrag = (e: React.MouseEvent) => {
    if (!session.locked) return
    e.preventDefault() // don't start a text selection
    const startX = e.clientX
    const startY = e.clientY
    const originLeft = left
    const originTop = top
    const onMove = (ev: MouseEvent) => {
      const w = ref.current?.offsetWidth ?? 300
      const h = ref.current?.offsetHeight ?? 80
      setDragPos({
        x: clamp(originLeft + ev.clientX - startX, 8, window.innerWidth - w - 8),
        y: clamp(originTop + ev.clientY - startY, 8, window.innerHeight - h - 8)
      })
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <div ref={ref} style={{ ...shell, left, top }}>
      {active && session.contact && (
        <>
      <div
        style={{ ...header, cursor: session.locked ? "move" : "default" }}
        onMouseDown={startDrag}
        title={session.locked ? "Drag to reposition" : undefined}>
        <div style={brand}>
          <img src={logoUrl} alt="Nudge" width={18} height={18} style={logoImg} />
          <strong style={{ fontSize: 13, color: INDIGO_700 }}>Nudge</strong>
        </div>
        <button style={iconBtn} onClick={() => send({ type: "DISMISS" })}>
          ✕
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
        {CONTACT_LABEL[session.contact.type]}:{" "}
        <span style={{ color: "#111" }}>{session.contact.text}</span>
        {session.locked && (
          <span style={lockPill}>
             locked · {session.context.length}{" "}
            {session.context.length === 1 ? "snippet" : "snippets"}
          </span>
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
            <button style={secondary} onClick={() => send({ type: "SAVE_LEAD" })}>
              Save now
            </button>
          </div>
        </div>
      )}

      {session.status === "context_adding" && (
        <div style={col}>
          <p style={hint}>
            Highlight anything on any tab to collect it as context.
          </p>
          <ContextList
            session={session}
            onRemove={(i) => send({ type: "REMOVE_CONTEXT", index: i })}
          />
          <div style={row}>
            <button style={primary} onClick={() => send({ type: "SAVE_LEAD" })}>
              Save to Nudge ({session.context.length})
            </button>
            <button
              style={secondary}
              onClick={() => {
                if (
                  !session.context.length ||
                  confirm("Discard this contact and the collected context?")
                )
                  send({ type: "RESET" })
              }}>
              Discard
            </button>
          </div>
        </div>
      )}

      {session.status === "saving" && <p style={hint}>Saving to Nudge…</p>}

      {session.status === "saved" && (
        <div style={col}>
          <p style={{ ...hint, fontSize: 13 }}>✅ Saved to Nudge.</p>
          <button style={primary} onClick={() => send({ type: "RESET" })}>
            Start over
          </button>
        </div>
      )}

      {session.status === "save_failed" && (
        <div style={col}>
          <p role="alert" style={{ ...hint, fontSize: 13 }}>
            {session.saveError}
          </p>
          <div style={row}>
            <button style={primary} onClick={() => send({ type: "SAVE_LEAD" })}>
              Try again
            </button>
            <button style={secondary} onClick={() => send({ type: "RESET" })}>
              Start over
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function ContextList({
  session,
  onRemove
}: {
  session: NudgeSession
  onRemove?: (index: number) => void
}) {
  if (!session.context.length) return null
  return (
    <ul style={ctxList}>
      {session.context.map((c, i) => (
        <li key={i} style={ctxItem} title={c.sourceUrl}>
          <span style={ctxText}>
            {c.text.length > 56 ? c.text.slice(0, 56) + "…" : c.text}
          </span>
          {onRemove && (
            <button
              style={ctxRemove}
              title="Remove from context"
              onClick={() => onRemove(i)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---- brand palette (see brand_guideline.md) ----
const INDIGO = "#4741A4" // Indigo 600 — primary
const INDIGO_700 = "#36317B" // hover / wordmark
const INDIGO_100 = "#E6E5F4" // tint

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
  // Translucent "glass" surface — blurs the page behind it.
  background: "rgba(255, 255, 255, 0.72)",
  backdropFilter: "blur(14px) saturate(160%)",
  WebkitBackdropFilter: "blur(14px) saturate(160%)",
  border: "1px solid rgba(71, 65, 164, 0.22)",
  borderRadius: 12,
  boxShadow: "0 10px 32px rgba(36, 33, 82, 0.22)",
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
const brand: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6
}
const logoImg: React.CSSProperties = {
  display: "block",
  objectFit: "contain"
}
const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 }
const row: React.CSSProperties = { display: "flex", gap: 8 }
const hint: React.CSSProperties = { margin: 0, fontSize: 12, color: "#666" }
const primary: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  border: "none",
  borderRadius: 7,
  background: INDIGO,
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
}
const secondary: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  border: `1px solid ${INDIGO}`,
  borderRadius: 7,
  background: "rgba(255, 255, 255, 0.5)",
  color: INDIGO_700,
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
  background: INDIGO_100,
  fontSize: 11,
  color: INDIGO_700
}
const ctxList: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  fontSize: 11,
  color: "#666",
  maxHeight: 84,
  overflowY: "auto"
}
const ctxItem: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  marginBottom: 2
}
const ctxText: React.CSSProperties = { flex: 1, minWidth: 0 }
const ctxRemove: React.CSSProperties = {
  flexShrink: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#999",
  fontSize: 10,
  lineHeight: 1,
  padding: "1px 2px"
}

export default ComposePopup
