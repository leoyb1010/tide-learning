"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, Sparkle, Check } from "@phosphor-icons/react";
import { TemplateCardArt } from "@/components/TemplateCardArt";

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
 * 造课「创作方向 + 生成模型」选择器（造课 Tab 与导入 Tab 共用）。
 * 数据来自 GET /api/ai/models（按订阅态过滤模型；模板全员可选）。
 * 受控：template/model 由父组件持有并透传进生成请求体。
 * 模型只有 1 个可选且无锁定项时，模型区自动隐藏（避免单选下拉的无谓 UI）。
 */
export function TemplateModelPicker({
  template,
  setTemplate,
  model,
  setModel,
  qualityTier,
  setQualityTier,
  onAvailability,
}: {
  template: string;
  setTemplate: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  qualityTier: "standard" | "premium";
  setQualityTier: (v: "standard" | "premium") => void;
  /** P1-1：AI 是否可用（服务端配了可用模型）。null=未探明；据此上层可禁用生成 CTA、避免填完表单才失败。 */
  onAvailability?: (available: boolean) => void;
}) {
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [lockedModels, setLockedModels] = useState<LockedModelOpt[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [isSubscriber, setIsSubscriber] = useState(false);

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
        setIsSubscriber(Boolean(j.data.isSubscriber));
        if (!j.data.isSubscriber && qualityTier === "premium") setQualityTier("standard");
        if (!model && j.data.defaultModel) setModel(j.data.defaultModel);
        // P1-1：defaultModel 为 null = 服务端无可用模型（未配 key）。明确上报「不可用」，让上层禁用生成。
        // 仅在响应 ok 时判定，网络异常（下方 catch）不误判为不可用。
        onAvailability?.(Boolean(j.data.defaultModel));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [model, onAvailability, qualityTier, setModel, setQualityTier]);

  const showModelPicker = models.length > 1 || lockedModels.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* —— 创作方向：自由导演为默认，旧模板只作为显式偏好 —— */}
      <div className="flex flex-col gap-2">
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
          创作方向
        </span>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setTemplate("")}
            aria-pressed={!template}
            className={`studio-press group relative flex flex-col items-stretch gap-2 overflow-hidden rounded-[14px] border p-2.5 text-left transition-[border-color,box-shadow,transform] duration-200 ${
              !template
                ? "border-[var(--red)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--red),0_10px_28px_-16px_var(--red)]"
                : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)] hover:bg-[var(--surface)] hover:-translate-y-0.5"
            }`}
          >
            {!template && (
              <span className="absolute right-2 top-2 grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--red)] text-white">
                <Check size={11} weight="bold" />
              </span>
            )}
            <span aria-hidden className="grid aspect-[16/9] w-full place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
              <Sparkle size={30} weight="duotone" className="text-[var(--red)]" />
            </span>
            <span className="flex flex-col gap-0.5 px-1 pb-0.5">
              <span className={`text-[13px] font-semibold leading-tight ${!template ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>自由导演</span>
              <span className="text-[11px] leading-snug text-[var(--ink4)]">按内容决定讲法与视觉</span>
            </span>
          </button>
          {templates.map((t) => {
            const active = template === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTemplate(t.key)}
                title={t.recommendedFor}
                aria-pressed={active}
                className={`studio-press group relative flex flex-col items-stretch gap-2 overflow-hidden rounded-[14px] border p-2.5 text-left transition-[border-color,box-shadow,transform] duration-200 ${
                  active
                    ? "border-[var(--red)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--red),0_10px_28px_-16px_var(--red)]"
                    : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)] hover:bg-[var(--surface)] hover:-translate-y-0.5"
                }`}
              >
                {active && (
                  <span className="absolute right-2 top-2 z-10 grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_2px_8px_-2px_var(--red)]">
                    <Check size={11} weight="bold" />
                  </span>
                )}
                {/* 卡面 = 该模板代表 art 的迷你课件样张(v4.2:真实 design token,所见即所得) */}
                <span
                  aria-hidden
                  className={`block aspect-[16/9] w-full overflow-hidden rounded-[10px] border transition-[border-color,opacity] duration-200 ${
                    active ? "border-[var(--red)]/40" : "border-[var(--border)] opacity-[0.96] group-hover:opacity-100"
                  }`}
                >
                  <TemplateCardArt templateKey={t.key} />
                </span>
                <span className="flex flex-col gap-0.5 px-1 pb-0.5">
                  <span className={`text-[13px] font-semibold leading-tight ${active ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
                    {t.label}
                  </span>
                  <span className="text-[11px] leading-snug text-[var(--ink4)]">{t.tagline}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* —— 内容深度档 —— */}
      <div className="flex flex-col gap-2">
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
          内容深度
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setQualityTier("standard")}
            aria-pressed={qualityTier === "standard"}
            className={`studio-press rounded-[12px] border p-3 text-left transition-colors ${qualityTier === "standard" ? "border-[var(--red)] bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface2)]"}`}
          >
            <span className="block text-[13px] font-semibold text-[var(--ink)]">完整生成</span>
            <span className="mt-1 block text-[11px] leading-snug text-[var(--ink4)]">讲清核心内容、检验与迁移</span>
          </button>
          {isSubscriber ? (
            <button
              type="button"
              onClick={() => setQualityTier("premium")}
              aria-pressed={qualityTier === "premium"}
              className={`studio-press rounded-[12px] border p-3 text-left transition-colors ${qualityTier === "premium" ? "border-[var(--red)] bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface2)]"}`}
            >
              <span className="flex items-center gap-1 text-[13px] font-semibold text-[var(--ink)]"><Sparkle size={13} weight="fill" className="text-[var(--red)]" />深度研究</span>
              <span className="mt-1 block text-[11px] leading-snug text-[var(--ink4)]">扩大范围，补足边界与复杂案例</span>
            </button>
          ) : (
            <Link href="/pricing" className="studio-press rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface)] p-3 text-left">
              <span className="flex items-center gap-1 text-[13px] font-semibold text-[var(--ink3)]"><Lock size={13} weight="fill" />深度研究</span>
              <span className="mt-1 block text-[11px] leading-snug text-[var(--ink4)]">会员可扩大范围与案例深度</span>
            </Link>
          )}
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
                  className={`studio-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
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
                className="studio-press inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--border2)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink4)] transition-colors hover:border-[var(--red)] hover:text-[var(--red)]"
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
