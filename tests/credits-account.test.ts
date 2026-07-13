import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  creditAccount: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { ensureAccount } from "@/lib/credits";

describe("积分账户初始化反套利", () => {
  beforeEach(() => vi.clearAllMocks());

  it("未验证的新账号只创建零余额账户，不生成注册赠送", async () => {
    mockPrisma.creditAccount.findUnique.mockResolvedValue(null);
    mockPrisma.creditAccount.create.mockResolvedValue({
      userId: "user-new",
      balance: 0,
      totalEarned: 0,
    });

    await expect(ensureAccount("user-new")).resolves.toMatchObject({ balance: 0, totalEarned: 0 });
    expect(mockPrisma.creditAccount.create).toHaveBeenCalledWith({
      data: { userId: "user-new", balance: 0, totalEarned: 0 },
    });
    expect(mockPrisma).not.toHaveProperty("creditLedger");
  });

  it("已有账户原样返回，不覆盖历史余额", async () => {
    const existing = { userId: "user-old", balance: 125, totalEarned: 200 };
    mockPrisma.creditAccount.findUnique.mockResolvedValue(existing);

    await expect(ensureAccount("user-old")).resolves.toBe(existing);
    expect(mockPrisma.creditAccount.create).not.toHaveBeenCalled();
  });

  it("并发创建撞唯一约束时重读已创建账户", async () => {
    mockPrisma.creditAccount.findUnique.mockResolvedValue(null);
    mockPrisma.creditAccount.create.mockRejectedValue({ code: "P2002" });
    mockPrisma.creditAccount.findUniqueOrThrow.mockResolvedValue({ userId: "user-race", balance: 0 });

    await expect(ensureAccount("user-race")).resolves.toMatchObject({ userId: "user-race", balance: 0 });
  });
});
