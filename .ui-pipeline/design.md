# Design Direction

## Chosen direction

- 保持现有 STUDIO 造课剧场视觉与交互，不做视觉重构。
- 本轮只修复同步大纲生成的等待预算、推理强度与终态错误恢复。
- 失败时继续使用现有 Toast；服务端新增机器契约，浏览器立即清理终态 requestId。

## Interaction contract

- 首次点击只发起一次供应商调用，不在未知账务状态下自动重试。
- 运行中或账务未收敛：保留 requestId，原样重放。
- 已完成冲正的超时/终态失败：`COURSE_OUTLINE_FAILED` + `preserveRequestId:false`。
- 成功：进入现有大纲检查点或后台生成剧场。

## Motion and accessibility

- 未修改动画、颜色、排版或焦点行为。
- 保持现有 reduced-motion 与表单语义。
