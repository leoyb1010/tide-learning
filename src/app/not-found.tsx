import Link from "next/link";
import { TideMark } from "@/components/TideMark";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <TideMark size={44} />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink-950">页面走丢了</h1>
      <p className="mt-2 text-ink-500">你要找的内容不存在或已下架</p>
      <Link href="/" className="mt-7 rounded-xl bg-accent-600 px-6 py-3 text-sm font-medium text-white transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:bg-accent-700 active:scale-[0.97]">返回首页</Link>
    </div>
  );
}
