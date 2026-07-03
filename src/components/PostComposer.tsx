"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, CheckCircle, Question, PaperPlaneRight, X, ImageSquare, Hash } from "@phosphor-icons/react";
import { useToast } from "./Toast";

// 三类帖子的元数据（图标 + 文案 + 占位）
const TYPES = [
  { key: "insight", label: "学习心得", icon: Lightbulb, placeholder: "今天学到了什么？分享一点你的领悟…" },
  { key: "checkin", label: "打卡", icon: CheckCircle, placeholder: "记录今天的学习：学了多久、完成了哪节课…" },
  { key: "question", label: "求助", icon: Question, placeholder: "遇到什么卡点？描述清楚更容易得到回应…" },
] as const;

type PostType = (typeof TYPES)[number]["key"];

const MAX_IMAGES = 4;
const MAX_TAGS = 5;
// 单张 mock 图（dataURL）体积上限——与后端 parseImages 的 512KB 约束对齐，超限前端先拦。
const MAX_IMAGE_BYTES = 512 * 1024;

/**
 * PostComposer —— 自习室广场发帖组件（仅登录+订阅用户可见入口）。
 * 选类型 + 写正文 + 加图片(mock 上传，file→dataURL，1-4 张) + 话题标签(#xx，最多 5 个) + 发布。
 * 发布前服务端 LLM 审核，实时反馈 审核中/被拒/已发布。STUDIO token 设计。
 */
export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PostType>("insight");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]); // dataURL mock
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 审核结果提示：approved / pending / rejected
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  function reset() {
    setContent("");
    setImages([]);
    setTags([]);
    setTagInput("");
    setResult(null);
  }

  // ---------- 图片：file input → dataURL（mock 上传，前端先做数量/体积约束）----------
  function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      toast(`最多 ${MAX_IMAGES} 张图片`, { tone: "warn" });
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    for (const file of chosen) {
      if (!file.type.startsWith("image/")) {
        toast("只能上传图片文件", { tone: "warn" });
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        if (!url) return;
        if (url.length > MAX_IMAGE_BYTES) {
          toast("单张图片过大，请换更小的图", { tone: "warn" });
          return;
        }
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, url]));
      };
      reader.readAsDataURL(file);
    }
    // 清空 input，允许重复选同一文件
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ---------- 话题标签：输入 + 回车/空格/# 提交，去重、去 #、限长 ----------
  function commitTag(raw: string) {
    const tag = raw.replace(/^#+/, "").trim().slice(0, 20);
    if (!tag) return;
    setTags((prev) => {
      if (prev.length >= MAX_TAGS) {
        toast(`最多 ${MAX_TAGS} 个话题`, { tone: "warn" });
        return prev;
      }
      if (prev.some((t) => t.toLowerCase() === tag.toLowerCase())) return prev;
      return [...prev, tag];
    });
    setTagInput("");
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === " " || e.key === "#") {
      e.preventDefault();
      commitTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  async function submit() {
    const text = content.trim();
    if (text.length < 4) {
      toast("内容太短了，多写几句吧", { tone: "warn" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, content: text, images, topicTags: tags }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      const { status, message } = json.data;
      if (status === "approved") {
        toast("已发布到广场", { tone: "success" });
        reset();
        setOpen(false);
        onPosted?.();
        router.refresh();
      } else {
        // pending / rejected：留在弹层内提示，不刷新
        setResult({ status, message });
        if (status === "rejected") setContent("");
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="studio-press inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-all hover:brightness-105"
      >
        ＋ 发帖
      </button>
    );
  }

  const canSubmit = !loading && content.trim().length >= 4;

  return (
    <div className="studio-rise rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
      <div className="flex items-center justify-between">
        <div className="mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink3)]">发一条到广场</div>
        <button
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="studio-press inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink3)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
          aria-label="关闭"
        >
          <X size={15} />
        </button>
      </div>

      {/* 类型选择 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {TYPES.map((t) => {
          const Icon = t.icon;
          const active = type === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                active
                  ? "bg-[var(--red-soft)] text-[var(--red)] border border-[var(--red-soft-border)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              <Icon size={14} weight={active ? "fill" : "regular"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 内容输入 */}
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (result) setResult(null);
        }}
        maxLength={800}
        rows={4}
        placeholder={TYPES.find((t) => t.key === type)?.placeholder}
        className="mt-3 w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 text-[14px] leading-[1.65] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />

      {/* 图片预览网格 */}
      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {images.map((src, i) => (
            <div
              key={i}
              className="group relative aspect-square overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => removeImage(i)}
                aria-label="移除图片"
                className="studio-press absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)]/70 text-white transition-opacity hover:bg-[var(--ink)]"
              >
                <X size={11} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 话题标签行 */}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="mono inline-flex items-center gap-1 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--red)]"
            >
              #{t}
              <button onClick={() => removeTag(t)} aria-label={`移除话题 ${t}`} className="studio-press">
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 工具条：加图 / 话题输入 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickImages(e.target.files)} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={images.length >= MAX_IMAGES}
          className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)] disabled:opacity-40"
        >
          <ImageSquare size={15} />
          图片 <span className="mono text-[var(--ink4)]">{images.length}/{MAX_IMAGES}</span>
        </button>
        <div className="inline-flex flex-1 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] focus-within:border-[var(--ink3)]">
          <Hash size={14} className="shrink-0 text-[var(--ink4)]" />
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={() => tagInput && commitTag(tagInput)}
            maxLength={20}
            disabled={tags.length >= MAX_TAGS}
            placeholder={tags.length >= MAX_TAGS ? `最多 ${MAX_TAGS} 个话题` : "加话题，回车确认"}
            className="w-full min-w-0 bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--ink4)] disabled:opacity-50"
          />
        </div>
      </div>

      {/* 审核结果提示 */}
      {result && (
        <div
          className={`mt-2 rounded-[10px] px-3 py-2 text-[12.5px] ${
            result.status === "pending"
              ? "border border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink2)]"
              : "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
          }`}
        >
          {result.status === "pending" ? "⏳ " : "⚠️ "}
          {result.message}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="mono text-[11px] text-[var(--ink4)]">
          {content.length}/800 · 发布前会经过内容审核，禁止外链与广告
        </span>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="studio-press inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
        >
          <PaperPlaneRight size={14} weight="fill" />
          {loading ? "审核中…" : "发布"}
        </button>
      </div>
    </div>
  );
}
