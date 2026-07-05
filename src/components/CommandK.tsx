"use client";

import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass, Compass, BookOpen, Sparkle, NotePencil, User,
  CreditCard, ClockCounterClockwise, Waves, ArrowRight,
  GraduationCap, Note, ChatCircle, Storefront, Megaphone, CircleNotch,
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

// ---- 五域联搜结果类型（与 /api/search 契约一致）----
type SearchDomain = "course" | "note" | "post" | "market" | "demand";
interface SearchResult {
  type: SearchDomain;
  id: string;
  title: string;
  snippet: string;
  href: string;
  meta?: Record<string, string | number | boolean | null>;
}
interface SearchResponse {
  results: SearchResult[];
  counts: Record<SearchDomain, number>;
}

// 域展示配置：分组标题、图标、组内排序权重。
const DOMAIN_META: Record<SearchDomain, { label: string; icon: React.ReactNode; order: number }> = {
  course: { label: "课程", icon: <GraduationCap size={16} />, order: 0 },
  note: { label: "笔记", icon: <Note size={16} />, order: 1 },
  post: { label: "帖子", icon: <ChatCircle size={16} />, order: 2 },
  market: { label: "集市", icon: <Storefront size={16} />, order: 3 },
  demand: { label: "需求", icon: <Megaphone size={16} />, order: 4 },
};
const DOMAIN_ORDER: SearchDomain[] = ["course", "note", "post", "market", "demand"];

// 最近访问（localStorage）配置。
const RECENT_KEY = "tide.cmdk.recent";
const RECENT_MAX = 5;
type RecentItem = { title: string; href: string; type: SearchDomain };

const DEBOUNCE_MS = 250;

/**
 * CommandK — ⌘K / Ctrl+K 命令面板（流2 · U2 搜索与发现）。
 *
 * 顶部保留 8 条导航命令作「快捷动作」；输入非空时 debounce(250ms) 打 /api/search 做五域联搜
 * （课程/笔记/帖子/集市/需求），结果按域分组展示。↑/↓ 在「快捷动作 + 所有搜索结果」统一扁平序里
 * 移动高亮，回车跳转当前高亮项（快捷动作则执行其命令、结果则 push href）。
 * 空 q 时只显示快捷动作 + 最近访问（localStorage）。搜索有 加载/空/错 三态。
 */
