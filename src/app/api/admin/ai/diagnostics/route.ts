import { ok, handle } from "@/lib/api";
import { requireAdminRole } from "@/lib/session";
import { LLM_MODELS, modelCredentials, DEFAULT_MODEL_KEY, resolveModel } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai/diagnostics —— AI 网关连通性自检（仅超级管理员）。
 *
 * 用途：线上「造课一直生成失败」时，用这个端点在**运行造课的那台服务器上**实测到 NewAPI
 * 网关的真实可达性与鉴权结果，一眼定位是「密钥没配 / 网关不可达（内网地址外网打不通）/
 * 模型无权限 / 响应慢」中的哪一种，而不是笼统的「生成失败」。
 *
 * 只读、不落库、不扣费；对当前默认可用模型发一条极小的探针请求，返回真实 status/耗时/错误。
 * 绝不回传密钥本身，只回传「是否已配置」。
 */
export async function GET() {
  return handle(async () => {
    await requireAdminRole();

    // 每个模型：启用状态 + 是否配了 env key + 实际 baseUrl（不含密钥）。
    const models = LLM_MODELS.map((m) => {
      const { apiKey, baseUrl } = modelCredentials(m);
      return {
        key: m.key,
        label: m.label,
        tier: m.tier,
        enabled: m.enabled,
        hasKey: Boolean(apiKey),
        baseUrl,
        usable: m.enabled && Boolean(apiKey),
      };
    });

    // 选一个当前可用的默认模型做实测探针（无可用模型则跳过探针，直接报未配置）。
    const probeEntry = resolveModel(DEFAULT_MODEL_KEY);
    const { apiKey, baseUrl } = modelCredentials(probeEntry);

    let probe: {
      model: string;
      baseUrl: string;
      reachable: boolean;
      status: number | null;
      latencyMs: number;
      ok: boolean;
      detail: string;
    } = {
      model: probeEntry.key,
      baseUrl,
      reachable: false,
      status: null,
      latencyMs: 0,
      ok: false,
      detail: "",
    };

    if (!apiKey) {
      probe.detail = "未配置 API 密钥（env NEWAPI_API_KEY 为空）";
    } else {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: probeEntry.key,
            messages: [
              { role: "system", content: "只输出 JSON。" },
              { role: "user", content: '回复 {"ok":true}' },
            ],
            temperature: 0,
            max_tokens: 32,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        });
        probe.latencyMs = Date.now() - started;
        probe.reachable = true;
        probe.status = res.status;
        const text = await res.text().catch(() => "");
        if (res.ok) {
          // 网关返回 HTML（非 JSON）通常意味着 baseUrl 少了 /v1 或打到了控制台页面。
          const looksHtml = text.trimStart().toLowerCase().startsWith("<!doctype") || text.trimStart().startsWith("<");
          if (looksHtml) {
            probe.ok = false;
            probe.detail = "网关返回 HTML 而非 JSON：baseUrl 可能少了 /v1 或指向了控制台页面";
          } else {
            probe.ok = true;
            probe.detail = "连通正常，鉴权通过";
          }
        } else {
          probe.ok = false;
          probe.detail = `上游返回 ${res.status}：${text.slice(0, 200)}`;
        }
      } catch (e) {
        probe.latencyMs = Date.now() - started;
        if (e instanceof Error && e.name === "AbortError") {
          probe.detail = "探针超时（>15s）：网关不可达或响应过慢，常见于生产服务器无法访问内网地址";
        } else {
          // DNS 解析失败 / 连接被拒 / 网络不可达 —— 内网网关在外网环境的典型表现。
          probe.detail = `网络错误：${e instanceof Error ? e.message : String(e)}（若为内网地址，需部署在可访问该网关的网络内）`;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return ok({
      defaultModelKey: DEFAULT_MODEL_KEY,
      anyUsable: models.some((m) => m.usable),
      models,
      probe,
    });
  });
}
