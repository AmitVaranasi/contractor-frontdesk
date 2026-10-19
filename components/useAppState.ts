"use client";

import { useCallback, useEffect, useState } from "react";

// Mirrors GET /api/state. Kept loose on purpose; the server is the source of truth.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppState = any;

export function useAppState(intervalMs = 2000) {
  const [state, setState] = useState<AppState | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      // keep last good state
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, intervalMs]);
  return { state, refresh };
}
