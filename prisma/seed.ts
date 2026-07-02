import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

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

type LessonSeed = {
  title: string; summary: string; contentType?: string; durationSec: number;
  isFree?: boolean; articleMd?: string; live?: boolean; seat?: number;
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
      { title: "第 2 讲 · 用 AI 写邮件", summary: "结构化提示词", durationSec: 720 },
      { title: "第 3 讲 · 会议纪要自动化", summary: "录音到纪要", durationSec: 810 },
      { title: "第 4 讲 · 一句话生成 PPT", summary: "提纲到成稿", durationSec: 900 },
      { title: "第 5 讲 · 提示词模板库", summary: "10 个高频模板", contentType: "article", durationSec: 600, articleMd: article("办公提示词模板库") },
    ],
    updateLogs: [{ updateType: "added", title: "新增 PPT 生成一讲", description: "补充成稿工作流", daysAgo: 2, lessonIdx: 3 }],
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
  await prisma.demandStatusLog.deleteMany();
  await prisma.demandVote.deleteMany();
  await prisma.demand.deleteMany();
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
  const admin = await prisma.user.create({
    data: { nickname: "平台管理员", email: "admin@tide.learning", phone: "13800000000", role: "admin", passwordHash: hashPassword("admin123"), profile: { create: { ageBand: "22-40" } } },
  });
  const demoUser = await prisma.user.create({
    data: { nickname: "体验用户", email: "demo@tide.learning", phone: "13900000000", role: "user", passwordHash: hashPassword("demo123"), profile: { create: { ageBand: "22-40", learningGoal: "口语 + AI" } } },
  });
  // demo：全站年卡
  const sub = await prisma.subscription.create({
    data: { userId: demoUser.id, planId: planYear.id, channel: "youdao_dict", scope: "all", status: "active", currentPeriodEnd: new Date(Date.now() + 365 * 864e5), cancelAtPeriodEnd: true },
  });
  await prisma.entitlement.create({
    data: { userId: demoUser.id, sourceSubscriptionId: sub.id, status: "active", accessLevel: "premium", validUntil: new Date(Date.now() + 365 * 864e5), snapshotJson: JSON.stringify({ isSubscriber: true, accessibleTracks: "all" }) },
  });
  await prisma.order.create({ data: { userId: demoUser.id, planId: planYear.id, channel: "youdao_dict", amountCents: 49900, status: "paid", paidAt: new Date(), externalOrderId: "seed_demo_year" } });

  // 单赛道体验用户：只订了口语
  const oralUser = await prisma.user.create({
    data: { nickname: "口语学员", email: "oral@tide.learning", phone: "13700000000", role: "user", passwordHash: hashPassword("oral123"), profile: { create: { ageBand: "22-40" } } },
  });
  const oralSub = await prisma.subscription.create({
    data: { userId: oralUser.id, planId: (await prisma.plan.findFirst({ where: { scope: "english_oral" } }))!.id, channel: "ad_external", scope: "english_oral", status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 864e5), cancelAtPeriodEnd: false },
  });
  await prisma.entitlement.create({ data: { userId: oralUser.id, sourceSubscriptionId: oralSub.id, status: "active", accessLevel: "premium", validUntil: new Date(Date.now() + 30 * 864e5), snapshotJson: JSON.stringify({ accessibleTracks: ["english_oral"] }) } });

  // ---------- 课程 ----------
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
      const lesson = await prisma.lesson.create({
        data: {
          courseId: created.id, title: l.title, summary: l.summary, sortOrder: i,
          contentType: type,
          videoAssetId: type === "video" || type === "live" ? `asset_${c.slug}_${i}` : null,
          articleMd: l.articleMd ?? null, durationSec: l.durationSec, isFree: l.isFree ?? false,
          liveStartAt: l.live ? new Date(Date.now() + 3 * 864e5) : null,
          liveSeatLimit: l.seat ?? null,
          status: "published", publishedAt: new Date(),
        },
      });
      lessonIdMap[c.slug].push(lesson.id);
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

  // ---------- 共创需求（含 → 选题排期）----------
  const demandSeeds = [
    { title: "希望出商务邮件写作口语课", desc: "职场商务沟通场景", status: "collecting", track: "english_oral", votes: 128 },
    { title: "银发群体微信视频通话英语", desc: "和海外子女视频常用语", status: "evaluating", track: "silver_english", votes: 96 },
    { title: "AI 数据分析入门", desc: "不写代码用 AI 做分析", status: "scheduled", track: "ai_skill", votes: 74 },
    { title: "雅思口语新题季精讲", desc: "跟随题季更新", status: "producing", track: "english_foundation", votes: 61 },
    { title: "职场英语面试专项", desc: "英文面试问答", status: "collecting", track: "english_oral", votes: 45 },
    { title: "Excel 与 AI 结合", desc: "已由 AI 办公课覆盖", status: "launched", track: "ai_skill", votes: 200 },
  ];
  for (const d of demandSeeds) {
    const demand = await prisma.demand.create({
      data: {
        userId: demoUser.id, title: d.title, description: d.desc, category: d.track, status: d.status,
        officialReply: d.status === "scheduled" ? "已进入排期，预计下月上线。" : d.status === "launched" ? "已由《AI 办公效率入门》覆盖。" : null,
        launchedCourseId: d.status === "launched" ? courseIds["ai-office-005"] : null,
      },
    });
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

  console.log("✅ 融合种子完成：");
  console.log(`   课程 ${courses.length} 门（有道英语板块 + 潮汐 AI/生活）`);
  console.log(`   套餐：全站(月/季/年) + 单赛道(口语/银发/AI) · 线索 ${leadSeeds.length} 条`);
  console.log("   admin@tide.learning/admin123 · demo@tide.learning/demo123(全站) · oral@tide.learning/oral123(仅口语)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
