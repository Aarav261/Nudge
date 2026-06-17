// Background service worker: the single source of truth for Nudge.
//
// Owns the NudgeSession state machine and chrome.storage.session. Content
// scripts send messages here; every state change is persisted and broadcast
// to all tabs so the compose popup stays in sync (cross-tab accumulation).

import iconDataUri from "data-base64:~assets/icon.png"

import type {
  BackgroundToContent,
  ContentToBackground
} from "~lib/messages"
import {
  emptySession,
  type ContextSnippet,
  type NudgeSession
} from "~lib/types"

const SESSION_KEY = "nudge:session"

async function loadSession(): Promise<NudgeSession> {
  const stored = await chrome.storage.session.get(SESSION_KEY)
  return (stored[SESSION_KEY] as NudgeSession) ?? emptySession()
}

async function saveSession(session: NudgeSession): Promise<NudgeSession> {
  session.updatedAt = Date.now()
  await chrome.storage.session.set({ [SESSION_KEY]: session })
  return session
}

/** Push the latest session to every tab that has a content script listening. */
async function broadcast(session: NudgeSession): Promise<void> {
  const msg: BackgroundToContent = { type: "STATE_UPDATE", session }
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map((tab) =>
      tab.id != null
        ? chrome.tabs.sendMessage(tab.id, msg).catch(() => {
            // Tab has no content script (e.g. chrome:// pages) — ignore.
          })
        : Promise.resolve()
    )
  )
}

function makeSnippet(
  text: string,
  sender: chrome.runtime.MessageSender
): ContextSnippet {
  return {
    text: text.trim(),
    sourceUrl: sender.tab?.url ?? "",
    sourceTitle: sender.tab?.title ?? "",
    capturedAt: Date.now()
  }
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * True when this text is already represented — either it's the locked contact
 * itself (don't add the name/email/handle you're reaching out to as "context")
 * or an identical snippet was already collected.
 */
function isDuplicate(session: NudgeSession, text: string): boolean {
  const t = norm(text)
  if (!t) return true
  if (session.contact && norm(session.contact.text) === t) return true
  return session.context.some((c) => norm(c.text) === t)
}

/** Append a snippet unless it duplicates the contact or an existing one. */
function addContext(session: NudgeSession, snippet: ContextSnippet): NudgeSession {
  if (isDuplicate(session, snippet.text)) return session
  return {
    ...session,
    context: [...session.context, snippet],
    status: session.status === "composing" ? "composing" : "context_adding"
  }
}

/**
 * Apply one message to the session. Pure-ish reducer: returns the next
 * session. The state machine lives entirely here.
 */
function reduce(
  session: NudgeSession,
  msg: ContentToBackground,
  sender: chrome.runtime.MessageSender
): NudgeSession {
  switch (msg.type) {
    case "HIGHLIGHT_DETECTED": {
      // While locked, any highlight becomes accumulated context rather than a
      // new contact. This is the "context mode" half of the state machine.
      if (session.locked) {
        // Dedupe: ignore re-highlights of the contact itself or known snippets.
        return addContext(session, makeSnippet(msg.contact.text, sender))
      }
      // Unlocked: a fresh detection. Anchor the popup and offer to start.
      return {
        ...session,
        status: "detected",
        contact: msg.contact,
        position: msg.position
      }
    }

    case "LOCK_CONTACT": {
      if (!session.contact) return session
      const usable =
        session.contact.type === "email" ||
        session.contact.type === "linkedin" ||
        session.contact.type === "twitter" ||
        session.contact.type === "phone"
      return {
        ...session,
        locked: true,
        status: usable ? "context_adding" : "not_found"
      }
    }

    case "ADD_CONTEXT":
      return addContext(session, makeSnippet(msg.text, sender))

    case "REMOVE_CONTEXT":
      return {
        ...session,
        context: session.context.filter((_, i) => i !== msg.index)
      }

    case "START_COMPOSE":
      if (!session.contact) return session
      return { ...session, status: "composing" }

    case "UPDATE_DRAFT":
      return { ...session, draft: msg.draft }

    case "SEND":
      return { ...session, status: "sent" }

    case "SAVE_DRAFT":
      return { ...session, status: "draft_saved" }

    case "DISMISS":
      // Hide the popup but keep a locked contact + context alive across tabs.
      return session.locked
        ? { ...session, status: "context_adding" }
        : emptySession()

    case "RESET":
      return emptySession()

    case "GET_STATE":
      return session

    default:
      return session
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender, sendResponse) => {
  ;(async () => {
    const current = await loadSession()
    const next = reduce(current, msg, sender)
    if (next !== current) {
      await saveSession(next)
      // GET_STATE is a pure read; everything else may have changed state.
      if (msg.type !== "GET_STATE") await broadcast(next)
    }
    sendResponse(next)
  })()
  return true // keep the message channel open for the async response
})

// Make sure we start each browser session clean.
chrome.runtime.onStartup.addListener(() => {
  void saveSession(emptySession())
})

// ---------------------------------------------------------------------------
// Toolbar icon state: colored where Nudge can act, greyed out where it can't.
// Nudge's content scripts only run on https:// pages, so anywhere else (http,
// chrome://, file://, the New Tab page, the web store) we have no access and
// the icon is desaturated to signal that.
// ---------------------------------------------------------------------------

const ICON_SIZES = [16, 32, 48, 128]
const ACCESS_RE = /^https:\/\//i

let iconCache: {
  color: Record<number, ImageData>
  grey: Record<number, ImageData>
} | null = null

/** Decode the logo once and pre-render both color and greyscale ImageData. */
async function getIcons() {
  if (iconCache) return iconCache
  const bitmap = await createImageBitmap(await (await fetch(iconDataUri)).blob())
  const color: Record<number, ImageData> = {}
  const grey: Record<number, ImageData> = {}

  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(bitmap, 0, 0, size, size)

    color[size] = ctx.getImageData(0, 0, size, size)

    const g = ctx.getImageData(0, 0, size, size)
    const d = g.data
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      d[i] = d[i + 1] = d[i + 2] = lum
      d[i + 3] = Math.round(d[i + 3] * 0.55) // fade it to read as "disabled"
    }
    grey[size] = g
  }

  iconCache = { color, grey }
  return iconCache
}

async function updateActionIcon(tabId: number, url?: string) {
  try {
    const { color, grey } = await getIcons()
    const hasAccess = !!url && ACCESS_RE.test(url)
    await chrome.action.setIcon({
      tabId,
      imageData: hasAccess ? color : grey
    })
  } catch {
    // Tab closed mid-update, or OffscreenCanvas unsupported — ignore.
  }
}

// Re-evaluate whenever the active tab changes or a tab navigates.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab) void updateActionIcon(tabId, tab.url)
})

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" || info.url) void updateActionIcon(tabId, tab.url)
})

// Paint the correct state for already-open tabs on install/startup.
async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id != null) void updateActionIcon(tab.id, tab.url)
  }
}
chrome.runtime.onInstalled.addListener(() => void refreshAllTabs())
chrome.runtime.onStartup.addListener(() => void refreshAllTabs())
