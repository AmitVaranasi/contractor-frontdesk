"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";

/** Sam's Masky talking-head recap of a call. Media URLs are re-signed on load (they expire hourly). */
export function CallRecap({ callId, status, text }: { callId: string; status: string | null; text: string | null }) {
  const [media, setMedia] = useState<{ videoUrl?: string | null; audioUrl?: string | null; liveUrl?: string | null } | null>(null);
  const [requested, setRequested] = useState(false);
  const ready = status === "video" || status === "audio";

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetch(`/api/calls/recap?id=${callId}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setMedia(j))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [callId, ready]);

  async function make() {
    setRequested(true);
    await fetch("/api/calls/recap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: callId }) });
  }

  if (!status || status.startsWith("failed")) {
    return (
      <button className="btn btn-ghost text-xs" onClick={make} disabled={requested}>
        {requested ? "Sam is recording…" : status ? "Retry Masky recap" : "🎬 Create Sam's video recap"}
      </button>
    );
  }
  if (status === "rendering" || status === "text-only" || status === "skipped") {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-bg p-2 text-xs">
        <Avatar agent="sam" size={28} />
        <div>
          <div className="font-medium">{status === "rendering" ? "Sam is recording a video recap (≈1 min)…" : "Recap (Masky not available)"}</div>
          {text && <p className="text-muted">{text}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-lg bg-bg p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">🎬 Sam&apos;s recap (Masky {status})</span>
        {media?.liveUrl && (
          <a className="text-accent" href={media.liveUrl} target="_blank" rel="noreferrer">
            open in Masky ↗
          </a>
        )}
      </div>
      {media?.videoUrl ? (
        <video controls preload="metadata" src={media.videoUrl} className="aspect-square w-full max-w-xs rounded-lg bg-black" />
      ) : media?.audioUrl ? (
        <audio controls src={media.audioUrl} className="w-full" />
      ) : (
        <p className="text-xs text-muted">Loading…</p>
      )}
      {text && <p className="text-xs text-muted">{text}</p>}
    </div>
  );
}
