import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = {
  title: "用户协议",
  description: "潮汐学习用户服务协议：订阅、内容、笔记归属与取消规则。",
};

// 用户协议 — 静态合规文案（订阅制学习平台）
export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl py-6">
      <Reveal>
        <div className="overline mb-2 text-accent-600">LEGAL</div>
        <h1 className="text-[1.9rem] font-semibold tracking-tight text-ink-950">用户服务协议</h1>
        <p className="mt-2 text-sm text-ink-400">最后更新：2026 年 7 月 1 日</p>
      </Reveal>

      <div className="tide-md mt-10 space-y-8 text-ink-700">
        <Section title="1. 协议范围">
          <p>
            本协议是您与网易有道「潮汐学习」平台（下称「本平台」）之间就使用订阅制学习服务达成的约定。
            当您注册账号、订阅课程或以其他方式使用本平台服务时，即视为您已阅读并同意本协议全部条款。
          </p>
        </Section>

        <Section title="2. 账号与使用">
          <p>
            您应对账号下的一切行为负责，不得将账号出借、转让或与他人共享。平台账号仅供个人非商业性学习使用；
            禁止对课程视频、讲义、字幕等内容进行录制、下载、转载、二次销售或公开传播。
          </p>
        </Section>

        <Section title="3. 订阅与计费">
          <ul>
            <li>本平台采用订阅制。全站会员解锁全部赛道，单赛道会员解锁所订赛道，均含每周持续更新的新章节。</li>
            <li>连续包月首月优惠价 ¥19.9，之后按标准价 ¥99/月自动续费，续费价格以下单时的价格快照为准。</li>
            <li>您可在「我的 · 订阅管理」中随时取消。取消后权益保留至当前计费周期结束，不再产生下一期扣费。</li>
            <li>取消或到期后，课程内容锁定，但您创建的笔记永久保留、可随时查看与导出。</li>
          </ul>
        </Section>

        <Section title="4. 退款">
          <p>
            数字内容一经解锁不支持无理由退款。若发生重复扣费、系统故障等异常，请通过下方客服渠道联系我们，
            核实后将按原路退回。依法享有的法定退款权利不受本条限制。
          </p>
        </Section>

        <Section title="5. 内容与免责">
          <p>
            本平台课程用于学习与信息素养提升。健康、财务、防诈骗等类目内容仅供学习参考，
            <strong>不构成诊断、治疗、用药、投资或其他专业建议</strong>；相关内容均经审核并标注免责声明。
            请勿将课程内容作为专业决策的唯一依据。
          </p>
        </Section>

        <Section title="6. 用户共创">
          <p>
            订阅用户可在需求广场提交学习需求并投票。您提交的需求内容授权本平台用于课程规划与制作展示。
            平台对需求是否立项、排期与实现方式保留最终决定权。
          </p>
        </Section>

        <Section title="7. 协议变更">
          <p>
            本平台可能根据业务与法规调整本协议，重大变更将通过站内通知或公告告知。变更生效后继续使用即视为接受。
          </p>
        </Section>

        <Section title="8. 联系我们">
          <p>
            如对本协议有任何疑问，请发送邮件至 support@tide.learning。隐私相关事项请参见
            <Link href="/privacy" className="link-underline text-accent-700">《隐私政策》</Link>。
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
