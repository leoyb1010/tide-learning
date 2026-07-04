/**
 * trapFocus —— Tab 焦点陷阱，与 Dialog.tsx / SharePanel.tsx 内联版语义完全一致。
 *
 * 抽到共享模块，供后续新增模态（TopNav 移动抽屉、Player prep/review 面板）复用，
 * 避免第三、四份拷贝漂移。Dialog / SharePanel 的既有内联副本保持不动（不改动其契约）。
 *
 * 用法：在模态的 keydown handler 里对 e.key === "Tab" 调用 trapFocus(e, panelEl)，
 * Tab / Shift+Tab 循环停留在面板内首/末可聚焦元素之间。
 */
export function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const focusables = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
