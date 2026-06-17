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
 * The six UI states the compose popup can render, plus `idle` (no popup).
 *
 *   idle          → nothing detected, no popup shown
 *   detected      → a contact was highlighted; offer to start
 *   context_adding→ contact locked; accumulating context across tabs
 *   composing     → editing the draft message
 *   sent          → message sent
 *   draft_saved   → draft saved for later
 *   not_found     → locked a contact but no usable email/handle was found
 */
export type ComposeStatus =
  | "idle"
  | "detected"
  | "context_adding"
  | "composing"
  | "sent"
  | "draft_saved"
  | "not_found"

/**
 * The single source of truth, persisted in chrome.storage.session (owned by
 * the background service worker). Survives tab navigation; cleared when the
 * browser session ends.
 */
export interface NudgeSession {
  status: ComposeStatus
  contact: ContactInfo | null
  /** Once locked, new highlights add context instead of replacing the contact. */
  locked: boolean
  /** Context accumulated across every tab while the contact is locked. */
  context: ContextSnippet[]
  draft: string
  /** Where to anchor the popup, in page coordinates of the detecting tab. */
  position: ScreenPosition | null
  updatedAt: number
}

export const emptySession = (): NudgeSession => ({
  status: "idle",
  contact: null,
  locked: false,
  context: [],
  draft: "",
  position: null,
  updatedAt: Date.now()
})
