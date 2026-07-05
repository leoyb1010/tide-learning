"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import {
  NotePencil,
  ClockCounterClockwise,
  Sparkle,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { LightUp } from "@/components/motion";
import { useStudyRoom } from "./StudyRoomContext";

/* ============================================================
   第二幕 · 走近书桌（滚动 1-2 屏）= 替代原三引擎
   position sticky + useScroll 进度驱动「镜头推近」：书桌 scale/translate 放大。
   桌面三件物件逐个「点亮」讲功能（与 STUDIO「点亮 Light-Up」签名同族）：
     笔记本（边学边记）→ 卡片盒（到点复习）→ 台灯（AI 伴侣）。

   深浅色（问题⑧-5）：场景底/墨阶/材质走 --scene-* —— 浅=晨光亮场、暗=夜航暗场，跟随系统。
   宽屏响应式（问题⑧-1）：内容列 max-w 阶梯 860→lg:1040→xl:1200→2xl:1360，
     标题/卡片/图标同步随视口放大，三列卡在宽屏更舒展。

   降级：
   - reduce-motion / 移动端（!immersive）→ 不 sticky、不推近，三物件退为
     纵向 Reveal 卡片，光影用静态渐变保留氛围，内容完整可读。
   ============================================================ */

interface DeskObject {
  key: string;
  Icon: Icon;
  eyebrow: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  tint: string;
  soft: string;
}

const DESK_OBJECTS: DeskObject[] = [
  {
    key: "notebook",
    Icon: NotePencil,
    eyebrow: "桌上的笔记本",
    title: "边学边记",
    desc: "视频与课件在同一张桌面。截帧、划线、AI 帮你整理，看到哪记到哪，笔记永久保存。",
    href: "/create",
    cta: "把资料变成一门课",
    tint: "var(--info)",
    soft: "var(--info-soft)",
  },
  {
    key: "cardbox",
    Icon: ClockCounterClockwise,
    eyebrow: "桌角的卡片盒",
    title: "到点复习",
    desc: "学过的要点自动进复习队列，按间隔重复推到眼前。不是学完就忘，是真的记住。",
    href: "/courses",
    cta: "看看课程库",
    tint: "var(--warn)",
    soft: "var(--warn-soft)",
  },
  {
    key: "lamp",
    Icon: Sparkle,
    eyebrow: "亮着的台灯",
    title: "AI 学习伴侣",
    desc: "台灯下的那个人，读完了你的整门课。学到哪问到哪，随时答疑、带你复盘。",
    href: "/create",
    cta: "去造一门课",
    tint: "var(--red)",
    soft: "var(--red-soft)",
  },
];

export function ActTwo() {
  const { immersive } = useStudyRoom();

  // 降级路径：不 sticky、不推近，纵向 Reveal 卡片（内容完整、光影静态）。
  if (!immersive) {
    return <ActTwoStatic />;
  }
  return <ActTwoImmersive />;
}

