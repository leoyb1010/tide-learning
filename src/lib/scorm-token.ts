import { timingSafeEqual } from "node:crypto";
import { createStreamSignature } from "@/lib/private-media";

/** 签名路径段有效期:2 小时,覆盖一次学习会话;过期后重开课节会重新取号。 */
export const SCORM_TOKEN_TTL_MS = 2 * 60 * 60_000;

/**
 * SCORM 播放签名段 `st.<exp>.<hex64>`(2026-07-21 审查 M1/P0 修复)。
 * 背景:课件 iframe 是 sandbox 不透明源,包内 css/js/img 的相对请求带不上 SameSite=strict 会话
 * cookie(必 401,多文件包整体白屏)。改用「签名放在路径段」——相对引用解析时天然继承该段,
 * 免 cookie 即可鉴权;权益校验在发号端(/api/scorm/:assetId/token)做,
 * 签名用 `scorm:` 前缀与视频流签名域隔离(同 STREAM_SIGNING_SECRET,不同消息空间)。
 */
export function mintScormToken(assetId: string, now = Date.now()): string {
  const exp = now + SCORM_TOKEN_TTL_MS;
  return `st.${exp}.${createStreamSignature(`scorm:${assetId}`, exp)}`;
}

export function verifyScormToken(assetId: string, token: string, now = Date.now()): boolean {
  const m = /^st\.(\d+)\.([a-f0-9]{64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp <= now || exp - now > SCORM_TOKEN_TTL_MS + 5_000) return false;
  try {
    const expected = Buffer.from(createStreamSignature(`scorm:${assetId}`, exp), "hex");
    const actual = Buffer.from(m[2], "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
