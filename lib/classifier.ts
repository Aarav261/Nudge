// Regex-based classifier that maps a highlighted string to a ContactType.

import type { ContactType } from "~lib/types"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 7–15 digits, optional country code, common separators.
const PHONE_RE =
  /^[+]?[(]?\d{1,4}[)]?[-\s.]?\d{2,4}[-\s.]?\d{2,4}([-\s.]?\d{2,4})?$/
// ISO and day-first dates, which PHONE_RE would otherwise accept.
const DATE_RE = /^(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/
// Whole-string only, so prose containing a link isn't taken for a contact.
const LINKEDIN_RE = /^(https?:\/\/)?([\w-]+\.)?linkedin\.com\/(in|pub)\/\S+$/i
const TWITTER_RE =
  /(^@[A-Za-z0-9_]{1,15}$)|(^(https?:\/\/)?([\w-]+\.)?(twitter|x)\.com\/[A-Za-z0-9_]+\S*$)/i
const URL_RE = /^https?:\/\/.+/i
// Rough name heuristic: 2–4 capitalized words (allows accents, hyphens, O'Brien).
const NAME_RE = /^([A-ZÀ-Ý][\w'’-]+)(\s+[A-ZÀ-Ý][\w'’-]+){1,3}$/
// ponytail: leading words that mark UI copy or places, not people. Still misses
// plenty ("Hello World"); replace with /extract-contact NER when that exists.
const NOT_NAME_RE =
  /^(about|contact|get|hello|home|learn|log|more|new|our|read|see|show|sign|start|the|view)\b/i

/** Loosely require enough digits for a phone before trusting PHONE_RE. */
const looksLikePhone = (t: string) => {
  const digits = t.replace(/\D/g, "")
  return (
    digits.length >= 7 &&
    digits.length <= 15 &&
    !DATE_RE.test(t) &&
    PHONE_RE.test(t)
  )
}

export function classifyContact(raw: string): ContactType {
  const t = raw.trim()
  if (!t) return "unknown"
  if (EMAIL_RE.test(t)) return "email"
  if (LINKEDIN_RE.test(t)) return "linkedin"
  if (TWITTER_RE.test(t)) return "twitter"
  if (looksLikePhone(t)) return "phone"
  if (URL_RE.test(t)) return "url"
  if (NAME_RE.test(t) && !NOT_NAME_RE.test(t)) return "name"
  return "unknown"
}

/** Whether a highlight is worth surfacing the popup for at all. */
export function isActionable(type: ContactType): boolean {
  return type !== "unknown" && type !== "url"
}
