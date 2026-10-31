// Toolbar popup: shows whether the extension is connected to a Nudge account.
// Sign-in happens on the app, which hands the token to contents/app-connect.ts.

import { useEffect, useState } from "react"

import { APP_URL, TOKEN_KEY } from "~lib/types"

function IndexPopup() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    chrome.storage.local
      .get(TOKEN_KEY)
      .then((stored) => setConnected(Boolean(stored[TOKEN_KEY])))
  }, [])

  const signOut = async () => {
    await chrome.storage.local.remove(TOKEN_KEY)
    setConnected(false)
  }

  return (
    <div style={shell}>
      <strong style={{ fontSize: 14, color: "#36317B" }}>Nudge</strong>
      {connected ? (
        <>
          <p style={{ margin: 0, color: "#555" }}>Signed in. Leads save to your account.</p>
          <button type="button" onClick={signOut} style={button}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: "#555" }}>Sign in to save leads to your account.</p>
          <a href={`${APP_URL}/app`} target="_blank" style={button}>
            Sign in to Nudge
          </a>
        </>
      )}
    </div>
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
const button: React.CSSProperties = {
  padding: "7px 10px",
  border: "none",
  borderRadius: 7,
  background: "#4741A4",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "center",
  textDecoration: "none"
}

export default IndexPopup
