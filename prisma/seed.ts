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

// ---------- 8 门冷启动课程（§11.1）----------
// 每门课至少 1 章可试学（§19 内容验收）。
type LessonSeed = {
  title: string;
  summary: string;
  contentType?: string;
  durationSec: number;
  isFree?: boolean;
  articleMd?: string;
};
type CourseSeed = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: "ai_skill" | "exam" | "life";
  level: "L1" | "L2" | "L3";
  cover: string;
  instructor: string;
  reviewer?: string;
  disclaimer?: string;
  cadence: string;
  featured?: boolean;
  learners: number;
  lessons: LessonSeed[];
  updateLogs: { updateType: string; title: string; description: string; daysAgo: number; lessonIdx?: number }[];
};

const article = (t: string) =>
  `## ${t}\n\n这是一节图文课件的示例正文。正式内容由内容团队按《每门课程标准结构》(§11.2) 制作：课程定位、适合谁、学习前准备、章节要点、核心模板与更新日志。\n\n- 要点一：先理解概念，再动手实操。\n- 要点二：每节配套可复用模板。\n- 要点三：跟随更新日志掌握工具版本变化。\n`;

const courses: CourseSeed[] = [
  {
    slug: "ai-office-001",
    title: "AI 办公效率入门",
    subtitle: "从写邮件、做 PPT 到会议纪要",
    description: "面向职场人的 AI 提效第一课。用主流 AI 工具重构日常办公：邮件、文档、表格、PPT、会议纪要，每周跟随工具更新。",
    category: "ai_skill",
    level: "L1",
    cover: "tide",
    instructor: "陈明·AI 提效讲师",
    cadence: "每周更新",
    featured: true,
    learners: 12430,
    lessons: [
      { title: "第 1 讲 · 认识你的 AI 办公助手", summary: "建立正确心智：AI 是协作者不是替代者", durationSec: 640, isFree: true },
      { title: "第 2 讲 · 用 AI 写清楚一封邮件", summary: "结构化提示词 + 语气控制", durationSec: 720, isFree: true },
      { title: "第 3 讲 · 会议纪要自动化", summary: "从录音到结构化纪要", durationSec: 810 },
      { title: "第 4 讲 · 一句话生成 PPT 大纲", summary: "从提纲到成稿的工作流", durationSec: 900 },
      { title: "第 5 讲 · 表格与数据整理", summary: "公式生成与数据清洗", durationSec: 760 },
      { title: "第 6 讲 · 提示词模板库", summary: "10 个高频办公模板", contentType: "article", durationSec: 600, articleMd: article("办公提示词模板库") },
      { title: "第 7 讲 · 避坑与信息核对", summary: "如何校验 AI 输出", durationSec: 700 },
      { title: "第 8 讲 · 搭建你的个人工作流", summary: "把单点技巧串成流程", durationSec: 840 },
    ],
    updateLogs: [
      { updateType: "added", title: "新增第 8 讲：个人工作流", description: "补充端到端工作流搭建案例", daysAgo: 2, lessonIdx: 7 },
      { updateType: "revised", title: "更新提示词模板库", description: "适配最新模型能力，替换 3 个模板", daysAgo: 9, lessonIdx: 5 },
    ],
  },
  {
    slug: "ai-writing-002",
    title: "AI 写作与内容生产",
    subtitle: "选题、初稿、改写、事实核查全流程",
    description: "面向职场与自媒体的 AI 写作系统课。用 AI 提高产量同时守住质量与事实底线。",
    category: "ai_skill",
    level: "L2",
    cover: "dawn",
    instructor: "林一·内容策略讲师",
    cadence: "每周更新",
    featured: true,
    learners: 9820,
    lessons: [
      { title: "第 1 讲 · AI 写作的正确姿势", summary: "人机分工与质量红线", durationSec: 680, isFree: true },
      { title: "第 2 讲 · 选题与角度生成", summary: "从热点到可写角度", durationSec: 720 },
      { title: "第 3 讲 · 初稿到定稿的改写链", summary: "多轮改写提示词", durationSec: 780 },
      { title: "第 4 讲 · 风格迁移与语气控制", summary: "让文字有你的味道", durationSec: 700 },
      { title: "第 5 讲 · 事实核查与引用", summary: "避免 AI 编造", durationSec: 660 },
      { title: "第 6 讲 · 爆款结构拆解", summary: "标题与开头模板", contentType: "article", durationSec: 600, articleMd: article("内容爆款结构") },
    ],
    updateLogs: [
      { updateType: "added", title: "新增事实核查一讲", description: "回应用户对 AI 幻觉的担忧", daysAgo: 4, lessonIdx: 4 },
    ],
  },
  {
    slug: "ai-visual-003",
    title: "AI 做图与短视频入门",
    subtitle: "从生图到成片的工具实操",
    description: "运营与创作者的 AI 视觉课。生图、改图、口播、剪辑，工具实操为主，每两周跟随工具版本更新。",
    category: "ai_skill",
    level: "L1",
    cover: "tide",
    instructor: "苏晴·视觉创作讲师",
    cadence: "每两周更新",
    learners: 7640,
    lessons: [
      { title: "第 1 讲 · 生图工具全景", summary: "选对工具少走弯路", durationSec: 620, isFree: true },
      { title: "第 2 讲 · 提示词与出图控制", summary: "构图、风格、比例", durationSec: 720 },
      { title: "第 3 讲 · 图片精修与合规", summary: "版权与水印意识", durationSec: 680 },
      { title: "第 4 讲 · 口播脚本与配音", summary: "从脚本到语音", durationSec: 740 },
      { title: "第 5 讲 · 一键成片工作流", summary: "剪辑与字幕自动化", durationSec: 820 },
    ],
    updateLogs: [
      { updateType: "fixed", title: "修订工具版本说明", description: "标注最新工具版本与适用场景", daysAgo: 6 },
    ],
  },
  {
    slug: "ielts-writing-004",
    title: "雅思写作 7 分路径",
    subtitle: "从结构到高分表达，配作业模板",
    description: "学生备考主力课。按考试月更新真题趋势，覆盖大小作文结构、论证、语法与批改模板。",
    category: "exam",
    level: "L2",
    cover: "tide",
    instructor: "王铮·雅思写作讲师",
    cadence: "按考试月更新",
    featured: true,
    learners: 15230,
    lessons: [
      { title: "第 1 讲 · 评分标准拆解", summary: "考官到底看什么", durationSec: 700, isFree: true },
      { title: "第 2 讲 · Task 1 图表描述框架", summary: "趋势语言与结构", durationSec: 760 },
      { title: "第 3 讲 · Task 2 论证结构", summary: "立场、论点、论据", durationSec: 820 },
      { title: "第 4 讲 · 高分句式与连接", summary: "复杂句的正确用法", durationSec: 680 },
      { title: "第 5 讲 · 常见失分点", summary: "语法与逻辑陷阱", durationSec: 640 },
      { title: "第 6 讲 · 作业与批改模板", summary: "自我批改清单", contentType: "article", durationSec: 600, articleMd: article("雅思写作批改清单") },
    ],
    updateLogs: [
      { updateType: "revised", title: "更新本月真题趋势", description: "同步最新考试月高频话题", daysAgo: 3 },
    ],
  },
  {
    slug: "ielts-speaking-005",
    title: "雅思口语新题季精讲",
    subtitle: "跟随题季更新的口语题库与范例",
    description: "按题季滚动更新的口语课。Part 1/2/3 结构、话题库、地道表达与发音纠错。",
    category: "exam",
    level: "L2",
    cover: "dawn",
    instructor: "Nina·口语教研",
    cadence: "按题季更新",
    learners: 11040,
    lessons: [
      { title: "第 1 讲 · 口语评分与心态", summary: "流利度与连贯性", durationSec: 660, isFree: true },
      { title: "第 2 讲 · Part 2 话题卡应对", summary: "1 分钟准备法", durationSec: 780 },
      { title: "第 3 讲 · 本题季高频话题", summary: "题季话题库精讲", durationSec: 820 },
      { title: "第 4 讲 · 地道表达升级", summary: "从对到好", durationSec: 700 },
      { title: "第 5 讲 · 发音与语调纠错", summary: "常见中式发音", durationSec: 720 },
    ],
    updateLogs: [
      { updateType: "added", title: "新增本题季话题库", description: "更新至最新题季高频题", daysAgo: 5, lessonIdx: 2 },
    ],
  },
  {
    slug: "elder-ai-006",
    title: "长辈 AI 入门：会问、会用、会判断",
    subtitle: "大字视频 + 图文，教长辈用好 AI",
    description: "为 45–65 岁用户设计的 AI 入门课。大字、慢节奏、生活化案例，教会开口问、动手用、学会判断真假。",
    category: "life",
    level: "L1",
    cover: "dawn",
    instructor: "赵老师·适老教学",
    reviewer: "内容合规组·审核",
    cadence: "每月更新",
    learners: 4310,
    lessons: [
      { title: "第 1 讲 · AI 到底是什么", summary: "用生活比喻讲清楚", durationSec: 540, isFree: true },
      { title: "第 2 讲 · 怎么向 AI 提问", summary: "把话说清楚", durationSec: 600 },
      { title: "第 3 讲 · 用 AI 帮忙写东西", summary: "写祝福、写通知", durationSec: 620 },
      { title: "第 4 讲 · 判断 AI 说得对不对", summary: "别全信，学会核对", contentType: "article", durationSec: 560, articleMd: article("如何判断 AI 的回答") },
    ],
    updateLogs: [
      { updateType: "added", title: "新增判断真假一讲", description: "帮助长辈识别 AI 可能出错的地方", daysAgo: 8, lessonIdx: 3 },
    ],
  },
  {
    slug: "anti-fraud-007",
    title: "手机防诈骗与隐私保护",
    subtitle: "识别常见套路，守好钱包和信息",
    description: "面向 35–65 岁的案例课。只讲识别与防范，不涉及任何实施方法。跟随诈骗热点更新。",
    category: "life",
    level: "L1",
    cover: "tide",
    instructor: "公共安全科普组",
    reviewer: "内容合规组·审核",
    cadence: "热点更新",
    learners: 6890,
    lessons: [
      { title: "第 1 讲 · 常见诈骗类型总览", summary: "先认识才能防范", durationSec: 600, isFree: true },
      { title: "第 2 讲 · 冒充客服与熟人", summary: "识别话术特征", durationSec: 640 },
      { title: "第 3 讲 · 刷单与投资陷阱", summary: "天上不会掉馅饼", durationSec: 680 },
      { title: "第 4 讲 · 保护个人信息", summary: "隐私设置清单", contentType: "article", durationSec: 560, articleMd: article("个人信息保护清单") },
      { title: "第 5 讲 · 遇到诈骗怎么办", summary: "止损与报警流程", durationSec: 600 },
    ],
    updateLogs: [
      { updateType: "added", title: "新增近期热点案例", description: "更新最新诈骗手法识别要点", daysAgo: 1 },
    ],
  },
  {
    slug: "pre-visit-008",
    title: "就医前信息整理课",
    subtitle: "把症状和病史说清楚，看病更高效",
    description: "健康信息素养课。教你在就医前整理症状、病史与用药记录，学会和医生沟通。不做诊断、不做用药建议。",
    category: "life",
    level: "L1",
    cover: "dawn",
    instructor: "健康科普组",
    reviewer: "医学信息审核组",
    disclaimer: HEALTH_DISCLAIMER,
    cadence: "季度更新",
    learners: 3120,
    lessons: [
      { title: "第 1 讲 · 就医前该准备什么", summary: "一张清单看懂", durationSec: 560, isFree: true },
      { title: "第 2 讲 · 如何描述症状", summary: "时间、部位、程度", durationSec: 600 },
      { title: "第 3 讲 · 整理病史与用药", summary: "既往史记录方法", contentType: "article", durationSec: 540, articleMd: article("病史与用药记录") },
      { title: "第 4 讲 · 如何和医生沟通", summary: "高效问诊技巧", durationSec: 580 },
    ],
    updateLogs: [
      { updateType: "revised", title: "更新就医准备清单", description: "补充线上问诊准备要点", daysAgo: 12 },
    ],
  },
];

