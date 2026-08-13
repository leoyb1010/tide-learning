import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindPresentationRequestId,
  clearPresentationRequestId,
  getOrCreatePresentationRequestId,
} from "@/lib/presentation-request-id";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() { return values.size; },
  } satisfies Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("browser presentation request id", () => {
  it("survives a component remount and only clears the exact terminal request", () => {
    const session = storage();
    let sequence = 0;
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("crypto", { randomUUID: () => `request-id-browser-${++sequence}-000000` });

    const first = getOrCreatePresentationRequestId("lesson:course-1:lesson-1");
    const afterRemount = getOrCreatePresentationRequestId("lesson:course-1:lesson-1");
    expect(afterRemount).toBe(first);

    clearPresentationRequestId("lesson:course-1:lesson-1", "request-id-stale-response-0000");
    expect(getOrCreatePresentationRequestId("lesson:course-1:lesson-1")).toBe(first);

    clearPresentationRequestId("lesson:course-1:lesson-1", first);
    expect(getOrCreatePresentationRequestId("lesson:course-1:lesson-1")).not.toBe(first);
  });

  it("rebinds a second tab to the server canonical request without stale clears", () => {
    const session = storage();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("crypto", { randomUUID: () => "request-id-tab-b-local-0001" });
    const scope = "lesson:course-1:lesson-1";
    const local = getOrCreatePresentationRequestId(scope);
    const canonical = "request-id-tab-a-canonical-01";

    expect(bindPresentationRequestId(scope, canonical)).toBe(canonical);
    expect(getOrCreatePresentationRequestId(scope)).toBe(canonical);
    clearPresentationRequestId(scope, local);
    expect(getOrCreatePresentationRequestId(scope)).toBe(canonical);
    expect(bindPresentationRequestId(scope, "bad id")).toBeNull();
  });
});
