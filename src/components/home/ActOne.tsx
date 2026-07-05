"use client";

import { motion, useTransform } from "framer-motion";
import Link from "next/link";
import { ArrowDown } from "@phosphor-icons/react/dist/ssr";
import { DoorOpen } from "@/components/motion";
import { useStudyRoom } from "./StudyRoomContext";
import { HeroPromptInput } from "./HeroPromptInput";
import { DeskDemo } from "./DeskDemo";

/* ============================================================
   第一幕 · 推门（首屏，0 滚动）
   全屏「学习工作室」：3D 透视网格地板（径向渐隐）+ 台灯暖光唯一光源（呼吸），
   红色专注小点克制点缀。中央真实文案（SEO/LCP），悬浮输入框「说出想学的」
   → /create?prompt=…。鼠标移动整场景 ±1.5° 视差。桌上的屏内嵌 <DeskDemo>：
   用产品真实 UI 拼装的造课演示（造课输入→AI生成→课程卡浮现），替代视频。

   深浅色（问题⑧-5）：场景底/墨阶/材质全部走 --scene-* token —— 浅色系统下是
   「晨光工作室」高级亮场，暗色系统 / data-theme=dark 下是沉浸夜航暗场，跟随系统。
   不再硬编码单一深色。

   宽屏响应式（问题⑧-1）：内容列 max-w 阶梯放宽（720→lg:1040→xl:1200→2xl:1360），
   H1 字号阶梯放大，输入框/演示区同步按视口扩展，宽屏用双列铺开，消除中央窄条。

   文案（问题⑧-2）：去「深夜/凌晨一点」压抑恐怖感，改温暖有力的「一句话造课 +
   同学同行」社会证明。N=真实在线数，server 传入。

   降级：
   - reduce-motion（motionOk=false）→ 光晕/呼吸/视差全静，演示定格终态。
   - 移动端（isMobile）→ 砍鼠标视差与激进 rotateX，网格压平，纵向单列排布。
   ============================================================ */

