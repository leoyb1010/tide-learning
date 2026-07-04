import Link from "next/link";
import { Users, PlayCircle, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "./ui";
import { Spotlight } from "./motion";
import { trackGradientVar, resolveCoverSrc } from "@/lib/tracks";

export interface CourseCardData {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  /** 赛道 key，用于封面渐变映射（视觉，不参与权益判断） */
  category?: string;
  categoryLabel: string;
  levelLabel: string;
  coverColor: string;
  updateText: string;
  duration: string;
  /** 课时数（书架视图按此定书脊「厚度」；网格视图不用，故可选） */
  lessonsCount?: number;
  learnersCount: number;
  freeLessonsCount: number;
  status?: string;
  /** 本周新上线/新更新，展示 NEW 角标（A3） */
  isNew?: boolean;
}

export function CourseCard({ course }: { course: CourseCardData }) {
  const grad = trackGradientVar(course.category ?? "");
  // 封面决策（server 组件，无法 onError 探测）：有专属封面走 cover-<slug>.jpg，
  // 否则按赛道+id 从封面池取一张稳定真实图。渐变仅作图片加载前的兜底底色，不再暴露。
  const cover = resolveCoverSrc(course.slug, course.category ?? "", course.id);

  return (
    <Spotlight className="h-full rounded-[var(--radius-card)]">
      <Link
        href={`/courses/${course.slug}`}
        className="studio-lift group flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]"
      >
        {/* 封面：赛道渐变底 + 可选封面图 + hover 高光扫过。
            data-vt-cover 标记共享元素：点击进详情时由 ViewTransitions 临时命名，
            与详情预告封面配对做形变过渡（无 VT 能力的浏览器忽略此属性，无害）。 */}
        <div className="hover-sheen relative aspect-[16/10] w-full" style={{ background: grad }} data-vt-cover={course.slug}>
          {/* 深色区柔光顶高光，避免死平面 */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.18), transparent 60%)" }}
          />
          <img
            src={cover}
            alt={course.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
          {/* 底部压暗渐变，保证角标与免费标可读 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/30 to-transparent" />

          <div className="absolute left-3.5 top-3.5">
            <span className="rounded-full bg-black/25 px-2.5 py-1 text-[0.7rem] font-medium text-white/95 backdrop-blur-sm ring-1 ring-white/10">
              {course.categoryLabel}
            </span>
          </div>
          {/* NEW 角标：本周上新（A3） */}
          {course.isNew && (
            <div className="absolute right-3.5 top-3.5 flex items-center gap-1 rounded-full bg-[var(--new-bg)] px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wide text-[var(--new-ink)] shadow-[0_4px_12px_-4px_rgba(35,41,53,0.35)]">
              <Sparkle size={11} weight="fill" />
              NEW
            </div>
          )}
          {course.freeLessonsCount > 0 && (
            // 免费试学：文字退成中性深色，只保留 PlayCircle 一点红点睛——封面上同时最多一处彩色热点
            <div className="absolute bottom-3.5 left-3.5 flex items-center gap-1.5 rounded-full bg-white/92 px-2.5 py-1 text-[0.7rem] font-semibold text-[var(--ink)] backdrop-blur-sm">
              <PlayCircle size={13} weight="fill" className="text-[var(--red-active)]" />
              {course.freeLessonsCount} 节免费试学
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col p-5">
          <div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
            <span>{course.levelLabel}</span>
            <span className="h-3 w-px bg-[var(--border)]" />
            <span>{course.duration}</span>
          </div>
          {/* 标题显式提到 17px/leading-snug，与 14px 副标拉开层级；封面→标题→副标→指标四级节奏 */}
          <h3 className="mt-2 text-[17px] font-bold leading-snug tracking-tight text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">{course.title}</h3>
          {/* 副标始终占一行高度（无则 &nbsp; 占位），让同排卡片标题基线对齐、栅格成一条线 */}
          <p className="mt-1 line-clamp-1 text-sm text-[var(--ink2)]">{course.subtitle || " "}</p>
          <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-3.5 text-[0.78rem]">
            {/* 更新标记做成 Badge，比裸文本更醒目（A3） */}
            <Badge tone="success">{course.updateText}</Badge>
            {/* 学习人数=社会证明：数字 num 强调（semibold + ink2），图标留在 ink3，别和数字同灰同重 */}
            <span className="flex items-center gap-1 text-[var(--ink3)]">
              <Users size={13} />
              <span className="num font-semibold text-[var(--ink2)]">{course.learnersCount.toLocaleString()}</span>
            </span>
          </div>
        </div>
      </Link>
    </Spotlight>
  );
}
