"use client";

import { useEffect, useState } from "react";

const STORAGE_NAME = "portal:business";

/** The owner's selected business, remembered per browser (demo has two). */
export function useBusiness(defaultId = "ctr_sparkle") {
  const [id, setId] = useState(defaultId);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_NAME);
        if (saved) setId(saved);
      } catch {
        /* storage unavailable */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const choose = (next: string) => {
    setId(next);
    try {
      localStorage.setItem(STORAGE_NAME, next);
    } catch {
      /* storage unavailable */
    }
  };
  return [id, choose] as const;
}
