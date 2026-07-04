"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AmbientVideo —— 深色展示区「静态渐变卡 → 真实氛围视频」的统一接入件。
 *
 * 用途：把营销/详情页里原本 var(--video-grad) 静态占位卡，换成自动播放、静音、
 * 循环的背景视频，同时严守可访问性与移动端自动播放约束：
 *  - muted + playsInline：iOS Safari 允许无声自动播放的硬性要求。
 *  - autoPlay + loop：氛围铺底，无需交互。
 *  - poster / gradient 兜底：视频加载前、加载失败、或 prefers-reduced-motion 时，
 *    统一落到静帧（poster 图）或渐变（--video-grad）铺底，绝不出现死黑/空白。
 *  - prefers-reduced-motion：不自动播放，只显示静帧（poster 或渐变），尊重用户偏好。
 *
 * 本组件只负责「铺满容器的底层视频/静帧」；所有标题、进度、播放圆等叠层由调用方
 * 以绝对定位子元素叠在其上（本组件铺 absolute inset-0，z 层在叠层之下）。
 */
export function AmbientVideo({
  src,
  poster,
  gradient = "var(--video-grad)",
  className = "",
  objectPosition,
}: {
  /** 视频源（public 下的绝对路径，如 /videos/marketing/xxx.mp4）。 */
  src: string;
  /** 首帧兜底静帧图（public 路径）。缺省则仅用渐变兜底。 */
  poster?: string;
  /** 最底层渐变兜底，默认 --video-grad。视频/静帧透明或未加载时透出。 */
  gradient?: string;
  className?: string;
  /** 视频/静帧的 object-position（如 "center 30%"），控制裁切焦点。 */
  objectPosition?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 动效门：默认 false（先不自动播放），挂载后按用户偏好放行，避免 reduce 用户抢跑首帧。
  const [motionOk, setMotionOk] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotionOk(!mq.matches);
    apply();
    // 用户中途切换系统动效偏好时同步（现代浏览器 addEventListener，回退 addListener）。
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  // motionOk 变化时主动 play/pause（autoPlay 属性只在初次生效，切换偏好需手动兜住）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (motionOk) {
      // play() 返回的 promise 在自动播放被拒时会 reject，静默吞掉（poster 已兜底）。
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [motionOk]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ background: gradient }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay={motionOk}
        preload="metadata"
        className="h-full w-full object-cover"
        style={objectPosition ? { objectPosition } : undefined}
      />
    </div>
  );
}
