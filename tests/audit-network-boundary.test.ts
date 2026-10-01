import { expect, it, vi } from "vitest";
import { restrictToLocalApp } from "../scripts/audit-browser-network.mjs";
it("only permits the same isolated application and local object URLs", async () => {
  let handler: (route: unknown) => Promise<void> = async () => {};
  const context = { routeWebSocket: vi.fn(), route: vi.fn(async (_pattern: string, callback: typeof handler) => { handler = callback; }) };
  await restrictToLocalApp(context, "http://127.0.0.1:3100");
  for (const [url, allowed] of [["http://127.0.0.1:3100/api/notes", true], ["http://localhost:3100/asset.png", true], ["https://example.com/telemetry", false], ["http://127.0.0.1:9999/", false], ["http://169.254.169.254/", false]] as const) {
    const route = { request: () => ({ url: () => url }), continue: vi.fn(), abort: vi.fn() };
    await handler(route);
    expect(route.continue).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(route.abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
  }
});
it("refuses to audit a production origin", async () => {
  await expect(restrictToLocalApp({}, "https://production.example")).rejects.toThrow(/loopback/);
});