async function main() {
  console.log("🌊 清空并重建种子数据...");
  // 清空（按依赖顺序）
  await prisma.analyticsEvent.deleteMany();
  await prisma.auditLog.deleteMany();
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

  // ---------- 套餐（§7.1）----------
  const planRecurring = await prisma.plan.create({
    data: { name: "连续包月", billingPeriod: "month_recurring", priceCents: 3800, firstPriceCents: 1900, highlight: true },
  });
  await prisma.plan.create({
    data: { name: "单月", billingPeriod: "month", priceCents: 4800 },
  });
  const planYear = await prisma.plan.create({
    data: { name: "年度会员", billingPeriod: "year", priceCents: 32800, highlight: true },
  });

  // ---------- 用户 ----------
  const admin = await prisma.user.create({
    data: {
      nickname: "平台管理员",
      email: "admin@tide.learning",
      phone: "13800000000",
      role: "admin",
      passwordHash: hashPassword("admin123"),
      profile: { create: { ageBand: "22-40", preferredMode: "standard" } },
    },
  });
  const demoUser = await prisma.user.create({
    data: {
      nickname: "体验用户",
      email: "demo@tide.learning",
      phone: "13900000000",
      role: "user",
      passwordHash: hashPassword("demo123"),
      profile: { create: { ageBand: "22-40", learningGoal: "掌握 AI 办公", preferredMode: "standard" } },
    },
  });
  // 给 demo 用户一个活跃年度订阅，便于体验付费闭环
  const sub = await prisma.subscription.create({
    data: {
      userId: demoUser.id,
      planId: planYear.id,
      channel: "stripe",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 365 * 864e5),
      cancelAtPeriodEnd: true,
    },
  });
  await prisma.entitlement.create({
    data: {
      userId: demoUser.id,
      sourceSubscriptionId: sub.id,
      status: "active",
      accessLevel: "premium",
      validUntil: new Date(Date.now() + 365 * 864e5),
      snapshotJson: JSON.stringify({ isSubscriber: true }),
    },
  });
  await prisma.order.create({
    data: { userId: demoUser.id, planId: planYear.id, channel: "stripe", amountCents: 32800, status: "paid", paidAt: new Date(), externalOrderId: "seed_demo_year" },
  });

  // ---------- 课程 ----------
  const courseIds: Record<string, string> = {};
  const lessonIdMap: Record<string, string[]> = {};
  for (const c of courses) {
    const totalDuration = c.lessons.reduce((s, l) => s + l.durationSec, 0);
    const created = await prisma.course.create({
      data: {
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        description: c.description,
        category: c.category,
        level: c.level,
        status: "published",
        coverColor: c.cover,
        ownerId: admin.id,
        instructorName: c.instructor,
        reviewerName: c.reviewer ?? null,
        disclaimer: c.disclaimer ?? null,
        updateCadence: c.cadence,
        totalDurationSec: totalDuration,
        learnersCount: c.learners,
        isFeatured: c.featured ?? false,
        publishedAt: new Date(),
        lastUpdatedAt: new Date(Date.now() - (c.updateLogs[0]?.daysAgo ?? 1) * 864e5),
      },
    });
    courseIds[c.slug] = created.id;
    lessonIdMap[c.slug] = [];

    for (let i = 0; i < c.lessons.length; i++) {
      const l = c.lessons[i];
      const lesson = await prisma.lesson.create({
        data: {
          courseId: created.id,
          title: l.title,
          summary: l.summary,
          sortOrder: i,
          contentType: l.contentType ?? "video",
          videoAssetId: (l.contentType ?? "video") !== "article" ? `asset_${c.slug}_${i}` : null,
          articleMd: l.articleMd ?? null,
          durationSec: l.durationSec,
          isFree: l.isFree ?? false,
          status: "published",
          publishedAt: new Date(),
        },
      });
      lessonIdMap[c.slug].push(lesson.id);
    }

    for (const log of c.updateLogs) {
      await prisma.courseUpdateLog.create({
        data: {
          courseId: created.id,
          lessonId: log.lessonIdx != null ? lessonIdMap[c.slug][log.lessonIdx] : null,
          updateType: log.updateType,
          title: log.title,
          description: log.description,
          ownerId: admin.id,
          publishedAt: new Date(Date.now() - log.daysAgo * 864e5),
        },
      });
    }

    // 内容排期（§8.2.2）：为每门课排一节下一次更新
    await prisma.contentCalendar.create({
      data: {
        courseId: created.id,
        title: `${c.title} · 下一次更新`,
        plannedPublishDate: new Date(Date.now() + 7 * 864e5),
        owner: c.instructor,
        status: "planned",
        riskLevel: c.reviewer ? "medium" : "low",
      },
    });
  }

  // ---------- 共创需求（§6.6）----------
  const demandSeeds = [
    { title: "希望出一门 AI 数据分析入门课", desc: "面向不会写代码的运营，用 AI 做数据清洗和图表", status: "collecting", category: "ai_skill", votes: 128 },
    { title: "AI 简历与面试辅导", desc: "用 AI 优化简历、模拟面试问答", status: "evaluating", category: "ai_skill", votes: 96 },
    { title: "考研英语长难句 AI 精讲", desc: "结合 AI 拆解长难句", status: "scheduled", category: "exam", votes: 74 },
    { title: "长辈微信与支付安全课", desc: "教长辈安全使用微信支付", status: "producing", category: "life", votes: 61 },
    { title: "AI 帮忙做家庭记账", desc: "用 AI 工具管理家庭收支", status: "collecting", category: "ai_skill", votes: 45 },
    { title: "Excel 与 AI 结合进阶", desc: "已上线课程覆盖，合并", status: "launched", category: "ai_skill", votes: 200 },
  ];
  for (const d of demandSeeds) {
    const demand = await prisma.demand.create({
      data: {
        userId: demoUser.id,
        title: d.title,
        description: d.desc,
        category: d.category,
        status: d.status,
        officialReply: d.status === "scheduled" ? "已进入排期，预计下个月上线。" : d.status === "launched" ? "已由《AI 办公效率入门》覆盖。" : null,
        launchedCourseId: d.status === "launched" ? courseIds["ai-office-001"] : null,
      },
    });
    await prisma.demandVote.create({
      data: { demandId: demand.id, userId: demoUser.id, voteCount: Math.min(3, Math.ceil(d.votes / 40)), weekKey: currentWeekKey() },
    });
    await prisma.demandStatusLog.create({
      data: { demandId: demand.id, fromStatus: "pending_review", toStatus: d.status, operatorId: admin.id, reason: "种子初始化" },
    });
  }

  // ---------- 一条学习进度与一条笔记，便于体验 ----------
  const firstLesson = lessonIdMap["ai-office-001"][0];
  await prisma.learningProgress.create({
    data: { userId: demoUser.id, courseId: courseIds["ai-office-001"], lessonId: firstLesson, progressSec: 320, lastPlayedAt: new Date() },
  });
  await prisma.note.create({
    data: {
      userId: demoUser.id,
      courseId: courseIds["ai-office-001"],
      lessonId: firstLesson,
      timestampSec: 180,
      title: "AI 是协作者",
      contentMd: "关键点：把 AI 当协作者，先给背景再提要求。",
    },
  });

  console.log("✅ 种子完成：");
  console.log(`   课程 ${courses.length} 门 · 套餐 3 个 · 需求 ${demandSeeds.length} 条`);
  console.log("   管理员 admin@tide.learning / admin123");
  console.log("   体验用户 demo@tide.learning / demo123（已订阅年度）");
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
