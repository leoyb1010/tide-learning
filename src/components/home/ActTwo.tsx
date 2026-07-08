"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform, AnimatePresence, type MotionValue } from "framer-motion";
import {
  Books,
  Sparkle,
  FileArrowUp,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { LightUp } from "@/components/motion";
import { useStudyRoom } from "./StudyRoomContext";
import { ImportDemo } from "./ImportDemo";
import type { TrackCardData } from "./types";

/* ============================================================
   第二幕 · 三张亮着的桌子（滚动 1-2 屏）
   自习室里三张工位桌依次点亮，每张桌 = 一种真实的开学方式，
   桌上是「活的产品演示」而非宣传插图：
     ① 现成好课桌 —— 迷你书架（真实赛道渐变书脊 + 在架课程数）
     ② 一句话造课桌 —— 需求轮播 → 成品课卡浮现（AI 锻造台）
     ③ 资料升维桌 —— 文档裂变成章节卡 + 测验/复习卡徽标（ImportDemo）
   position sticky + useScroll 驱动「走过一张张桌子」的镜头；
   每张桌在自己的滚动段落内点亮（opacity/transform 合成友好）。

   降级：
   - reduce-motion / 移动端（!immersive）→ 不 sticky，纵向 LightUp 卡；
     演示组件各自定格终态，内容完整可读。
   ============================================================ */

interface DeskSpec {
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

const DESKS: DeskSpec[] = [
  {
    key: "library",
    Icon: Books,
    eyebrow: "第一张桌 · 现成好课",
    title: "书架上挑一门就开学",
    desc: "真实在架的编辑精选课，四条赛道持续更新，坐下就能学。",
    href: "/courses",
    cta: "逛逛课程库",
    tint: "var(--info)",
    soft: "var(--info-soft)",
  },
  {
    key: "forge",
    Icon: Sparkle,
    eyebrow: "第二张桌 · AI 造课",
    title: "说句话，AI 现场造一门",
    desc: "想学的再小众也没关系，AI 按你的需求当场编排一门课。",
    href: "/create",
    cta: "去造一门课",
    tint: "var(--red)",
    soft: "var(--red-soft)",
  },
  {
    key: "import",
    Icon: FileArrowUp,
    eyebrow: "第三张桌 · 资料升维",
    title: "把你的资料变成课",
    desc: "笔记、长文、讲义丢进来，拆章配测验，升维成能学的课。",
    href: "/create?tab=import",
    cta: "导入我的资料",
    tint: "var(--warn)",
    soft: "var(--warn-soft)",
  },
];

export function ActTwo({ tracks, totalCourses }: { tracks: TrackCardData[]; totalCourses: number }) {
  const { immersive } = useStudyRoom();
  if (!immersive) return <ActTwoStatic tracks={tracks} totalCourses={totalCourses} />;
  return <ActTwoImmersive tracks={tracks} totalCourses={totalCourses} />;
}

/** 桌面演示区：按桌位渲染对应的活演示。 */
function DeskDemoArea({ deskKey, tracks, totalCourses }: { deskKey: string; tracks: TrackCardData[]; totalCourses: number }) {
  if (deskKey === "library") return <MiniShelf tracks={tracks} totalCourses={totalCourses} />;
  if (deskKey === "forge") return <MiniForge />;
  return <ImportDemo />;
}

/* ---------- 沉浸态：sticky 舞台 + 滚动逐桌点亮 ---------- */
function ActTwoImmersive({ tracks, totalCourses }: { tracks: TrackCardData[]; totalCourses: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // 镜头推近：随滚动 scale 1→1.1 + 轻微上移（走近这排桌子）。
  const deskScale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
  const deskY = useTransform(scrollYProgress, [0, 1], [0, -32]);
  const vignette = useTransform(scrollYProgress, [0, 1], [0.28, 0.5]);

  // 问题①：原 h-[380vh] + 逐桌 start 间隔 0.26，要滚约三屏、点三次才看全三桌，体验割裂。
  // 压到 h-[190vh]（sticky 只钉约一屏），配合下方 DeskCard 更紧凑且重叠的点亮区间，
  // 一次顺畅下滑即可看全三桌，保留镜头推近质感。
  return (
    <section ref={ref} aria-label="三种开学方式" className="relative h-[190vh]">
      <div
        className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 40%, var(--scene-bg-1) 0%, var(--scene-bg-2) 55%, var(--scene-bg-3) 100%)",
        }}
      >
        {/* 暗角遮罩：随推近收拢 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(72% 72% at 50% 45%, transparent 40%, var(--scene-vignette) 100%)",
            opacity: vignette,
          }}
        />

        {/* 台灯暖光：桌面主光源 */}
        <div
          aria-hidden
          className="lamp-breathe pointer-events-none absolute left-1/2 top-[26%] h-[440px] w-[440px] -translate-x-1/2 rounded-full xl:h-[560px] xl:w-[560px]"
          style={{ background: "var(--scene-lamp)" }}
        />

        <motion.div
          className="relative z-[1] w-full max-w-[880px] px-6 lg:max-w-[1120px] lg:px-10 xl:max-w-[1280px] 2xl:max-w-[1400px]"
          style={{ scale: deskScale, y: deskY }}
        >
          <div className="mb-8 text-center lg:mb-11">
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
              THREE DESKS · 走过这排桌子
            </p>
            <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[30px] lg:text-[40px] xl:text-[46px]">
              三种开学方式,一间自习室
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:gap-6 xl:gap-7">
            {DESKS.map((d, i) => (
              <DeskCard
                key={d.key}
                desk={d}
                progress={scrollYProgress}
                index={i}
                tracks={tracks}
                totalCourses={totalCourses}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** 单张桌：滚动到它的段落时点亮（透明度/上浮 + 桌灯光晕），桌上演示常驻循环。 */
function DeskCard({
  desk,
  progress,
  index,
  tracks,
  totalCourses,
}: {
  desk: DeskSpec;
  progress: MotionValue<number>;
  index: number;
  tracks: TrackCardData[];
  totalCourses: number;
}) {
  // 问题①：更早起始 + 更密间隔（0.06/0.18/0.30），三桌在一次下滑内相继点亮、约 44% 行程即全亮；
  // 起始亮度抬高（0.5 而非 0.35），未点亮的桌子也可见，减轻「藏起来要滚出来」的割裂感。
  const start = 0.06 + index * 0.12;
  const lit = useTransform(progress, [start, start + 0.14], [0, 1]);
  const opacity = useTransform(lit, [0, 1], [0.5, 1]);
  const y = useTransform(lit, [0, 1], [26, 0]);
  const glowOpacity = useTransform(lit, [0, 1], [0, 1]);
  const dimOverlay = useTransform(lit, [0, 1], [0.45, 0]);

  return (
    <motion.div style={{ opacity, y }} className="relative">
      <div
        className="group relative flex h-full flex-col overflow-hidden rounded-[18px] border p-4.5 lg:rounded-[22px] lg:p-6"
        style={{
          borderColor: "var(--scene-hairline)",
          background: "var(--scene-card)",
          boxShadow: "var(--scene-card-shadow-sm)",
        }}
      >
        {/* 点亮时桌顶一圈桌灯光晕 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-6 -top-8 h-28 w-32 rounded-full blur-2xl"
          style={{
            opacity: glowOpacity,
            background: `radial-gradient(circle, ${desk.tint}, transparent 68%)`,
          }}
        />
        {/* 暗态罩：未点亮时压低，只走 opacity 合成 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2] rounded-[18px] lg:rounded-[22px]"
          style={{ opacity: dimOverlay, background: "var(--scene-vignette)" }}
        />

        <p className="mono relative text-[10px] uppercase tracking-[0.14em] text-[var(--scene-ink-3)] lg:text-[11px]">
          {desk.eyebrow}
        </p>
        <h3 className="relative mt-2 text-[17px] font-bold text-[var(--scene-ink)] lg:mt-2.5 lg:text-[21px]">
          {desk.title}
        </h3>
        <p className="relative mt-1.5 text-[12.5px] leading-[1.65] text-[var(--scene-ink-2)] lg:text-[14px]">
          {desk.desc}
        </p>

        {/* 桌上的活演示 */}
        <div className="relative mt-4 flex-1 lg:mt-5">
          <DeskDemoArea deskKey={desk.key} tracks={tracks} totalCourses={totalCourses} />
        </div>

        <Link
          href={desk.href}
          className="relative mt-4 inline-flex min-h-[44px] items-center gap-1 text-[12.5px] font-bold text-[var(--scene-ink)] transition-colors hover:text-[var(--red)] lg:mt-5 lg:text-[14px]"
        >
          {desk.cta}
          <ArrowRight size={13} weight="bold" aria-hidden className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </motion.div>
  );
}

/* ---------- 降级态：纵向 LightUp 卡（reduce-motion / 移动端） ---------- */
function ActTwoStatic({ tracks, totalCourses }: { tracks: TrackCardData[]; totalCourses: number }) {
  return (
    <section
      aria-label="三种开学方式"
      className="relative w-full overflow-hidden px-6 py-20 lg:py-28"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 20%, var(--scene-bg-1) 0%, var(--scene-bg-2) 60%, var(--scene-bg-3) 100%)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-[300px] w-[300px] -translate-x-1/2 rounded-full"
        style={{ background: "var(--scene-lamp)" }}
      />
      <div className="relative mx-auto max-w-[720px] lg:max-w-[980px]">
        <div className="mb-8 text-center lg:mb-11">
          <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
            THREE DESKS · 走过这排桌子
          </p>
          <h2 className="mt-3 text-[24px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] lg:text-[36px]">
            三种开学方式,一间自习室
          </h2>
        </div>
        <div className="flex flex-col gap-4 lg:gap-5">
          {DESKS.map((d, i) => (
            <LightUp
              key={d.key}
              glowColor={`color-mix(in srgb, ${d.tint} 22%, transparent)`}
              delay={i * 0.06}
            >
              <div
                className="relative flex flex-col gap-4 overflow-hidden rounded-[16px] border p-5 sm:flex-row sm:items-start sm:gap-5 lg:rounded-[20px] lg:p-6"
                style={{
                  borderColor: "var(--scene-hairline)",
                  background: "var(--scene-card)",
                  boxShadow: "var(--scene-card-shadow-sm)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--scene-ink-3)] lg:text-[11px]">
                    {d.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[16px] font-bold text-[var(--scene-ink)] lg:text-[20px]">
                    {d.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:text-[15px]">
                    {d.desc}
                  </p>
                  <Link
                    href={d.href}
                    className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-[12px] font-semibold text-[var(--scene-ink)] lg:text-[14px]"
                  >
                    {d.cta}
                    <ArrowRight size={13} weight="bold" aria-hidden />
                  </Link>
                </div>
                <div className="w-full sm:w-[46%] sm:shrink-0">
                  <DeskDemoArea deskKey={d.key} tracks={tracks} totalCourses={totalCourses} />
                </div>
              </div>
            </LightUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   MiniShelf —— 「现成好课桌」上的迷你书架
   用写实书脊排图（book-spines-row.jpg：绿/赭/紫三系布纹书脊立在浅木层板上，
   冷灰蓝背景，与设计系统同调）。hover 整排轻微推近（transform-only），
   底部横向渐隐让图与卡片自然衔接。下方在架总数信息条。
   ============================================================ */
function MiniShelf({ tracks, totalCourses }: { tracks: TrackCardData[]; totalCourses: number }) {
  return (
    <div className="w-full" aria-hidden>
      <div
        className="group/shelf relative overflow-hidden rounded-[12px] border"
        style={{ borderColor: "var(--scene-hairline)", background: "var(--scene-card-2)" }}
      >
        {/* 写实书脊排图：16:9 裁切成一条书架，hover 时整排轻微放大（像凑近看书架） */}
        <div className="relative aspect-[16/7] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/textures/book-spines-row.jpg"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="mini-shelf-img h-full w-full origin-bottom object-cover object-bottom transition-transform duration-500 ease-out will-change-transform group-hover/shelf:scale-[1.04]"
          />
          {/* 底部极淡渐隐，让书脊底与卡片背景软衔接（不压住书本） */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6"
            style={{
              background:
                "linear-gradient(180deg, transparent, color-mix(in srgb, var(--scene-card-2) 60%, transparent))",
            }}
          />
        </div>
      </div>

      <p className="mono mt-2.5 text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--scene-ink-3)" }}>
        <span className="font-bold" style={{ color: "var(--scene-ink-2)" }}>{totalCourses}</span> 门在架 ·{" "}
        {tracks.length} 条赛道 · 每周上新
      </p>
    </div>
  );
}

/* ============================================================
   MiniForge —— 「AI 造课桌」上的迷你锻造演示
   需求 chip 轮播（真实灵感语料）→ 一张迷你课卡「锻」出来，循环。
   与第一幕大演示 DeskDemo 不重复：这里是「多样需求 → 都能造」的快闪。
   降级：定格在成品卡。
   ============================================================ */
const FORGE_PROMPTS: { ask: string; course: string; grad: string }[] = [
  { ask: "带我从零开口说英语", course: "零基础开口说 · 10 节", grad: "var(--track-english)" },
  { ask: "讲讲 Python 装饰器", course: "装饰器从懵到会 · 6 节", grad: "var(--track-ai)" },
  { ask: "教爸妈用手机挂号", course: "手机挂号无忧课 · 5 节", grad: "var(--track-elder)" },
];

function MiniForge() {
  const { motionOk } = useStudyRoom();
  const [idx, setIdx] = useState(0);
  const [showCard, setShowCard] = useState(!motionOk);

  useEffect(() => {
    if (!motionOk) return;
    // 每轮：亮需求(1.4s) → 出卡(2.6s) → 下一条
    const t1 = setTimeout(() => setShowCard(true), 1400);
    const t2 = setTimeout(() => {
      setShowCard(false);
      setIdx((i) => (i + 1) % FORGE_PROMPTS.length);
    }, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [idx, motionOk]);

  const cur = FORGE_PROMPTS[idx];

  return (
    <div className="w-full" aria-hidden>
      {/* 需求 chip */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`ask-${idx}`}
          className="flex items-center gap-2 rounded-full border px-3 py-1.5"
          style={{ borderColor: "var(--scene-hairline)", background: "var(--scene-card-2)" }}
          initial={motionOk ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Sparkle size={13} weight="fill" style={{ color: "var(--red)" }} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: "var(--scene-ink-2)" }}>
            “{cur.ask}”
          </span>
        </motion.div>
      </AnimatePresence>

      {/* 锻造出的迷你课卡 */}
      <div className="mt-2.5 h-[86px] lg:h-[92px]">
        <AnimatePresence mode="wait" initial={false}>
          {showCard ? (
            <motion.div
              key={`card-${idx}`}
              className="flex h-full items-center gap-2.5 overflow-hidden rounded-[12px] border p-2.5"
              style={{
                borderColor: "var(--scene-hairline)",
                background: "var(--scene-card)",
                boxShadow: "var(--scene-card-shadow-sm)",
              }}
              initial={motionOk ? { opacity: 0, y: 14, scale: 0.96 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                className="flex h-full w-[38%] shrink-0 items-center justify-center rounded-[9px]"
                style={{ background: cur.grad }}
              >
                <Books size={22} weight="fill" color="rgba(255,255,255,.92)" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] font-bold" style={{ color: "var(--scene-ink)" }}>
                  {cur.course}
                </p>
                <p className="mono mt-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--ok)" }}>
                  ✓ 已生成 · 含测验与复习卡
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`forging-${idx}`}
              className="flex h-full flex-col justify-center gap-1.5 rounded-[12px] border border-dashed px-3"
              style={{ borderColor: "var(--scene-hairline)" }}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {[64, 82, 48].map((w, i) => (
                <span
                  key={i}
                  className="skeleton h-2 rounded-full"
                  style={{ width: `${w}%`, ["--i" as string]: i }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
