import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";
// 复用 App 的块校验：种子里的 ai_block 内容也走同一道白名单，确保入库即合法（含 image src 白名单）。
import { validateBlocks } from "../src/lib/blocks";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const HEALTH_DISCLAIMER =
  "本内容仅用于健康信息素养学习，不构成诊断、治疗或用药建议。身体不适请及时咨询正规医疗机构。";

const article = (t: string) =>
  `## ${t}\n\n这是一节图文课件的示例正文。正式内容由内容团队按标准结构制作：定位、适合谁、要点、模板与更新日志。\n\n- 要点一：先理解概念，再动手实操。\n- 要点二：每节配套可复用模板。\n- 要点三：跟随更新日志掌握内容变化。\n`;

// —— ai_block 演示课件（AI 办公）：结构化块，含两张真实课件图解（public/courseware/courseware-ai-*.png）。
//   走 validateBlocks 校验后再 JSON.stringify 入库，确保种子数据本身也是合法块协议。
//   同时这门课挂了「视频课件」(lesson-ai-office-005.mp4 + videoGenStatus:ready)，点亮学习台的视频通路。
const aiOfficeBlocks: unknown[] = [
  { type: "scene", title: "为什么先学会「派活」给 AI", markdown: "职场里 80% 的重复文书，都能交给 AI 打初稿。真正拉开效率差距的，不是谁的工具新，而是**谁更会描述任务**。这一节，我们把「派活」这件事讲透。" },
  { type: "objectives", items: ["理解 AI 办公助手的定位：协作者，不是替你决定的人", "掌握一个可复用的四段式提示词结构", "看懂两张对照图解，知道好提示词长什么样", "能独立写出一封结构清晰的邮件初稿"] },
  { type: "concept", title: "AI 是协作者，不是甩手掌柜", markdown: "把 AI 当**实习生**：交代得越清楚，产出越靠谱。你负责判断与拍板，它负责把体力活做完。**背景、目标、约束、格式**四件事讲明白，返工就少一大半。" },
  // —— 课件图解（image 块）：真实课件图，引用 public/courseware/ ——
  { type: "image", src: "/courseware/courseware-ai-1.png", caption: "图解一：四段式提示词结构，背景 / 目标 / 约束 / 输出格式逐段拆解。", alt: "四段式提示词结构图解" },
  { type: "keypoint", points: ["背景：你是谁、面对什么场景", "目标：想要 AI 产出什么", "约束：语气、长度、不能出现的内容", "格式：分点、表格还是纯段落"] },
  { type: "image", src: "/courseware/courseware-ai-2.png", caption: "图解二：同一需求，模糊提示词 vs 结构化提示词的产出对照。", alt: "模糊提示词与结构化提示词产出对照图" },
  { type: "compare", title: "两种提示词写法", left: { heading: "模糊写法（返工多）", items: ["「帮我写封邮件」", "没有对象和目的", "语气长度全靠猜"] }, right: { heading: "结构化写法（一次到位）", items: ["交代收件人与场景", "写清诉求与截止时间", "指定礼貌、简洁、分点"] } },
  { type: "quiz", question: "下面哪一项最该写进提示词的「约束」里？", options: ["邮件正文的具体内容", "希望语气正式、控制在 150 字内", "AI 用的是什么模型", "今天的天气"], answerIndex: 1, explain: "约束描述的是对产出的限制条件，比如语气、字数、禁用内容；正文内容属于目标，模型与天气都不相关。" },
  { type: "flashcard", front: "四段式提示词是哪四段？", back: "背景、目标、约束、输出格式。交代齐这四件事，AI 初稿的返工率显著下降。" },
  { type: "summary", markdown: "学会用**背景 / 目标 / 约束 / 格式**四段式描述任务，AI 就能稳定产出可用初稿。下一步是把它用到最高频的场景：写邮件。", next: "第 2 讲 · 用 AI 写邮件" },
];

type LessonSeed = {
  title: string; summary: string; contentType?: string; durationSec: number;
  isFree?: boolean; articleMd?: string; live?: boolean; seat?: number;
  // ai_block 课件：结构化块数组（JSON.stringify 后写入 blocksJson）。
  blocks?: unknown[];
  // 视频课件通路（v3.1）：块课可另挂一版「视频课件」。填 videoUrl(站内 /videos/*.mp4) + videoGenStatus:"ready" 即可真播。
  videoUrl?: string; videoGenStatus?: string; videoDurationSec?: number;
};
type CourseSeed = {
  slug: string; title: string; subtitle: string; description: string;
  track: string; level: "L1" | "L2" | "L3"; cover: string;
  instructor: string; contributor?: string; revenueShare?: number;
  reviewer?: string; disclaimer?: string; cadence: string;
  featured?: boolean; learners: number;
  lessons: LessonSeed[];
  updateLogs: { updateType: string; title: string; description: string; daysAgo: number; lessonIdx?: number }[];
};