/* ---------- 沉浸态：sticky 舞台 + 滚动镜头推近 ---------- */
function ActTwoImmersive() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // 镜头推近：书桌随滚动 scale 1→1.16 + 轻微上移（走近书桌）。
  const deskScale = useTransform(scrollYProgress, [0, 1], [1, 1.16]);
  const deskY = useTransform(scrollYProgress, [0, 1], [0, -40]);
  // 环境暗角随推近略收拢，聚焦到桌面。
  const vignette = useTransform(scrollYProgress, [0, 1], [0.28, 0.5]);

  return (
    <section ref={ref} aria-label="走近书桌" className="relative h-[380vh]">
      {/* sticky 舞台：钉住一屏，滚动进度驱动其内容变化 */}
      <div
        className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 40%, var(--scene-bg-1) 0%, var(--scene-bg-2) 55%, var(--scene-bg-3) 100%)",
        }}
      >
        {/* 暗角遮罩：随推近收拢（主题跟随：浅场几乎不压，暗场明显收拢） */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(72% 72% at 50% 45%, transparent 40%, var(--scene-vignette) 100%)",
            opacity: vignette,
          }}
        />

        {/* 台灯暖光：桌面主光源，柔和常亮（呼吸靠 CSS） */}
        <div
          aria-hidden
          className="lamp-breathe pointer-events-none absolute left-1/2 top-[28%] h-[440px] w-[440px] -translate-x-1/2 rounded-full xl:h-[560px] xl:w-[560px]"
          style={{ background: "var(--scene-lamp)" }}
        />

        {/* 书桌 + 三物件：随滚动推近。宽屏 max-w 阶梯放宽。 */}
        <motion.div
          className="relative z-[1] w-full max-w-[860px] px-6 lg:max-w-[1040px] lg:px-10 xl:max-w-[1200px] 2xl:max-w-[1360px]"
          style={{ scale: deskScale, y: deskY }}
        >
          <div className="mb-9 text-center lg:mb-12">
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
              CORE ENGINES · 走近这张桌子
            </p>
            <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[30px] lg:text-[40px] xl:text-[48px]">
              一张书桌,装下完整的学习闭环
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:gap-6 xl:gap-8">
            {DESK_OBJECTS.map((o, i) => (
              <DeskObjectCard key={o.key} object={o} progress={scrollYProgress} index={i} />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** 单个桌面物件：滚动到「它的段落」时点亮（亮度/透明/上浮 + 光扫）。 */
function DeskObjectCard({
  object,
  progress,
  index,
}: {
  object: DeskObject;
  progress: MotionValue<number>;
  index: number;
}) {
  // 三物件在滚动进度上分三段依次点亮（0.12→、0.38→、0.64→）。
  const start = 0.12 + index * 0.26;
  const lit = useTransform(progress, [start, start + 0.14], [0, 1]);
  const opacity = useTransform(lit, [0, 1], [0.32, 1]);
  const y = useTransform(lit, [0, 1], [24, 0]);
  const glowOpacity = useTransform(lit, [0, 1], [0, 1]);
  // 暗态一层罩降低亮度感（点亮时淡出）。用 overlay opacity 替代 filter:brightness，走合成层。
  const dimOverlay = useTransform(lit, [0, 1], [0.5, 0]);

  return (
    <motion.div style={{ opacity, y }} className="relative">
      <Link
        href={object.href}
        className="studio-lift group relative flex h-full flex-col overflow-hidden rounded-[16px] border p-5 lg:rounded-[20px] lg:p-7"
        style={{
          borderColor: "var(--scene-hairline)",
          background: "var(--scene-card)",
          boxShadow: "var(--scene-card-shadow-sm)",
        }}
      >
        {/* 点亮时物件顶部一圈暖光晕（signature Light-Up 同族） */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-6 -top-8 h-28 w-32 rounded-full blur-2xl"
          style={{
            opacity: glowOpacity,
            background: `radial-gradient(circle, ${object.tint}, transparent 68%)`,
          }}
        />
        {/* 暗态罩：盖一层场景暗角色半透罩压低亮度，点亮时随 lit 淡出，只走 opacity 合成。 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[16px] lg:rounded-[20px]"
          style={{ opacity: dimOverlay, background: "var(--scene-vignette)" }}
        />
        <p className="mono relative text-[10px] uppercase tracking-[0.14em] text-[var(--scene-ink-3)] lg:text-[11px]">
          {object.eyebrow}
        </p>
        <div
          className="relative mt-3 flex h-[42px] w-[42px] items-center justify-center rounded-[12px] lg:mt-4 lg:h-[52px] lg:w-[52px] lg:rounded-[14px]"
          style={{ background: object.soft, color: object.tint }}
        >
          <object.Icon size={21} weight="fill" className="lg:hidden" />
          <object.Icon size={26} weight="fill" className="hidden lg:block" />
        </div>
        <h3 className="relative mt-4 text-[17px] font-bold text-[var(--scene-ink)] lg:mt-5 lg:text-[22px]">
          {object.title}
        </h3>
        <p className="relative mt-2 flex-1 text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:mt-3 lg:text-[15px] lg:leading-[1.75]">
          {object.desc}
        </p>
        <span className="relative mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--scene-ink)] lg:mt-6 lg:text-[14px]">
          {object.cta}
          <ArrowRight
            size={13}
            weight="bold"
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </motion.div>
  );
}

/* ---------- 降级态：静态分层，纵向淡入（reduce-motion / 移动端） ---------- */
function ActTwoStatic() {
  return (
    <section
      aria-label="走近书桌"
      className="relative w-full overflow-hidden px-6 py-20 lg:py-28"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 20%, var(--scene-bg-1) 0%, var(--scene-bg-2) 60%, var(--scene-bg-3) 100%)",
      }}
    >
      {/* 静态台灯光晕（无呼吸），保留氛围 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-[300px] w-[300px] -translate-x-1/2 rounded-full"
        style={{ background: "var(--scene-lamp)" }}
      />
      <div className="relative mx-auto max-w-[720px] lg:max-w-[980px]">
        <div className="mb-8 text-center lg:mb-11">
          <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
            CORE ENGINES · 走近这张桌子
          </p>
          <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] lg:text-[36px]">
            一张书桌,装下完整的学习闭环
          </h2>
        </div>
        <div className="flex flex-col gap-4 lg:gap-5">
          {/* 降级态也走同一套「点亮」语言（<LightUp> 视口触发，赛道色光晕）。 */}
          {DESK_OBJECTS.map((o, i) => (
            <LightUp
              key={o.key}
              glowColor={`color-mix(in srgb, ${o.tint} 22%, transparent)`}
              delay={i * 0.06}
            >
              <Link
                href={o.href}
                className="studio-lift group relative flex items-start gap-4 overflow-hidden rounded-[16px] border p-5 lg:gap-5 lg:rounded-[20px] lg:p-6"
                style={{
                  borderColor: "var(--scene-hairline)",
                  background: "var(--scene-card)",
                  boxShadow: "var(--scene-card-shadow-sm)",
                }}
              >
                <div
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] lg:h-[52px] lg:w-[52px] lg:rounded-[14px]"
                  style={{ background: o.soft, color: o.tint }}
                >
                  <o.Icon size={21} weight="fill" className="lg:hidden" />
                  <o.Icon size={26} weight="fill" className="hidden lg:block" />
                </div>
                <div className="min-w-0">
                  <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--scene-ink-3)] lg:text-[11px]">
                    {o.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[16px] font-bold text-[var(--scene-ink)] lg:text-[20px]">
                    {o.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:text-[15px]">
                    {o.desc}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--scene-ink)] lg:text-[14px]">
                    {o.cta}
                    <ArrowRight
                      size={13}
                      weight="bold"
                      aria-hidden
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </Link>
            </LightUp>
          ))}
        </div>
      </div>
    </section>
  );
}
