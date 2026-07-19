"use client";

import type { CSSProperties, ReactNode } from "react";
import { getArtDirection, type ArtDirection } from "@/lib/ai/courseware-design";

/**
 * 造课模板卡面 —— 「真实课件风格的迷你样张」(v4.2 重做)。
 *
 * 换掉 v4 的线描母题(视觉空洞、像剪贴画,用户实评"什么玩意"):每个模板直接用它的
 * 代表性艺术方向(TEMPLATE_ART_CANDIDATES 首选)的**真实 design token**(底色/纸面/强调色/字族)
 * 渲染一张缩微课件首屏——所见即所得:选这个模板,生成的课件就是这套气质。
 * 8 张卡 8 套互不重复的 art(含 2 张深色卡破版面单调),签名元素对应模板教学法:
 * 台阶步骤/误区对比/对话气泡/追问选择题/终端窗口/计分冲刺/跟读声波/闯关奖励。
 *
 * 纯展示、零 IO;token 来自 courseware-design(纯数据,server/client 通用)。
 */

const TEMPLATE_ART: Record<string, string> = {
  classic: "editorial_paper",
  case_driven: "magazine_bold",
  story: "storybook",
  socratic: "dark_tech",
  workshop: "dev_terminal",
  exam_sprint: "scoreboard",
  language_immersion: "soft_structure",
  kids_bright: "journal_washi",
};

/** 纹理的 background-size(courseware 原纹理是 1px 网点/网格,迷你卡按小尺寸铺)。 */
const TEXTURE_SIZE: Record<string, string> = {
  editorial_paper: "10px 10px",
  dark_tech: "14px 14px",
  blueprint: "14px 14px",
  journal_washi: "10px 10px",
  magazine_bold: "12px 12px",
  academic_lecture: "10px 10px",
  cinematic_neon: "12px 12px",
};

function faceStyle(a: ArtDirection): CSSProperties {
  return {
    background: a.bg,
    ...(a.texture !== "none"
      ? { backgroundImage: a.texture, backgroundSize: TEXTURE_SIZE[a.key] ?? "12px 12px" }
      : {}),
    fontFamily: a.fontBody,
    color: a.ink,
  };
}

