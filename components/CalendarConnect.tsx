"use client";

import { useState } from "react";

/** Mock Google OAuth consent for the demo; the real flow would redirect to accounts.google.com. */
export function CalendarConnect({ contractorId, connection, defaultAccount, onChange }: { contractorId: string; connection: { account: string; connectedAt: string } | null; defaultAccount: string; onChange: () => void }) {
  const [consent, setConsent] = useState(false);
  const [account, setAccount] = useState(defaultAccount);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(action: "connect" | "disconnect") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractorId, action, account }) });
    const j = await res.json();
    setBusy(false);
    setConsent(false);
    if (!res.ok) setMsg(j.error);
    else if (action === "connect") setMsg(`Imported ${j.imported} busy blocks. Sam now checks them on every call.`);
    onChange();
  }

  if (connection) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="pill bg-ok-soft text-ok">connected</span> Google Calendar · {connection.account} <span className="text-xs text-muted">(demo data)</span>
        </span>
        <span className="flex gap-2">
          <button className="btn btn-ghost text-xs" onClick={() => call("connect")} disabled={busy}>Re-sync</button>
          <button className="btn btn-ghost text-xs" onClick={() => call("disconnect")} disabled={busy}>Disconnect</button>
        </span>
        {msg && <span className="w-full text-xs text-ok">{msg}</span>}
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {!consent ? (
        <button className="btn" onClick={() => setConsent(true)}>Connect Google Calendar</button>
      ) : (
        <div className="space-y-3 rounded-xl border border-line bg-bg p-4">
          <div className="font-medium">Sign in with Google <span className="text-xs font-normal text-muted">(simulated for the demo)</span></div>
          <input className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" value={account} onChange={(e) => setAccount(e.target.value)} />
          <div className="text-xs text-muted">Front Desk Co. wants to:</div>
          <ul className="list-inside list-disc text-xs">
            <li>See your free/busy times, so Sam only offers times you&apos;re free</li>
            <li>Add the appointments Sam books</li>
          </ul>
          <div className="flex gap-2">
            <button className="btn" onClick={() => call("connect")} disabled={busy}>{busy ? "Connecting…" : "Allow"}</button>
            <button className="btn btn-ghost" onClick={() => setConsent(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-bad">{msg}</p>}
    </div>
  );
}
