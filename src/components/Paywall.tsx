import { Waves, Check } from "@phosphor-icons/react/dist/ssr";
import { Button } from "./ui";

/**
 * Paywall — 不制造焦虑、不倒计时、明确解锁内容与取消方式。
 */
export function Paywall({
  remainingLessons,
  courseTitle,
  isLoggedIn,
}: {
  remainingLessons: number;
  courseTitle: string;
  isLoggedIn: boolean;
}) {
  return (
    <div className="mx-auto max-w-lg overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      <div className="flex items-center justify-center border-b border-ink-100 bg-accent-50/50 py-8">
        <Waves size={34} weight="light" className="text-accent-600" />
      </div>
      <div className="px-8 py-7 text-center">
        <h3 className="text-lg font-semibold tracking-tight text-ink-950">
          继续学习后面的 <span className="num text-accent-700">{remainingLessons}</span> 讲
        </h3>
        <p className="mt-2 text-sm text-ink-500">订阅《{courseTitle}》所在赛道，即可解锁全部章节</p>

        <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-ink-600">
          {["实战模板与案例拆解", "每周持续更新", "无限笔记 + 时间戳锚点", "笔记永久保留，随时可取消"].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <Check size={15} weight="bold" className="shrink-0 text-accent-600" />
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button href="/pricing" variant="primary" size="lg" icon>查看订阅方案</Button>
          {!isLoggedIn && <Button href="/login" variant="secondary" size="lg">登录 / 注册</Button>}
        </div>
        <p className="num mt-4 text-[0.72rem] text-ink-400">连续包月首月 ¥19.9，之后 ¥99/月 · 随时可取消</p>
      </div>
    </div>
  );
}
