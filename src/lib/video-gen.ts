import { prisma } from "./db";
import { track } from "./analytics";
import { validateBlocks, type Block } from "./blocks";

/**
 * 视频课件生成内核（v3.1）—— 把一节块课件（blocks）转成「带旁白 + 字幕」的视频课件。
 *
 * 分层（对齐 course-gen.ts 的 generateLessonCore 风格）：
 *  - 纯函数层：buildVideoScript(blocks) 把块协议组织成 scene 脚本（旁白/字幕/时长），
 *    无 IO、无副作用、永不抛错，是「课件 → 视频脚本」的可测试转换。
 *  - Provider 层：VideoProvider 接口 + 可插拔实现。mock 现成可跑；真实文生视频/数字人讲课
 *    provider 按同一签名接入即可（见文件末 TODO）。
 *  - 编排层：generateLessonVideo(lessonId, userId) 做越权校验 / 原子 claim 幂等 / 落脚本 /
 *    调 provider / 写 videoAssetId + videoGenStatus 收尾。只关心「生成逻辑」，不做请求级闸门
 *    （requireUser / 权益 / 积分 / 限流 / 同源）——那些由 route 把守。
 *
 * 视频生成走 VIDEO_MODE=mock 开关（默认 mock）：mock 返回占位资源（videoAssetId 指向占位
 * 讲解页，Player 走模拟播放器渲染品牌画面 + 字幕），不真调任何生视频模型。
 */

// ————————————————————————————————————————————————————————————
//  开关：VIDEO_MODE=mock（默认）/ real
// ————————————————————————————————————————————————————————————

export type VideoMode = "mock" | "real";

/** 读取视频生成模式。默认 mock（未配置真实 provider 时优雅降级，不阻断流程）。 */
export function videoMode(): VideoMode {
  return process.env.VIDEO_MODE === "real" ? "real" : "mock";
}

// ————————————————————————————————————————————————————————————
//  视频脚本协议（blocks → scenes）
// ————————————————————————————————————————————————————————————

/**
 * 单个场景：一屏讲解。
 *  - narration：旁白文本（真实 provider 用 TTS 合成语音 / 数字人口播）。
 *  - caption：字幕（屏幕短句，通常是 narration 的精炼版）。
 *  - kind：来源块型（scene/concept/quiz…），供真实 provider 决定镜头/版式模板。
 *  - durationSec：本场景预估时长（按旁白字数估算，真实 provider 可覆盖）。
 */
export interface VideoScene {
  kind: string;
  caption: string;
  narration: string;
  durationSec: number;
}

export interface VideoScript {
  version: 1;
  /** 全片预估总时长（各 scene 之和） */
  totalDurationSec: number;
  scenes: VideoScene[];
}

// —— 脚本约束（避免异常 payload） ——
const MAX_SCENES = 40;
const MAX_NARRATION = 600;
const MAX_CAPTION = 120;
// 旁白时长估算：中文口播约每分钟 240 字 → 每字 0.25s；最短 3s，最长 30s。
const SEC_PER_CHAR = 0.25;
const MIN_SCENE_SEC = 3;
const MAX_SCENE_SEC = 30;

function clamp(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** 按旁白字数估算场景时长（真实 provider 可用 TTS 实际时长覆盖）。 */
function estimateSceneSec(narration: string): number {
  const sec = Math.round(narration.length * SEC_PER_CHAR);
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, sec));
}