// ============ 融合内容目录：有道英语板块 + 潮汐 AI/生活赛道 ============
const courses: CourseSeed[] = [
  // —— 有道：口语小班课（含直播）——
  {
    slug: "oral-smallclass-001", title: "口语小班课·实战表达", subtitle: "依据基础匹配难度，即学即用",
    description: "贴合碎片化学习的实战口语课，短时见效。覆盖生活、职场即时沟通，配套直播小班练习。",
    track: "english_oral", level: "L1", cover: "tide",
    instructor: "梁焕臻·超频语境", contributor: "签约讲师·口语教研", revenueShare: 40,
    cadence: "每周更新", featured: true, learners: 8600,
    lessons: [
      { title: "第 1 讲 · 开口的第一句", summary: "破除哑巴英语心理关", durationSec: 620, isFree: true },
      { title: "第 2 讲 · 点餐与购物场景", summary: "高频生活表达", durationSec: 680 },
      { title: "第 3 讲 · 职场自我介绍", summary: "3 句话说清楚", durationSec: 700 },
      { title: "直播 · 本周口语实战小班", summary: "真人连麦纠音，限额小班", durationSec: 3600, live: true, seat: 20 },
      { title: "第 4 讲 · 地道习语速用", summary: "让表达更自然", contentType: "article", durationSec: 600, articleMd: article("地道习语速用") },
    ],
    updateLogs: [
      { updateType: "added", title: "新增本周直播小班", description: "真人连麦纠音场次", daysAgo: 1, lessonIdx: 3 },
      { updateType: "revised", title: "更新职场场景表达", description: "贴合最新职场沟通需求", daysAgo: 7 },
    ],
  },
  // —— 有道：躺学单词/听说读写全能 ——
  {
    slug: "all-round-002", title: "躺学单词·听说读写全能", subtitle: "夯实语法与词汇根基",
    description: "节选超频语境全能英语浸泡营的单词讲解与练习，循序渐进让听说读写扎实进步。",
    track: "english_foundation", level: "L2", cover: "dawn",
    instructor: "梁焕臻·超频语境", contributor: "超频语境教研组", revenueShare: 45,
    cadence: "每周更新", featured: true, learners: 12100,
    lessons: [
      { title: "第 1 讲 · 躺学单词法总览", summary: "无压力记词逻辑", durationSec: 640, isFree: true },
      { title: "第 2 讲 · 音标与发音", summary: "打好听说基础", durationSec: 720 },
      { title: "第 3 讲 · 语法主干梳理", summary: "用中文思维学语法", durationSec: 800 },
      { title: "第 4 讲 · 语境记忆法", summary: "词汇在语境中记牢", durationSec: 760 },
      { title: "第 5 讲 · 综合练习模板", summary: "输入-练习-输出闭环", contentType: "article", durationSec: 600, articleMd: article("综合练习模板") },
    ],
    updateLogs: [{ updateType: "added", title: "新增语境记忆一讲", description: "补充语境记忆法实操", daysAgo: 4, lessonIdx: 3 }],
  },
  // —— 有道：银发口语 ——
  {
    slug: "silver-oral-003", title: "银发口语·开口就会", subtitle: "只教当下能开口的短句",
    description: "为 50+ 学员设计。覆盖见面寒暄、超市购物等高频生活场景，摒弃晦涩语法，授课慢、练习重复，学完立刻能用。",
    track: "silver_english", level: "L1", cover: "dawn",
    instructor: "赵老师·适老教学", contributor: "银发教研组", revenueShare: 35,
    reviewer: "内容合规组·审核", cadence: "每月更新", learners: 5200,
    lessons: [
      { title: "第 1 讲 · 见面打招呼", summary: "最常用的寒暄句", durationSec: 540, isFree: true },
      { title: "第 2 讲 · 超市购物", summary: "买东西够用的英语", durationSec: 560 },
      { title: "第 3 讲 · 看医生问路", summary: "关键场景短句", durationSec: 580 },
      { title: "第 4 讲 · 和外孙说英语", summary: "亲子互动表达", contentType: "article", durationSec: 520, articleMd: article("和外孙说英语") },
    ],
    updateLogs: [{ updateType: "added", title: "新增看医生问路场景", description: "补充关键生活场景", daysAgo: 9, lessonIdx: 2 }],
  },
  // —— 有道：三合一全能英语 ——
  {
    slug: "three-in-one-004", title: "三合一全能英语", subtitle: "实用英语·动词短语·地道习语",
    description: "三合一教学主线，不侧重课本理论，聚焦生活实用内容，解决哑巴英语、听不懂本土口语的问题。",
    track: "english_oral", level: "L2", cover: "tide",
    instructor: "口语教研组", contributor: "签约内容池", revenueShare: 30,
    cadence: "每两周更新", learners: 7400,
    lessons: [
      { title: "第 1 讲 · 实用英语框架", summary: "从场景出发", durationSec: 660, isFree: true },
      { title: "第 2 讲 · 高频动词短语", summary: "一词多用", durationSec: 700 },
      { title: "第 3 讲 · 地道习语", summary: "让表达更本土", durationSec: 680 },
      { title: "第 4 讲 · 综合场景演练", summary: "流利沟通", durationSec: 720 },
    ],
    updateLogs: [{ updateType: "revised", title: "更新习语库", description: "补充近期高频习语", daysAgo: 6 }],
  },
  // —— 潮汐：AI 技能 ——
  {
    slug: "ai-office-005", title: "AI 办公效率入门", subtitle: "从写邮件、做 PPT 到会议纪要",
    description: "职场人的 AI 提效第一课，每周跟随工具更新。",
    track: "ai_skill", level: "L1", cover: "tide",
    instructor: "陈明·AI 提效讲师", contributor: "平台自制", revenueShare: 0,
    cadence: "每周更新", featured: true, learners: 12430,
    lessons: [
      { title: "第 1 讲 · 认识 AI 办公助手", summary: "AI 是协作者", durationSec: 640, isFree: true },
      // ai_block 块课件：图文课件（含 image 图解）+ 视频课件（真播 lesson-ai-office-005.mp4）双通路。
      // videoGenStatus:"ready" + videoUrl 让学习台「视频课件」Tab 能真播放。
      {
        title: "第 2 讲 · 给 AI 派活的四段式提示词", summary: "图文 + 视频双课件", contentType: "ai_block",
        durationSec: 540, blocks: aiOfficeBlocks,
        videoUrl: "/videos/lessons/lesson-ai-office-005.mp4", videoGenStatus: "ready", videoDurationSec: 540,
      },
      { title: "第 3 讲 · 用 AI 写邮件", summary: "结构化提示词", durationSec: 720 },
      { title: "第 4 讲 · 会议纪要自动化", summary: "录音到纪要", durationSec: 810 },
      { title: "第 5 讲 · 一句话生成 PPT", summary: "提纲到成稿", durationSec: 900 },
      { title: "第 6 讲 · 提示词模板库", summary: "10 个高频模板", contentType: "article", durationSec: 600, articleMd: article("办公提示词模板库") },
    ],
    updateLogs: [
      { updateType: "added", title: "新增块课件与视频课件", description: "第 2 讲上线图文 + 视频双课件", daysAgo: 1, lessonIdx: 1 },
      { updateType: "added", title: "新增 PPT 生成一讲", description: "补充成稿工作流", daysAgo: 2, lessonIdx: 4 },
    ],
  },
  {
    slug: "ai-writing-006", title: "AI 写作与内容生产", subtitle: "选题、初稿、改写、事实核查",
    description: "职场与自媒体的 AI 写作系统课，守住质量与事实底线。",
    track: "ai_skill", level: "L2", cover: "dawn",
    instructor: "林一·内容策略讲师", contributor: "平台自制", revenueShare: 0,
    cadence: "每周更新", learners: 9820,
    lessons: [
      { title: "第 1 讲 · AI 写作正确姿势", summary: "人机分工", durationSec: 680, isFree: true },
      { title: "第 2 讲 · 选题与角度", summary: "从热点到角度", durationSec: 720 },
      { title: "第 3 讲 · 改写链", summary: "多轮改写", durationSec: 780 },
      { title: "第 4 讲 · 事实核查", summary: "避免编造", durationSec: 660 },
    ],
    updateLogs: [{ updateType: "added", title: "新增事实核查一讲", description: "回应 AI 幻觉担忧", daysAgo: 4, lessonIdx: 3 }],
  },
  // —— 潮汐：生活实用 ——
  {
    slug: "anti-fraud-007", title: "手机防诈骗与隐私保护", subtitle: "识别常见套路，守好钱包和信息",
    description: "面向 35–65 岁的案例课，只讲识别与防范，跟随诈骗热点更新。",
    track: "life", level: "L1", cover: "tide",
    instructor: "公共安全科普组", contributor: "平台自制", revenueShare: 0,
    reviewer: "内容合规组·审核", cadence: "热点更新", learners: 6890,
    lessons: [
      { title: "第 1 讲 · 常见诈骗类型", summary: "先认识才能防范", durationSec: 600, isFree: true },
      { title: "第 2 讲 · 冒充客服与熟人", summary: "识别话术", durationSec: 640 },
      { title: "第 3 讲 · 刷单与投资陷阱", summary: "天上不掉馅饼", durationSec: 680 },
      { title: "第 4 讲 · 保护个人信息", summary: "隐私清单", contentType: "article", durationSec: 560, articleMd: article("个人信息保护清单") },
    ],
    updateLogs: [{ updateType: "added", title: "新增近期热点案例", description: "更新最新手法识别", daysAgo: 1 }],
  },
  {
    slug: "pre-visit-008", title: "就医前信息整理课", subtitle: "把症状和病史说清楚",
    description: "健康信息素养课。整理症状、病史与用药记录，学会和医生沟通。不做诊断、不做用药建议。",
    track: "life", level: "L1", cover: "dawn",
    instructor: "健康科普组", contributor: "平台自制", revenueShare: 0,
    reviewer: "医学信息审核组", disclaimer: HEALTH_DISCLAIMER, cadence: "季度更新", learners: 3120,
    lessons: [
      { title: "第 1 讲 · 就医前准备什么", summary: "一张清单", durationSec: 560, isFree: true },
      { title: "第 2 讲 · 如何描述症状", summary: "时间/部位/程度", durationSec: 600 },
      { title: "第 3 讲 · 整理病史用药", summary: "既往史记录", contentType: "article", durationSec: 540, articleMd: article("病史与用药记录") },
    ],
    updateLogs: [{ updateType: "revised", title: "更新就医准备清单", description: "补充线上问诊准备", daysAgo: 12 }],
  },
];

