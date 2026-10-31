// Content script: runs only on the Nudge app, so a signed-in user can connect
// the extension with one click. The app posts a capture token here and we store
// it. Only this page can send it, and no other site reaches this script.

import type { PlasmoCSConfig } from "plasmo"

import { TOKEN_KEY } from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["https://nudge-7850d0c4.base44.app/*"]
}

// Lets the app check for the extension before it replaces the live token.
document.documentElement.dataset.nudgeExtension = "1"

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  if (event.data?.type !== "NUDGE_CONNECT") return
  const { token } = event.data
  if (typeof token !== "string" || !token.startsWith("nudge_")) return

  await chrome.storage.local.set({ [TOKEN_KEY]: token })
  window.postMessage({ type: "NUDGE_CONNECTED" }, location.origin)
})
