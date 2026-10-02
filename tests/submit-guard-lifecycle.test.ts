// Real React hook lifecycle, synthetic promises and timers; no browser/provider traffic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";

let root: Root;
let dom: JSDOM;
let hook: ReturnType<typeof useSubmitGuard<[], string>>;
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(r => { resolve = r; });
  return { promise, resolve };
}
function mount(fn: () => Promise<string>, timeout = 20) {
  function Harness() { hook = useSubmitGuard(fn, timeout); return null; }
  act(() => root.render(createElement(Harness)));
}
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("submit guard ownership across timeouts and resets", () => {
  it("blocks same-tick double submission", async () => {
    const first = deferred(); const fn = vi.fn(() => first.promise); mount(fn);
    let result!: Promise<string | undefined>;
    act(() => { result = hook.guard(); void hook.guard(); });
    expect(fn).toHaveBeenCalledTimes(1); expect(hook.submitting).toBe(true);
    await act(async () => { first.resolve("saved"); await result; });
    expect(hook.submitting).toBe(false);
  });
  it.each(["resolve", "reject"])("a stale %s must not unlock a newer submission", async mode => {
    const first = deferred(); const second = deferred();
    let reject!: (e: Error) => void;
    const stale = mode === "resolve" ? first.promise : new Promise<string>((_, r) => { reject = r; });
    const fn = vi.fn().mockReturnValueOnce(stale).mockReturnValue(second.promise); mount(fn);
    let pending!: Promise<unknown>;
    act(() => { pending = hook.guard().catch(() => undefined); });
    act(() => vi.advanceTimersByTime(20)); expect(hook.submitting).toBe(false);
    act(() => { void hook.guard(); }); expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => { if (mode === "resolve") first.resolve("old"); else reject(new Error("old")); await pending; });
    expect(hook.submitting).toBe(true);
    act(() => { void hook.guard(); }); expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve("new"); });
    expect(hook.submitting).toBe(false);
  });
  it("reset invalidates old completion without clearing the successor's timer", async () => {
    const first = deferred(); const second = deferred();
    const fn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValue(second.promise); mount(fn);
    let pending!: Promise<unknown>;
    act(() => { pending = hook.guard(); hook.reset(); void hook.guard(); });
    await act(async () => { first.resolve("old"); await pending; });
    expect(hook.submitting).toBe(true);
    act(() => vi.advanceTimersByTime(20)); expect(hook.submitting).toBe(false);
    await act(async () => { second.resolve("new"); });
  });
  it("zero timeout keeps the request locked until settlement", async () => {
    const first = deferred(); const fn = vi.fn(() => first.promise); mount(fn, 0);
    act(() => { void hook.guard(); vi.advanceTimersByTime(60_000); void hook.guard(); });
    expect(fn).toHaveBeenCalledTimes(1); expect(hook.submitting).toBe(true);
    await act(async () => { first.resolve("ok"); }); expect(hook.submitting).toBe(false);
  });
});
