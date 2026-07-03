"use client";

import { useState, useRef, useEffect } from "react";
import { PaperPlaneRight, Sparkle } from "@phosphor-icons/react";
import { renderMarkdown } from "@/lib/markdown";

/**
 * AI 学习伴侣面板（中枢）——学习页侧栏内嵌。
 * scope 绑定当前 lesson，伴侣基于当前课内容 + 用户本课笔记答疑。
 * 调 /api/ai/companion；未订阅(402)/未配置优雅提示。
 */
interface Msg { role: "user" | "assistant"; content: string }

export function CompanionPanel({ lessonId, courseId }: { lessonId: string; courseId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setErr(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/companion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, scope: `lesson:${lessonId}`, lessonId, courseId, message: text }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json?.error ?? "伴侣暂时无法回应，请稍后再试");
        return;
      }
      setThreadId(json.data.threadId);
      setMessages((m) => [...m, { role: "assistant", content: json.data.reply }]);
    } catch {
      setErr("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--red-soft)] text-[var(--red)]">
              <Sparkle size={20} weight="fill" />
            </span>
            <p className="text-sm font-medium text-[var(--ink)]">AI 学习伴侣</p>
            <p className="max-w-[220px] text-xs leading-relaxed text-[var(--ink3)]">
              基于你正在学的这节课和你的笔记答疑。这句没懂？想要例子？直接问我。
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="self-end rounded-2xl rounded-br-md bg-[var(--ink)] px-3.5 py-2 text-[13px] text-[var(--surface)] max-w-[85%]">
                {m.content}
              </div>
            ) : (
              <div
                key={i}
                className="tide-md self-start rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--ink)] max-w-[90%]"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
            )
          )}
          {loading && (
            <div className="self-start rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5">
              <span className="saving-dots inline-flex gap-1 text-[var(--ink3)]"><i /><i /><i /></span>
            </div>
          )}
        </div>
      </div>

      {err && <p className="px-4 pb-1 text-xs text-[var(--red)]">{err}</p>}

      {/* 输入区 */}
      <div className="border-t border-[var(--border)] bg-[var(--surface2)] p-3">
        <div className="flex items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-1 pl-3.5 pr-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
            placeholder="问伴侣任何关于本课的问题…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink4)]"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[var(--ink)] text-[var(--surface)] transition-opacity disabled:opacity-40"
            aria-label="发送"
          >
            <PaperPlaneRight size={15} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
}
