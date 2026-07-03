import Link from "next/link";
import { Users, PlayCircle, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Badge, CoverBg, coverSrc } from "./ui";
import { Spotlight } from "./motion";

export interface CourseCardData {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  categoryLabel: string;
  levelLabel: string;
  coverColor: string;
  updateText: string;
  duration: string;
  learnersCount: number;
  freeLessonsCount: number;
  status?: string;
  /** 本周新上线/新更新，展示 NEW 角标（A3） */
  isNew?: boolean;
}

export function CourseCard({ course }: { course: CourseCardData }) {
  return (
    <Spotlight className="h-full rounded-[var(--radius-card)]">
      <Link
        href={`/courses/${course.slug}`}
        className="studio-lift group flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)] hover:border-[var(--border2)]"
      >
        <CoverBg color={course.coverColor} imageSrc={coverSrc(course.slug)} alt={course.title} className="aspect-[16/10] w-full">
          <div className="absolute left-3.5 top-3.5">
            <span className="rounded-full bg-black/20 px-2.5 py-1 text-[0.7rem] font-medium text-white backdrop-blur-sm">{course.categoryLabel}</span>
          </div>
          {/* NEW 角标：本周上新（A3） */}
          {course.isNew && (
            <div className="absolute right-3.5 top-3.5 flex items-center gap-1 rounded-full bg-[var(--new-bg)] px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wide text-[var(--new-ink)] shadow-[0_4px_12px_-4px_rgba(35,41,53,0.35)]">
              <Sparkle size={11} weight="fill" />
              NEW
            </div>
          )}
          {course.freeLessonsCount > 0 && (
            <div className="absolute bottom-3.5 left-3.5 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[0.7rem] font-medium text-accent-700 backdrop-blur-sm">
              <PlayCircle size={13} weight="fill" />
              {course.freeLessonsCount} 节免费试学
            </div>
          )}
        </CoverBg>
        <div className="flex flex-1 flex-col p-5">
          <div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
            <span>{course.levelLabel}</span>
            <span className="h-3 w-px bg-[var(--border)]" />
            <span>{course.duration}</span>
          </div>
          <h3 className="mt-2 font-bold tracking-tight text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">{course.title}</h3>
          {course.subtitle && <p className="mt-1 line-clamp-1 text-sm text-[var(--ink2)]">{course.subtitle}</p>}
          <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-3.5 text-[0.78rem]">
            {/* 更新标记做成 Badge，比裸文本更醒目（A3） */}
            <Badge tone="success">{course.updateText}</Badge>
            <span className="mono flex items-center gap-1 text-[var(--ink3)]">
              <Users size={13} />
              {course.learnersCount.toLocaleString()}
            </span>
          </div>
        </div>
      </Link>
    </Spotlight>
  );
}
