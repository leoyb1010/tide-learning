"use client";

import { createContext, useContext } from "react";
import { useMotionValue, useSpring, type MotionValue } from "framer-motion";

/* ============================================================
   StudyRoomContext —— 沉浸首页共享环境（自习室场景）
   - 鼠标视差：整个场景共享一对归一化指针 MotionValue（-1..1），
     ActOne 的透视容器、台灯光晕据此微偏。用 MotionValue（不 useState）
     避免每帧 re-render。
   - 降级判定：reduce-motion / 移动端由 orchestrator 统一探测后经 context 下发，
     子幕据此决定「沉浸 3D」还是「静态分层海报 / 纵向淡入」。
   本文件只导出 client 原语与 hooks，不引任何 server 链。
   ============================================================ */

export interface StudyRoomEnv {
  /** 归一化鼠标 X，-1（最左）..1（最右）。桌面非降级时才活跃。 */
  px: MotionValue<number>;
  /** 归一化鼠标 Y，-1（最上）..1（最下）。 */
  py: MotionValue<number>;
  /** 是否允许沉浸动效（!reduce-motion）。false → 静态分层海报。 */
  motionOk: boolean;
  /** 沉浸 3D 是否可用（当前等价 motionOk；移动端适配全部走 CSS media query，不再下发 isMobile 标志）。 */
  immersive: boolean;
}

const StudyRoomContext = createContext<StudyRoomEnv | null>(null);

export function useStudyRoom(): StudyRoomEnv {
  const ctx = useContext(StudyRoomContext);
  if (!ctx) {
    throw new Error("useStudyRoom 必须在 <StudyRoomProvider> 内使用");
  }
  return ctx;
}

/** 建一对带弹性的指针 MotionValue（供 provider 内部初始化）。 */
export function usePointerMotion() {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  // 轻弹跟随，让视差有「重量」而非生硬；克制 stiffness 防抖。
  const px = useSpring(rawX, { stiffness: 60, damping: 18, mass: 0.6 });
  const py = useSpring(rawY, { stiffness: 60, damping: 18, mass: 0.6 });
  return { rawX, rawY, px, py };
}

export const StudyRoomProvider = StudyRoomContext.Provider;
