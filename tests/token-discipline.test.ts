import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * token 纪律护栏（2026-07-20）——防止「半步字号」与「中段奇数圆角」漂移回潮。
 *
 * 背景：Tailwind 任意值 text-[12.5px]/13.5px 等半步字号(曾 238 处)与 rounded-[9/11/13px] 奇数圆角
 * 是设计 token 漂移的病灶。已一次性就近归并(半步→整数 0.5px；奇数→偶数 1px，均不可见)。
 * 本测试扫描 src/**，一旦新代码再引入这些病态值即红，逼开发用规范档位。
 * （整数字号 12/13/14 与偶数圆角是有意的细粒度档位，不在禁列。）
 */

const BANNED = [
  { re: /text-\[[0-9]+\.[0-9]+px\]/g, name: "半步字号 text-[N.Npx]（用就近整数 px 档）" },
  { re: /rounded-\[(?:9|11|13)px\]/g, name: "中段奇数圆角 rounded-[9/11/13px]（用 10/12/14）" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("token 纪律护栏", () => {
  const files = walk(join(process.cwd(), "src"));

  for (const { re, name } of BANNED) {
    it(`src/** 不得出现${name}`, () => {
      const hits: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        const m = src.match(re);
        if (m) hits.push(`${f.replace(process.cwd() + "/", "")}: ${[...new Set(m)].join(", ")}`);
      }
      expect(hits, `发现被禁 token（就近归并到规范档位）：\n${hits.join("\n")}`).toEqual([]);
    });
  }
});
