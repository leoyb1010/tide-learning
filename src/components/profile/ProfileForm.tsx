"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IdentificationCard,
  UserCircle,
  Quotes,
  NotePencil,
  Eye,
  Check,
  LockKey,
  ChartBar,
  Medal,
  ChatCircleText,
} from "@phosphor-icons/react";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { useToast } from "@/components/Toast";
import { SharePanel } from "@/components/SharePanel";
import { StudentCardPreview } from "./StudentCardPreview";

/* ============================================================
 * 个人资料编辑表单（v3.0 设置精品化）
 * 左：分组字段卡（elev-1）；右：学生证实时预览 + 分享。
 * 改 motto/昵称/头像 → 预览即时刷新；保存走 PATCH /api/profile（useSubmitGuard 防抖）。
 * STUDIO 语义 token，输入 focus 红边，保存按钮 cta，触达≥44px，零 em-dash。
 * ============================================================ */

// 预设头像（public/avatars/*）；与后端白名单一致。
const PRESET_AVATARS = ["/avatars/avatar-1.png", "/avatars/avatar-2.png", "/avatars/avatar-3.png"];

const MOTTO_MAX = 40;
const BIO_MAX = 200;
const NICKNAME_MAX = 16;

const AGE_BAND_OPTIONS = [
  { value: "18-24", label: "18-24 岁" },
  { value: "22-40", label: "22-40 岁" },
  { value: "35-45", label: "35-45 岁" },
  { value: "45-65", label: "45-65 岁" },
];

const GOAL_OPTIONS = [
  { value: "skill", label: "技能提升" },
  { value: "exam", label: "考试备考" },
  { value: "interest", label: "兴趣拓展" },
  { value: "career", label: "职业发展" },
  { value: "language", label: "语言学习" },
];

export interface ProfileFormProps {
  userId: string;
  // 初始值
  initial: {
    nickname: string;
    avatarUrl: string | null;
    motto: string | null;
    bio: string | null;
    birthYear: number | null;
    ageBand: string | null;
    learningGoal: string | null;
    showStats: boolean;
    showBadges: boolean;
    showPosts: boolean;
  };
  // 改名冷却：null 表示当前可改，否则为剩余天数
  nicknameCooldownDays: number | null;
  // 学生证静态展示数据（预览用）
  card: {
    studentNo: string;
    joinedLabel: string;
    validLabel: string;
    levelLabel: string;
    hoursLabel: string;
    streak: number;
    isSubscriber: boolean;
    qrSvg?: string;
  };
}

const inputCls =
  "w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:ring-2 focus:ring-[var(--red)]/25";

