# UI/Product Debug Brief

- Goal: 修复“生成课程”在大更新后稳定超时失败，并保持幂等、积分和失败恢复语义正确。
- Evidence: 2026-08-17 13:07:21 的 course_outline 请求在 60.044s 被 AbortController 截断；真实 gpt-5.6-sol 大纲复测耗时 64.230s（4000 tokens）/81.451s（6000 tokens）；启用 low reasoning + 3500 tokens 后为 29.020s。
- Constraints: 不重复供应商调用；超时必须退款并耐久对账；明确终态失败后清理浏览器 requestId；保持现有生成剧场 UI。
- Success: 真实生成请求成功，失败响应机器契约正确，测试/构建/浏览器网络与控制台验证通过。


## 2026-08-17 multi-role adversarial audit

- Roles: guest, free user, full subscriber, active single-track subscriber, creator/owner, admin, malicious cross-origin caller.
- Confirmed issue: `/api/auth/logout` accepted a cross-origin Cookie POST and invalidated the session (`200 -> /api/auth/me 401`).
- Fix: apply the shared `assertSameOrigin` write boundary while preserving native Bearer logout.
