import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl">🌊</div>
      <h1 className="mt-4 text-2xl font-semibold text-ink-950">页面走丢了</h1>
      <p className="mt-2 text-ink-500">你要找的内容不存在或已下架</p>
      <Link href="/" className="mt-6 rounded-xl bg-tide-600 px-6 py-3 text-sm font-medium text-white hover:bg-tide-700">返回首页</Link>
    </div>
  );
}
