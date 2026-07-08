"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";
import Link from "next/link";
import {
  ArrowDown,
  Flame,
  Books,
  Sparkle,
  FileArrowUp,
} from "@phosphor-icons/react/dist/ssr";
import { DoorOpen } from "@/components/motion";
import { useStudyRoom } from "./StudyRoomContext";
import { HeroPromptInput } from "./HeroPromptInput";
import { DeskDemo } from "./DeskDemo";

/* ============================================================
   第一幕 · 推门（首屏，0 滚动）
   全屏「学习工作室」：教室实景大图作氛围背景（书架=课程库 / 造课台=AI造课 /
   资料桌=自己课，低透明度 + 场景色蒙版压柔，营造一屋子教室的纵深，亮/暗两版随主题切）
   + 台灯暖光 + 红色专注小点。左：真实文案（SEO/LCP）+ 三入口 pill + 悬浮输入框
   「说出想学的」→ /create?prompt=…。右：会动的 <DeskDemo> AI 造课演示
   （最新四步流程 理解需求→设计大纲→逐节写作→装订成册，前景立在教室背景之上）。
   鼠标移动整场景 ±1.5° 视差、背景反向轻移。

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
      {/* —— 教室氛围背景层：整幕铺一张自习室实景（书架/造课台/资料桌三区），
          低透明度 + 边缘渐隐 + 场景色蒙版压柔，营造「一屋子教室」的空间纵深；
          英文标注被蒙版弱化成氛围纹理，不与前景动画争视线。亮/暗两版随主题切换，
          随鼠标反向轻微视差（比前景慢，像更远的房间）。aria-hidden 纯装饰。 —— */}
      {!isMobile && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ x: glowX, y: glowY }}
        >
          {/* 装饰性背景图：低优先级（fetchPriority=low）不与首屏 LCP 内容争带宽；
              暗版只在暗色态才需要，走 lazy。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/classroom-hero-triptych.jpg"
            alt=""
            fetchPriority="low"
            decoding="async"
            className="scene-light-only absolute inset-0 h-full w-full object-cover opacity-[0.34]"
            style={{
              maskImage: "radial-gradient(125% 90% at 50% 42%, #000 0%, rgba(0,0,0,.68) 60%, transparent 92%)",
              WebkitMaskImage: "radial-gradient(125% 90% at 50% 42%, #000 0%, rgba(0,0,0,.68) 60%, transparent 92%)",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/classroom-hero-triptych-dark.jpg"
            alt=""
            loading="lazy"
            decoding="async"
            className="scene-dark-only absolute inset-0 h-full w-full object-cover opacity-[0.24]"
            style={{
              maskImage: "radial-gradient(120% 85% at 50% 42%, #000 0%, rgba(0,0,0,.55) 55%, transparent 88%)",
              WebkitMaskImage: "radial-gradient(120% 85% at 50% 42%, #000 0%, rgba(0,0,0,.55) 55%, transparent 88%)",
            }}
          />
          {/* 场景色蒙版：把实景压回冷灰蓝基调，与 --scene-* 材质融为一体。
              中心略放开（让书架/桌子透出来更清楚），四周仍压柔护住前景文字对比。 */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 32%, color-mix(in srgb, var(--scene-bg-1) 46%, transparent) 0%, color-mix(in srgb, var(--scene-bg-2) 68%, transparent) 48%, var(--scene-bg-3) 100%)",
            }}
          />
        </motion.div>
      )}

      {/* 推门进场：整场从暗到亮 + 光缝推开，一次性开场编排。reduce-motion 直接终态。 */}
      <DoorOpen className="absolute inset-0 flex flex-col items-center justify-center">
        {/* —— 透视网格地板：CSS 3D，rotateX 铺向远方，径向遮罩渐隐（移动端保留，
            桌面已有教室背景图提供纵深，网格再淡一档避免与图打架）—— */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%]"
          style={{
            transformStyle: "preserve-3d",
            transform: `perspective(680px) rotateX(${isMobile ? 66 : 60}deg)`,
            transformOrigin: "50% 100%",
            opacity: isMobile ? 1 : 0.4,
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
          style={{ x: glowX, y: glowY, background: "var(--scene-lamp)" }}
        />
        {/* 红色专注信号小点（克制，唯一红）：像桌上一盏待机指示灯的微光。 */}
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-[22%] h-2 w-2 -translate-x-1/2 rounded-full ${
            motionOk ? "focus-dot" : ""
          }`}
          style={{ background: "var(--red)", boxShadow: "0 0 12px 2px color-mix(in srgb, var(--red) 60%, transparent)" }}
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

              {/* 主文案：真实 DOM（SEO/LCP）。教室主轴——「想学的，这里都能开学」，
                  只保留一个红色专注词，字号收敛对齐设计系统 display 阶梯。 */}
              <motion.h1
                className="text-balance text-[32px] font-bold leading-[1.18] tracking-[-0.02em] text-[var(--scene-ink)] sm:text-[44px] lg:text-[52px] lg:leading-[1.1] xl:text-[60px]"
                initial={motionOk ? { opacity: 0, y: 14 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
              >
                想学的,
                <br className="hidden sm:block" />
                <span className="text-[var(--red)]">这里都能开学</span>
              </motion.h1>

              {/* 副文案：一句话点出「一间自习室，三种开学方式」，接社会证明。 */}
              <motion.p
                className="mt-5 max-w-[440px] text-[15px] leading-[1.8] text-[var(--scene-ink-2)] lg:mt-6 lg:max-w-[500px] lg:text-[17px]"
                initial={motionOk ? { opacity: 0, y: 12 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
              >
                三种开学方式:挑一门现成好课、一句话让 AI 造一门、
                或把你的资料升维成课——都在你的自习室里完成。此刻{" "}
                <span className="whitespace-nowrap font-semibold text-[var(--scene-ink)]">
                  <span className="mono num-pop text-[var(--red)]">
                    {onlineCount.toLocaleString()}
                  </span>{" "}
                  位同学
                </span>{" "}
                正一起学。
              </motion.p>

              {/* 三种开学方式入口 pill：直接回应「课程库 / AI 造课 / 自己课」三种内容。
                  真实链接、冷灰卡 + 小图标，SSR 直出可点。 */}
              <motion.div
                className="mt-5 flex flex-wrap items-center justify-center gap-2 lg:mt-6 lg:justify-start"
                initial={motionOk ? { opacity: 0, y: 12 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              >
                <EntryPill href="/courses" Icon={Books} label="现成好课" hint="课程库" />
                <EntryPill href="/create" Icon={Sparkle} label="AI 造课" hint="一句话" accent />
                <EntryPill href="/create?tab=import" Icon={FileArrowUp} label="资料升维" hint="导入" />
              </motion.div>

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

            {/* —— 右：书桌上的屏 = 会动的 AI 造课演示（<DeskDemo>，最新四步流程：
                理解需求→设计大纲→逐节写作→装订成册）。前景动画立在教室背景之上，
                「一屋子教室」的纵深由整幕背景图承担，此处专注展示 AI 造课过程。 */}
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

      {/* —— 邻座工位：房间四周浮着几张「别人正在学」的桌面小卡（仅宽屏沉浸态）。
          直挂 section（包含块=整幕），四角定位不受 DoorOpen 的居中布局影响；
          不同深度随鼠标反向视差 + floatY 缓浮。纯装饰 aria-hidden，降级不渲染。 —— */}
      {immersive && <AmbientDesks px={px} py={py} />}

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

/* ============================================================
   EntryPill —— 首屏「三种开学方式」入口胶囊
   点出课程库 / AI 造课 / 自己课三种内容，真实链接、SSR 可点。
   冷灰卡 + 小图标 + 主标签 + mono 提示；accent（AI 造课）走红软底。
   ============================================================ */
function EntryPill({
  href,
  Icon,
  label,
  hint,
  accent = false,
}: {
  href: string;
  Icon: typeof Books;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="studio-press group inline-flex min-h-[44px] items-center gap-2 rounded-[13px] border px-3.5 py-2 transition-colors"
      style={{
        borderColor: accent
          ? "color-mix(in srgb, var(--red) 32%, var(--scene-hairline))"
          : "var(--scene-hairline)",
        background: accent ? "var(--red-soft)" : "var(--scene-card)",
        boxShadow: "var(--scene-card-shadow-sm)",
      }}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px]"
        style={{
          background: accent ? "var(--red)" : "var(--scene-card-2)",
          color: accent ? "#fff" : "var(--scene-ink-2)",
        }}
      >
        <Icon size={15} weight="fill" />
      </span>
      <span className="flex flex-col text-left leading-tight">
        <span
          className="text-[13px] font-bold"
          style={{ color: accent ? "var(--red-ink)" : "var(--scene-ink)" }}
        >
          {label}
        </span>
        <span className="mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--scene-ink-3)]">
          {hint}
        </span>
      </span>
    </Link>
  );
}

/* ============================================================
   AmbientDesks —— 第一幕四周的「邻座工位」浮卡（仅宽屏沉浸态）
   三张卡各对应一种开学方式（AI 造课 / 坚持 / 资料升维），文案成句可读，
   营造「一屋子人在学」的空间感。不同 --depth 随鼠标反向轻移（比主场景慢），
   像房间里更远的桌子；缓慢 floatY 浮动错开相位。纯 transform/opacity，aria-hidden。
   ============================================================ */
function AmbientDesks({ px, py }: { px: MotionValue<number>; py: MotionValue<number> }) {
  // 反向视差：远处物体移动更慢且与视线相反，深度感由幅度差营造。
  const x1 = useTransform(px, [-1, 1], [10, -10]);
  const y1 = useTransform(py, [-1, 1], [7, -7]);
  const x2 = useTransform(px, [-1, 1], [16, -16]);
  const y2 = useTransform(py, [-1, 1], [11, -11]);
  const x3 = useTransform(px, [-1, 1], [7, -7]);
  const y3 = useTransform(py, [-1, 1], [5, -5]);

  const cardStyle = {
    borderColor: "var(--scene-hairline)",
    background: "var(--scene-card)",
    boxShadow: "var(--scene-card-shadow-sm)",
  } as const;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      {/* 左上 · 邻座刚用一句话造好一门课（AI 造课信号）——主文案块之上的留白带 */}
      <motion.div
        className="absolute left-[2%] top-[9%] w-[214px] rounded-[14px] border p-3 opacity-80"
        style={{ x: x1, y: y1, ...cardStyle, animation: "floatY 7s ease-in-out infinite" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
            <Sparkle size={15} weight="fill" />
          </span>
          <div className="min-w-0">
            <p className="mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--scene-ink-3)" }}>邻座 · 刚刚</p>
            <p className="text-[11.5px] font-semibold leading-snug" style={{ color: "var(--scene-ink)" }}>
              一句话造好了《手机挂号无忧课》
            </p>
          </div>
        </div>
      </motion.div>

      {/* 右下 · 邻座刚把长文导入成课（资料升维信号）——演示屏之下的留白带 */}
      <motion.div
        className="absolute bottom-[6%] right-[2%] w-[220px] rounded-[14px] border p-3 opacity-80"
        style={{ x: x2, y: y2, ...cardStyle, animation: "floatY 8.5s ease-in-out 1.2s infinite" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
            <FileArrowUp size={15} weight="fill" />
          </span>
          <div className="min-w-0">
            <p className="mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--scene-ink-3)" }}>邻座 · 2 分钟前</p>
            <p className="text-[11.5px] font-semibold leading-snug" style={{ color: "var(--scene-ink)" }}>
              把一篇长文导入,升维成了 6 节课
            </p>
          </div>
        </div>
      </motion.div>

      {/* 右上 · 邻座连学 28 天（坚持信号，火苗）——演示屏之上的留白带 */}
      <motion.div
        className="absolute right-[5%] top-[10%] w-[190px] rounded-[14px] border p-3 opacity-80"
        style={{ x: x3, y: y3, ...cardStyle, animation: "floatY 9.5s ease-in-out 2.4s infinite" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
            <Flame size={15} weight="fill" />
          </span>
          <div className="min-w-0">
            <p className="mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--scene-ink-3)" }}>邻座 · 此刻</p>
            <p className="text-[11.5px] font-semibold leading-snug" style={{ color: "var(--scene-ink)" }}>
              连学 <span className="mono text-[var(--red)]">28</span> 天,今晚也亮着灯
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
