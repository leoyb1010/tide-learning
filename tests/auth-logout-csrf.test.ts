import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ destroySession: vi.fn() }));
vi.mock("@/lib/session", () => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) { super(message); this.status = status; }
  }
  return { AuthError, destroySession: mocks.destroySession };
});

import { POST } from "@/app/api/auth/logout/route";

function request(origin: string, bearer = false) {
  return new NextRequest("http://127.0.0.1:3101/api/auth/logout", {
    method: "POST",
    headers: {
      origin,
      host: "127.0.0.1:3101",
      ...(bearer ? { authorization: "Bearer native-session-token" } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.destroySession.mockResolvedValue(undefined);
});

describe("logout CSRF boundary", () => {
  it("rejects a cross-origin cookie logout without destroying the session", async () => {
    const response = await POST(request("https://evil.example"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: "跨域请求被拒绝" });
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("allows same-origin browser logout", async () => {
    const response = await POST(request("http://127.0.0.1:3101"));
    expect(response.status).toBe(200);
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });

  it("allows native Bearer logout regardless of browser Origin", async () => {
    const response = await POST(request("https://evil.example", true));
    expect(response.status).toBe(200);
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });
});
