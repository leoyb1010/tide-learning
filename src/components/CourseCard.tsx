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
        className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised transition-all duration-300 [transition-timing-function:var(--ease-out-expo)] hover:-translate-y-1 hover:border-accent-200 hover:shadow-[0_24px_48px_-24px_rgba(13,51,45,0.25)]"
      >
        <CoverBg color={course.coverColor} imageSrc={coverSrc(course.slug)} alt={course.title} className="aspect-[16/10] w-full">
          <div className="absolute left-3.5 top-3.5">
            <span className="rounded-full bg-black/20 px-2.5 py-1 text-[0.7rem] font-medium text-white backdrop-blur-sm">{course.categoryLabel}</span>
          </div>
          {/* NEW 角标：本周上新（A3） */}
          {course.isNew && (
            <div className="absolute right-3.5 top-3.5 flex items-center gap-1 rounded-full bg-accent-600 px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wide text-white shadow-[0_4px_12px_-2px_rgba(252,1,26,0.5)]">
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
          <div className="overline flex items-center gap-2 text-ink-400">
            <span>{course.levelLabel}</span>
            <span className="h-3 w-px bg-ink-200" />
            <span>{course.duration}</span>
          </div>
          <h3 className="mt-2 font-semibold tracking-tight text-ink-950 transition-colors group-hover:text-accent-700">{course.title}</h3>
          {course.subtitle && <p className="mt-1 line-clamp-1 text-sm text-ink-500">{course.subtitle}</p>}
          <div className="mt-auto flex items-center justify-between border-t border-ink-100 pt-3.5 text-[0.78rem]">
            {/* 更新标记做成 Badge，比裸文本更醒目（A3） */}
            <Badge tone="success">{course.updateText}</Badge>
            <span className="num flex items-center gap-1 text-ink-400">
              <Users size={13} />
              {course.learnersCount.toLocaleString()}
            </span>
          </div>
        </div>
      </Link>
    </Spotlight>
  );
}
