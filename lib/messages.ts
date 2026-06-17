// Message protocol between content scripts and the background service worker.
//
// Content scripts NEVER touch chrome.storage.session directly. They send
// these messages to the background worker, which owns the state machine and
// broadcasts the resulting NudgeSession back to every tab.

import type { ContactInfo, NudgeSession, ScreenPosition } from "~lib/types"

export type ContentToBackground =
  | { type: "HIGHLIGHT_DETECTED"; contact: ContactInfo; position: ScreenPosition }
  | { type: "LOCK_CONTACT" }
  | { type: "ADD_CONTEXT"; text: string }
  | { type: "START_COMPOSE" }
  | { type: "UPDATE_DRAFT"; draft: string }
  | { type: "SEND" }
  | { type: "SAVE_DRAFT" }
  | { type: "DISMISS" }
  | { type: "RESET" }
  | { type: "GET_STATE" }

export type BackgroundToContent = {
  type: "STATE_UPDATE"
  session: NudgeSession
}

/** Sent from a content script; resolves with the latest session snapshot. */
export function sendToBackground(
  msg: ContentToBackground
): Promise<NudgeSession> {
  return chrome.runtime.sendMessage(msg)
}
