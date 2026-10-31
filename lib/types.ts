// Shared domain types for Nudge.

export type ContactType =
  | "email"
  | "linkedin"
  | "twitter"
  | "name"
  | "phone"
  | "url"
  | "unknown"

export interface ContactInfo {
  /** Raw highlighted text that produced this contact. */
  text: string
  type: ContactType
}

export interface ContextSnippet {
  /** A piece of context highlighted somewhere on the web. */
  text: string
  sourceUrl: string
  sourceTitle: string
  capturedAt: number
}

export interface ScreenPosition {
  x: number
  y: number
}

/**
 * The UI states the popup can render, plus `idle` (no popup).
 *
 *   idle          → nothing detected, no popup shown
 *   detected      → a contact was highlighted; offer to start
 *   context_adding→ contact locked; accumulating context across tabs
 *   saving        → posting the lead to the Nudge app
 *   saved         → the lead and its context are in the app
 *   save_failed   → the post failed; `saveError` says why
 */
export type SaveStatus =
  | "idle"
  | "detected"
  | "context_adding"
  | "saving"
  | "saved"
  | "save_failed"

/**
 * The single source of truth, persisted in chrome.storage.session (owned by
 * the background service worker). Survives tab navigation; cleared when the
 * browser session ends.
 */
export interface NudgeSession {
  status: SaveStatus
  contact: ContactInfo | null
  /** Once locked, new highlights add context instead of replacing the contact. */
  locked: boolean
  /** Context accumulated across every tab while the contact is locked. */
  context: ContextSnippet[]
  saveError: string | null
  /** Where to anchor the popup, in page coordinates of the detecting tab. */
  position: ScreenPosition | null
  updatedAt: number
}

export const emptySession = (): NudgeSession => ({
  status: "idle",
  contact: null,
  locked: false,
  context: [],
  saveError: null,
  position: null,
  updatedAt: Date.now()
})

export const APP_URL = "https://nudge-7850d0c4.base44.app"

/** The capture token, in chrome.storage.local. Set in the toolbar popup. */
export const TOKEN_KEY = "nudge:token"
