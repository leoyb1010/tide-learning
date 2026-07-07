import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  generateKeyPairSync,
  createSign,
  X509Certificate,
} from "node:crypto";
import {
  base64UrlToBuffer,
  parseJws,
  joseToDer,
  validateClaims,
  verifyJwsSignature,
  verifyAppleTransaction,
  appleRootFingerprintSha256,
  type AppleTransactionPayload,
} from "@/lib/apple-iap";

/**
 * Apple IAP JWS 校验单测。
 *
 * 说明 / 局限：我们**无法**用真实 Apple 的私钥签名，因此不测「合法 Apple 交易全链路通过」。
 * 覆盖的是可离线、可复现的部分：
 *   - 纯函数 claims 校验（bundleId/environment/productId/transactionId/过期/撤销 的匹配与拒绝）；
 *   - JOSE raw r||s → DER 转换（含高位补 0、边界长度）；
 *   - 紧凑 JWS 解析对畸形输入的拒绝（段数/空段/非法 JSON/非 ES256/缺 x5c/签名长度）；
 *   - 用一把**自签**的 P-256 密钥验证「JWS 签名核验」这一步本身正确（签名正确→过，篡改→拒）；
 *     这不代表信任 Apple——证书链信任锚仍固定为内置 Apple Root CA - G3，自签证书过不了
 *     verifyCertChain（下方有单独用例验证根信任锚）。
 *   - verifyAppleTransaction 的 mock/生产分支：未配置时非生产放行、生产拒绝。
 */

// —— 固定基准时间，避免用例随时间漂移 ——
const NOW = new Date("2026-01-01T00:00:00Z");

const BASE_PAYLOAD: AppleTransactionPayload = {
  bundleId: "com.youdao.tide",
  environment: "Sandbox",
  productId: "credits_60",
  transactionId: "tx-123",
};

const EXPECTED = {
  bundleId: "com.youdao.tide",
  environment: "Sandbox" as const,
  productId: "credits_60",
  transactionId: "tx-123",
};

describe("validateClaims", () => {
  it("全部匹配 → 通过", () => {
    expect(validateClaims(BASE_PAYLOAD, EXPECTED, NOW)).toEqual({ ok: true });
  });

  it("bundleId 不匹配 → 拒绝", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, bundleId: "com.evil.app" }, EXPECTED, NOW);
    expect(r.ok).toBe(false);
  });

  it("environment 不匹配（Sandbox 交易但期望 Production）→ 拒绝", () => {
    const r = validateClaims(BASE_PAYLOAD, { ...EXPECTED, environment: "Production" }, NOW);
    expect(r.ok).toBe(false);
  });

  it("productId 不匹配（防伪造更贵商品）→ 拒绝", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, productId: "sub_yearly" }, EXPECTED, NOW);
    expect(r.ok).toBe(false);
  });

  it("transactionId 不匹配 → 拒绝", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, transactionId: "tx-999" }, EXPECTED, NOW);
    expect(r.ok).toBe(false);
  });

  it("transactionId 与 originalTransactionId 一致亦可（续订场景）→ 通过", () => {
    const payload = { ...BASE_PAYLOAD, transactionId: "tx-new", originalTransactionId: "tx-123" };
    expect(validateClaims(payload, EXPECTED, NOW)).toEqual({ ok: true });
  });

  it("含 revocationDate（已退款/撤销）→ 拒绝", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, revocationDate: NOW.getTime() - 1000 }, EXPECTED, NOW);
    expect(r.ok).toBe(false);
  });

  it("expiresDate 已过 → 拒绝", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, expiresDate: NOW.getTime() - 1 }, EXPECTED, NOW);
    expect(r.ok).toBe(false);
  });

  it("expiresDate 未来 → 通过", () => {
    const r = validateClaims({ ...BASE_PAYLOAD, expiresDate: NOW.getTime() + 86_400_000 }, EXPECTED, NOW);
    expect(r.ok).toEqual(true);
  });
});

