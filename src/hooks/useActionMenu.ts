"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

/** Keyboard ownership for one-level action menus; pointer/focus dismissal never steals focus. */
export function useActionMenu(open: boolean, setOpen: (open: boolean) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialEdge = useRef<"first" | "last">("first");
  const id = useId();
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const entries = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
      (initialEdge.current === "last" ? entries.at(-1) : entries[0])?.focus();
      initialEdge.current = "first";
    });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, setOpen]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    initialEdge.current = event.key === "ArrowUp" ? "last" : "first";
    if (open) (initialEdge.current === "last" ? items().at(-1) : items()[0])?.focus();
    else setOpen(true);
  }
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return;
    }
    if (event.key === "Tab") {
      // Move the starting point out of the soon-to-unmount popup, then let the
      // browser perform native forward/backward tab navigation from the trigger.
      triggerRef.current?.focus(); setOpen(false); return;
    }
    const entries = items();
    if (!entries.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
    entries[next]?.focus();
  }
  function closeAfterAction() { setOpen(false); triggerRef.current?.focus(); }
  return { id, containerRef, triggerRef, menuRef, onTriggerKeyDown, onMenuKeyDown, closeAfterAction };
}