export function ProfileForm({ userId, initial, nicknameCooldownDays, card }: ProfileFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── 表单状态（预览联动的三项：nickname / motto / avatarUrl 直接驱动预览）──
  const [nickname, setNickname] = useState(initial.nickname);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);
  const [motto, setMotto] = useState(initial.motto ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [birthYear, setBirthYear] = useState<string>(initial.birthYear ? String(initial.birthYear) : "");
  const [ageBand, setAgeBand] = useState(initial.ageBand ?? "");
  const [learningGoal, setLearningGoal] = useState(initial.learningGoal ?? "");
  const [showStats, setShowStats] = useState(initial.showStats);
  const [showBadges, setShowBadges] = useState(initial.showBadges);
  const [showPosts, setShowPosts] = useState(initial.showPosts);

  const [err, setErr] = useState<string | null>(null);
  // 改名冷却：保存成功若触发了改名，本地立刻锁定为 30 天（避免连续改）。
  const [cooldownDays, setCooldownDays] = useState<number | null>(nicknameCooldownDays);
  const nameLocked = cooldownDays !== null;

  // 脏检查：任一字段偏离初始即可保存。
  const dirty = useMemo(() => {
    return (
      nickname.trim() !== initial.nickname ||
      (avatarUrl ?? "") !== (initial.avatarUrl ?? "") ||
      motto.trim() !== (initial.motto ?? "") ||
      bio.trim() !== (initial.bio ?? "") ||
      birthYear !== (initial.birthYear ? String(initial.birthYear) : "") ||
      ageBand !== (initial.ageBand ?? "") ||
      learningGoal !== (initial.learningGoal ?? "") ||
      showStats !== initial.showStats ||
      showBadges !== initial.showBadges ||
      showPosts !== initial.showPosts
    );
  }, [nickname, avatarUrl, motto, bio, birthYear, ageBand, learningGoal, showStats, showBadges, showPosts, initial]);

  // ── 保存（useSubmitGuard 防抖 + 超时兜底）──────────────
  const { submitting, guard } = useSubmitGuard(async () => {
    setErr(null);
    const payload: Record<string, unknown> = {
      // 昵称仅在可改且有变动时提交（冷却中禁用输入，理论上不会到这）。
      ...(!nameLocked && nickname.trim() !== initial.nickname ? { nickname: nickname.trim() } : {}),
      avatarUrl: avatarUrl ?? "",
      motto: motto.trim(),
      bio: bio.trim(),
      birthYear: birthYear ? Number(birthYear) : null,
      ageBand: ageBand || null,
      learningGoal: learningGoal || null,
      showProfile: { stats: showStats, badges: showBadges, posts: showPosts },
    };

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({ ok: false, error: "网络异常" }))) as {
      ok: boolean;
      error?: string;
      data?: { nicknameChanged?: boolean };
    };
    if (!json.ok) {
      setErr(json.error ?? "保存失败");
      toast(json.error ?? "保存失败", { tone: "warn" });
      return;
    }
    if (json.data?.nicknameChanged) setCooldownDays(30); // 改名成功 → 本地锁 30 天
    toast("资料已保存", { tone: "success" });
    // 刷新 server 组件（个人主页 / 学生证等读取最新值）。
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      {/* ═══ 左：字段分组卡 ═══ */}
      <div className="stagger flex min-w-0 flex-1 flex-col gap-5">
        {/* 卡一：证件信息（头像 / 昵称 / 座右铭）—— 直接联动学生证 */}
        <FieldCard
          index={0}
          icon={<IdentificationCard size={18} weight="fill" />}
          tone="red"
          title="证件信息"
          desc="展示在学生证上"
        >
          {/* 头像选择 */}
          <FieldLabel icon={<UserCircle size={14} weight="fill" />}>头像</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            {/* 默认字母头像（清空） */}
            <AvatarChoice
              selected={!avatarUrl}
              onClick={() => setAvatarUrl(null)}
              label="默认头像"
            >
              <span className="grid h-full w-full place-items-center rounded-full bg-[var(--surface-inset)] text-[18px] font-bold text-[var(--ink2)]">
                {(nickname.slice(0, 1) || "学")}
              </span>
            </AvatarChoice>
            {PRESET_AVATARS.map((src) => (
              <AvatarChoice
                key={src}
                selected={avatarUrl === src}
                onClick={() => setAvatarUrl(src)}
                label="选择头像"
              >
                { }
                <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
              </AvatarChoice>
            ))}
          </div>

          {/* 昵称（改名冷却） */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <FieldLabel plain>昵称</FieldLabel>
              {nameLocked && (
                <span className="inline-flex items-center gap-1 text-[12px] text-[var(--warn)]">
                  <LockKey size={12} weight="fill" /> 改名冷却中，还需 {cooldownDays} 天
                </span>
              )}
            </div>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, NICKNAME_MAX))}
              disabled={nameLocked}
              maxLength={NICKNAME_MAX}
              className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-55`}
              placeholder="2-16 个字"
              aria-label="昵称"
            />
            <p className="mt-1.5 text-[12px] text-[var(--ink4)]">
              {nameLocked ? "冷却结束后可再次修改" : "修改后 30 天内不可再改，请谨慎"}
            </p>
          </div>

          {/* 座右铭 motto —— 学生证卡脚实时联动 */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <FieldLabel icon={<Quotes size={13} weight="fill" />}>座右铭</FieldLabel>
              <CharCount value={motto.length} max={MOTTO_MAX} />
            </div>
            <input
              value={motto}
              onChange={(e) => setMotto(e.target.value.slice(0, MOTTO_MAX))}
              maxLength={MOTTO_MAX}
              className={inputCls}
              placeholder="日拱一卒，功不唐捐"
              aria-label="座右铭"
            />
            <p className="mt-1.5 text-[12px] text-[var(--ink4)]">右侧学生证会实时预览这句话</p>
          </div>
        </FieldCard>

        {/* 卡二：学习心得 bio（个人主页展示） */}
        <FieldCard
          index={1}
          icon={<NotePencil size={18} weight="fill" />}
          title="学习心得"
          desc="展示在你的个人主页"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <FieldLabel plain>一句话介绍自己或分享学习感悟</FieldLabel>
            <CharCount value={bio.length} max={BIO_MAX} />
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            maxLength={BIO_MAX}
            rows={4}
            className={`${inputCls} resize-none leading-relaxed`}
            placeholder="例如：正在攻克高数，也喜欢用费曼学习法把知识讲给别人听。"
            aria-label="学习心得"
          />
        </FieldCard>

        {/* 卡三：基础资料（出生年段 / 学习目标） */}
        <FieldCard
          index={2}
          icon={<UserCircle size={18} weight="fill" />}
          title="基础资料"
          desc="帮助我们为你推荐更合适的内容"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel plain>出生年份</FieldLabel>
              <input
                type="number"
                inputMode="numeric"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                min={1920}
                max={new Date().getFullYear()}
                className={`${inputCls} mt-1.5`}
                placeholder="例如 1998"
                aria-label="出生年份"
              />
            </div>
            <div>
              <FieldLabel plain>年龄段</FieldLabel>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {AGE_BAND_OPTIONS.map((o) => (
                  <ChipToggle
                    key={o.value}
                    active={ageBand === o.value}
                    onClick={() => setAgeBand(ageBand === o.value ? "" : o.value)}
                  >
                    {o.label}
                  </ChipToggle>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <FieldLabel plain>学习目标</FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {GOAL_OPTIONS.map((o) => (
                <ChipToggle
                  key={o.value}
                  active={learningGoal === o.value}
                  onClick={() => setLearningGoal(learningGoal === o.value ? "" : o.value)}
                >
                  {o.label}
                </ChipToggle>
              ))}
            </div>
          </div>
        </FieldCard>

        {/* 卡四：个人主页展示开关（showProfile） */}
        <FieldCard
          index={3}
          icon={<Eye size={18} weight="fill" />}
          tone="info"
          title="主页展示"
          desc="控制访客在你主页能看到哪些板块"
        >
          <div className="divide-y divide-[var(--border)]">
            <ToggleRow
              icon={<ChartBar size={15} weight="fill" />}
              label="学习数据"
              hint="等级、累计时长、发帖数等统计"
              checked={showStats}
              onChange={setShowStats}
            />
            <ToggleRow
              icon={<Medal size={15} weight="fill" />}
              label="成就徽章"
              hint="已解锁的徽章墙"
              checked={showBadges}
              onChange={setShowBadges}
            />
            <ToggleRow
              icon={<ChatCircleText size={15} weight="fill" />}
              label="动态"
              hint="你发布的公开帖子"
              checked={showPosts}
              onChange={setShowPosts}
            />
          </div>
        </FieldCard>

        {/* 保存栏（sticky 底部，脏才可保存） */}
        {err && <p className="text-[13px] font-medium text-[var(--red)]">{err}</p>}
        <div className="sticky bottom-3 z-10 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void guard()}
            disabled={submitting || !dirty}
            className="studio-press cta-glow inline-flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-6 text-[14px] font-semibold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? (
              "保存中…"
            ) : (
              <>
                <Check size={15} weight="bold" /> 保存资料
              </>
            )}
          </button>
          {dirty && !submitting && (
            <span className="text-[13px] text-[var(--ink4)]">有未保存的修改</span>
          )}
        </div>
      </div>

      {/* ═══ 右：学生证实时预览 + 分享 ═══ */}
      <aside className="w-full shrink-0 lg:w-[360px]">
        <div className="lg:sticky lg:top-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-[var(--ink2)]">学生证预览</p>
            <SharePanel
              kind="student-card"
              title="分享学生证"
              shareUrl={`/u/${userId}`}
              triggerLabel="分享学生证"
              triggerClassName="studio-press inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
            />
          </div>
          <StudentCardPreview
            nickname={nickname}
            motto={motto}
            avatarUrl={avatarUrl}
            studentNo={card.studentNo}
            joinedLabel={card.joinedLabel}
            validLabel={card.validLabel}
            levelLabel={card.levelLabel}
            hoursLabel={card.hoursLabel}
            streak={card.streak}
            isSubscriber={card.isSubscriber}
            qrSvg={card.qrSvg}
          />
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-[var(--ink4)]">
            扫码或点击「分享学生证」即可把你的主页
            <span className="font-mono"> /u/{userId.slice(0, 6)}… </span>
            分享给同学。
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ── 子组件 ─────────────────────────────────────────── */

const CARD_TONE: Record<string, string> = {
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  red: "bg-[var(--red-soft)] text-[var(--red)]",
  neutral: "bg-[var(--surface-inset)] text-[var(--ink2)]",
};

/** 分组字段卡（elev-1，与设置中心 SectionCard 语言一致，可插任意表单控件）。 */
function FieldCard({
  index,
  icon,
  title,
  desc,
  tone = "neutral",
  children,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  tone?: "info" | "red" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ "--i": index } as React.CSSProperties}
      className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${CARD_TONE[tone]}`}>{icon}</span>
        <div>
          <h2 className="text-[16px] font-bold text-[var(--ink)]">{title}</h2>
          {desc && <p className="text-[12px] text-[var(--ink3)]">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  children,
  icon,
  plain,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${plain ? "text-[var(--ink3)]" : "text-[var(--ink2)]"}`}
    >
      {icon && <span className="text-[var(--ink4)]">{icon}</span>}
      {children}
    </span>
  );
}

function CharCount({ value, max }: { value: number; max: number }) {
  const near = value >= max;
  return (
    <span className={`mono text-[11px] ${near ? "text-[var(--warn)]" : "text-[var(--ink4)]"}`}>
      {value}/{max}
    </span>
  );
}

/** 头像候选：44px 触达，选中态红环。 */
function AvatarChoice({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={`studio-press relative grid h-12 w-12 place-items-center overflow-hidden rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50 ${
        selected
          ? "ring-2 ring-[var(--red)] ring-offset-2 ring-offset-[var(--surface)]"
          : "ring-1 ring-[var(--border)] hover:ring-[var(--border2)]"
      }`}
    >
      {children}
      {selected && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--red)] text-white ring-2 ring-[var(--surface)]">
          <Check size={9} weight="bold" />
        </span>
      )}
    </button>
  );
}

/** 单选/可清空 chip（枚举取值用）。 */
function ChipToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`studio-press inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/40 ${
        active
          ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)]"
          : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink2)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}

/** 开关行（触达 ≥44px，红=开）。 */
function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--surface-inset)] text-[var(--ink3)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-[var(--ink)]">{label}</p>
          {hint && <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{hint}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
        className="relative inline-grid h-11 w-11 shrink-0 place-items-center focus-visible:outline-none"
      >
        <span
          className={`relative h-7 w-12 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--red)]/40 ${
            checked ? "bg-[var(--red)]" : "bg-[var(--surface-inset)]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-[var(--surface)] shadow-[var(--card)] transition-transform ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

export default ProfileForm;