/** 把一个块转成一个场景（返回 null = 该块不入镜，如纯装饰）。永不抛错。 */
function blockToScene(b: Block, index: number): VideoScene | null {
  switch (b.type) {
    case "scene":
      return scene("scene", b.title || "开场", `${b.title ? b.title + "。" : ""}${b.markdown}`);
    case "objectives":
      return scene("objectives", "本节目标", `这一节，我们要达成这些目标：${b.items.join("；")}。`);
    case "concept":
      return scene("concept", b.title || "核心概念", `${b.title ? b.title + "。" : ""}${b.markdown}`);
    case "keypoint":
      return scene("keypoint", "重点回顾", `记住这几个要点：${b.points.join("；")}。`);
    case "example":
      return scene("example", "举个例子", `我们来看一个例子：${b.markdown}`);
    case "compare":
      return scene(
        "compare",
        b.title || "对比辨析",
        `${b.title ? b.title + "。" : ""}${b.left.heading}：${b.left.items.join("、")}。` +
          `${b.right.heading}：${b.right.items.join("、")}。`,
      );
    case "steps":
      return scene(
        "steps",
        "操作步骤",
        `跟着做：${b.steps.map((s, i) => `第 ${i + 1} 步，${s.title}${s.detail ? "，" + s.detail : ""}`).join("；")}。`,
      );
    case "dialog":
      return scene("dialog", "对话示范", b.turns.map((t) => `${t.speaker}说：${t.text}`).join("。") + "。");
    case "code":
      // 代码不口播全文，旁白讲解释 + 提示看屏幕代码块。
      return scene("code", "代码演示", `${b.explanation || "看这段代码"}。具体实现请看画面中的代码。`);
    case "callout":
      return scene("callout", b.tone === "warn" ? "特别提醒" : "小贴士", b.markdown);
    case "quiz":
      // 测验转成「提问 + 停顿思考 + 揭晓」的一屏。
      return scene(
        "quiz",
        "随堂一问",
        `想一想：${b.question} 正确答案是：${b.options[b.answerIndex] ?? b.options[0]}。${b.explain}`,
      );
    case "flashcard":
      return scene("flashcard", b.front, `${b.front} 答案是：${b.back}。`);
    case "summary":
      return scene("summary", "本节小结", `${b.markdown}${b.next ? " 下一节，" + b.next : ""}`);
    default:
      return null;
  }

  function scene(kind: string, caption: string, narration: string): VideoScene | null {
    const nar = clamp(narration, MAX_NARRATION);
    if (!nar) return null;
    void index;
    return { kind, caption: clamp(caption, MAX_CAPTION) || nar.slice(0, 40), narration: nar, durationSec: estimateSceneSec(nar) };
  }
}

/**
 * 把一节的 blocks 组织成视频脚本。纯函数，永不抛错（脏输入 → 空脚本）。
 * 供编排层落库（videoScriptJson），真实 provider 直接消费该结构。
 */
export function buildVideoScript(blocks: (Block & { id: string })[]): VideoScript {
  const scenes: VideoScene[] = [];
  for (let i = 0; i < blocks.length && scenes.length < MAX_SCENES; i++) {
    const s = blockToScene(blocks[i], i);
    if (s) scenes.push(s);
  }
  const totalDurationSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  return { version: 1, totalDurationSec, scenes };
}

// ————————————————————————————————————————————————————————————
//  Provider 接口（可插拔）+ mock 实现
// ————————————————————————————————————————————————————————————

/** provider 生成入参：脚本 + 归属信息（供真实 provider 打水印 / 归档）。 */
export interface VideoGenInput {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  lessonTitle: string;
  script: VideoScript;
}

/** provider 生成产物。 */
export interface VideoGenOutput {
  /** 受控视频资源 id（写入 lesson.videoAssetId；mock 为占位 id，真实为对象存储/CDN key）。 */
  assetId: string;
  /** 实际总时长（真实 provider 用 TTS/渲染实测；mock 用脚本估算）。 */
  durationSec: number;
  /** 产物形态标记，便于排查（mock-placeholder / hls / mp4 …）。 */
  kind: string;
}

/**
 * 视频生成 provider 契约。真实文生视频/数字人讲课服务实现此接口即可接入，
 * 编排层与 route 完全不感知底层是哪家模型。
 */
export interface VideoProvider {
  readonly name: string;
  generate(input: VideoGenInput): Promise<VideoGenOutput>;
}