/** 眉题:课件里的 mono 小字导语,迷你卡同款。 */
function Eyebrow({ a, children }: { a: ArtDirection; children: string }) {
  return (
    <div
      style={{
        fontFamily: a.fontMono,
        fontSize: 6.5,
        letterSpacing: "0.14em",
        color: a.ink3,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/** 大标题:用该 art 的 display 字族与字重,是卡面的「气质担当」。 */
function Headline({ a, size = 15, children }: { a: ArtDirection; size?: number; children: string }) {
  return (
    <div
      style={{
        fontFamily: a.fontDisplay,
        fontWeight: a.displayWeight,
        letterSpacing: a.displayTracking,
        fontSize: size,
        lineHeight: 1.15,
        color: a.ink,
      }}
    >
      {children}
    </div>
  );
}

/** 正文骨架条(样张惯用法:标题真实、正文以条形示意密度)。 */
function Bars({ a, widths, light = false }: { a: ArtDirection; widths: number[]; light?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {widths.map((w, i) => (
        <div
          key={i}
          style={{
            height: 3,
            width: `${w}%`,
            borderRadius: 2,
            background: light ? "rgba(255,255,255,.55)" : a.ink3,
            opacity: light ? 1 : 0.38,
          }}
        />
      ))}
    </div>
  );
}

// —— 各模板签名样张 ——————————————————————————————————————————

function ClassicFace({ a }: { a: ArtDirection }) {
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
      {/* 编辑纸刊的双细线刊头 */}
      <div style={{ width: "56%", borderTop: `1.5px solid ${a.accent}`, paddingTop: 1.5 }}>
        <div style={{ width: "100%", borderTop: `1px solid ${a.accent}`, opacity: 0.55 }} />
      </div>
      <Eyebrow a={a}>Lesson 01 · 场景</Eyebrow>
      <Headline a={a}>先懂，再上手</Headline>
      <Bars a={a} widths={[88, 64]} />
      {/* 签名:三级台阶步骤轨(循序渐进) */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, flex: i < 2 ? 1 : "none" }}>
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                fontFamily: a.fontMono,
                fontSize: 6.5,
                fontWeight: 700,
                background: i === 2 ? a.accent : a.surface,
                color: i === 2 ? "#fff" : a.ink2,
                border: `1px solid ${i === 2 ? a.accent : a.border}`,
              }}
            >
              {i + 1}
            </div>
            {i < 2 && <div style={{ flex: 1, height: 1.5, background: a.border }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function CaseFace({ a }: { a: ArtDirection }) {
  const col: CSSProperties = { flex: 1, borderRadius: Math.min(a.radius, 6), padding: "5px 6px", minWidth: 0 };
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow a={a}>Case File · 复盘</Eyebrow>
      <Headline a={a} size={17}>
        这单为什么翻车
      </Headline>
      {/* 签名:误区 vs 正确 对照(案例拆解的 compare) */}
      <div style={{ marginTop: "auto", display: "flex", gap: 5 }}>
        <div style={{ ...col, background: a.surfaceAlt, border: `1px solid ${a.border}` }}>
          <div style={{ fontSize: 7, fontWeight: 700, color: a.ink3, marginBottom: 3 }}>✕ 当时的做法</div>
          <Bars a={a} widths={[92, 70]} />
        </div>
        <div style={{ ...col, background: a.surface, border: `1.5px solid ${a.accent}` }}>
          <div style={{ fontSize: 7, fontWeight: 700, color: a.accentInk, marginBottom: 3 }}>✓ 应该这样</div>
          <Bars a={a} widths={[92, 70]} />
        </div>
      </div>
    </div>
  );
}

function StoryFace({ a }: { a: ArtDirection }) {
  const bubble: CSSProperties = { maxWidth: "78%", padding: "4.5px 7px", fontSize: 7.5, lineHeight: 1.45 };
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow a={a}>EP.03 · 连载</Eyebrow>
      <Headline a={a}>深夜的电话</Headline>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 3.5 }}>
        <div
          style={{
            ...bubble,
            alignSelf: "flex-start",
            background: a.surface,
            border: `1px solid ${a.border}`,
            borderRadius: "10px 10px 10px 3px",
            color: a.ink2,
          }}
        >
          铃声响的时候，她正要关灯……
        </div>
        <div
          style={{
            ...bubble,
            alignSelf: "flex-end",
            background: a.accent,
            color: "#fff",
            borderRadius: "10px 10px 3px 10px",
          }}
        >
          「是我。听我说完。」
        </div>
      </div>
    </div>
  );
}

function SocraticFace({ a }: { a: ArtDirection }) {
  const opt: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "3.5px 6px",
    borderRadius: Math.min(a.radius, 8),
    fontSize: 7.5,
  };
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow a={a}>Socratic · 追问</Eyebrow>
      <Headline a={a}>真的是这样吗？</Headline>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 3.5 }}>
        <div style={{ ...opt, background: a.surface, border: `1px solid ${a.border}`, color: a.ink2 }}>
          <span style={{ fontFamily: a.fontMono, fontSize: 6.5, color: a.ink3 }}>A</span> 直觉的答案
        </div>
        <div style={{ ...opt, background: a.accentSoft, border: `1.5px solid ${a.accent}`, color: a.ink }}>
          <span style={{ fontFamily: a.fontMono, fontSize: 6.5, color: a.accentInk, fontWeight: 700 }}>B</span>
          再想一层的答案
          <span style={{ marginLeft: "auto", color: a.accentInk, fontWeight: 700 }}>✓</span>
        </div>
      </div>
    </div>
  );
}

function WorkshopFace({ a }: { a: ArtDirection }) {
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
      <Eyebrow a={a}>Workshop · 实操</Eyebrow>
      <Headline a={a} size={13}>
        边做边学
      </Headline>
      {/* 签名:终端窗口(titlebar 三点 + 命令行 + 产出确认) */}
      <div
        style={{
          marginTop: "auto",
          borderRadius: 7,
          overflow: "hidden",
          border: `1px solid ${a.border}`,
          background: a.surface,
        }}
      >
        <div style={{ display: "flex", gap: 3.5, padding: "4px 6px", background: a.surfaceAlt }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 5, height: 5, borderRadius: 99, background: c, opacity: 0.9 }} />
          ))}
        </div>
        <div style={{ padding: "5px 7px", fontFamily: a.fontMono, fontSize: 7, lineHeight: 1.7 }}>
          <div style={{ color: a.ink2 }}>
            <span style={{ color: a.ink3 }}>$</span> 跟着做第一步
          </div>
          <div style={{ color: a.accentInk }}>✓ 你的作品已产出</div>
        </div>
      </div>
    </div>
  );
}