// 本地版 Asia/Shanghai 日期 key，与 src/lib/week.ts 的 shanghaiDayKey 逻辑一致（seed 不引 src/）。
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
function shanghaiDayKey(date = new Date()): string {
  const s = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const y = s.getUTCFullYear();
  const m = String(s.getUTCMonth() + 1).padStart(2, "0");
  const d = String(s.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentWeekKey(): string {
  const date = new Date();
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function main() {
  console.log("🌊 清空并重建融合种子数据...");
  await prisma.analyticsEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.lead.deleteMany();
  // C2/C3 新增关联表：先删子表再删主表，保证可重复执行
  await prisma.userAchievement.deleteMany();
  await prisma.achievement.deleteMany();
  await prisma.streakDay.deleteMany();
  await prisma.streak.deleteMany();
  await prisma.demandStage.deleteMany();
  await prisma.demandFollow.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.demandStatusLog.deleteMany();
  await prisma.demandVote.deleteMany();
  await prisma.demand.deleteMany();
  // 笔记标签关联表（NoteTagOnNote 随 Note/NoteTag 级联，显式清理更稳妥）
  await prisma.noteTagOnNote.deleteMany();
  await prisma.noteTag.deleteMany();
  await prisma.subtitle.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.note.deleteMany();
  await prisma.learningProgress.deleteMany();
  await prisma.entitlement.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.order.deleteMany();
  await prisma.paymentWebhookLog.deleteMany();
  await prisma.contentCalendar.deleteMany();
  await prisma.courseUpdateLog.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.course.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.familyMember.deleteMany();
  await prisma.familyGroup.deleteMany();
  await prisma.user.deleteMany();

  // ---------- 套餐：全站会员 + 单赛道会员（有道真实定价 + 分赛道自由组合）----------
  const planQuarterly = await prisma.plan.create({
    data: { name: "全站季卡", billingPeriod: "quarter", priceCents: 24900, scope: "all", highlight: false },
  });
  const planMonthly = await prisma.plan.create({
    data: { name: "全站连续包月", billingPeriod: "month_recurring", priceCents: 9900, firstPriceCents: 1990, scope: "all", highlight: true },
  });
  const planYear = await prisma.plan.create({
    data: { name: "全站年卡", billingPeriod: "year", priceCents: 49900, scope: "all", highlight: true },
  });
  await prisma.plan.create({ data: { name: "单月（价格锚点）", billingPeriod: "month", priceCents: 4990, scope: "all" } });
  // 单赛道会员（低门槛切入，对应"自由选购适配的课程权限"）
  await prisma.plan.create({ data: { name: "口语实战·月卡", billingPeriod: "month", priceCents: 1990, scope: "english_oral" } });
  await prisma.plan.create({ data: { name: "银发口语·月卡", billingPeriod: "month", priceCents: 1990, scope: "silver_english" } });
  await prisma.plan.create({ data: { name: "AI 技能·月卡", billingPeriod: "month", priceCents: 2990, scope: "ai_skill" } });

  // ---------- 用户 ----------
  // P0-4：管理员密码优先取 SEED_ADMIN_PASSWORD，避免弱密码 admin123 进生产。
  //   - 有 env：一律用它。
  //   - 无 env + 非生产：回退 admin123（本机 / 测试不受影响，与体验账号文档一致）。
  //   - 无 env + 生产：生成强随机密码并 console.log 打印一次（仅此一次可见），杜绝默认弱口令上线。
  // 注：dingyue / oral 等为体验（demo）账号，弱口令是刻意的演示凭据，保持现状不动。
  const isProd = process.env.NODE_ENV === "production";
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ??
    (isProd
      ? (() => {
          const generated = randomBytes(18).toString("base64url");
          console.log(`⚠️  未设置 SEED_ADMIN_PASSWORD，已为 admin 生成强随机密码（仅此一次打印）：${generated}`);
          return generated;
        })()
      : "admin123");
  const admin = await prisma.user.create({
    data: { nickname: "平台管理员", username: "admin", email: "admin@tide.learning", phone: "13800000000", role: "admin", avatarUrl: "/avatars/avatar-2.png", passwordHash: hashPassword(adminPassword), profile: { create: { ageBand: "22-40" } } },
  });
  const demoUser = await prisma.user.create({
    data: { nickname: "体验用户", username: "dingyue", email: "demo@tide.learning", phone: "13900000000", role: "user", avatarUrl: "/avatars/avatar-1.png", passwordHash: hashPassword("demo123"), profile: { create: { ageBand: "22-40", learningGoal: "口语 + AI" } } },
  });
  // demo：全站年卡
  const sub = await prisma.subscription.create({
    data: { userId: demoUser.id, planId: planYear.id, channel: "youdao_dict", scope: "all", status: "active", currentPeriodEnd: new Date(Date.now() + 365 * 864e5), cancelAtPeriodEnd: true },
  });
  await prisma.entitlement.create({
    data: { userId: demoUser.id, sourceSubscriptionId: sub.id, status: "active", accessLevel: "premium", validUntil: new Date(Date.now() + 365 * 864e5), snapshotJson: JSON.stringify({ isSubscriber: true, accessibleTracks: "all" }) },
  });
  // 已付订单回填 subscriptionId：关联本单激活的那条年卡订阅，退款时可据此精确撤销「这一笔」
  // （对齐 payment.ts payment.succeeded 分支写回 order.subscriptionId 的语义，避免 seed 数据缺链）。
  await prisma.order.create({ data: { userId: demoUser.id, planId: planYear.id, channel: "youdao_dict", amountCents: 49900, status: "paid", paidAt: new Date(), externalOrderId: "seed_demo_year", subscriptionId: sub.id } });

  // 单赛道体验用户：只订了口语
  const oralUser = await prisma.user.create({
    data: { nickname: "口语学员", email: "oral@tide.learning", phone: "13700000000", role: "user", avatarUrl: "/avatars/avatar-3.png", passwordHash: hashPassword("oral123"), profile: { create: { ageBand: "22-40" } } },
  });
  const oralSub = await prisma.subscription.create({
    data: { userId: oralUser.id, planId: (await prisma.plan.findFirst({ where: { scope: "english_oral" } }))!.id, channel: "ad_external", scope: "english_oral", status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 864e5), cancelAtPeriodEnd: false },
  });
  await prisma.entitlement.create({ data: { userId: oralUser.id, sourceSubscriptionId: oralSub.id, status: "active", accessLevel: "premium", validUntil: new Date(Date.now() + 30 * 864e5), snapshotJson: JSON.stringify({ accessibleTracks: ["english_oral"] }) } });
  // oral 用户的已付订单也回填 subscriptionId（关联其口语月卡订阅），保持「付费订单↔订阅」双向可查。
  await prisma.order.create({ data: { userId: oralUser.id, planId: oralSub.planId, channel: "ad_external", amountCents: 1990, status: "paid", paidAt: new Date(), externalOrderId: "seed_oral_month", subscriptionId: oralSub.id } });

  // ---------- 广场/社区 demo 用户（轻量：仅昵称 + 头像，无订阅）----------
  // 让广场「有人在学」，并把新头像 avatar-4~12 用起来（避免全站只有 3 个头像）。
  const communitySeeds = [
    { nickname: "晨读的橙子", avatar: "/avatars/avatar-4.png", ageBand: "22-40" },
    { nickname: "打卡不迟到", avatar: "/avatars/avatar-5.png", ageBand: "18-24" },
    { nickname: "AI 造课小王", avatar: "/avatars/avatar-6.png", ageBand: "22-40" },
    { nickname: "银发也爱学", avatar: "/avatars/avatar-7.png", ageBand: "45-65" },
    { nickname: "口语练习生", avatar: "/avatars/avatar-8.png", ageBand: "18-24" },
    { nickname: "职场充电中", avatar: "/avatars/avatar-9.png", ageBand: "22-40" },
    { nickname: "反诈老陈", avatar: "/avatars/avatar-10.png", ageBand: "35-45" },
    { nickname: "笔记控 Mia", avatar: "/avatars/avatar-11.png", ageBand: "22-40" },
    { nickname: "每天进步一点", avatar: "/avatars/avatar-12.png", ageBand: "18-24" },
  ];
  const communityUsers: { id: string; nickname: string; avatarUrl: string }[] = [];
  for (let i = 0; i < communitySeeds.length; i++) {
    const s = communitySeeds[i];
    const u = await prisma.user.create({
      data: {
        nickname: s.nickname, avatarUrl: s.avatar, role: "user",
        email: `community${i + 1}@tide.learning`, passwordHash: hashPassword("demo123"),
        profile: { create: { ageBand: s.ageBand } },
      },
    });
    communityUsers.push({ id: u.id, nickname: u.nickname, avatarUrl: s.avatar });
  }

  // ---------- 课程 ----------
  // 已就位的真实教学视频：文件名对应课程 slug，只有这 4 门有真片源。
  // 给对应课程的「第 1 讲」（isFree 免费试学那节）填 videoUrl，让学习台能真播放。
  const LESSON_VIDEO_BY_SLUG: Record<string, string> = {
    "oral-smallclass-001": "/videos/lessons/lesson-oral-smallclass-001.mp4",
    "ai-office-005": "/videos/lessons/lesson-ai-office-005.mp4",
    "silver-oral-003": "/videos/lessons/lesson-silver-oral-003.mp4",
    "anti-fraud-007": "/videos/lessons/lesson-anti-fraud-007.mp4",
  };
  const videoFilledCourses: string[] = [];
  const courseIds: Record<string, string> = {};
  const lessonIdMap: Record<string, string[]> = {};
  for (const c of courses) {
    const totalDuration = c.lessons.reduce((s, l) => s + l.durationSec, 0);
    const created = await prisma.course.create({
      data: {
        slug: c.slug, title: c.title, subtitle: c.subtitle, description: c.description,
        category: c.track, level: c.level, status: "published", coverColor: c.cover,
        ownerId: admin.id, instructorName: c.instructor, contributorName: c.contributor ?? null,
        revenueSharePct: c.revenueShare ?? null, reviewerName: c.reviewer ?? null, disclaimer: c.disclaimer ?? null,
        updateCadence: c.cadence, totalDurationSec: totalDuration, learnersCount: c.learners,
        isFeatured: c.featured ?? false, publishedAt: new Date(),
        lastUpdatedAt: new Date(Date.now() - (c.updateLogs[0]?.daysAgo ?? 1) * 864e5),
      },
    });
    courseIds[c.slug] = created.id;
    lessonIdMap[c.slug] = [];
    for (let i = 0; i < c.lessons.length; i++) {
      const l = c.lessons[i];
      const type = l.live ? "live" : l.contentType ?? "video";
      // 真实片源：仅第 1 讲（免费试学节）、且该课有对应视频文件时填直链，让学习台真播放。
      const lessonZeroVideo = i === 0 && (l.isFree ?? false) ? LESSON_VIDEO_BY_SLUG[c.slug] ?? null : null;
      // ai_block 课件：校验块数组后 stringify 入库；非块课不写 blocksJson。
      const blocksJson =
        type === "ai_block" && Array.isArray(l.blocks)
          ? JSON.stringify({ version: 1, blocks: validateBlocks(l.blocks) })
          : null;
      // 视频课件通路：块课可显式挂 videoUrl + videoGenStatus:"ready"（真播）。否则沿用第 1 讲兜底片源。
      const realVideoUrl = l.videoUrl ?? lessonZeroVideo;
      const lesson = await prisma.lesson.create({
        data: {
          courseId: created.id, title: l.title, summary: l.summary, sortOrder: i,
          contentType: type,
          videoAssetId: type === "video" || type === "live" ? `asset_${c.slug}_${i}` : null,
          videoUrl: realVideoUrl,
          blocksJson,
          videoGenStatus: l.videoGenStatus ?? null,
          videoDurationSec: l.videoDurationSec ?? null,
          articleMd: l.articleMd ?? null, durationSec: l.durationSec, isFree: l.isFree ?? false,
          liveStartAt: l.live ? new Date(Date.now() + 3 * 864e5) : null,
          liveSeatLimit: l.seat ?? null,
          status: "published", publishedAt: new Date(),
        },
      });
      lessonIdMap[c.slug].push(lesson.id);
      if (realVideoUrl) videoFilledCourses.push(c.slug);
    }
    for (const log of c.updateLogs) {
      await prisma.courseUpdateLog.create({
        data: {
          courseId: created.id, lessonId: log.lessonIdx != null ? lessonIdMap[c.slug][log.lessonIdx] : null,
          updateType: log.updateType, title: log.title, description: log.description, ownerId: admin.id,
          publishedAt: new Date(Date.now() - log.daysAgo * 864e5),
        },
      });
    }
    await prisma.contentCalendar.create({
      data: { courseId: created.id, title: `${c.title} · 下一次更新`, plannedPublishDate: new Date(Date.now() + 7 * 864e5), owner: c.instructor, status: "planned", riskLevel: c.reviewer ? "medium" : "low" },
    });
  }

  // ---------- 课程集市：置几门课为「用户造并分享」，让集市有货可验证 ----------
  // 挑 3 门内容好的 seed 课，装作 demoUser 用 AI 造出来并分享到集市：
  //   - sharedStatus="shared"：集市展示开关打开（market/page.tsx 只查 shared）。
  //   - authorUserId=demoUser：collect/request 需要作者归属；demo 登录时看到「这是你分享的课」，
  //     其它用户（oral@ / community 用户）可对其「拿走」/「申请学习」。
  //   - origin="ai_generated"：市场卡显示「AI 生成」徽标，符合「同学用 AI 造的课」语境。
  //   - visibility 保持默认 public 不动（shared 才是集市开关；public 让它同时可进公共课程库，
  //     不会重新引入「私有课污染库」的 bug——那 bug 挡的是 visibility=private 的课）。
  // 定价：三门集市课设为付费（priceCredits>0），让交易闭环（course_purchase / course_sale_income）
  // 有真实付费课可回归。priceCredits=null/0 为免费拿走；此处按内容体量给 300/500/800 三档。
  const MARKET_PAID_PRICES: Record<string, number> = {
    "ai-office-005": 300,
    "ai-writing-006": 500,
    "anti-fraud-007": 800,
  };
  const MARKET_SHARED_SLUGS = ["ai-office-005", "ai-writing-006", "anti-fraud-007"];
  for (const slug of MARKET_SHARED_SLUGS) {
    const id = courseIds[slug];
    if (!id) continue;
    await prisma.course.update({
      where: { id },
      data: { sharedStatus: "shared", authorUserId: demoUser.id, origin: "ai_generated", priceCredits: MARKET_PAID_PRICES[slug] ?? null },
    });
  }
  // 让集市卡的「拿走数」非零：其它用户对这些分享课建起始 LearningProgress（= 拿走）。
  // 与 /api/market/collect 的 fork 语义一致（第 1 节起始记录，progressSec=0）。
  const collectorPool = [oralUser, ...communityUsers];
  for (let i = 0; i < MARKET_SHARED_SLUGS.length; i++) {
    const slug = MARKET_SHARED_SLUGS[i];
    const courseId = courseIds[slug];
    const firstLessonId = lessonIdMap[slug]?.[0];
    if (!courseId || !firstLessonId) continue;
    // 每门课取前 (2 + i) 个收藏者，制造不同的「拿走数」。
    const takers = collectorPool.slice(0, Math.min(2 + i, collectorPool.length));
    for (const t of takers) {
      if (t.id === demoUser.id) continue; // 作者本人不算拿走
      await prisma.learningProgress.upsert({
        where: { userId_lessonId: { userId: t.id, lessonId: firstLessonId } },
        update: {},
        create: { userId: t.id, courseId, lessonId: firstLessonId, progressSec: 0 },
      });
    }
  }

  // ---------- 共创需求（含 → 选题排期）----------
  const demandSeeds = [
    { title: "希望出商务邮件写作口语课", desc: "职场商务沟通场景", status: "collecting", track: "english_oral", votes: 128 },
    { title: "银发群体微信视频通话英语", desc: "和海外子女视频常用语", status: "evaluating", track: "silver_english", votes: 96 },
    { title: "AI 数据分析入门", desc: "不写代码用 AI 做分析", status: "scheduled", track: "ai_skill", votes: 74 },
    { title: "雅思口语新题季精讲", desc: "跟随题季更新", status: "producing", track: "english_foundation", votes: 61 },
    { title: "职场英语面试专项", desc: "英文面试问答", status: "collecting", track: "english_oral", votes: 45 },
    { title: "Excel 与 AI 结合", desc: "已由 AI 办公课覆盖", status: "launched", track: "ai_skill", votes: 200 },
  ];
  const demandIds: Record<string, string> = {}; // title -> demand.id，供后续阶段/评论/关注关联
  for (const d of demandSeeds) {
    const demand = await prisma.demand.create({
      data: {
        userId: demoUser.id, title: d.title, description: d.desc, category: d.track, status: d.status,
        officialReply: d.status === "scheduled" ? "已进入排期，预计下月上线。" : d.status === "launched" ? "已由《AI 办公效率入门》覆盖。" : null,
        launchedCourseId: d.status === "launched" ? courseIds["ai-office-005"] : null,
      },
    });
    demandIds[d.title] = demand.id;
    await prisma.demandVote.create({ data: { demandId: demand.id, userId: demoUser.id, voteCount: Math.min(3, Math.ceil(d.votes / 40)), weekKey: currentWeekKey() } });
    await prisma.demandStatusLog.create({ data: { demandId: demand.id, fromStatus: "pending_review", toStatus: d.status, operatorId: admin.id, reason: "种子初始化" } });
    // 已排期/制作中的需求接入内容排期
    if (["scheduled", "producing"].includes(d.status)) {
      await prisma.contentCalendar.create({
        data: { courseId: courseIds["ai-office-005"], demandId: demand.id, title: `共创选题：${d.title}`, plannedPublishDate: new Date(Date.now() + 14 * 864e5), owner: "内容团队", status: d.status === "producing" ? "recording" : "planned", riskLevel: "low" },
      });
    }
  }

  // ---------- 预约试听 / 建联线索（有道 0转正 + 电联漏斗）----------
  const leadSeeds = [
    { name: "王先生", phone: "138****1234", track: "english_oral", source: "youdao_dict", status: "new" },
    { name: "李阿姨", phone: "139****5678", track: "silver_english", source: "ad_external", status: "contacting", note: "已电联一次，倾向银发口语" },
    { name: "张同学", phone: "137****9012", track: "ai_skill", source: "private_domain", status: "booked", note: "已预约周四试听" },
    { name: "陈女士", phone: "136****3456", track: "english_oral", source: "ad_external", status: "converted", note: "已转化口语月卡" },
    { name: "刘先生", phone: "135****7890", track: "english_foundation", source: "organic", status: "lost", note: "价格顾虑，暂搁置" },
  ];
  for (const l of leadSeeds) {
    await prisma.lead.create({
      data: { name: l.name, phone: l.phone, track: l.track, courseId: courseIds[Object.keys(courseIds).find((k) => courses.find((c) => c.slug === k)?.track === l.track) ?? "oral-smallclass-001"] ?? null, source: l.source, status: l.status, assigneeId: admin.id, followUpNote: l.note ?? null },
    });
  }

  // ---------- 学习进度 + 笔记 ----------
  const firstLesson = lessonIdMap["ai-office-005"][0];
  await prisma.learningProgress.create({ data: { userId: demoUser.id, courseId: courseIds["ai-office-005"], lessonId: firstLesson, progressSec: 320, lastPlayedAt: new Date() } });
  await prisma.note.create({ data: { userId: demoUser.id, courseId: courseIds["ai-office-005"], lessonId: firstLesson, timestampSec: 180, title: "AI 是协作者", contentMd: "关键点：把 AI 当协作者，先给背景再提要求。" } });

  // ---------- 渠道埋点样本（供看板漏斗展示）----------
  const channels = ["youdao_dict", "ad_external", "private_domain"];
  for (const ch of channels) {
    for (let i = 0; i < (ch === "youdao_dict" ? 40 : ch === "ad_external" ? 25 : 12); i++) {
      await prisma.analyticsEvent.create({ data: { eventName: "homepage_view", anonymousId: `${ch}_${i}`, propertiesJson: JSON.stringify({ source: ch }), platform: "web" } });
    }
  }

  // ========================================================================
  // 潮汐学习 v1.0 增量种子（C1 字幕/笔记馆 · C2 需求剧场 · C3 游戏化）
  // ========================================================================

  // ---------- C1：章节字幕 cue（供「字幕划线剪藏」演示）----------
  // 为若干代表性课程的前几讲补 5-10 条中文字幕；lessonIdMap 已在上文构建。
  const subtitleScripts: Record<string, string[][]> = {
    // AI 办公：第 1、2 讲
    "ai-office-005": [
      [
        "欢迎来到 AI 办公效率入门，这一讲我们先建立正确心态。",
        "很多人把 AI 当搜索引擎，其实它更像一位随叫随到的协作者。",
        "把背景、目标、约束一次讲清楚，AI 的产出质量会明显提升。",
        "记住一个原则：先给上下文，再提要求，最后给示例。",
        "这样它才能理解你真正想要什么，而不是泛泛而谈。",
        "接下来的几讲，我们会把这套方法用到邮件、纪要和 PPT 上。",
        "现在，先在笔记里划下这句：AI 是协作者，不是许愿池。",
      ],
      [
        "这一讲我们用 AI 来写一封得体的商务邮件。",
        "第一步，先说清楚收件人是谁、你们的关系如何。",
        "第二步，交代这封邮件要达成的目标，比如约会议还是催进度。",
        "第三步，给出语气要求：正式、友好，还是简洁直接。",
        "把这三点写进提示词，AI 生成的初稿就已经能用八成。",
        "剩下的两成，是你补充细节、核对事实、调整称呼。",
        "试着把刚才的结构套用到你手头一封真实邮件上。",
      ],
    ],
    // 口语小班课：第 1、2 讲
    "oral-smallclass-001": [
      [
        "开口的第一句，往往是最难的一句。",
        "别担心语法完美，先让声音发出来。",
        "我们从最安全的三个万能开场白练起。",
        "第一句：Hi, nice to meet you. 简单但永远好用。",
        "第二句：How's it going? 比 How are you 更自然。",
        "第三句：Sorry, could you say that again? 听不懂时的救命句。",
        "把这三句大声重复五遍，肌肉记住了，开口就不慌。",
      ],
      [
        "这一讲进入点餐与购物的高频场景。",
        "点餐时最常用的一句：I'll have the..., please.",
        "想问推荐，就说：What do you recommend?",
        "购物结账，记住：Do you take card? 问能不能刷卡。",
        "想要小一号，说：Do you have this in a smaller size?",
        "这些句子短、好记，今天就能在生活里用上。",
      ],
    ],
    // 银发口语：第 1 讲（慢速、重复友好）
    "silver-oral-003": [
      [
        "这一讲，我们学最常用的见面打招呼。",
        "见到人，最简单的一句就是 Hello，你好。",
        "想问对方好不好，说 How are you，你好吗。",
        "回答可以很简单：I'm fine，我很好。",
        "分别的时候说 Goodbye，再见。",
        "别急，我们把这几句慢慢多念几遍。",
      ],
    ],
    // 防诈骗：第 1 讲
    "anti-fraud-007": [
      [
        "这一讲，我们先认识常见的诈骗类型。",
        "凡是让你转账、验证码给别人的，几乎都是骗局。",
        "冒充公检法、冒充客服，是最常见的两种套路。",
        "记住：正规机构不会用电话要你的银行密码。",
        "遇到催你、吓你、不让你挂电话的，先冷静挂断。",
        "把这几条记在笔记里，遇事多留个心眼。",
      ],
    ],
  };
  let subtitleCount = 0;
  for (const [slug, lessonCues] of Object.entries(subtitleScripts)) {
    const lessons = lessonIdMap[slug];
    if (!lessons) continue;
    for (let li = 0; li < lessonCues.length; li++) {
      const lessonId = lessons[li];
      if (!lessonId) continue;
      const cues = lessonCues[li];
      // 每条 cue 约 6 秒，首尾相接，形成可划线的连续字幕轨
      for (let ci = 0; ci < cues.length; ci++) {
        const startSec = 12 + ci * 6.5;
        await prisma.subtitle.create({
          data: { lessonId, lang: "zh", startSec, endSec: startSec + 6, text: cues[ci] },
        });
        subtitleCount++;
      }
    }
  }

  // ---------- C3：成就种子（Phosphor 图标名）----------
  const achievementSeeds = [
    { key: "first_subscribe", name: "扬帆起航", description: "完成首次订阅，正式加入潮汐。", icon: "Medal" },
    { key: "first_note", name: "落笔成潮", description: "记下第一条学习笔记。", icon: "NotePencil" },
    { key: "week_streak", name: "七日不辍", description: "连续 7 天保持学习潮汐。", icon: "Flame" },
    { key: "cocreator", name: "共创者", description: "参与共创需求，与内容团队同行。", icon: "Users" },
    { key: "first_tide", name: "首潮", description: "参与首批共创投票，掀起一次潮汐。", icon: "Waves" },
  ];
  const achievementIds: Record<string, string> = {};
  for (const a of achievementSeeds) {
    const created = await prisma.achievement.create({ data: a });
    achievementIds[a.key] = created.id;
  }

  // ---------- C1：笔记标签 + demo 用户多形态笔记（三视图内容）----------
  // 标签：先建标签，再在建笔记时关联。
  const tagSeeds = [
    { name: "重点", color: "accent" },
    { name: "待复习", color: "warning" },
    { name: "灵感", color: "tide" },
    { name: "口语句型", color: "success" },
  ];
  const tagIds: Record<string, string> = {};
  for (const t of tagSeeds) {
    const created = await prisma.noteTag.create({
      data: { userId: demoUser.id, name: t.name, color: t.color },
    });
    tagIds[t.name] = created.id;
  }

  // 目标课程/章节 id（复用上文已建记录）
  const aiOfficeLessons = lessonIdMap["ai-office-005"];
  const oralLessons = lessonIdMap["oral-smallclass-001"];
  // 截帧笔记的真实截图（替换原 1x1 透明 PNG 占位）：kind=capture 的 captureUrl 轮流引用这 4 张。
  const NOTE_CAPTURES = [
    "/note-captures/note-capture-01.jpg",
    "/note-captures/note-capture-02.jpg",
    "/note-captures/note-capture-03.jpg",
    "/note-captures/note-capture-04.jpg",
  ];
  let captureSeq = 0;
  const nextCapture = () => NOTE_CAPTURES[captureSeq++ % NOTE_CAPTURES.length];

  type NoteSeed = {
    courseSlug: string; lessonIdx: number; timestampSec?: number; title?: string;
    contentMd: string; kind?: string; captureUrl?: string; sourceText?: string;
    starred?: boolean; tags?: string[];
  };
  const noteSeeds: NoteSeed[] = [
    {
      courseSlug: "ai-office-005", lessonIdx: 0, timestampSec: 46, title: "AI 是协作者",
      contentMd: "**核心心态**：把 AI 当协作者——先给上下文，再提要求，最后给示例。",
      kind: "clip", sourceText: "把背景、目标、约束一次讲清楚，AI 的产出质量会明显提升。",
      starred: true, tags: ["重点"],
    },
    {
      courseSlug: "ai-office-005", lessonIdx: 1, timestampSec: 78, title: "写邮件三步法",
      contentMd: "写邮件三要素：收件人关系 → 目标 → 语气。三点写进提示词，初稿即可用八成。",
      kind: "clip", sourceText: "把这三点写进提示词，AI 生成的初稿就已经能用八成。",
      tags: ["重点", "待复习"],
    },
    {
      courseSlug: "ai-office-005", lessonIdx: 0, timestampSec: 20, title: "开场截帧",
      contentMd: "这一页的心态图很好，先存下来回头复习。",
      kind: "capture", captureUrl: nextCapture(), tags: ["灵感"],
    },
    {
      courseSlug: "ai-office-005", lessonIdx: 1, timestampSec: 64, title: "邮件三步法截帧",
      contentMd: "把「收件人关系 → 目标 → 语气」这张图存下来，写邮件前对照一眼。",
      kind: "capture", captureUrl: nextCapture(), starred: true, tags: ["重点"],
    },
    {
      courseSlug: "oral-smallclass-001", lessonIdx: 0, timestampSec: 40, title: "万能开场白截帧",
      contentMd: "三句万能开场白截了下来，刷牙时对着念。",
      kind: "capture", captureUrl: nextCapture(), tags: ["口语句型"],
    },
    {
      courseSlug: "anti-fraud-007", lessonIdx: 0, timestampSec: 88, title: "诈骗类型速查截帧",
      contentMd: "常见诈骗类型这一页最实用，转给爸妈看。",
      kind: "capture", captureUrl: nextCapture(), tags: ["待复习"],
    },
    {
      courseSlug: "oral-smallclass-001", lessonIdx: 0, timestampSec: 55, title: "万能救命句",
      contentMd: "听不懂时救命：Sorry, could you say that again?",
      kind: "clip", sourceText: "Sorry, could you say that again? 听不懂时的救命句。",
      starred: true, tags: ["口语句型", "重点"],
    },
    {
      courseSlug: "oral-smallclass-001", lessonIdx: 1, timestampSec: 30, title: "点餐句型",
      contentMd: "点餐通用句：I'll have the..., please. 想要推荐问 What do you recommend?",
      kind: "clip", sourceText: "点餐时最常用的一句：I'll have the..., please.",
      tags: ["口语句型"],
    },
    {
      courseSlug: "oral-smallclass-001", lessonIdx: 0,
      contentMd: "随手记：今天开口练了 5 遍，明显没那么紧张了。",
      kind: "text", tags: ["灵感"],
    },
  ];
  let noteCount = 0;
  for (const n of noteSeeds) {
    const lessons = lessonIdMap[n.courseSlug];
    const lessonId = lessons?.[n.lessonIdx];
    if (!lessonId) continue;
    const note = await prisma.note.create({
      data: {
        userId: demoUser.id, courseId: courseIds[n.courseSlug], lessonId,
        timestampSec: n.timestampSec ?? null, title: n.title ?? null, contentMd: n.contentMd,
        kind: n.kind ?? "text", captureUrl: n.captureUrl ?? null, sourceText: n.sourceText ?? null,
        starred: n.starred ?? false,
        tags: n.tags?.length
          ? { create: n.tags.map((t) => ({ tagId: tagIds[t] })) }
          : undefined,
      },
    });
    noteCount++;
    void note;
  }
  void aiOfficeLessons;
  void oralLessons;

  // ---------- 自习室广场 demo 帖子（让广场一进去就"有人在学"）----------
  // author 混用现有用户（demo/oral）+ 新建社区用户；type 混合 insight/checkin/question；
  // 部分帖子带 1-2 张 square 配图，部分纯文字；likeCount/commentCount 给合理非零；
  // createdAt 分散在近几天（HOUR 为偏移单位）。status=approved 才会出现在广场列表。
  const HOUR = 3600 * 1000;
  const authorPool = [demoUser, oralUser, ...communityUsers];
  const pickAuthor = (i: number) => authorPool[i % authorPool.length];
  type PostSeed = {
    author: { id: string }; type: "insight" | "checkin" | "question";
    content: string; images?: string[]; topicTags?: string[];
    likeCount: number; commentCount: number; hoursAgo: number;
  };
  const postSeeds: PostSeed[] = [
    {
      author: communityUsers[1], type: "checkin",
      content: "打卡第 12 天。今天学完《口语小班课》第 1 讲，跟着念了 5 遍开场白，开口没那么慌了，明天继续。",
      images: ["/square/square-post-01.jpg"], topicTags: ["口语打卡", "开口挑战"],
      likeCount: 34, commentCount: 6, hoursAgo: 3,
    },
    {
      author: communityUsers[2], type: "insight",
      content: "用 AI 造课体验分享：一句话把大纲丢给它，十几分钟就出了一门《职场表达》图文课的骨架，再自己补案例。真正省时间的是初稿，不是终稿，事实核查还得人来。",
      images: ["/square/square-post-02.jpg", "/square/square-post-03.jpg"], topicTags: ["AI造课", "效率"],
      likeCount: 58, commentCount: 12, hoursAgo: 8,
    },
    {
      author: communityUsers[4], type: "question",
      content: "求推荐：基础几乎为零，只想先能在超市、问路时开口，选《银发口语》还是《口语小班课》更合适？有学过的同学说说体验吗？",
      topicTags: ["求推荐", "零基础"],
      likeCount: 9, commentCount: 15, hoursAgo: 11,
    },
    {
      author: demoUser, type: "insight",
      content: "AI 办公课第 3 讲的会议纪要自动化太实用了。把录音转文字丢进去，先让它按「决议/待办/风险」三栏归纳，再补负责人和时间。原来两小时的活现在二十分钟。",
      images: ["/square/square-post-04.jpg"], topicTags: ["AI办公", "会议纪要"],
      likeCount: 47, commentCount: 8, hoursAgo: 20,
    },
    {
      author: communityUsers[6], type: "checkin",
      content: "反诈课打卡。今天把「常见诈骗类型」那一讲截图转到家庭群，老妈看完主动说以后陌生链接不点了。学以致用，值了。",
      images: ["/square/square-post-05.jpg"], topicTags: ["反诈打卡"],
      likeCount: 72, commentCount: 10, hoursAgo: 26,
    },
    {
      author: oralUser, type: "insight",
      content: "坚持口语两周的小心得：别追求句子完美，先把「万能三句」练成肌肉记忆。听不懂就说 Sorry, could you say that again，比硬撑着点头强多了。",
      topicTags: ["口语心得", "坚持"],
      likeCount: 41, commentCount: 5, hoursAgo: 33,
    },
    {
      author: communityUsers[0], type: "checkin",
      content: "晨读打卡 Day 21。今天躺学单词那门课学了音标，跟读了一整节。连续三周没断，潮汐日历终于连成一条线了，很有成就感。",
      images: ["/square/square-post-06.jpg"], topicTags: ["晨读", "单词打卡"],
      likeCount: 55, commentCount: 7, hoursAgo: 40,
    },
    {
      author: communityUsers[5], type: "question",
      content: "问下大家，AI 写作课里讲的「改写链」具体怎么落地？我每次让它改一遍就没思路了，有没有多轮改写的提示词模板可以参考？",
      topicTags: ["AI写作", "提示词"],
      likeCount: 18, commentCount: 14, hoursAgo: 48,
    },
    {
      author: communityUsers[7], type: "insight",
      content: "笔记控の自习室用法：看课时用字幕划线剪藏，重点直接存成卡片；关键页面截帧进「截帧廊」。复习时不用回看整节，翻卡片就够了，效率翻倍。",
      images: ["/square/square-post-07.jpg", "/square/square-post-08.jpg"], topicTags: ["笔记方法", "复习"],
      likeCount: 63, commentCount: 9, hoursAgo: 55,
    },
    {
      author: communityUsers[8], type: "checkin",
      content: "每天进步一点点。今天学了 AI 办公第 1 讲，记住一句话：AI 是协作者，不是许愿池。先给上下文再提要求，产出果然靠谱多了。",
      images: ["/square/square-post-09.jpg"], topicTags: ["AI办公打卡"],
      likeCount: 29, commentCount: 4, hoursAgo: 68,
    },
  ];
  void pickAuthor;
  // 广场帖子的 likeCount/commentCount 必须由真实 PostLike/PostComment 行数派生，不能硬编码假数
  // （否则计数与实际点赞/评论表脱节，前端点开评论区是空的、取消点赞时 -1 会算错）。
  // 做法：先建帖（计数留 0），再从「除作者外的其它用户」里取 distinct 用户建真实点赞/评论行，
  // 目标数取 min(想要的热度, 可用 distinct 用户数)——PostLike 有 @@unique([postId,userId])，
  // 一个用户对一帖只能点一次赞，所以真实计数天然被用户池上限约束（诚实的小数 > 好看的假数）。
  // 计数在本段末尾按真实行数回填（见下方 recompute）。
  const likerPool = [demoUser, oralUser, admin, ...communityUsers];
  const commenterPool = [oralUser, demoUser, ...communityUsers];
  const COMMENT_TEXTS = [
    "同款体验，跟着练确实有效！", "收藏了，感谢分享～", "请问用的是哪一讲的方法？",
    "打卡同行，一起坚持！", "这个思路很受用，学到了。", "太真实了，我也是这么过来的。",
    "已 mark，回头照着试试。", "求更多细节，蹲一个后续。", "支持！继续更新呀。",
    "刚好在纠结这个，看完清晰多了。", "点赞，说到心坎里了。", "跟我的情况一模一样，抄作业了。",
    "赞同，先完成再完美。", "感谢楼主，干货满满。", "学习使我快乐，冲！",
  ];
  const createdPostIds: string[] = [];
  let postCount = 0;
  let postLikeCount = 0;
  let postCommentCount = 0;
  for (let pi = 0; pi < postSeeds.length; pi++) {
    const p = postSeeds[pi];
    const postCreatedAt = new Date(Date.now() - p.hoursAgo * HOUR);
    const post = await prisma.post.create({
      data: {
        userId: p.author.id, type: p.type, content: p.content, status: "approved",
        images: JSON.stringify(p.images ?? []),
        topicTags: JSON.stringify(p.topicTags ?? []),
        likeCount: 0, commentCount: 0, // 占位，末尾按真实行数重算
        createdAt: postCreatedAt,
      },
    });
    createdPostIds.push(post.id);
    postCount++;

    // 真实点赞：从 likerPool 去掉作者，按目标热度取前 N 个 distinct 用户（受池大小约束）
    const likers = likerPool.filter((u) => u.id !== p.author.id);
    const likeTarget = Math.min(p.likeCount, likers.length);
    for (let li = 0; li < likeTarget; li++) {
      // 从不同起点轮转，避免每帖都是同一批人点赞，分布更自然
      const u = likers[(li + pi) % likers.length];
      try {
        await prisma.postLike.create({
          data: { postId: post.id, userId: u.id, createdAt: new Date(postCreatedAt.getTime() + (li + 1) * 60 * 1000) },
        });
        postLikeCount++;
      } catch { /* @@unique([postId,userId]) 撞车则跳过（轮转已尽量避免） */ }
    }

    // 真实评论：从 commenterPool 去掉作者，取目标数（受池大小约束；同一用户可多条评论，无唯一约束）
    const commenters = commenterPool.filter((u) => u.id !== p.author.id);
    const commentTarget = commenters.length === 0 ? 0 : Math.min(p.commentCount, commenters.length);
    for (let ci = 0; ci < commentTarget; ci++) {
      const u = commenters[(ci + pi) % commenters.length];
      await prisma.postComment.create({
        data: {
          postId: post.id, userId: u.id, status: "approved",
          content: COMMENT_TEXTS[(ci + pi) % COMMENT_TEXTS.length],
          createdAt: new Date(postCreatedAt.getTime() + (ci + 1) * 90 * 1000),
        },
      });
      postCommentCount++;
    }
  }

  // 计数重算：把每帖 likeCount/commentCount 校准为真实 PostLike/PostComment 行数（真值源单一）。
  for (const postId of createdPostIds) {
    const [likeN, commentN] = await Promise.all([
      prisma.postLike.count({ where: { postId } }),
      prisma.postComment.count({ where: { postId, status: "approved" } }),
    ]);
    await prisma.post.update({ where: { id: postId }, data: { likeCount: likeN, commentCount: commentN } });
  }

  // ---------- C2：需求制作剧场（DemandStage）+ 评论 + 关注 ----------
  // 阶段模板：scripting → recording → editing → reviewing → published
  const STAGE_FLOW = ["scripting", "recording", "editing", "reviewing", "published"] as const;
  // 为「制作中/已评估/已排期」的需求补阶段：activeStageIdx 之前为 done，当前为 active，之后 pending。
  const stagePlans: { title: string; activeIdx: number }[] = [
    { title: "雅思口语新题季精讲", activeIdx: 1 }, // producing：录制中
    { title: "AI 数据分析入门", activeIdx: 0 }, // scheduled：脚本撰写中
    { title: "银发群体微信视频通话英语", activeIdx: 0 }, // evaluating：刚进入脚本
  ];
  const stageNotes: Record<string, string> = {
    scripting: "脚本大纲撰写中，锁定核心场景。",
    recording: "讲师录制进行中，预计本周完成。",
    editing: "后期剪辑与字幕制作。",
    reviewing: "内容合规与质量复核。",
    published: "已上线，欢迎学习。",
  };
  let stageCount = 0;
  for (const p of stagePlans) {
    const demandId = demandIds[p.title];
    if (!demandId) continue;
    for (let si = 0; si < STAGE_FLOW.length; si++) {
      const stage = STAGE_FLOW[si];
      const status = si < p.activeIdx ? "done" : si === p.activeIdx ? "active" : "pending";
      await prisma.demandStage.create({
        data: { demandId, stage, status, note: status === "pending" ? null : stageNotes[stage] },
      });
      stageCount++;
    }
  }

  // 需求评论：普通用户留言 + 1 条官方回复（isOfficial）
  const producingDemandId = demandIds["雅思口语新题季精讲"];
  const collectingDemandId = demandIds["希望出商务邮件写作口语课"];
  if (producingDemandId) {
    await prisma.comment.create({
      data: { userId: oralUser.id, demandId: producingDemandId, contentMd: "太期待了！新题季一定要跟上速度～" },
    });
    await prisma.comment.create({
      data: { userId: admin.id, demandId: producingDemandId, isOfficial: true, contentMd: "**官方回复**：已进入录制阶段，预计两周内上线首批章节，感谢支持！" },
    });
  }
  if (collectingDemandId) {
    await prisma.comment.create({
      data: { userId: demoUser.id, demandId: collectingDemandId, contentMd: "商务邮件太需要了，尤其是跨国同事沟通的语气把握。" },
    });
  }

  // 需求关注（进度订阅）：demo 关注制作中/已排期需求，oral 关注商务邮件
  const followPairs: { userId: string; title: string }[] = [
    { userId: demoUser.id, title: "雅思口语新题季精讲" },
    { userId: demoUser.id, title: "AI 数据分析入门" },
    { userId: oralUser.id, title: "希望出商务邮件写作口语课" },
    { userId: oralUser.id, title: "雅思口语新题季精讲" },
  ];
  let followCount = 0;
  for (const f of followPairs) {
    const demandId = demandIds[f.title];
    if (!demandId) continue;
    await prisma.demandFollow.create({ data: { demandId, userId: f.userId } });
    followCount++;
  }

  // ---------- 演示优惠券 ----------
  await prisma.coupon.create({
    data: {
      code: "TIDE20", kind: "percent", value: 20, maxRedeem: 0, planScope: "any",
      isActive: true, expiresAt: new Date(Date.now() + 60 * 864e5),
    },
  });
  // 限量券示例（流3-U4b 核销/超发验证用）：仅 2 名额、满 100 分抵扣。
  await prisma.coupon.create({
    data: {
      code: "WELCOME10", kind: "fixed", value: 1000, maxRedeem: 2, planScope: "any",
      isActive: true, expiresAt: new Date(Date.now() + 60 * 864e5),
    },
  });

  // ---------- C3：demo 用户潮汐日历（Streak + StreakDay）+ 已解锁成就 ----------
  // 最近 14 天，minutes 递增形成上升水位；shanghaiDayKey 与 gamification 保持一致。
  const STREAK_DAYS = 14;
  const todayKey = shanghaiDayKey();
  let streakDayCount = 0;
  for (let ago = STREAK_DAYS - 1; ago >= 0; ago--) {
    const day = shanghaiDayKey(new Date(Date.now() - ago * 864e5));
    // 递增水位：越近学习越久（20 → 90 分钟），并带少量笔记
    const minutes = 20 + (STREAK_DAYS - 1 - ago) * 5;
    const notes = ago % 3 === 0 ? 2 : 1;
    await prisma.streakDay.create({
      data: { userId: demoUser.id, day, minutes, notes },
    });
    streakDayCount++;
  }
  await prisma.streak.create({
    data: { userId: demoUser.id, currentStreak: STREAK_DAYS, longestStreak: STREAK_DAYS, lastActiveDay: todayKey },
  });

  // demo 已解锁的成就：首订阅（有年卡）、首笔记、连续 7 天、首潮（已投票）
  const demoUnlocked = ["first_subscribe", "first_note", "week_streak", "first_tide"];
  for (const key of demoUnlocked) {
    const achievementId = achievementIds[key];
    if (!achievementId) continue;
    await prisma.userAchievement.create({
      data: { userId: demoUser.id, achievementId },
    });
  }

  console.log("✅ 融合种子完成：");
  console.log(`   字幕 ${subtitleCount} 条 · 笔记 ${noteCount} 条（截帧 ${captureSeq} 张真实截图）· 成就 ${achievementSeeds.length} 个（demo 解锁 ${demoUnlocked.length}）`);
  console.log(`   需求阶段 ${stageCount} 条 · 关注 ${followCount} 条 · 潮汐日历 ${streakDayCount} 天 · 优惠券 TIDE20`);
  console.log(`   广场帖子 ${postCount} 条（真实点赞 ${postLikeCount} · 评论 ${postCommentCount}，计数按真实行数重算）· 社区用户 ${communityUsers.length} 位（头像 avatar-4~12）`);
  console.log(`   真实视频已填入 ${[...new Set(videoFilledCourses)].length} 门课首讲：${[...new Set(videoFilledCourses)].join(", ")}`);
  console.log(`   课程 ${courses.length} 门（有道英语板块 + 潮汐 AI/生活）`);
  console.log(`   套餐：全站(月/季/年) + 单赛道(口语/银发/AI) · 线索 ${leadSeeds.length} 条`);
  console.log("   dingyue/demo123(全站, 或 demo@tide.learning) · admin/admin123(后台) · oral@tide.learning/oral123(仅口语)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
