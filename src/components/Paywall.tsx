"use client";

import Link from "next/link";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { Button } from "./ui";
import { track } from "@/lib/analytics-client";

/**
 * Paywall — 水面遮罩隐喻：后续内容沉入半透明波动水面之下，
 * 主 CTA 浮在水面上。不制造焦虑、不倒计时，明确解锁内容与取消方式（A3-6）。
 */
export function Paywall({
  remainingLessons,
  courseTitle,
  isLoggedIn,
  returnTo,
}: {
  remainingLessons: number;
  courseTitle: string;
  isLoggedIn: boolean;
  returnTo: string;
}) {
  const pricingHref = `/pricing?next=${encodeURIComponent(returnTo)}`;
  const loginHref = `/login?next=${encodeURIComponent(returnTo)}`;
  // 次级链接 = 放弃订阅、先去别处逛逛，记录 paywall_dismiss 用于转化分析
  const onDismiss = () => {
    track("paywall_dismiss", { courseTitle, remainingLessons });
  };

  return (
    <div className="mx-auto max-w-lg overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      {/* 水面区：沉入水下的内容预览 + 波动水面 + 浮出的主张 */}
      <div className="relative isolate overflow-hidden px-8 pb-2 pt-10">
        {/* 沉入水下的“后续章节”虚影 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-6 top-6 space-y-2 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 rounded-full bg-ink-200" style={{ width: `${88 - i * 16}%` }} />
          ))}
        </div>

        {/* 波动水面：两层正弦 SVG 缓慢横移（wave-x），点题潮汐 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-14 -z-10 h-24 overflow-hidden">
          <svg className="absolute bottom-0 left-0 h-full w-[200%] [animation:wave-x_9s_linear_infinite] motion-reduce:animate-none" viewBox="0 0 1440 120" preserveAspectRatio="none" fill="none">
            <path d="M0 60 Q180 20 360 60 T720 60 T1080 60 T1440 60 V120 H0 Z" fill="rgba(252,1,26,0.06)" />
          </svg>
          <svg className="absolute bottom-0 left-0 h-full w-[200%] [animation:wave-x_6s_linear_infinite_reverse] motion-reduce:animate-none" viewBox="0 0 1440 120" preserveAspectRatio="none" fill="none">
            <path d="M0 70 Q180 40 360 70 T720 70 T1080 70 T1440 70 V120 H0 Z" fill="rgba(252,1,26,0.10)" />
          </svg>
        </div>

        {/* 浮在水面上的主张 */}
        <div className="relative mt-8 text-center">
          <h3 className="text-lg font-semibold tracking-tight text-ink-950">
            还有 <span className="num text-accent-700">{remainingLessons}</span> 讲沉在水面下
          </h3>
          <p className="mt-2 text-sm text-ink-500">订阅《{courseTitle}》所在赛道，让全部章节浮出水面</p>
        </div>
      </div>

      <div className="px-8 pb-8 pt-2 text-center">
        <ul className="mx-auto mt-3 max-w-xs space-y-2 text-left text-sm text-ink-600">
          {["实战模板与案例拆解", "每周持续更新", "无限笔记 + 时间戳锚点", "笔记永久保留，随时可取消"].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <Check size={15} weight="bold" className="shrink-0 text-accent-600" />
              {t}
            </li>
          ))}
        </ul>

        {/* 单一主 CTA + 次级文字链接（A3-6） */}
        <div className="mt-7">
          <Button href={pricingHref} variant="primary" size="lg" icon full>
            {isLoggedIn ? "查看订阅方案" : "查看订阅方案"}
          </Button>
        </div>
        <p className="mt-4 text-sm">
          {isLoggedIn ? (
            <Link href="/courses" onClick={onDismiss} className="link-underline text-ink-400 hover:text-ink-600">
              先去逛逛其他免费试学的课程
            </Link>
          ) : (
            <Link href={loginHref} onClick={onDismiss} className="link-underline text-ink-400 hover:text-ink-600">
              已有账号？登录后继续
            </Link>
          )}
        </p>
        <p className="num mt-4 text-[0.72rem] text-ink-400">连续包月首月 ¥19.9，之后 ¥99/月 · 随时可取消</p>
      </div>
    </div>
  );
}