function ExamFace({ a }: { a: ArtDirection }) {
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow a={a}>Day 07 · 冲刺</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span
          style={{
            fontFamily: a.fontMono,
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: "-0.03em",
            color: a.ink,
          }}
        >
          92
        </span>
        <span style={{ fontSize: 8, color: a.ink3 }}>分 · 高频考点 12</span>
      </div>
      {/* 签名:得分进度 + 连对计数 */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ height: 4.5, borderRadius: 99, background: a.surfaceAlt, overflow: "hidden" }}>
          <div style={{ width: "72%", height: "100%", borderRadius: 99, background: a.accent }} />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["连对 ×5", "限时 45s"].map((t) => (
            <span
              key={t}
              style={{
                fontFamily: a.fontMono,
                fontSize: 6.5,
                padding: "2px 5px",
                borderRadius: 99,
                background: a.accentSoft,
                color: a.accentInk,
                fontWeight: 700,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LanguageFace({ a }: { a: ArtDirection }) {
  const barH = [5, 9, 13, 8, 11, 6, 9];
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow a={a}>跟读 · Repeat</Eyebrow>
      <div
        style={{
          alignSelf: "flex-start",
          maxWidth: "88%",
          background: a.surface,
          border: `1px solid ${a.border}`,
          borderRadius: "12px 12px 12px 3px",
          padding: "5px 8px",
          boxShadow: "0 2px 8px -4px rgba(20,24,40,.18)",
        }}
      >
        <div style={{ fontSize: 8.5, fontWeight: 700, color: a.ink }}>Nice to meet you.</div>
        <div style={{ fontSize: 6.5, color: a.ink3, marginTop: 1 }}>很高兴认识你 · 重音在 meet</div>
      </div>
      {/* 签名:开口跟读的声波条 */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 2.5, height: 14 }}>
        {barH.map((h, i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: h,
              borderRadius: 2,
              background: i === 2 ? a.accent : a.ink3,
              opacity: i === 2 ? 1 : 0.4,
            }}
          />
        ))}
        <span style={{ marginLeft: 4, fontSize: 6.5, color: a.accentInk, fontWeight: 700 }}>开口即练</span>
      </div>
    </div>
  );
}

function KidsFace({ a }: { a: ArtDirection }) {
  return (
    <div style={{ padding: "9px 11px", height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      {/* 和纸胶带 */}
      <div
        style={{
          position: "absolute",
          top: -3,
          left: 14,
          width: 34,
          height: 10,
          background: a.accentSoft,
          opacity: 0.9,
          transform: "rotate(-6deg)",
          borderRadius: 2,
        }}
      />
      <Eyebrow a={a}>第 3 关 · 加油</Eyebrow>
      <Headline a={a}>小小冒险家</Headline>
      {/* 签名:大形状 + 星星奖励 + 过关章 */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        {[1, 1, 0].map((done, i) => (
          <div
            key={i}
            style={{
              width: 15,
              height: 15,
              borderRadius: i === 1 ? 5 : 99,
              background: done ? a.accentSoft : a.surface,
              border: `1.5px solid ${done ? a.accent : a.border}`,
              display: "grid",
              placeItems: "center",
              fontSize: 8,
              color: a.accentInk,
              fontWeight: 800,
            }}
          >
            {done ? "★" : ""}
          </div>
        ))}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 7.5,
            fontWeight: 800,
            color: "#fff",
            background: a.accent,
            borderRadius: 99,
            padding: "2.5px 7px",
          }}
        >
          过关！
        </span>
      </div>
    </div>
  );
}

const FACES: Record<string, (p: { a: ArtDirection }) => ReactNode> = {
  classic: ClassicFace,
  case_driven: CaseFace,
  story: StoryFace,
  socratic: SocraticFace,
  workshop: WorkshopFace,
  exam_sprint: ExamFace,
  language_immersion: LanguageFace,
  kids_bright: KidsFace,
};

export function TemplateCardArt({ templateKey }: { templateKey: string }) {
  const artKey = TEMPLATE_ART[templateKey] ?? "editorial_paper";
  const a = getArtDirection(artKey);
  const Face = FACES[templateKey] ?? ClassicFace;
  return (
    <div className="relative h-full w-full overflow-hidden" style={faceStyle(a)} aria-hidden>
      <Face a={a} />
    </div>
  );
}
