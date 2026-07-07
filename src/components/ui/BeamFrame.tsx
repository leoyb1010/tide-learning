"use client";

import * as React from "react";

/**
 * BeamFrame —— 动态边框光束的**统一封装**（零第三方依赖，效果实现见 globals.css .beam-frame）。
 *
 * 背景：参考 border-beam 组件的动态高价值区域高亮。**未引入 border-beam npm 包**——它会在运行时注入
 * <style>、预设为彩虹色板，与本站克制的「暖灰蓝 + 有道红 7% 焦点信号」设计语言冲突，且属新增供应链依赖。
 * 故用现有 design token（var(--red)/var(--info)/var(--ink3)）+ 纯 CSS（transform:rotate + mask 只留边框环）
 * 原生实现同款「边缘扫光」，天生亮暗/多主题自适应、GPU 友好、reduced-motion 自动降级、无新依赖。
 *
 * 光束层 pointer-events:none 且绝对定位，故**不影响子元素布局与点击/键盘焦点**。
 * 圆角：光束用 border-radius:inherit 跟随本框——用 radius 传数值，或用 className 传 Tailwind 圆角（含响应式）。
 *
 * 用法（仅限极少数高价值区域，勿批量用于列表）：
 *   <BeamFrame className="rounded-[16px] lg:rounded-[18px]"><HeroInput/></BeamFrame>
 *   <BeamFrame variant="button" radius={12} tone="brand"><CtaButton/></BeamFrame>
 */

type BeamTone = "brand" | "neutral" | "ocean";
type BeamVariant = "inner" | "outside" | "line" | "button";

export interface BeamFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** inner=贴边细环(默认) · outside=略外扩带柔光 · line=更细更慢 · button=按钮小圆角基调 */
  variant?: BeamVariant;
  /** 光束色调（默认品牌红；克制起见非品牌处可用 neutral/ocean）。 */
  tone?: BeamTone;
  /** 关闭光束层（如与用户偏好联动）；关闭时仅透传子元素、零额外 DOM 影响。 */
  enabled?: boolean;
  /** 本框圆角(px)。省略则不写内联圆角，改由 className 决定（支持响应式圆角）。 */
  radius?: number;
  /** 扫光一圈时长(秒)，默认 3.4（line 变体 4.4）。 */
  duration?: number;
}

export function BeamFrame({
  children,
  variant = "inner",
  tone = "brand",
  enabled = true,
  radius,
  duration,
  className,
  style,
  ...rest
}: BeamFrameProps) {
  const vars: React.CSSProperties = {
    ...(radius != null ? { borderRadius: radius } : null),
    ...(duration != null ? ({ "--beam-dur": `${duration}s` } as React.CSSProperties) : null),
    ...style,
  };
  return (
    <div className={`beam-frame beam-frame--${tone} beam-frame--${variant} ${className ?? ""}`} style={vars} {...rest}>
      {children}
      {enabled && <span className="beam-frame__beam" aria-hidden />}
    </div>
  );
}
