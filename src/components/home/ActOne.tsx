"use client";

import { motion, useTransform } from "framer-motion";
import Link from "next/link";
import { ArrowDown } from "@phosphor-icons/react/dist/ssr";
import { AmbientVideo } from "@/components/AmbientVideo";
import { DoorOpen } from "@/components/motion";
import { useStudyRoom } from "./StudyRoomContext";
import { HeroPromptInput } from "./HeroPromptInput";

/* ============================================================
   第一幕 · 推门（首屏，0 滚动）
   全屏深色自习室：3D 透视网格地板（径向渐隐到黑）+ 远处亮着台灯的书桌，
   台灯光晕是唯一光源（呼吸），红色专注小点克制点缀。中央真实文案（SEO/LCP），
   悬浮输入框「说出想学的」→ /create?prompt=…。鼠标移动整场景 ±1.5° 视差。
   书桌屏幕内嵌 hero-product-demo-loop（AmbientVideo，poster 先行控 LCP）。

   降级：
   - reduce-motion（motionOk=false）→ 光晕/呼吸/视差全静，退为静态分层海报。
   - 移动端（isMobile）→ 砍鼠标视差与激进 rotateX，网格压平，纵向排布。
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
      aria-label="推门进入自习室"
      className="relative flex min-h-[100svh] w-full flex-col items-center justify-center overflow-hidden"
      style={{
        // 场景底：深色区渐变（弃死黑平面），四周径向压暗成「房间」。
        background:
          "radial-gradient(120% 90% at 50% 30%, #1a2130 0%, #12171f 45%, #0a0c10 100%)",
      }}
    >
      {/* —— 推门进场（moment 5）：整场从暗到亮 + 光缝推开，一次性开场编排。
           复用 <DoorOpen>（与「点亮」同族语言）；reduce-motion 直接终态亮场。
           包裹整场景层（含网格/光晕/内容），sr-only 导航留在其外恒可达。 —— */}
      <DoorOpen className="absolute inset-0 flex flex-col items-center justify-center">
      {/* —— 氛围底图：深夜自习室推门实拍（studyroom-act1-hero）。铺满、object-cover，
           压在网格/光晕/内容之下，作场景「实景底」。静态图无动画，reduce-motion 亦正常显示。
           上方叠一层暗化 + 径向暗角，压住图的高光、维持深色沉浸调，保证台灯光晕/红点/文案
           仍是视觉焦点、文字对比度充足。 —— */}
      <img
        src="/marketing/studyroom-act1-hero.jpg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45"
        loading="eager"
        decoding="async"
      />
      {/* 图上暗化 + 径向暗角遮罩：图作氛围底，此层确保深色调与文字可读（叠在图与网格之间）。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 30%, rgba(16,20,28,0.55) 0%, rgba(12,16,22,0.78) 52%, rgba(8,10,14,0.94) 100%)",
        }}
      />

      {/* —— 透视网格地板：CSS 3D，rotateX 铺向远方，径向遮罩渐隐到黑 —— */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%]"
        style={{
          transformStyle: "preserve-3d",
          transform: `perspective(680px) rotateX(${isMobile ? 66 : 60}deg)`,
          transformOrigin: "50% 100%",
          backgroundImage:
            "linear-gradient(rgba(139,152,178,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(139,152,178,0.14) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          // 网格向远方与两侧渐隐，只留中央一小片「被灯照到」的地面。
          maskImage:
            "radial-gradient(70% 62% at 50% 92%, #000 0%, rgba(0,0,0,0.35) 46%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(70% 62% at 50% 92%, #000 0%, rgba(0,0,0,0.35) 46%, transparent 78%)",
        }}
      />

      {/* —— 台灯光晕：画面唯一光源，大径向渐变 + 呼吸（reduce-motion 静态）—— */}
      <motion.div
        aria-hidden
        className={`pointer-events-none absolute left-1/2 top-[26%] h-[520px] w-[520px] -translate-x-1/2 rounded-full ${
          motionOk ? "lamp-breathe" : ""
        }`}
        style={{
          x: glowX,
          y: glowY,
          background:
            "radial-gradient(circle, rgba(255,214,150,0.30) 0%, rgba(255,190,120,0.12) 34%, transparent 66%)",
          filter: "blur(8px)",
        }}
      />
      {/* 红色专注信号小点（克制，唯一红）：像桌上一盏待机指示灯的微光。 */}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 top-[24%] h-2 w-2 -translate-x-1/2 rounded-full ${
          motionOk ? "focus-dot" : ""
        }`}
        style={{ background: "var(--red)", boxShadow: "0 0 12px 2px rgba(252,1,26,0.6)" }}
      />

      {/* —— 场景内容层：随鼠标整体倾斜（视差容器）—— */}
      <motion.div
        className="relative z-[1] flex w-full max-w-[720px] flex-col items-center px-6 text-center"
        style={{
          rotateX: rotX,
          rotateY: rotY,
          transformPerspective: 1200,
          transformStyle: "preserve-3d",
        }}
      >
        {/* 顶部微标：进入自习室的仪式语 */}
        <motion.p
          className="mono mb-6 text-[11px] uppercase tracking-[0.22em] text-[var(--ink-on-dark-3)]"
          initial={motionOk ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          TIDE · 深夜自习室
        </motion.p>

        {/* 主文案：真实 DOM（SEO/LCP）。N=真实/合理在线数，server 传入。 */}
        <motion.h1
          className="text-balance text-[30px] font-bold leading-[1.28] tracking-[-0.01em] text-[var(--ink-on-dark)] sm:text-[42px]"
          initial={motionOk ? { opacity: 0, y: 14 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
        >
          凌晨一点，还有{" "}
          <span className="relative whitespace-nowrap text-[var(--red)]">
            <span className="mono num-pop text-[34px] font-black sm:text-[48px]">
              {onlineCount.toLocaleString()}
            </span>{" "}
            人
          </span>
          <br className="hidden sm:block" />
          在这里自习
        </motion.h1>

        <motion.p
          className="mt-5 max-w-[460px] text-[15px] leading-[1.85] text-[var(--ink-on-dark-2)]"
          initial={motionOk ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
        >
          推开门，找一张亮着灯的书桌坐下。说出你想学的，AI 当场为你造一门课，
          边学边记、到点复习。这一夜，你不是一个人在学。
        </motion.p>

        {/* —— 悬浮输入框：首屏即产品。提交跳造课（复用 /create?prompt=）——
            输入框 + 其 useState 抽入 <HeroPromptInput>：按键只重渲该子组件，
            第一幕视差/进场 motion 子树不再参与 reconcile。进场编排（这层
            motion.div）保留在此，占位/样式/提交行为不变。 */}
        <motion.div
          className="mt-8 w-full max-w-[520px]"
          initial={motionOk ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
        >
          <HeroPromptInput />
          {/* 信任行：真实课程量作社会证明锚（真实 DOM）。 */}
          <p className="mono mt-4 text-[12px] text-[var(--ink-on-dark-3)]">
            已有{" "}
            <span className="font-bold text-[var(--ink-on-dark-2)]">{totalCourses}</span>{" "}
            门课程在架 · 免费体验，无需登录
          </p>
        </motion.div>

        {/* —— 书桌上的屏幕：内嵌 hero-product-demo-loop（AmbientVideo，poster 先行）——
            桌面沉浸态才展示这块「远处桌上的发光屏」，避免与输入框争首屏焦点；
            移动端为控 LCP 与竖屏节奏，此屏折入第二幕。 */}
        {!isMobile && (
          <motion.div
            className="relative mt-12 w-full max-w-[460px]"
            style={{ transform: "translateZ(40px)" }}
            initial={motionOk ? { opacity: 0, y: 20 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.34 }}
          >
            {/* 屏幕面板：深色边框 + 底部投影，像一台立在桌上的显示器 */}
            <div
              className="relative aspect-[16/10] w-full overflow-hidden rounded-[14px] border border-[var(--hairline-on-dark)]"
              style={{
                background: "var(--video-grad)",
                boxShadow: "0 30px 60px -30px rgba(0,0,0,0.8), 0 0 60px -20px rgba(255,200,140,0.25)",
              }}
            >
              <AmbientVideo
                src="/videos/marketing/hero-product-demo-loop.mp4"
                poster="/marketing/desk-screen-demo.jpg"
              />
              {/* 屏面反光高光，让它像「亮着的屏」而非贴图 */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(255,255,255,0.10), transparent 42%)",
                }}
              />
            </div>
            {/* 屏下桌面：一条暖色台灯反光带，把屏「坐实」在桌面上 */}
            <div
              aria-hidden
              className="mx-auto mt-2 h-6 w-[86%] rounded-[50%]"
              style={{ background: "radial-gradient(ellipse, rgba(255,200,140,0.16), transparent 70%)" }}
            />
          </motion.div>
        )}
      </motion.div>

      {/* —— 向下滚动提示：把用户引向第二幕「走近书桌」—— */}
      <motion.div
        className="absolute bottom-6 left-1/2 z-[1] -translate-x-1/2"
        initial={motionOk ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.8 }}
      >
        <span className="flex flex-col items-center gap-1 text-[var(--ink-on-dark-3)]">
          <span className="mono text-[10px] uppercase tracking-[0.18em]">走近书桌</span>
          <ArrowDown
            size={16}
            weight="bold"
            aria-hidden
            className={motionOk ? "scroll-hint" : ""}
          />
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
