import { Badge } from "./ui";
import { UPDATE_TYPE_LABELS } from "@/lib/format";

interface UpdateLogItem {
  id: string;
  updateType: string;
  title: string;
  description: string | null;
  relativeTime: string;
}

// §6.3 更新日志：更新时间/类型/影响章节/说明/责任人 — 强化"持续更新"
export function UpdateLog({ logs, ownerName }: { logs: UpdateLogItem[]; ownerName?: string | null }) {
  if (logs.length === 0) {
    return <p className="text-sm text-ink-400">暂无更新记录</p>;
  }
  const toneOf: Record<string, string> = { added: "success", revised: "tide", fixed: "warning", removed: "muted" };
  return (
    <ol className="relative space-y-5 border-l border-ink-100 pl-5">
      {logs.map((log) => (
        <li key={log.id} className="relative">
          <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent-400 ring-4 ring-paper" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneOf[log.updateType] ?? "muted"}>{UPDATE_TYPE_LABELS[log.updateType] ?? log.updateType}</Badge>
            <span className="font-medium text-ink-950">{log.title}</span>
            <span className="text-xs text-ink-400">{log.relativeTime}</span>
          </div>
          {log.description && <p className="mt-1 text-sm text-ink-500">{log.description}</p>}
          {ownerName && <p className="mt-1 text-xs text-ink-400">内容责任人：{ownerName}</p>}
        </li>
      ))}
    </ol>
  );
}
