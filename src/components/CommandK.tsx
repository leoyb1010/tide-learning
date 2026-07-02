"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass, Compass, BookOpen, Sparkle, NotePencil, User,
  CreditCard, ClockCounterClockwise, Waves, ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import { Dialog } from "./Dialog";
import { useMode } from "./ModeProvider";
import { track } from "@/lib/analytics-client";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
};

/**
 * CommandK — ⌘K / Ctrl+K 命令面板（A3）。
 * 搜课程/笔记/需求跳转 + 切换深海模式 + 常用导航。
 * 输入非空时，回车把关键词带入课程搜索。
 */
export function CommandK() {
  const router = useRouter();
  const { theme, toggleTheme } = useMode();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      close();
    },
    [router, close],
  );

  const commands = useMemo<Cmd[]>(
    () => [
      { id: "nav-home", label: "首页", hint: "发现", keywords: "home 首页 发现 discover", icon: <Compass size={17} />, run: () => go("/") },
      { id: "nav-courses", label: "课程库", hint: "学习", keywords: "courses 课程 学习 study", icon: <BookOpen size={17} />, run: () => go("/courses") },
      { id: "nav-updates", label: "本周上新", hint: "更新", keywords: "updates 上新 更新 new", icon: <ClockCounterClockwise size={17} />, run: () => go("/updates") },
      { id: "nav-demands", label: "需求广场", hint: "共创", keywords: "demands 需求 共创 vote 投票", icon: <Sparkle size={17} />, run: () => go("/demands") },
      { id: "nav-notes", label: "我的笔记", hint: "笔记", keywords: "notes 笔记 note", icon: <NotePencil size={17} />, run: () => go("/notes") },
      { id: "nav-me", label: "我的", hint: "账户", keywords: "me 我的 profile account", icon: <User size={17} />, run: () => go("/me") },
      { id: "nav-pricing", label: "订阅方案", hint: "定价", keywords: "pricing 订阅 定价 subscribe", icon: <CreditCard size={17} />, run: () => go("/pricing") },
      {
        id: "toggle-deep",
        label: theme === "deep" ? "切换到浅色模式" : "切换到深海模式",
        hint: "主题",
        keywords: "theme deep 深海 主题 dark 深色 沉浸",
        icon: <Waves size={17} />,
        run: () => {
          toggleTheme();
          track("theme_toggle", { to: theme === "deep" ? "light" : "deep", source: "command_k" });
          close();
        },
      },
    ],
    [go, theme, toggleTheme, close],
  );

  const query = q.trim();
  const filtered = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(lower) || c.keywords.toLowerCase().includes(lower));
  }, [commands, query]);

  // ⌘K / Ctrl+K 唤起；已打开时再次按下关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 回车：优先执行首个命中命令；否则把关键词带入课程搜索
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (filtered.length > 0) {
      filtered[0].run();
      return;
    }
    if (query) {
      track("note_search", { source: "command_k", q: query });
      go(`/courses?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <Dialog open={open} onClose={close}>
      <form onSubmit={onSubmit}>
        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-ink-100 bg-paper px-3.5 py-2.5">
          <MagnifyingGlass size={18} className="shrink-0 text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索课程、需求，或输入命令…"
            className="w-full bg-transparent text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none"
            aria-label="命令面板搜索"
          />
          <kbd className="num rounded bg-ink-100 px-1.5 py-0.5 text-[0.66rem] text-ink-400">⌘K</kbd>
        </div>

        <ul className="max-h-[52vh] space-y-0.5 overflow-y-auto">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={c.run}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent-50"
              >
                <span className="text-ink-400 group-hover:text-accent-600">{c.icon}</span>
                <span className="flex-1 text-sm font-medium text-ink-950">{c.label}</span>
                {c.hint && <span className="text-xs text-ink-400">{c.hint}</span>}
                <ArrowRight size={14} className="text-ink-300 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
          {filtered.length === 0 && query && (
            <li>
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent-50"
              >
                <MagnifyingGlass size={17} className="text-accent-600" />
                <span className="flex-1 text-sm text-ink-700">
                  在课程库中搜索 “<span className="font-medium text-ink-950">{query}</span>”
                </span>
                <ArrowRight size={14} className="text-ink-300" />
              </button>
            </li>
          )}
        </ul>
      </form>
    </Dialog>
  );
}
