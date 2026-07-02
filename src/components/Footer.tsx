import Link from "next/link";
import { YoudaoLogo } from "./YoudaoLogo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-ink-100 bg-paper-raised">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <YoudaoLogo variant="ink" height={20} />
            <span className="h-4 w-px bg-ink-200" />
            <span className="font-semibold tracking-tight text-ink-950">潮汐学习</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-500">
            网易有道 出品。订阅制学习平台，按月订阅解锁持续更新的体系化课程；全站畅学或单赛道自由组合，用需求投票决定下一批课程。
          </p>
        </div>
        <FooterCol title="产品" links={[
          { href: "/courses", label: "课程库" },
          { href: "/updates", label: "本周上新" },
          { href: "/demands", label: "需求广场" },
          { href: "/pricing", label: "订阅方案" },
        ]} />
        <div>
          <h4 className="overline mb-4 text-ink-400">订阅说明</h4>
          <ul className="space-y-2.5 text-sm text-ink-500">
            <li>连续包月首月 ¥19.9，之后 ¥99/月</li>
            <li>随时在「我的 · 订阅」取消</li>
            <li>取消后课程锁定，笔记永久保留</li>
          </ul>
        </div>
        <FooterCol title="合规" links={[
          { href: "/terms", label: "用户协议" },
          { href: "/privacy", label: "隐私政策" },
        ]}>
          <li className="text-ink-400">健康内容仅用于健康信息素养</li>
          <li className="text-ink-400">不构成诊断、治疗或用药建议</li>
        </FooterCol>
      </div>
      <div className="border-t border-ink-100 py-5 text-center">
        <p className="num text-[0.72rem] text-ink-400">© 2026 网易有道 · 潮汐学习 v1.0 · 内容仅供学习参考</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links, children }: { title: string; links: { href: string; label: string }[]; children?: React.ReactNode }) {
  return (
    <div>
      <h4 className="overline mb-4 text-ink-400">{title}</h4>
      <ul className="space-y-2.5 text-sm text-ink-500">
        {links.map((l) => (
          <li key={l.href}>
            {/* A3-9：链接改用 accent-700 提升可见性 */}
            <Link href={l.href} className="link-underline font-medium text-accent-700 hover:text-accent-600">{l.label}</Link>
          </li>
        ))}
        {children}
      </ul>
    </div>
  );
}
