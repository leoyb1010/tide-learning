"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * NavHistoryTracker —— 会话内「是否已在站内导航过」的全局探针（挂在根 layout，仅此一处）。
 *
 * 为什么需要：Next 15 App Router 的 history.state 不再暴露 idx（改用私有的
 * __PRIVATE_NEXTJS_INTERNALS_TREE），无法据此判断「router.back() 会不会离开站点」。
 * 故自行在 sessionStorage 记一枚标记：本标签页发生过至少一次站内路由切换 → 置 1。
 * SmartBackLink 在点击时读它：为 1 才 router.back()（必回站内来源），否则用兜底路径
 * （新标签 / 外链直达 / 首屏即详情页的场景）。sessionStorage 天然按标签页隔离、关页即清。
 */
export function NavHistoryTracker() {
  const pathname = usePathname();
  const isFirst = useRef(true);

  useEffect(() => {
    // 首个 pathname 是本标签页的落地页，不算「导航过」；此后每次 pathname 变化即置标记。
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    try {
      sessionStorage.setItem("tide:hasNavigated", "1");
    } catch {
      /* 隐私模式 / 存储禁用：静默降级，SmartBackLink 会退回兜底路径 */
    }
  }, [pathname]);

  return null;
}
