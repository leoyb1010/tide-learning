import { Button } from "./ui";

/**
 * Paywall — §6.4 文案规则：不制造焦虑、不倒计时逼单、明确解锁内容、明确取消方式。
 * 服务端已判定无权访问后展示；不含任何倒计时或红色促销。
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
    <div className="mx-auto max-w-lg rounded-2xl border border-ink-100 bg-paper-raised p-8 text-center shadow-[var(--shadow-soft)]">
      <div className="mb-4 text-3xl">🌊</div>
      <h3 className="text-lg font-semibold text-ink-950">
        继续学习后面的 {remainingLessons} 讲
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-500">
        订阅后可解锁《{courseTitle}》全部章节，以及全站课程。
        <br />
        包含：实战模板、案例拆解、每周更新。
        <br />
        <span className="text-ink-950">笔记永久保留，随时可取消，取消后仍可查看笔记。</span>
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button href="/pricing" variant="primary" size="lg">
          查看订阅方案
        </Button>
        {!isLoggedIn && (
          <Button href="/login" variant="secondary" size="lg">
            登录 / 注册
          </Button>
        )}
      </div>
      <p className="mt-4 text-xs text-ink-400">连续包月首月 ¥19，之后 ¥38/月 · 随时在「我的-订阅」取消</p>
    </div>
  );
}
