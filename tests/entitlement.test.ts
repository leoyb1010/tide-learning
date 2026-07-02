import { describe, it, expect, vi } from "vitest";

// entitlement.ts 顶层 import 了 ./db（prisma），只测纯函数，故 mock 掉以免实例化 prisma。
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  canAccessTrack,
  canAccessLesson,
  FREE_SNAPSHOT,
  type EntitlementSnapshot,
} from "@/lib/entitlement";

/** 构造快照的小工具（只覆盖判断相关字段）。 */
function snap(accessibleTracks: "all" | string[]): EntitlementSnapshot {
  return { ...FREE_SNAPSHOT, accessibleTracks, isSubscriber: true };
}

describe("canAccessTrack", () => {
  it('全站订阅（"all"）可访问任意赛道', () => {
    const s = snap("all");
    expect(canAccessTrack("finance", s)).toBe(true);
    expect(canAccessTrack("anything", s)).toBe(true);
  });

  it("单赛道订阅仅可访问其覆盖的赛道", () => {
    const s = snap(["finance", "design"]);
    expect(canAccessTrack("finance", s)).toBe(true);
    expect(canAccessTrack("design", s)).toBe(true);
    expect(canAccessTrack("coding", s)).toBe(false);
  });

  it("免费用户（空赛道列表）不可访问任何付费赛道", () => {
    expect(canAccessTrack("finance", FREE_SNAPSHOT)).toBe(false);
  });
});

describe("canAccessLesson", () => {
  it("免费章节任何人可学（不看订阅）", () => {
    expect(canAccessLesson("finance", true, FREE_SNAPSHOT)).toBe(true);
    expect(canAccessLesson("coding", true, snap(["design"]))).toBe(true);
  });

  it("付费章节需订阅且覆盖该赛道", () => {
    expect(canAccessLesson("finance", false, FREE_SNAPSHOT)).toBe(false);
    expect(canAccessLesson("finance", false, snap(["finance"]))).toBe(true);
    expect(canAccessLesson("finance", false, snap(["design"]))).toBe(false);
  });

  it("全站订阅可学任意付费章节", () => {
    expect(canAccessLesson("coding", false, snap("all"))).toBe(true);
  });
});

describe("FREE_SNAPSHOT", () => {
  it("免费快照默认不可投票、笔记上限为 3", () => {
    expect(FREE_SNAPSHOT.canVote).toBe(false);
    expect(FREE_SNAPSHOT.noteFreeLimit).toBe(3);
    expect(FREE_SNAPSHOT.accessLevel).toBe("free");
  });
});
