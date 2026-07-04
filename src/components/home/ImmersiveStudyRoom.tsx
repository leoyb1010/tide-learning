"use client";

import { useEffect, useState } from "react";
import type { CourseCardData } from "@/components/CourseCard";
import { StudyRoomProvider, usePointerMotion, type StudyRoomEnv } from "./StudyRoomContext";
import { ActOne } from "./ActOne";
import { ActTwo } from "./ActTwo";
import { ActThree } from "./ActThree";

/* ============================================================
   ImmersiveStudyRoom —— 沉浸首页 orchestrator（client 场景根）
   职责：
   1. 探测降级条件（prefers-reduced-motion / 视口 <768px），经 context 下发。
   2. 建一对鼠标视差 MotionValue，桌面沉浸态监听 pointermove 写入（不 useState，
      避免每帧 re-render）；降级态不挂监听。
   3. 渲染三幕（推门 / 走近书桌 / 环顾房间），把 server 传入的真实数据分发给对应幕。

   本组件是纯 client：只引 client 子组件与 framer 原语，不触任何 server 链
   （next/headers / session / api / prisma / queries）。真实数据全部由 server
   page 作 props 传入。真实文案在各幕内以真实 DOM 渲染，利于 SEO/LCP。
   ============================================================ */

export interface ImmersiveData {
  onlineCount: number;
  totalCourses: number;
  courses: CourseCardData[];
  demand: {
    id: string;
    title: string;
    description: string | null;
    categoryLabel: string;
    totalVotes: number;
  } | null;
  demandCount: number;
  canVote: boolean;
  yearPriceText: string | null;
}

export function ImmersiveStudyRoom(data: ImmersiveData) {
  const { rawX, rawY, px, py } = usePointerMotion();

  // 降级判定：默认按「非移动、允许动效」乐观渲染（SSR 与首帧一致，避免布局跳变），
  // 挂载后按真实环境校正。SSR 时 immersive=true → 输出的静态 HTML 含完整真实文案，
  // 沉浸增强在 hydration 后按能力接管。
  const [motionOk, setMotionOk] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileMq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setMotionOk(!reduceMq.matches);
      setIsMobile(mobileMq.matches);
    };
    apply();
    const bind = (mq: MediaQueryList) => {
      if (mq.addEventListener) {
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
      }
      mq.addListener(apply);
      return () => mq.removeListener(apply);
    };
    const un1 = bind(reduceMq);
    const un2 = bind(mobileMq);
    return () => {
      un1();
      un2();
    };
  }, []);

  const immersive = motionOk && !isMobile;

  // 鼠标视差：仅沉浸态挂监听。归一化到 -1..1（视口中心为 0）。
  useEffect(() => {
    if (!immersive) {
      // 降级/离开沉浸态时把视差归位，防止残留倾斜。
      rawX.set(0);
      rawY.set(0);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      rawX.set(nx);
      rawY.set(ny);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [immersive, rawX, rawY]);

  const env: StudyRoomEnv = { px, py, motionOk, isMobile, immersive };

  return (
    <StudyRoomProvider value={env}>
      {/* 场景根：满宽脱离常规容器边距（首页 layout 若有 max-w 由 page 决定）。
          文字选择保留（真实内容），只是场景层不可选中由各幕内 aria-hidden 装饰承担。 */}
      <div className="relative w-full">
        <ActOne onlineCount={data.onlineCount} totalCourses={data.totalCourses} />
        <ActTwo />
        <ActThree
          courses={data.courses}
          demand={data.demand}
          demandCount={data.demandCount}
          canVote={data.canVote}
          yearPriceText={data.yearPriceText}
        />
      </div>
    </StudyRoomProvider>
  );
}
