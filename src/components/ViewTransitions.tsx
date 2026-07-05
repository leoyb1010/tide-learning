"use client";

/* ============================================================
   ViewTransitions —— App Router 软导航转场驱动（纯客户端，无 server import）
   ------------------------------------------------------------
   Next 15.1.3 无稳定 experimental.viewTransition，故用原生
   document.startViewTransition 包裹 router 软导航，复用 globals.css 的
   ::view-transition-* 规则做全站淡入淡出 + 课程封面共享元素形变。

   工作方式（事件委托，零改造现有 <Link>）：
   1. 捕获文档级 click，识别站内 <a>（同源、非新窗口、非修饰键、非 hash）；
   2. 若命中「课程卡 → 课程详情」，在旧页封面写 view-transition-name=course-cover；
   3. document.startViewTransition(() => router.push(href))，让浏览器补间；
   4. 详情页封面已静态标注同名，两端自动配对形变。

   渐进增强：浏览器不支持 startViewTransition → 直接 router.push，无过渡、功能不变。
   reduce-motion：CSS 层已将所有 ::view-transition-* 动画置 none，切换瞬时完成。
   ============================================================ */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const COVER_NAME = "course-cover";
// 课程卡封面元素标记：CourseCard 封面容器带 data-vt-cover，值为课程 slug。
const COVER_ATTR = "data-vt-cover";

type WithStartViewTransition = Document & {
  startViewTransition?: (cb: () => void) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

export function ViewTransitions() {
  const router = useRouter();

  useEffect(() => {
    const doc = document as WithStartViewTransition;
    // 能力探测：无 startViewTransition（Firefox/旧 Safari）→ 不拦截，走浏览器默认软导航。
    if (typeof doc.startViewTransition !== "function") return;

    // reduce-motion 用户：不拦截，让导航即时发生（CSS 也已把过渡降级，双保险）。
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // 清掉上一轮可能残留的封面命名，避免污染下次转场。
    function clearCoverName() {
      document
        .querySelectorAll<HTMLElement>(`[${COVER_ATTR}]`)
        .forEach((el) => {
          el.style.viewTransitionName = "";
        });
    }

    function onClick(e: MouseEvent) {
      if (reduce.matches) return;
      // 仅左键、无修饰键（cmd/ctrl/shift/alt 交给浏览器开新标签等原生行为）。
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      // 新窗口 / 下载 / 非站内 / 锚点 → 交回浏览器。
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (!href.startsWith("/")) return;

      // 同址不转场。
      const dest = new URL(href, window.location.origin);
      if (dest.pathname === window.location.pathname && dest.search === window.location.search) return;

      // 命中课程卡封面 → 标记共享元素，令详情封面承接同一张封面。
      const cover = anchor.querySelector<HTMLElement>(`[${COVER_ATTR}]`);
      if (cover) {
        clearCoverName();
        cover.style.viewTransitionName = COVER_NAME;
      }

      e.preventDefault();
      const transition = doc.startViewTransition!(() => {
        router.push(href);
      });
      // 转场结束（或被打断）后清名，防止残留影响后续任意导航。
      // ready/updateCallbackDone 在转场被跳过（快速连点/新导航打断）时会 reject——
      // 三个 promise 全部兜住，否则控制台出现未处理的「Transition was skipped」。
      transition.finished.finally(clearCoverName).catch(() => {});
      transition.ready.catch(() => {});
      transition.updateCallbackDone.catch(() => {});
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);

  return null;
}