export function ActOne({
  onlineCount,
  totalCourses,
}: {
  onlineCount: number;
  totalCourses: number;
}) {
  const { px, py, motionOk, isMobile, immersive } = useStudyRoom();

  // 鼠标视差 → 场景倾斜（克制 ±1.5°）。仅沉浸态活跃；降级时恒 0。
  const rotY = useTransform(px, [-1, 1], immersive ? [1.5, -1.5] : [0, 0]);
  const rotX = useTransform(py, [-1, 1], immersive ? [-1.2, 1.2] : [0, 0]);
  // 台灯光晕反向轻移，制造「光源在场景深处」的层次。
  const glowX = useTransform(px, [-1, 1], immersive ? [16, -16] : [0, 0]);
  const glowY = useTransform(py, [-1, 1], immersive ? [10, -10] : [0, 0]);

  return (
    <section
      aria-label="推门进入学习工作室"
      className="relative flex min-h-[100svh] w-full flex-col items-center justify-center overflow-hidden"
      style={{
        // 场景底：三层径向雾（--scene-* 跟随主题：浅=晨光亮场 / 暗=夜航暗场）。
        background:
          "radial-gradient(120% 90% at 50% 30%, var(--scene-bg-1) 0%, var(--scene-bg-2) 45%, var(--scene-bg-3) 100%)",
      }}
    >
      {/* 推门进场：整场从暗到亮 + 光缝推开，一次性开场编排。reduce-motion 直接终态。 */}
      <DoorOpen className="absolute inset-0 flex flex-col items-center justify-center">
        {/* —— 透视网格地板：CSS 3D，rotateX 铺向远方，径向遮罩渐隐 —— */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%]"
          style={{
            transformStyle: "preserve-3d",
            transform: `perspective(680px) rotateX(${isMobile ? 66 : 60}deg)`,
            transformOrigin: "50% 100%",
            backgroundImage:
              "linear-gradient(var(--scene-grid) 1px, transparent 1px), linear-gradient(90deg, var(--scene-grid) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(70% 62% at 50% 92%, #000 0%, rgba(0,0,0,0.35) 46%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(70% 62% at 50% 92%, #000 0%, rgba(0,0,0,0.35) 46%, transparent 78%)",
          }}
        />

        {/* —— 台灯光晕：画面主光源，大径向渐变 + 呼吸（reduce-motion 静态）—— */}
        <motion.div
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-[24%] h-[520px] w-[520px] -translate-x-1/2 rounded-full xl:h-[640px] xl:w-[640px] ${
            motionOk ? "lamp-breathe" : ""
          }`}
          style={{ x: glowX, y: glowY, background: "var(--scene-lamp)", filter: "blur(8px)" }}
        />
        {/* 红色专注信号小点（克制，唯一红）：像桌上一盏待机指示灯的微光。 */}
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-[22%] h-2 w-2 -translate-x-1/2 rounded-full ${
            motionOk ? "focus-dot" : ""
          }`}
          style={{ background: "var(--red)", boxShadow: "0 0 12px 2px rgba(252,1,26,0.6)" }}
        />

        {/* —— 场景内容层：随鼠标整体倾斜（视差容器）。宽屏 max-w 阶梯放宽。 —— */}
        <motion.div
          className="relative z-[1] flex w-full max-w-[720px] flex-col items-center px-6 text-center lg:max-w-[1040px] lg:px-10 xl:max-w-[1200px] 2xl:max-w-[1360px]"
          style={{
            rotateX: rotX,
            rotateY: rotY,
            transformPerspective: 1200,
            transformStyle: "preserve-3d",
          }}
        >
          {/* 宽屏双列：左文案 + 右演示并排铺开；移动/窄屏单列纵向。 */}
          <div className="flex w-full flex-col items-center gap-10 lg:flex-row lg:items-center lg:gap-14 lg:text-left xl:gap-20">
            {/* —— 左：文案 + 输入框 —— */}
            <div className="flex w-full flex-col items-center lg:flex-1 lg:items-start">
              {/* 顶部微标 */}
              <motion.p
                className="mono mb-5 text-[11px] uppercase tracking-[0.22em] text-[var(--scene-ink-3)] lg:text-[12px]"
                initial={motionOk ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                TIDE · AI 学习工作室
              </motion.p>

              {/* 主文案：真实 DOM（SEO/LCP）。温暖有力的「一句话造课」主张。 */}
              <motion.h1
                className="text-balance text-[30px] font-bold leading-[1.24] tracking-[-0.015em] text-[var(--scene-ink)] sm:text-[42px] lg:text-[58px] lg:leading-[1.14] xl:text-[74px] 2xl:text-[84px]"
                initial={motionOk ? { opacity: 0, y: 14 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
              >
                说出想学的,
                <br />
                <span className="text-[var(--red)]">AI 当场为你造一门课</span>
              </motion.h1>

              {/* 社会证明副文案：保留「N 位同学一起学」的社会证明，去压抑感。 */}
              <motion.p
                className="mt-5 max-w-[460px] text-[15px] leading-[1.85] text-[var(--scene-ink-2)] lg:mt-6 lg:max-w-[520px] lg:text-[17px] xl:max-w-[600px] xl:text-[19px]"
                initial={motionOk ? { opacity: 0, y: 12 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
              >
                一句话,几秒钟,一门为你量身编排的课就摆上书桌。
                此刻还有{" "}
                <span className="whitespace-nowrap font-semibold text-[var(--scene-ink)]">
                  <span className="mono num-pop text-[var(--red)]">
                    {onlineCount.toLocaleString()}
                  </span>{" "}
                  位同学
                </span>{" "}
                正在一起学,你不是一个人。
              </motion.p>

              {/* —— 悬浮输入框：首屏即产品。提交跳造课（复用 /create?prompt=）—— */}
              <motion.div
                className="mt-8 w-full max-w-[520px] lg:mt-9 lg:max-w-[560px] xl:max-w-[620px]"
                initial={motionOk ? { opacity: 0, y: 12 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
              >
                <HeroPromptInput />
                {/* 信任行：真实课程量作社会证明锚（真实 DOM）。 */}
                <p className="mono mt-4 text-[12px] text-[var(--scene-ink-3)] lg:text-[13px]">
                  已有{" "}
                  <span className="font-bold text-[var(--scene-ink-2)]">{totalCourses}</span>{" "}
                  门课程在架 · 免费体验,无需登录
                </p>
              </motion.div>
            </div>

            {/* —— 右：书桌上的屏 = 真实 UI 产品演示（<DeskDemo>）——
                桌面/宽屏并排展示；移动端为控 LCP 与竖屏节奏折入下方（单列时仍显示）。 */}
            <motion.div
              className="w-full max-w-[460px] lg:max-w-[520px] lg:flex-1 xl:max-w-[620px] 2xl:max-w-[720px]"
              style={{ transform: immersive ? "translateZ(40px)" : undefined }}
              initial={motionOk ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.34 }}
            >
              <DeskDemo />
            </motion.div>
          </div>
        </motion.div>

        {/* —— 向下滚动提示：把用户引向第二幕「走近书桌」—— */}
        <motion.div
          className="absolute bottom-6 left-1/2 z-[1] -translate-x-1/2"
          initial={motionOk ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
        >
          <span className="flex flex-col items-center gap-1 text-[var(--scene-ink-3)]">
            <span className="mono text-[10px] uppercase tracking-[0.18em]">走近书桌</span>
            <ArrowDown size={16} weight="bold" aria-hidden className={motionOk ? "scroll-hint" : ""} />
          </span>
        </motion.div>
      </DoorOpen>

      {/* 无障碍/SEO 补充：把关键导航以真实链接埋入，即便沉浸层出问题也可达 */}
      <Link href="/create" className="sr-only">
        免费体验 AI 造课
      </Link>
      <Link href="/courses" className="sr-only">
        浏览全部课程
      </Link>
    </section>
  );
}