export function CommandK() {
  const router = useRouter();
  const { theme, toggleTheme } = useMode();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0); // ↑/↓ 键盘导航高亮项索引（在扁平可选序里）

  // 搜索状态
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // 竞态：仅采纳「最后一次发起」的请求结果（丢弃过期响应）。
  const reqSeq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHighlight(0);
    setResults([]);
    setStatus("idle");
  }, []);

  // 记一条最近访问（去重 + 头插 + 限量），写 localStorage。
  const pushRecent = useCallback((item: RecentItem) => {
    try {
      const next = [item, ...recent.filter((r) => r.href !== item.href)].slice(0, RECENT_MAX);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // localStorage 不可用（隐私模式/配额）时静默降级，不影响跳转。
    }
  }, [recent]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      close();
    },
    [router, close],
  );

  // 跳转到搜索结果：记最近访问 + push。
  const goResult = useCallback(
    (r: SearchResult) => {
      pushRecent({ title: r.title, href: r.href, type: r.type });
      go(r.href);
    },
    [pushRecent, go],
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

  // 快捷动作：空 q 显示全部；有 q 时按 label/keywords 本地过滤（即时，无需等网络）。
  const actions = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(lower) || c.keywords.toLowerCase().includes(lower));
  }, [commands, query]);

  // 结果按域分组（保持 DOMAIN_ORDER 顺序），空组不展示。
  const groups = useMemo(() => {
    return DOMAIN_ORDER.map((domain) => ({
      domain,
      items: results.filter((r) => r.type === domain),
    })).filter((g) => g.items.length > 0);
  }, [results]);

  // 扁平可选序（键盘导航的线性索引空间）：先快捷动作，再各域搜索结果（按分组顺序）。
  type FlatItem =
    | { kind: "action"; cmd: Cmd }
    | { kind: "result"; result: SearchResult };
  const flat = useMemo<FlatItem[]>(() => {
    const list: FlatItem[] = actions.map((cmd) => ({ kind: "action" as const, cmd }));
    for (const g of groups) for (const result of g.items) list.push({ kind: "result", result });
    return list;
  }, [actions, groups]);

  // debounce 触发五域联搜。q 变化 250ms 无更新才打网络；空 q 立即清空并回 idle。
  useEffect(() => {
    if (!open) return;
    if (!query) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const seq = ++reqSeq.current;
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          headers: { Accept: "application/json" },
        });
        const json = (await res.json()) as { ok: boolean; data?: SearchResponse; error?: string };
        if (seq !== reqSeq.current) return; // 过期响应，丢弃
        if (!res.ok || !json.ok || !json.data) {
          setStatus("error");
          setResults([]);
          return;
        }
        setResults(json.data.results);
        setStatus("done");
      } catch {
        if (seq !== reqSeq.current) return;
        setStatus("error");
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  // 加载最近访问（仅面板打开时读一次 localStorage）。
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, RECENT_MAX));
      }
    } catch {
      // 解析失败忽略
    }
  }, [open]);

  // 查询变化 / 结果变化 → 高亮回到首项（命令面板惯例）。
  useEffect(() => {
    setHighlight(0);
  }, [query, results]);

  useEffect(() => {
    if (open) setHighlight(0);
  }, [open]);

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

  const clampedHighlight = flat.length > 0 ? Math.min(highlight, flat.length - 1) : 0;

  // 执行当前扁平高亮项。
  const runFlat = useCallback(
    (idx: number) => {
      const item = flat[idx];
      if (!item) return;
      if (item.kind === "action") item.cmd.run();
      else goResult(item.result);
    },
    [flat, goResult],
  );

  // 回车：执行当前高亮项；无任何项且有 q 时兜底把关键词带入课程库搜索。
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (flat.length > 0) {
      runFlat(clampedHighlight);
      return;
    }
    if (query) {
      track("search", { source: "command_k", fallback: "courses", q_len: query.length });
      go(`/courses?q=${encodeURIComponent(query)}`);
    }
  };

  // ↑/↓ 在扁平可选序内移动高亮（循环），Home/End 跳首尾。
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(flat.length - 1);
    }
  };

  // 高亮项滚动进可视区（键盘导航体验）。
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-flat-idx="${clampedHighlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedHighlight, open]);

  const listboxId = "command-k-listbox";
  const activeId = flat.length > 0 ? `command-k-opt-${clampedHighlight}` : undefined;

  // 是否展示「最近访问」区块（空 q + 有记录）。
  const showRecent = !query && recent.length > 0;

  return (
    <Dialog open={open} onClose={close} ariaLabel="命令面板">
      <form onSubmit={onSubmit}>
        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-ink-100 bg-paper px-3.5 py-2.5">
          <MagnifyingGlass size={18} className="shrink-0 text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="搜索课程、笔记、帖子、集市、需求，或输入命令…"
            className="w-full bg-transparent text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none"
            aria-label="命令面板搜索"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={activeId}
          />
          {status === "loading" && <CircleNotch size={16} className="shrink-0 animate-spin text-accent-600" />}
          <kbd className="num rounded bg-ink-100 px-1.5 py-0.5 text-[0.66rem] text-ink-400">⌘K</kbd>
        </div>

        <ul id={listboxId} ref={listRef} role="listbox" aria-label="搜索与命令" className="max-h-[56vh] space-y-0.5 overflow-y-auto">
          {/* —— 快捷动作（导航命令）—— */}
          {actions.length > 0 && (
            <li role="presentation" className="px-3 pb-1 pt-2 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-400">
              快捷动作
            </li>
          )}
          {actions.map((c, i) => {
            const active = i === clampedHighlight;
            return (
              <li key={c.id} role="option" aria-selected={active} id={`command-k-opt-${i}`} data-flat-idx={i}>
                <button
                  type="button"
                  onClick={c.run}
                  onMouseMove={() => setHighlight(i)}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? "bg-accent-50" : "hover:bg-accent-50"}`}
                >
                  <span className={`transition-colors ${active ? "text-accent-600" : "text-ink-400 group-hover:text-accent-600"}`}>{c.icon}</span>
                  <span className="flex-1 text-sm font-medium text-ink-950">{c.label}</span>
                  {c.hint && <span className="text-xs text-ink-400">{c.hint}</span>}
                  <ArrowRight size={14} className={`text-ink-300 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
                </button>
              </li>
            );
          })}

          {/* —— 搜索结果分组 —— */}
          {groups.map((g) => {
            const dm = DOMAIN_META[g.domain];
            return (
              <Fragment key={g.domain}>
                <li role="presentation" className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-400">
                  <span className="text-ink-400">{dm.icon}</span>
                  {dm.label}
                </li>
                {g.items.map((r) => {
                  // 计算该结果在扁平序里的绝对索引（快捷动作数 + 该结果之前的结果数）。
                  const flatIdx = flat.findIndex((f) => f.kind === "result" && f.result.type === r.type && f.result.id === r.id);
                  const active = flatIdx === clampedHighlight;
                  return (
                    <li key={`${r.type}-${r.id}`} role="option" aria-selected={active} id={`command-k-opt-${flatIdx}`} data-flat-idx={flatIdx}>
                      <button
                        type="button"
                        onClick={() => goResult(r)}
                        onMouseMove={() => setHighlight(flatIdx)}
                        className={`group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? "bg-accent-50" : "hover:bg-accent-50"}`}
                      >
                        <span className={`mt-0.5 transition-colors ${active ? "text-accent-600" : "text-ink-400 group-hover:text-accent-600"}`}>{dm.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-950">{r.title}</span>
                          {r.snippet && <span className="mt-0.5 block truncate text-xs text-ink-400">{r.snippet}</span>}
                        </span>
                        <ArrowRight size={14} className={`mt-0.5 shrink-0 text-ink-300 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
                      </button>
                    </li>
                  );
                })}
              </Fragment>
            );
          })}

          {/* —— 最近访问（空 q）—— */}
          {showRecent && (
            <>
              <li role="presentation" className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-400">
                <ClockCounterClockwise size={14} />
                最近访问
              </li>
              {recent.map((r) => (
                <li key={r.href} role="presentation">
                  <button
                    type="button"
                    onClick={() => go(r.href)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent-50"
                  >
                    <span className="text-ink-400 group-hover:text-accent-600">{DOMAIN_META[r.type]?.icon ?? <MagnifyingGlass size={16} />}</span>
                    <span className="flex-1 truncate text-sm text-ink-700">{r.title}</span>
                    <ArrowRight size={14} className="text-ink-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </>
          )}

          {/* —— 搜索三态：加载 / 空 / 错 —— */}
          {query && status === "loading" && groups.length === 0 && (
            <li role="presentation" className="flex items-center gap-2 px-3 py-4 text-sm text-ink-400">
              <CircleNotch size={16} className="animate-spin" />
              搜索中…
            </li>
          )}
          {query && status === "done" && groups.length === 0 && (
            <li role="presentation" className="px-3 py-4 text-sm text-ink-400">
              没有找到「<span className="font-medium text-ink-700">{query}</span>」相关的课程/笔记/帖子/集市/需求
            </li>
          )}
          {query && status === "error" && (
            <li role="presentation" className="px-3 py-4 text-sm text-ink-500">
              搜索出错了，请稍后重试
            </li>
          )}

          {/* 兜底：有 q、无任何快捷动作命中、也无结果 → 提供「课程库搜索」直达（保留原行为）。 */}
          {query && actions.length === 0 && groups.length === 0 && status !== "loading" && (
            <li role="presentation">
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
