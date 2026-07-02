import Link from "next/link";

// §6.1 页脚：价格、续费规则、取消方式、合规信息清晰展示
export function Footer() {
  return (
    <footer className="mt-20 border-t border-ink-100 bg-paper-raised">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🌊</span>
            <span className="font-semibold text-ink-950">潮汐学习</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            全龄订阅制学习平台。按月订阅，解锁持续更新的体系化课程，用需求投票决定下一批课程。
          </p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-medium text-ink-950">产品</h4>
          <ul className="space-y-2 text-sm text-ink-500">
            <li><Link href="/courses" className="hover:text-tide-700">课程库</Link></li>
            <li><Link href="/updates" className="hover:text-tide-700">本周上新</Link></li>
            <li><Link href="/demands" className="hover:text-tide-700">需求广场</Link></li>
            <li><Link href="/pricing" className="hover:text-tide-700">订阅方案</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-medium text-ink-950">订阅说明</h4>
          <ul className="space-y-2 text-sm text-ink-500">
            <li>连续包月首月 ¥19，之后 ¥38/月</li>
            <li>随时可在「我的-订阅」取消</li>
            <li>取消后课程锁定，笔记永久保留</li>
            <li>到期不自动扣费需手动关闭连续包月</li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-medium text-ink-950">合规</h4>
          <ul className="space-y-2 text-sm text-ink-500">
            <li>健康类内容仅用于健康信息素养</li>
            <li>不构成诊断、治疗或用药建议</li>
            <li>防诈骗内容仅讲识别与防范</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-100 py-5 text-center text-xs text-ink-400">
        © 2026 潮汐学习 · v0.3 MVP · 本平台内容仅供学习参考
      </div>
    </footer>
  );
}
