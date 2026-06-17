// Background service worker: the single source of truth for Nudge.
//
// Owns the NudgeSession state machine and chrome.storage.session. Content
// scripts send messages here; every state change is persisted and broadcast
// to all tabs so the compose popup stays in sync (cross-tab accumulation).

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
        const snippet = makeSnippet(msg.contact.text, sender)
        if (!snippet.text) return session
        return {
          ...session,
          context: [...session.context, snippet],
          // Don't yank the user out of composing; only nudge idle→context_adding.
          status:
            session.status === "composing" ? "composing" : "context_adding"
        }
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

    case "ADD_CONTEXT": {
      const snippet = makeSnippet(msg.text, sender)
      if (!snippet.text) return session
      return {
        ...session,
        context: [...session.context, snippet],
        status: session.status === "composing" ? "composing" : "context_adding"
      }
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