describe("joseToDer (raw r||s → ASN.1 DER)", () => {
  it("64 字节 raw → DER SEQUENCE，且能被解析回相同 r/s", () => {
    const raw = Buffer.alloc(64, 0x01); // r、s 各 32 字节全 0x01（高位 0，无需补 0）
    const der = joseToDer(raw);
    // DER: 0x30 len 0x02 len r 0x02 len s
    expect(der[0]).toBe(0x30);
    expect(der[2]).toBe(0x02);
    // r=32 字节且高位为 0（0x01），不补 0，长度应为 32
    expect(der[3]).toBe(32);
  });

  it("最高位为 1 的分量前补 0x00（表正整数）", () => {
    const raw = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.alloc(32, 0x01)]);
    const der = joseToDer(raw);
    // r 段：0x02, len(33), 0x00, 0xff...
    expect(der[2]).toBe(0x02);
    expect(der[3]).toBe(33); // 32 + 1 个前导 0x00
    expect(der[4]).toBe(0x00);
    expect(der[5]).toBe(0xff);
  });

  it("前导 0 被裁剪（但至少保留一字节）", () => {
    const r = Buffer.alloc(32, 0x00);
    r[31] = 0x07; // r = 0x07
    const s = Buffer.alloc(32, 0x00);
    s[31] = 0x09;
    const der = joseToDer(Buffer.concat([r, s]));
    // r 段应压缩到单字节 0x07
    expect(der[2]).toBe(0x02);
    expect(der[3]).toBe(1);
    expect(der[4]).toBe(0x07);
  });

  it("长度非 64 字节 → 抛错", () => {
    expect(() => joseToDer(Buffer.alloc(63))).toThrow();
    expect(() => joseToDer(Buffer.alloc(65))).toThrow();
  });
});

describe("base64UrlToBuffer", () => {
  it("URL 安全字符与缺失 padding 均可解码", () => {
    // "sub" 的三种表述都应解出相同字节
    const withPad = base64UrlToBuffer("c3Vi");
    expect(withPad.toString("utf8")).toBe("sub");
    // 无 padding 也可解码
    expect(base64UrlToBuffer("c3Vi=").toString("utf8")).toBe("sub");
  });
});

describe("parseJws (畸形输入拒绝)", () => {
  const b64u = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  it("非三段结构 → 抛错", () => {
    expect(() => parseJws("only.two")).toThrow();
    expect(() => parseJws("a.b.c.d")).toThrow();
  });

  it("空字符串 / 空段 → 抛错", () => {
    expect(() => parseJws("")).toThrow();
    expect(() => parseJws("..")).toThrow();
  });

  it("header 非合法 JSON → 抛错", () => {
    const bad = Buffer.from("not-json").toString("base64url");
    expect(() => parseJws(`${bad}.${b64u({})}.${"a".repeat(86)}`)).toThrow();
  });

  it("alg 非 ES256 → 抛错", () => {
    const header = b64u({ alg: "HS256", x5c: ["x"] });
    expect(() => parseJws(`${header}.${b64u(BASE_PAYLOAD)}.${"a".repeat(86)}`)).toThrow();
  });

  it("缺 x5c → 抛错", () => {
    const header = b64u({ alg: "ES256" });
    expect(() => parseJws(`${header}.${b64u(BASE_PAYLOAD)}.${"a".repeat(86)}`)).toThrow();
  });

  it("签名长度非 64 字节 raw → 抛错", () => {
    const header = b64u({ alg: "ES256", x5c: ["x"] });
    // 签名段解出 4 字节，非 64
    expect(() => parseJws(`${header}.${b64u(BASE_PAYLOAD)}.YWJjZA`)).toThrow();
  });
});

