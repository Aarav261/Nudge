// Content script: listens for text selections and reports them to the
// background worker, which decides whether the highlight is a new contact or
// context for an already-locked one.

import type { PlasmoCSConfig } from "plasmo"

import { classifyContact, isActionable } from "~lib/classifier"
import { sendToBackground } from "~lib/messages"
import type { BackgroundToContent } from "~lib/messages"
import type { ScreenPosition } from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["https://*/*"],
  all_frames: false
}

console.log("[Nudge] highlight detector loaded")

// Mirror of the background's `locked` flag. When locked, even plain prose is
// forwarded as context; when unlocked, only actionable contacts are.
let locked = false

chrome.runtime.onMessage.addListener((msg: BackgroundToContent) => {
  if (msg.type === "STATE_UPDATE") locked = msg.session.locked
})
sendToBackground({ type: "GET_STATE" })
  .then((session) => {
    locked = session.locked
  })
  .catch(() => {})

function selectionPosition(selection: Selection): ScreenPosition {
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return {
    x: rect.right + window.scrollX,
    y: rect.bottom + window.scrollY
  }
}

async function handleSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return

  const text = selection.toString().trim()
  if (!text) return

  const type = classifyContact(text)

  // Unlocked + uninteresting selection → nothing to do.
  if (!locked && !isActionable(type)) return

  try {
    await sendToBackground({
      type: "HIGHLIGHT_DETECTED",
      contact: { text, type },
      position: selectionPosition(selection)
    })
  } catch (err) {
    // Background may be asleep/reloading; it will re-fire on the next mouseup.
    console.debug("[Nudge] failed to report highlight", err)
  }
}

// mouseup is the natural "finished selecting" signal; keyup covers keyboard
// selections. Debounced to coalesce double-fires.
let timer: ReturnType<typeof setTimeout>
const schedule = () => {
  clearTimeout(timer)
  timer = setTimeout(handleSelection, 150)
}

document.addEventListener("mouseup", schedule)
document.addEventListener("keyup", (e) => {
  if (e.shiftKey || e.key === "a") schedule()
})
