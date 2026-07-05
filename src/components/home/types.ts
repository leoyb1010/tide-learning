/* ============================================================
   首页沉浸场景 · 共享类型
   ------------------------------------------------------------
   TrackCardData 被 server page（装配数据）、ActThree（第三幕收尾）、
   HomeFunnel（下半区转化漏斗）三处共用。抽到独立 types 文件，避免
   下半区组件反向依赖某一幕组件、也避免各 agent 改幕时牵动彼此的 import。
   纯类型文件，无运行时代码、无 client/server 边界问题。
   ============================================================ */

/** 赛道精选卡（server 用真实赛道 + 课程数派生，client 只渲染）。 */
export interface TrackCardData {
  key: string;
  label: string;
  blurb: string;
  people: string;
  gradient: string; // trackGradientVar() 结果，如 var(--track-ai)
  iconKey: string; // trackIconKey() 结果
  courseCount: number;
}
