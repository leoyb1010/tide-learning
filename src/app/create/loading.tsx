/**
 * AI 造课骨架屏 —— 点击瞬间反馈。
 * 仿 /create 布局：垂直居中的造课工作台（标题 + 大输入区 + 操作行）。
 */
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-160px)] w-full max-w-[1040px] flex-col justify-center py-8 sm:py-12">
      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)]">
        {/* 标题区 */}
        <div className="flex flex-col items-center">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton mt-3 h-8 w-72 max-w-full" />
          <div className="skeleton mt-3 h-4 w-96 max-w-full" />
        </div>

        {/* 大输入区 */}
        <div className="skeleton mt-8 h-40 w-full rounded-[14px]" />

        {/* 操作行 */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <div className="skeleton h-9 w-24 rounded-[10px]" />
            <div className="skeleton h-9 w-24 rounded-[10px]" />
          </div>
          <div className="skeleton h-11 w-36 rounded-[12px]" />
        </div>
      </div>
    </div>
  );
}
