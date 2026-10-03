"use client";
import { useEffect, useState } from "react";

/** Hydrate against the server snapshot; refresh relative labels after hydration. */
export function useHydratedClock(serverNow = 0) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
