import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "潮汐学习隐私政策：我们收集哪些数据、如何使用埋点数据，以及你的权利。",
};

// 隐私政策 — 静态合规文案，重点说明埋点数据用途
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-[760px] py-6">
      <Reveal>
        <div className="overline mb-2 text-accent-600">PRIVACY</div>
        <h1 className="text-[1.9rem] font-semibold tracking-tight text-ink-950">隐私政策</h1>
        <p className="mt-2 text-sm text-ink-400">最后更新：2026 年 7 月 1 日</p>
      </Reveal>

      <div className="tide-md mt-10 space-y-8 text-ink-700">
        <Section title="1. 我们收集的信息">
          <ul>
            <li><strong>账号信息</strong>：注册时的邮箱或手机号、昵称，用于登录与身份识别。</li>
            <li><strong>学习信息</strong>：课程进度、笔记、需求投票等，用于同步进度与提供学习记录。</li>
            <li><strong>订阅信息</strong>：订阅状态与计费记录（不含完整支付卡号，支付由第三方支付渠道处理）。</li>
            <li><strong>设备与日志</strong>：IP、浏览器类型、访问时间，用于安全防护与限流。</li>
          </ul>
        </Section>

        <Section title="2. 埋点数据用途">
          <p>
            为持续改进产品体验，我们会记录匿名或化名的产品使用事件（例如：课程播放、笔记创建、需求投票、
            订阅变更、页面浏览等）。这些埋点数据用于：
          </p>
          <ul>
            <li>分析功能使用情况，优化课程排期与产品功能；</li>
            <li>衡量学习效果与留存，改进学习流与提醒；</li>
            <li>排查异常与保障服务稳定。</li>
          </ul>
          <p>
            埋点数据以聚合与统计形式使用，<strong>不会用于向第三方出售个人信息</strong>，也不会将其与不必要的个人身份信息关联。
          </p>
        </Section>

        <Section title="3. 信息的存储与安全">
          <p>
            我们采取合理的技术与管理措施保护您的信息，包括传输加密、访问控制与最小化收集原则。
            会话凭证以严格同源（SameSite）策略下发，降低跨站风险。
          </p>
        </Section>

        <Section title="4. 信息共享">
          <p>
            除支付渠道、云服务等为提供服务所必需的合作方外，我们不会向第三方共享您的个人信息，
            法律法规另有规定或经您同意的情形除外。
          </p>
        </Section>

        <Section title="5. 您的权利">
          <ul>
            <li>访问、更正您的账号与学习信息；</li>
            <li>导出您创建的笔记；</li>
            <li>注销账号并删除关联的个人数据；</li>
            <li>在设置中调整个性化与通知偏好。</li>
          </ul>
        </Section>

        <Section title="6. 联系我们">
          <p>
            如需行使上述权利或对隐私有疑问，请发送邮件至 privacy@tide.learning。服务条款请参见
            <Link href="/terms" className="link-underline text-accent-700">《用户协议》</Link>。
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold tracking-tight text-ink-950">{title}</h2>
      {children}
    </section>
  );
}
