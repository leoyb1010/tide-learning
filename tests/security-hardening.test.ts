import { describe, expect, it } from "vitest";
import { isBlockedHostname, isBlockedIp } from "@/lib/network-address";
import { matchesAttachmentMagic } from "@/lib/private-upload";
import { redactSensitiveText } from "@/lib/errors";

describe("SSRF 地址边界", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "fe80::1", "febf::1", "fc00::1", "fdff::1", "ff02::1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.1.1"])("拦截 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("允许公网 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
  it("拦截 localhost 及字面私网主机", () => {
    expect(isBlockedHostname("api.localhost.")).toBe(true);
    expect(isBlockedHostname("[::1]")).toBe(true);
  });
});

describe("附件内容验证", () => {
  it("拒绝伪装 DOC/DOCX 与无效 UTF-8", () => {
    expect(matchesAttachmentMagic("application/msword", Buffer.from("not-doc"))).toBe(false);
    expect(matchesAttachmentMagic("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PK\x03\x04random"))).toBe(false);
    expect(matchesAttachmentMagic("text/plain", Buffer.from([0xff, 0xfe, 0x00]))).toBe(false);
  });
  it("接受带 OOXML 目录标识的 DOCX 和正常文本", () => {
    expect(matchesAttachmentMagic("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PK\x03\x04...[Content_Types].xml...word/document.xml"))).toBe(true);
    expect(matchesAttachmentMagic("text/markdown", Buffer.from("# 安全文本", "utf8"))).toBe(true);
  });
});

describe("内部错误日志脱敏", () => {
  it("移除 bearer、支付密钥和常见字段秘密", () => {
    const raw = "Authorization: Bearer abc.def.ghi password=hunter2 token: tok_123456 sk_live_abcdefghijkl whsec_abcdefghijk";
    const out = redactSensitiveText(raw);
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk_live");
    expect(out).not.toContain("whsec_");
  });
});
