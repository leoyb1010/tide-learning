import Link from "next/link";
import { Badge, CoverBg } from "./ui";

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
}

// §6.2 课程卡：标题、封面、标签、更新状态、学习人数、试学
export function CourseCard({ course }: { course: CourseCardData }) {
  return (
    <Link
      href={`/courses/${course.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      <CoverBg color={course.coverColor} className="aspect-[16/9] w-full">
        <div className="absolute left-3 top-3 flex gap-2">
          <Badge tone="tide">{course.categoryLabel}</Badge>
        </div>
        {course.freeLessonsCount > 0 && (
          <div className="absolute bottom-3 left-3">
            <span className="rounded-md bg-white/90 px-2 py-0.5 text-xs font-medium text-tide-700">
              {course.freeLessonsCount} 节免费试学
            </span>
          </div>
        )}
      </CoverBg>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
          <span>{course.levelLabel}</span>
          <span>·</span>
          <span>{course.duration}</span>
        </div>
        <h3 className="font-semibold text-ink-950 group-hover:text-tide-700">{course.title}</h3>
        {course.subtitle && <p className="mt-1 line-clamp-1 text-sm text-ink-500">{course.subtitle}</p>}
        <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-3 text-xs text-ink-400">
          <span className="text-tide-700">{course.updateText}</span>
          <span className="tabular">{course.learnersCount.toLocaleString()} 人学</span>
        </div>
      </div>
    </Link>
  );
}
