/**
 * /desk 加载骨架 —— 贴合自习桌（问候 + 中央输入框 + 学习中 + 我的书桌三卡）。
 */
export default function DeskLoading() {
  return (
    <div className="mx-auto flex max-w-[1060px] flex-col gap-14 md:gap-16">
      {/* 问候 */}
      <div className="space-y-2 pt-2">
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>
      {/* 中央输入框 */}
      <div className="flex flex-col items-center gap-4">
        <div className="skeleton h-4 w-40 rounded" />
        <div className="skeleton h-[60px] w-full max-w-[620px] rounded-[18px]" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-28 rounded-full" />
          ))}
        </div>
      </div>
      {/* 学习中主卡 */}
      <div className="space-y-3">
        <div className="skeleton h-5 w-20 rounded" />
        <div className="skeleton h-[96px] w-full rounded-[16px]" />
      </div>
      {/* 我的书桌三卡 */}
      <div className="space-y-3">
        <div className="skeleton h-5 w-24 rounded" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-[150px] rounded-[16px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
