"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GraduationCap, MagnifyingGlass, BookOpen, Question, Wrench, Target,
  Lock, Sparkle, Check, type Icon,
} from "@phosphor-icons/react";

/** 模板 icon 名 → phosphor 组件（templates.ts 的 icon 字段用这些名）。未知回落 Sparkle。 */
const ICON_MAP: Record<string, Icon> = {
  GraduationCap, MagnifyingGlass, BookOpen, Question, Wrench, Target,
};

interface TemplateOpt {
  key: string;
  label: string;
  tagline: string;
  icon: string;
  recommendedFor: string;
}
interface ModelOpt {
  key: string;
  label: string;
  desc: string;
  tier: "free" | "premium";
  costWeight: number;
}
interface LockedModelOpt {
  key: string;
  label: string;
  desc: string;
}

/**
 * 造课「课件模板 + 生成模型」选择器（造课 Tab 与导入 Tab 共用）。
 * 数据来自 GET /api/ai/models（按订阅态过滤模型；模板全员可选）。
 * 受控：template/model 由父组件持有并透传进生成请求体。
 * 模型只有 1 个可选且无锁定项时，模型区自动隐藏（避免单选下拉的无谓 UI）。
 */
export function TemplateModelPicker({
  template,
  setTemplate,
  model,
  setModel,
}: {
  template: string;
  setTemplate: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [lockedModels, setLockedModels] = useState<LockedModelOpt[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  // 模板缩略图（public/templates/template-<key>.jpg）加载失败的卡回落成图标渲染。
  const [thumbFail, setThumbFail] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        setTemplates(j.data.templates ?? []);
        setModels(j.data.models ?? []);
        setLockedModels(j.data.lockedModels ?? []);
        setDefaultModel(j.data.defaultModel ?? null);
        if (!model && j.data.defaultModel) setModel(j.data.defaultModel);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const showModelPicker = models.length > 1 || lockedModels.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* —— 课件模板 —— */}
      <div className="flex flex-col gap-2">
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
          课件模板
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {templates.map((t) => {
            const active = (template || "classic") === t.key;
            const TIcon = ICON_MAP[t.icon] ?? Sparkle;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTemplate(t.key)}
                title={t.recommendedFor}
                aria-pressed={active}
                className={`studio-press group relative flex flex-col items-start gap-1 rounded-[12px] border p-3 text-left transition-colors duration-150 ${
                  active
                    ? "border-[var(--red)] bg-[var(--red-soft)]"
                    : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                }`}
              >
                {active && (
                  <span className="absolute right-2 top-2 z-10 grid h-4 w-4 place-items-center rounded-full bg-[var(--red)] text-white">
                    <Check size={10} weight="bold" />
                  </span>
                )}
                {/* 缩略图（生图资产）优先；加载失败回落图标 */}
                {!thumbFail[t.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/templates/template-${t.key}.jpg`}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={() => setThumbFail((m) => ({ ...m, [t.key]: true }))}
                    className={`h-16 w-full rounded-[8px] object-cover transition-opacity ${active ? "" : "opacity-90 group-hover:opacity-100"}`}
                  />
                ) : (
                  <TIcon
                    size={18}
                    weight={active ? "fill" : "regular"}
                    className={active ? "text-[var(--red)]" : "text-[var(--ink3)]"}
                  />
                )}
                <span className={`text-[13px] font-semibold ${active ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
                  {t.label}
                </span>
                <span className="text-[11px] leading-snug text-[var(--ink4)]">{t.tagline}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* —— 生成模型（≥2 可选 或 有会员专享锁定项时才显示）—— */}
      {showModelPicker && (
        <div className="flex flex-col gap-2">
          <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
            生成模型
          </span>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => {
              const active = (model || defaultModel || models[0]?.key) === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setModel(m.key)}
                  title={m.desc}
                  aria-pressed={active}
                  className={`studio-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ${
                    active
                      ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
                      : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {m.tier === "premium" && <Sparkle size={12} weight="fill" />}
                  {m.label}
                  {m.costWeight > 1 && <span className="mono text-[10px] opacity-70">{m.costWeight}×</span>}
                </button>
              );
            })}
            {lockedModels.map((m) => (
              <Link
                key={m.key}
                href="/pricing"
                title={`${m.desc}（会员专享，点击去订阅）`}
                className="studio-press inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--border2)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink4)] transition-colors hover:border-[var(--red)] hover:text-[var(--red)]"
              >
                <Lock size={12} weight="fill" />
                {m.label}
                <span className="text-[10px]">会员</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
