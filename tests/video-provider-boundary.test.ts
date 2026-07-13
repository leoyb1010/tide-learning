import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { resolveVideoProvider } from "@/lib/video-gen";

afterEach(() => vi.unstubAllEnvs());

describe("视频生成生产边界", () => {
  it("生产环境未接真实 provider 时显式不可用，不生成 mock ready 资源", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const provider = resolveVideoProvider();
    expect(provider.name).toBe("unavailable");
    await expect(provider.generate({} as never)).rejects.toThrow(/真实视频生成提供商/);
  });

  it("非生产环境保留 mock 供编排开发", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(resolveVideoProvider().name).toBe("mock");
  });
});
