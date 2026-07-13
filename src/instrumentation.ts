/**
 * Next.js 15 约定文件：进程启动时执行 register()（Next 15 默认启用，无需配置开关）。
 * 职责：
 *  1. 生产环境 env 校验 fail-fast——配置错误让 systemd 启动即失败并给出明确原因，
 *     而非带病运行到线上才暴露（漏配 DB 路径 / 示例密钥上生产等）；
 *  2. 注册 SIGTERM 优雅退出：prisma.$disconnect()，让 SQLite WAL 干净落盘。
 * 仅在 nodejs runtime 执行（edge 无 process 信号，也不应引入 Prisma）。
 */

/** .env.example 中的示例密钥值——生产环境实配值撞上任何一个即视为漏换，拒绝启动。 */
const EXAMPLE_PAY_SECRETS: Record<string, string> = {
  // 变量名对齐 payment-provider.ts 的 secretFor：PAY_<CHANNEL大写>_SECRET
  PAY_MOCK_SECRET: "dev-mock-secret",
  PAY_WEB_WECHAT_SECRET: "",
  PAY_WEB_ALIPAY_SECRET: "",
};

function validateProductionEnv(): void {
  const errors: string[] = [];

  // (a) 数据库：必须配置；SQLite（file:）必须绝对路径——相对路径随进程工作目录漂移（见 .env.example）。
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    errors.push("DATABASE_URL 未配置");
  } else if (dbUrl.startsWith("file:")) {
    const filePath = dbUrl.slice("file:".length);
    if (!filePath.startsWith("/")) {
      errors.push(`DATABASE_URL 为 SQLite 相对路径（${dbUrl}），生产必须用绝对路径（如 file:/var/lib/tide/prod.db）`);
    }
  }

  // (b) 生产永不允许 mock 渠道。演示支付必须使用独立的非生产部署。
  if (process.env.MOCK_PAY_ENABLED === "1") {
    errors.push("生产环境禁止 MOCK_PAY_ENABLED=1；请在独立非生产环境演示 mock 支付");
  }

  if (process.env.NEXT_PUBLIC_PAY_CHANNEL === "stripe") {
    if (!process.env.STRIPE_SECRET_KEY) errors.push("NEXT_PUBLIC_PAY_CHANNEL=stripe 时必须配置 STRIPE_SECRET_KEY");
    if (!process.env.STRIPE_WEBHOOK_SECRET) errors.push("NEXT_PUBLIC_PAY_CHANNEL=stripe 时必须配置 STRIPE_WEBHOOK_SECRET");
  }

  if (!process.env.STREAM_SIGNING_SECRET || process.env.STREAM_SIGNING_SECRET.length < 32) {
    errors.push("STREAM_SIGNING_SECRET 未配置或少于 32 字符（私有视频短时 URL 签名必需）");
  }
  if (process.env.STORAGE_MODE !== "local") {
    errors.push("生产环境必须配置 STORAGE_MODE=local（mock/留空都不得上线）");
  }

  // (c) 各支付渠道密钥：已设置的值不得等于 .env.example 的示例值（漏换示例值 = 密钥公开可查）。
  for (const [key, example] of Object.entries(EXAMPLE_PAY_SECRETS)) {
    const value = process.env[key];
    if (value && example && value === example) {
      errors.push(`${key} 仍是 .env.example 的示例值（${example}），生产必须换真实密钥`);
    }
  }

  if (errors.length > 0) {
    // throw 让 next start 启动失败 → systemd 标记服务失败，不带病上线。
    throw new Error(`生产环境配置校验失败（共 ${errors.length} 项）：\n  - ${errors.join("\n  - ")}`);
  }
}

export async function register() {
  // 仅 nodejs runtime：edge 无 process 信号处理，也绝不能引入 Prisma。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "production") {
    validateProductionEnv();
    // P2-2：公开站点基址若缺失或为 localhost，会被烤进 OG/分享卡链接，导致分享预览指向本地。
    // 不阻断（本地跑生产构建做验收时地址本就是 localhost），但高声告警提醒真实部署改真实域名。
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) {
      console.warn(
        "[instrumentation] ⚠️ 未设置 NEXT_PUBLIC_SITE_URL，OG/分享卡/robots/sitemap 将回落默认域名。" +
          "真实部署请在【构建期与运行期】都设置为公开域名（如 https://tide.learning）。",
      );
    } else if (/localhost|127\.0\.0\.1/.test(siteUrl)) {
      console.warn(
        `[instrumentation] ⚠️ NEXT_PUBLIC_SITE_URL 当前为本地地址（${siteUrl}）。` +
          "OG/分享卡链接会烤成本地域名，分享到微信/X 预览图失效。正式部署请改为公开域名后【重新构建】。",
      );
    }
  }

  // SIGTERM 优雅退出：断开 Prisma 连接（SQLite WAL checkpoint 落盘）。
  // 动态 import 避免顶层引入 db（instrumentation 也会被 edge 侧解析）；
  // 全局标记防 dev 热重载 / 多次 register 重复挂监听器。
  const g = globalThis as unknown as { __tideSigtermRegistered?: boolean };
  if (!g.__tideSigtermRegistered) {
    g.__tideSigtermRegistered = true;
    process.on("SIGTERM", () => {
      void import("./lib/db")
        .then(({ prisma }) => prisma.$disconnect())
        .catch(() => {
          /* 退出路径上断连失败无补救意义，静默即可 */
        });
    });
  }
}