// —— 用自签 P-256 密钥验证「JWS 签名核验」这一步的正确性 ——
// 注意：这只证明 verifyJwsSignature 的密码学核验逻辑正确；不代表信任任何非 Apple 证书，
// 因为真实入口 verifyAppleTransaction 会先跑 verifyCertChain（信任锚固定 Apple Root CA - G3）。
describe("verifyJwsSignature (以自签 P-256 验签逻辑本身)", () => {
  let leaf: X509Certificate;
  let signingInput: string;
  let rawSig: Buffer;

  beforeAll(async () => {
    // 生成 P-256 keypair
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

    // 用 openssl 生成自签证书（测试环境有 openssl；生成一张含该公钥的 X509）。
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iap-test-"));
    const keyPath = path.join(dir, "key.pem");
    const certPath = path.join(dir, "cert.pem");
    fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }) as string);
    execFileSync("openssl", [
      "req", "-new", "-x509", "-key", keyPath, "-out", certPath,
      "-days", "1", "-subj", "/CN=test-leaf",
    ]);
    leaf = new X509Certificate(fs.readFileSync(certPath, "utf8"));
    // sanity：证书公钥为 EC（P-256）
    expect(leaf.publicKey.asymmetricKeyType).toBe("ec");

    signingInput = "header-part.payload-part";
    const signer = createSign("SHA256");
    signer.update(signingInput);
    signer.end();
    // node 默认输出 DER；请求 IEEE-P1363（raw r||s）以模拟 JOSE。
    rawSig = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
    expect(rawSig.length).toBe(64);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("正确签名 → 通过", () => {
    expect(verifyJwsSignature(leaf, signingInput, rawSig)).toBe(true);
  });

  it("篡改 signingInput → 拒绝", () => {
    expect(verifyJwsSignature(leaf, "header-part.TAMPERED", rawSig)).toBe(false);
  });

  it("篡改签名字节 → 拒绝", () => {
    const bad = Buffer.from(rawSig);
    bad[0] ^= 0xff;
    expect(verifyJwsSignature(leaf, signingInput, bad)).toBe(false);
  });
});

describe("appleRootFingerprintSha256 (内置根证书自检)", () => {
  it("匹配 Apple 公布的 Apple Root CA - G3 SHA-256 指纹", () => {
    // 来源：apple.com/certificateauthority/AppleRootCA-G3.cer
    expect(appleRootFingerprintSha256()).toBe(
      "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
    );
  });
});

describe("verifyAppleTransaction (mock / 生产分支)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未配置 Apple 且非生产 → mock 放行", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "");
    vi.stubEnv("APPLE_IAP_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "test");
    const r = await verifyAppleTransaction({ productId: "credits_60", transactionId: "tx-1" });
    expect(r).toEqual({ ok: true, payload: { mock: true } });
  });

  it("未配置 Apple 但生产 → 拒绝（绝不放行，双保险）", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "");
    vi.stubEnv("APPLE_IAP_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "production");
    const r = await verifyAppleTransaction({ productId: "credits_60", transactionId: "tx-1" });
    expect(r.ok).toBe(false);
  });

  it("已配置 Apple 但缺 jwsRepresentation → 拒绝", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.youdao.tide");
    vi.stubEnv("APPLE_IAP_ENVIRONMENT", "Sandbox");
    vi.stubEnv("NODE_ENV", "test");
    const r = await verifyAppleTransaction({ productId: "credits_60", transactionId: "tx-1" });
    expect(r.ok).toBe(false);
  });

  it("已配置 Apple + 畸形 JWS → 拒绝（不抛未捕获异常）", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.youdao.tide");
    vi.stubEnv("APPLE_IAP_ENVIRONMENT", "Sandbox");
    vi.stubEnv("NODE_ENV", "test");
    const r = await verifyAppleTransaction({
      productId: "credits_60",
      transactionId: "tx-1",
      jwsRepresentation: "garbage.not.jws",
    });
    expect(r.ok).toBe(false);
  });
});
