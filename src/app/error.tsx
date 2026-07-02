"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="mt-4 text-2xl font-semibold text-ink-950">出错了</h1>
      <p className="mt-2 text-ink-500">页面加载遇到问题，请稍后重试</p>
      <button onClick={reset} className="mt-6 rounded-xl bg-tide-600 px-6 py-3 text-sm font-medium text-white hover:bg-tide-700">重试</button>
    </div>
  );
}
