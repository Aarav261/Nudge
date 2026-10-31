// Toolbar popup: holds the capture token that lets the extension save leads.

import { useEffect, useState } from "react"

import { APP_URL, TOKEN_KEY } from "~lib/types"

function IndexPopup() {
  const [token, setToken] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local
      .get(TOKEN_KEY)
      .then((stored) => setToken((stored[TOKEN_KEY] as string) ?? ""))
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = token.trim()
    if (value) await chrome.storage.local.set({ [TOKEN_KEY]: value })
    else await chrome.storage.local.remove(TOKEN_KEY)
    setToken(value)
    setSaved(true)
  }

  return (
    <form onSubmit={save} style={shell}>
      <strong style={{ fontSize: 14, color: "#36317B" }}>Nudge</strong>
      <label htmlFor="token" style={{ color: "#555" }}>
        Capture token
      </label>
      <input
        id="token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => {
          setToken(e.target.value)
          setSaved(false)
        }}
        style={input}
      />
      <button type="submit" style={button}>
        Save token
      </button>
      {saved && <p style={{ margin: 0, color: "#555" }}>Token saved.</p>}
      <a href={`${APP_URL}/app`} target="_blank" style={{ color: "#4741A4" }}>
        Get a token from the Nudge app
      </a>
    </form>
  )
}

const shell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: 260,
  padding: 12,
  font: "13px/1.4 -apple-system, system-ui, sans-serif"
}
const input: React.CSSProperties = {
  padding: 6,
  border: "1px solid #4741A433",
  borderRadius: 7,
  font: "inherit"
}
const button: React.CSSProperties = {
  padding: "7px 10px",
  border: "none",
  borderRadius: 7,
  background: "#4741A4",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
}

export default IndexPopup
