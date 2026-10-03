"use client";

import { useCallback, useEffect, useRef } from "react";

/** A completed request may notify only the panel that still owns it. */
export function useActiveCallback<T extends unknown[]>(callback: (...args: T) => void) {
  const active = useRef(true);
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  return useCallback((...args: T) => {
    if (active.current) latest.current(...args);
  }, []);
}
