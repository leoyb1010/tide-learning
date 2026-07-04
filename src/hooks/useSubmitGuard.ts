"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSubmitGuard —— 提交防抖守卫。
 *
 * 包装一个异步提交函数，杜绝「双击双发」：一次提交进行中时，重复调用被静默忽略，
 * 不会触发第二次网络请求。同时对外暴露 submitting 态，供按钮做 disabled + loading。
 *
 * 用 ref 做进行中判定（而非仅依赖 state），避免同一 tick 内连续两次点击因闭包读到
 * 旧 state 而漏拦；state 仅用于驱动 UI 重渲染。
 *
 * 含超时兜底：若被包装的 fn 因未捕获异常/挂起等原因迟迟不 resolve，
 * timeoutMs（默认 20s）后自动解锁，避免按钮永久卡在 loading。
 *
 * @param fn        受保护的异步提交函数（可带任意参数与返回值）
 * @param timeoutMs 兜底解锁超时，默认 20000ms；传 0 关闭兜底
 * @returns { submitting, guard, reset }
 *   - submitting：是否正在提交（供按钮 disabled/loading）
 *   - guard：包裹后的函数；进行中调用返回 undefined（被忽略），否则透传 fn 的结果
 *   - reset：手动解锁（极少用；组件卸载已自动清理）
 */
export function useSubmitGuard<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  timeoutMs = 20000,
): {
  submitting: boolean;
  guard: (...args: Args) => Promise<R | undefined>;
  reset: () => void;
} {
  const [submitting, setSubmitting] = useState(false);
  // 进行中判定用 ref：同一渲染周期内的重复点击也能可靠拦截
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 始终指向最新 fn，guard 依赖保持稳定（引用不随 fn 变化而改变）
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const unlock = useCallback(() => {
    inFlight.current = false;
    clearTimer();
    if (mounted.current) setSubmitting(false);
  }, [clearTimer]);

  const guard = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      if (inFlight.current) return undefined; // 进行中：忽略重复调用
      inFlight.current = true;
      if (mounted.current) setSubmitting(true);

      // 超时兜底：到点强制解锁（不打断真实 fn 的后续 finally）
      if (timeoutMs > 0) {
        timer.current = setTimeout(() => {
          inFlight.current = false;
          timer.current = null;
          if (mounted.current) setSubmitting(false);
        }, timeoutMs);
      }

      try {
        return await fnRef.current(...args);
      } finally {
        unlock();
      }
    },
    [timeoutMs, unlock],
  );

  return { submitting, guard, reset: unlock };
}