/**
 * Mock provider —— 不调任何模型，把脚本「就绪」为占位视频资源。
 * assetId 用可辨识前缀（mockvid_）落库；受控流路由 /api/stream 已按 videoAssetId 校验权益，
 * Player 对非真实媒体（无 .mp4/.m3u8/.webm）走模拟播放器：品牌渐变画面 + 字幕行照常。
 * 因此点「生成」→ 标记 ready → 学习页即可「播放」占位视频，跑通端到端流程。
 */
export const mockVideoProvider: VideoProvider = {
  name: "mock",
  async generate(input: VideoGenInput): Promise<VideoGenOutput> {
    // 模拟一点点「渲染耗时」，让状态有 pending/generating → ready 的过程感（不阻塞太久）。
    await new Promise((r) => setTimeout(r, 60));
    const assetId = `mockvid_${input.lessonId}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      assetId,
      durationSec: input.script.totalDurationSec,
      kind: "mock-placeholder",
    };
  },
};

/**
 * 选择当前生效的 provider。
 * VIDEO_MODE=real 且真实 provider 已注册时用真实的；否则一律回落 mock（优雅降级）。
 *
 * TODO(接入真实视频模型)：在此按 VIDEO_PROVIDER 环境变量分发到具体实现，例如：
 *   if (videoMode() === "real") {
 *     switch (process.env.VIDEO_PROVIDER) {
 *       case "wan":      return wanTextToVideoProvider;   // 文生视频（如通义万相/可灵）
 *       case "heygen":   return heygenAvatarProvider;     // 数字人讲课
 *       case "sadtalker":return sadtalkerProvider;        // 自建口播数字人
 *     }
 *   }
 * 每个真实 provider 只需实现 VideoProvider.generate：把 script.scenes 逐段合成语音 + 渲染画面，
 * 上传到对象存储，返回 { assetId(=对象存储/CDN key), durationSec, kind }。其余流程零改动。
 */
export function resolveVideoProvider(): VideoProvider {
  // 真实 provider 尚未接入：即便 VIDEO_MODE=real 也回落 mock，保证流程不断。
  return mockVideoProvider;
}

// ————————————————————————————————————————————————————————————
//  编排层：generateLessonVideo（越权 + 幂等 claim + 落脚本 + provider + 收尾）
// ————————————————————————————————————————————————————————————

export interface LessonVideoResult {
  /** 是否成功就绪 */
  ok: boolean;
  /** 就绪后的资源 id（供前端可选跳转/展示） */
  assetId: string | null;
  /** 生成态：ready / failed / generating(被别的流水抢占，本次跳过) */
  status: "ready" | "failed" | "generating";
  /** 脚本场景数（可见性/统计用） */
  scenes: number;
  /** 使用的 provider 名（mock / 真实名） */
  provider: string;
}

/**
 * 为单节生成视频课件 —— 视频生成的最小可复用单元（对齐 generateLessonCore 的所有权/幂等语义）。
 *
 * 契约：
 *  - 越权铁律：按 lessonId 重拉 lesson+course，校验 course.authorUserId===userId，不符抛错。
 *  - 前置：本节必须已有 blocksJson（块课件），否则无从组织脚本 → 抛「章节课件未就绪」。
 *  - 已就绪：videoGenStatus==="ready" 且已有 videoAssetId → 直接返回，不重复生成。
 *  - 幂等/并发：用 videoGenClaimedAt 原子 claim（updateMany where videoGenClaimedAt=null
 *    AND videoGenStatus ∈ {null, pending, failed}）抢占所有权；抢不到（count===0）直接跳过，
 *    返回 status=generating（另一条流水在跑），不重复调 provider。
 *  - 生成：buildVideoScript → 落 videoScriptJson + videoGenStatus=generating →
 *    resolveVideoProvider().generate → 写 videoAssetId + durationSec + videoGenStatus=ready。
 *  - 异常：任何失败把 videoGenStatus 置 failed 并释放 claim（videoGenClaimedAt→null），可重试。
 *
 * 不做请求级预检（同源/登录/权益/积分/限流由 route 把守）。仅「章节不存在 / 越权 /
 * 课件未就绪」三类结构性错误向上抛，由 route 映射为 4xx。
 */
export async function generateLessonVideo(lessonId: string, userId: string): Promise<LessonVideoResult> {
  // —— 越权铁律 ——
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: { select: { id: true, title: true, authorUserId: true } } },
  });
  if (!lesson || !lesson.course) throw new Error("章节不存在");
  const course = lesson.course;
  if (course.authorUserId !== userId) throw new Error("无权操作该课程");

  // —— 前置：需先有块课件才能组织脚本 ——
  if (!lesson.blocksJson) throw new Error("章节课件未就绪");

  // —— 已就绪：不重复生成 ——
  if (lesson.videoGenStatus === "ready" && lesson.videoAssetId) {
    return { ok: true, assetId: lesson.videoAssetId, status: "ready", scenes: 0, provider: resolveVideoProvider().name };
  }

  // —— 原子 claim：仅未认领且处于可发起态（null/pending/failed）的行会被抢到 ——
  // 注意：Prisma 的 `in` 列表不允许含 null（会抛校验错），故 null 态单独用 OR 分支匹配。
  const claim = await prisma.lesson.updateMany({
    where: {
      id: lessonId,
      videoGenClaimedAt: null,
      OR: [{ videoGenStatus: null }, { videoGenStatus: { in: ["pending", "failed"] } }],
    },
    data: { videoGenClaimedAt: new Date(), videoGenStatus: "generating" },
  });
  if (claim.count === 0) {
    // 已被另一条流水认领 / 正在生成 / 已就绪：跳过，不重复调 provider。
    return { ok: false, assetId: lesson.videoAssetId, status: "generating", scenes: 0, provider: resolveVideoProvider().name };
  }

  const provider = resolveVideoProvider();
  try {
    // —— 组织脚本并落库（生成前先存，真实 provider 可据此断点/审计）——
    const blocks = validateBlocks(safeParse(lesson.blocksJson));
    const script = buildVideoScript(blocks);
    if (script.scenes.length === 0) {
      // 脚本为空（块课件异常）：视为失败，释放 claim 供重试。
      throw new Error("课件内容为空，无法组织视频脚本");
    }
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { videoScriptJson: JSON.stringify(script) },
    });

    // —— 调 provider 生成（mock 立即返回占位；真实 provider 走文生视频/数字人）——
    const out = await provider.generate({
      lessonId: lesson.id,
      courseId: course.id,
      courseTitle: course.title,
      lessonTitle: lesson.title,
      script,
    });

    // —— 写产物 + 收尾：videoAssetId + 时长 + ready，释放 claim ——
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        videoAssetId: out.assetId,
        durationSec: out.durationSec > 0 ? out.durationSec : lesson.durationSec,
        videoGenStatus: "ready",
        videoGenClaimedAt: null,
      },
    });

    await track({
      eventName: "ai_gen_lesson_video",
      userId,
      properties: { courseId: course.id, lessonId: lesson.id, scenes: script.scenes.length, provider: provider.name, mode: videoMode(), kind: out.kind },
    });

    return { ok: true, assetId: out.assetId, status: "ready", scenes: script.scenes.length, provider: provider.name };
  } catch (e) {
    // 失败：标 failed + 释放 claim，允许后续重试。不吞原始异常。
    try {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { videoGenStatus: "failed", videoGenClaimedAt: null },
      });
    } catch {
      /* 复位失败仅日志级 */
    }
    // 结构性错误上抛（route 映射 4xx）；provider/内部错误折叠为失败结果，避免 route 500。
    const msg = e instanceof Error ? e.message : "";
    if (msg === "课件内容为空，无法组织视频脚本") {
      return { ok: false, assetId: null, status: "failed", scenes: 0, provider: provider.name };
    }
    throw e;
  }
}

/** 安全解析 blocksJson 字符串（失败归 null，交给 validateBlocks 归空）。 */
function safeParse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
