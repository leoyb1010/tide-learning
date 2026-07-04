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
   信息 = 原三引擎三大能力的空间化讲法。

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
  // track：整段 4 屏高，进入到离开映射 0..1。
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // 镜头推近：书桌随滚动 scale 1→1.16 + 轻微上移（走近书桌）。
  const deskScale = useTransform(scrollYProgress, [0, 1], [1, 1.16]);
  const deskY = useTransform(scrollYProgress, [0, 1], [0, -40]);
  // 环境暗角随推近略收拢，聚焦到桌面。
  const vignette = useTransform(scrollYProgress, [0, 1], [0.35, 0.6]);

  return (
    <section ref={ref} aria-label="走近书桌" className="relative h-[380vh]">
      {/* sticky 舞台：钉住一屏，滚动进度驱动其内容变化 */}
      <div
        className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 40%, #161c28 0%, #0e131c 55%, #080a0e 100%)",
        }}
      >
        {/* —— 舞台底图：走近书桌·三物件舞台实景（studyroom-act2-desk）。铺满、object-cover，
             压在渐变之上、暗角/光晕/物件卡之下，作「桌面舞台实景底」。静态图，reduce-motion 亦显示。
             上方保留渐变暗角 + 台灯光晕，图作氛围底、三物件卡浮在最上层清晰可辨。 —— */}
        <img
          src="/marketing/studyroom-act2-desk.jpg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
          loading="lazy"
          decoding="async"
        />
        {/* 图上暗化：压住图高光、维持深色调，保证三物件卡与标题文字对比度充足。 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 100% at 50% 42%, rgba(14,19,28,0.62) 0%, rgba(10,14,20,0.82) 58%, rgba(6,8,12,0.95) 100%)",
          }}
        />

        {/* 暗角遮罩：随推近收拢 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(70% 70% at 50% 45%, transparent 40%, #05070a 100%)",
            opacity: vignette,
          }}
        />

        {/* 台灯暖光：桌面主光源，柔和常亮（呼吸靠 CSS） */}
        <div
          aria-hidden
          className="lamp-breathe pointer-events-none absolute left-1/2 top-[30%] h-[440px] w-[440px] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(255,210,150,0.26) 0%, rgba(255,190,120,0.10) 38%, transparent 68%)",
          }}
        />

        {/* 书桌 + 三物件：随滚动推近 */}
        <motion.div
          className="relative z-[1] w-full max-w-[860px] px-6"
          style={{ scale: deskScale, y: deskY }}
        >
          <div className="mb-9 text-center">
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-on-dark-3)]">
              CORE ENGINES · 走近这张桌子
            </p>
            <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--ink-on-dark)] sm:text-[30px]">
              一张书桌，装下完整的学习闭环
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {DESK_OBJECTS.map((o, i) => (
              <DeskObjectCard
                key={o.key}
                object={o}
                progress={scrollYProgress}
                index={i}
              />
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
  const brightness = useTransform(lit, [0, 1], [0.6, 1]);
  const filter = useTransform(brightness, (b) => `brightness(${b})`);
  const glowOpacity = useTransform(lit, [0, 1], [0, 1]);

  return (
    <motion.div style={{ opacity, y, filter }} className="relative">
      <Link
        href={object.href}
        className="studio-lift group relative flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--hairline-on-dark)] p-5"
        style={{
          background: "var(--video-grad)",
          boxShadow: "0 12px 30px -14px rgba(0,0,0,0.6)",
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
        <p className="mono relative text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on-dark-3)]">
          {object.eyebrow}
        </p>
        <div
          className="relative mt-3 flex h-[42px] w-[42px] items-center justify-center rounded-[12px]"
          style={{ background: object.soft, color: object.tint }}
        >
          <object.Icon size={21} weight="fill" />
        </div>
        <h3 className="relative mt-4 text-[17px] font-bold text-[var(--ink-on-dark)]">
          {object.title}
        </h3>
        <p className="relative mt-2 flex-1 text-[13px] leading-[1.7] text-[var(--ink-on-dark-2)]">
          {object.desc}
        </p>
        <span className="relative mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-on-dark)]">
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
      className="relative w-full overflow-hidden px-6 py-20"
      style={{
        background: "radial-gradient(120% 90% at 50% 20%, #161c28 0%, #0e131c 60%, #080a0e 100%)",
      }}
    >
      {/* —— 舞台底图（降级态同样铺）：静态海报态更需要图撑场。铺满、object-cover，
           压在渐变之上、光晕/卡片之下。上叠暗化层维持深色调与文字对比度。 —— */}
      <img
        src="/marketing/studyroom-act2-desk.jpg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
        loading="lazy"
        decoding="async"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 22%, rgba(14,19,28,0.66) 0%, rgba(10,14,20,0.84) 60%, rgba(6,8,12,0.95) 100%)",
        }}
      />

      {/* 静态台灯光晕（无呼吸），保留氛围 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-[300px] w-[300px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,210,150,0.20) 0%, rgba(255,190,120,0.08) 40%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-[720px]">
        <div className="mb-8 text-center">
          <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-on-dark-3)]">
            CORE ENGINES · 走近这张桌子
          </p>
          <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--ink-on-dark)]">
            一张书桌，装下完整的学习闭环
          </h2>
        </div>
        <div className="flex flex-col gap-4">
          {/* 降级态也走同一套「点亮」语言（<LightUp> 视口触发，赛道色光晕）——
              与沉浸态滚动点亮同族，强化 moment 2 的设计一致性。 */}
          {DESK_OBJECTS.map((o, i) => (
            <LightUp key={o.key} glowColor={`color-mix(in srgb, ${o.tint} 22%, transparent)`} delay={i * 0.06}>
              <Link
                href={o.href}
                className="studio-lift group relative flex items-start gap-4 overflow-hidden rounded-[16px] border border-[var(--hairline-on-dark)] p-5"
                style={{ background: "var(--video-grad)", boxShadow: "0 12px 30px -14px rgba(0,0,0,0.6)" }}
              >
                <div
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px]"
                  style={{ background: o.soft, color: o.tint }}
                >
                  <o.Icon size={21} weight="fill" />
                </div>
                <div className="min-w-0">
                  <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on-dark-3)]">
                    {o.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[16px] font-bold text-[var(--ink-on-dark)]">{o.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-[1.7] text-[var(--ink-on-dark-2)]">{o.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-on-dark)]">
                    {o.cta}
                    <ArrowRight size={13} weight="bold" aria-hidden className="transition-transform group-hover:translate-x-0.5" />
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
