import { createHash, createVerify, X509Certificate } from "node:crypto";

/**
 * Apple App Store Server API — JWS 交易签名离线校验。
 *
 * StoreKit 2 / App Store Server API 下，苹果把每笔交易封装成一个 JWS（JWT，
 * 头部带 x5c 证书链），字段名可能是 signedTransactionInfo / jwsRepresentation。
 * 本模块**离线**校验该 JWS：不依赖任何外部 npm 依赖（对齐 payment-provider.ts 的
 * 零重依赖、只用 node:crypto 的风格），全部用 node:crypto 完成：
 *   - X509Certificate：解析 x5c、验证证书链（verify(issuerPublicKey)）与有效期；
 *   - createVerify("SHA256") / ES256：用叶证书公钥核验 JWS 签名（P-256）；
 *   - 处理 JOSE 的 raw r||s 签名 → DER 转换，喂给 node:crypto 的 ECDSA verify。
 *
 * 安全要点：
 *   1. 证书链必须**根到 Apple Root CA - G3**（下方硬编码 PEM，公开根证书）；
 *   2. bundleId / environment / productId / transactionId 全部与预期严格一致；
 *   3. 过期 / 撤销的交易一律拒绝。
 * 任一环节失败 → 返回 { ok:false, reason }，由路由统一转成对客户端的模糊错误
 * （不泄漏内部原因），reason 仅供服务端日志排查。
 */

// —— Apple Root CA - G3（公开根证书）——
// 来源：https://www.apple.com/certificateauthority/AppleRootCA-G3.cer（DER→PEM）
// SHA-256 指纹：63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
// App Store Server API 的 JWS x5c 证书链根即此证书；离线校验时以它作信任锚。
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

// P-256（prime256v1）ECDSA 签名分量长度：r、s 各 32 字节。
const P256_COMPONENT_LEN = 32;

// —— 标记 OID（DER TLV，用于 OID pinning，防「其他 Apple 签发证书」冒充收据签名证书）——
// 单纯「链根到 Apple Root CA - G3」不足：Apple 开发者账号可申请多种根到 G3 的 EC 证书
// （如 Apple Pay 商户处理证书），持私钥即可签出任意 claims 的「合法」JWS。真正的收据/交易
// 签名证书由 Apple CA 额外植入下列标记 OID，攻击者无法自行给别的 Apple 证书添加（需 Apple CA 重签）。
// 故校验叶证书含「App Store 收据签名」OID、中间证书含「WWDR」OID，即可区分真正的交易签名链。
// OID 值（base-128）复用同一前缀 1.2.840.113635.100.6（Apple: 2A 86 48 86 F7 63 64 06）。
/** 叶证书标记：1.2.840.113635.100.6.11.1（App Store 收据/交易签名）。DER: 06 0A <value>。 */
export const RECEIPT_SIGNING_OID_TLV = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01]);
/** 中间证书标记：1.2.840.113635.100.6.2.1（Apple WWDR CA）。DER: 06 0A <value>（10 个值字节）。 */
export const WWDR_OID_TLV = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01]);
/** Apple 交易 JWS 的 x5c 链固定为 3 段：叶（交易签名）→ 中间（WWDR）→ 根（Root CA - G3）。 */
const APPLE_JWS_CHAIN_LEN = 3;

/**
 * 证书 DER 是否包含某标记 OID 的 TLV（纯字节包含判定，导出以便单测）。
 * 证书整体由 Apple CA 签名，攻击者无法在不失效签名的前提下植入该 OID 字节，故字节包含即等价「Apple 确植入此扩展」。
 */
export function certHasOid(cert: X509Certificate, oidTlv: Buffer): boolean {
  return cert.raw.includes(oidTlv);
}

export type AppleEnvironment = "Sandbox" | "Production";

/** 解码后的交易载荷（只声明我们校验/使用到的字段；其余保留为宽松索引）。 */
export interface AppleTransactionPayload {
  bundleId?: string;
  environment?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  /** 到期时间（毫秒）——自动续订订阅字段；存在且已过期则拒绝。 */
  expiresDate?: number;
  /** 撤销时间（毫秒）——退款/家庭共享撤销后存在此字段；存在即拒绝。 */
  revocationDate?: number;
  [k: string]: unknown;
}

export interface VerifyInput {
  productId: string;
  transactionId: string;
  jwsRepresentation?: string;
  receiptData?: string;
}

export type VerifyResult =
  | { ok: true; payload: AppleTransactionPayload }
  | { ok: false; reason: string };

interface ParsedJws {
  header: { alg?: string; x5c?: string[]; [k: string]: unknown };
  payload: AppleTransactionPayload;
  /** 被签名的原文：`${headerB64}.${payloadB64}`（ASCII）。 */
  signingInput: string;
  /** JOSE raw 签名（r||s），base64url 解码后的字节。 */
  signature: Buffer;
}

// —— 纯函数工具（导出以便单测）——

/** base64url → Buffer（补齐 padding，替换 URL 安全字符）。 */
export function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

/**
 * 解析紧凑格式 JWS（header.payload.signature）。
 * 严格校验：三段结构、header 是合法 JSON、alg 为 ES256、x5c 为非空数组、payload 是合法 JSON。
 * 任一不满足即抛错（由调用方兜为 { ok:false }）。
 */
export function parseJws(jws: string): ParsedJws {
  if (typeof jws !== "string" || jws.length === 0) {
    throw new Error("空 JWS");
  }
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("JWS 结构非法：应为 header.payload.signature 三段");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("JWS 存在空段");
  }

  let header: ParsedJws["header"];
  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString("utf8"));
  } catch {
    throw new Error("JWS header 非合法 JSON");
  }
  if (header.alg !== "ES256") {
    throw new Error(`JWS alg 非 ES256：${String(header.alg)}`);
  }
  if (!Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new Error("JWS header 缺少 x5c 证书链");
  }
  if (!header.x5c.every((c) => typeof c === "string" && c.length > 0)) {
    throw new Error("JWS x5c 含非法条目");
  }

  let payload: AppleTransactionPayload;
  try {
    payload = JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new Error("JWS payload 非合法 JSON");
  }

  const signature = base64UrlToBuffer(signatureB64);
  if (signature.length !== P256_COMPONENT_LEN * 2) {
    throw new Error(`JWS 签名长度非法：期望 ${P256_COMPONENT_LEN * 2} 字节 raw r||s`);
  }

  return { header, payload, signingInput: `${headerB64}.${payloadB64}`, signature };
}

/**
 * JOSE raw 签名（r||s，各 32 字节定长）→ ASN.1 DER（ECDSA-Sig-Value）。
 * node:crypto 的 ECDSA verify 只接受 DER 编码，故需转换。
 * DER：SEQUENCE { INTEGER r, INTEGER s }，负数（高位为 1）前补 0x00。
 */
export function joseToDer(raw: Buffer): Buffer {
  if (raw.length !== P256_COMPONENT_LEN * 2) {
    throw new Error(`raw 签名长度非法：期望 ${P256_COMPONENT_LEN * 2} 字节`);
  }
  const r = raw.subarray(0, P256_COMPONENT_LEN);
  const s = raw.subarray(P256_COMPONENT_LEN);

  const encodeInt = (bytes: Buffer): Buffer => {
    // 去掉前导 0（但保留至少一字节）
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0x00) start++;
    let trimmed = bytes.subarray(start);
    // 若最高位为 1，前补 0x00 以表示正整数
    if (trimmed[0] & 0x80) {
      trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]);
    }
    return Buffer.concat([Buffer.from([0x02, trimmed.length]), trimmed]);
  };

  const rEnc = encodeInt(r);
  const sEnc = encodeInt(s);
  const body = Buffer.concat([rEnc, sEnc]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/** base64 DER 证书（x5c 单条）→ PEM 文本。 */
function x5cEntryToPem(b64Der: string): string {
  const wrapped = b64Der.match(/.{1,64}/g)?.join("\n") ?? b64Der;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

/**
 * 校验 x5c 证书链：
 *   - 链长恰为 3（叶→WWDR→Root G3），拒绝多塞/少塞证书；
 *   - 逐级验证 cert[i] 由 cert[i+1] 签发（X509Certificate.verify(issuerPublicKey)）；
 *   - 每张证书在有效期内（validFrom ≤ now ≤ validTo）；
 *   - 链尾根证书必须等于（或由）已内置的 Apple Root CA - G3 签发；
 *   - **OID pinning**：叶证书含「收据/交易签名」OID、中间证书含「WWDR」OID
 *     （防根到 G3 的其他 Apple 证书冒充交易签名证书，见常量注释）。
 * 返回叶证书（用于核验 JWS 签名）。失败抛错。
 */
export function verifyCertChain(x5c: string[], now: Date = new Date()): X509Certificate {
  // 链长硬校验：Apple 交易 JWS 的 x5c 恒为 3 段。多/少即拒（防塞入攻击者自签中间层）。
  if (x5c.length !== APPLE_JWS_CHAIN_LEN) {
    throw new Error(`证书链长度非法：期望 ${APPLE_JWS_CHAIN_LEN} 段，实际 ${x5c.length}`);
  }
  const chain = x5c.map((entry) => new X509Certificate(x5cEntryToPem(entry)));
  const appleRoot = new X509Certificate(APPLE_ROOT_CA_G3_PEM);

  // 有效期检查
  for (const cert of chain) {
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);
    if (Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) {
      throw new Error("证书有效期字段无法解析");
    }
    if (now < notBefore || now > notAfter) {
      throw new Error("证书链含已过期/尚未生效的证书");
    }
  }

  // 逐级签发校验：cert[i] 应由 cert[i+1] 签发
  for (let i = 0; i < chain.length - 1; i++) {
    const issuerKey = chain[i + 1].publicKey;
    if (!chain[i].verify(issuerKey)) {
      throw new Error(`证书链断裂：第 ${i} 级未由上一级签发`);
    }
  }

  // 信任锚：链尾必须由 Apple Root CA - G3 签发（或本身即该根证书）。
  const tail = chain[chain.length - 1];
  const tailIsAppleRoot = tail.raw.equals(appleRoot.raw);
  if (!tailIsAppleRoot && !tail.verify(appleRoot.publicKey)) {
    throw new Error("证书链未根到 Apple Root CA - G3");
  }

  // OID pinning：叶证书须为「收据/交易签名」证书，中间证书须为「WWDR CA」。
  // 仅链根到 G3 不足以证明这是交易签名链——此二 OID 才能区分（见常量注释）。
  const leaf = chain[0];
  if (!certHasOid(leaf, RECEIPT_SIGNING_OID_TLV)) {
    throw new Error("叶证书缺少 App Store 收据/交易签名 OID（非交易签名证书）");
  }
  if (!certHasOid(chain[1], WWDR_OID_TLV)) {
    throw new Error("中间证书缺少 Apple WWDR OID");
  }

  return leaf;
}

/**
 * 用叶证书公钥核验 JWS 签名（ES256 / P-256 over SHA-256）。
 * signingInput = `${headerB64}.${payloadB64}`；signature 为 JOSE raw r||s。
 */
export function verifyJwsSignature(leaf: X509Certificate, signingInput: string, rawSignature: Buffer): boolean {
  const der = joseToDer(rawSignature);
  // leaf.publicKey 已是 KeyObject（公钥），createVerify.verify 可直接接收，无需再包一层。
  const verifier = createVerify("SHA256");
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(leaf.publicKey, der);
}

/**
 * 校验解码后的交易 claims 与预期一致（纯函数，单测重点）。
 *   - bundleId === expectedBundleId
 *   - environment === expectedEnvironment（Sandbox/Production）
 *   - productId === input.productId
 *   - transactionId === input.transactionId（或与 originalTransactionId 一致）
 *   - 若含 expiresDate 且已过期 → 拒绝
 *   - 若含 revocationDate → 拒绝（已退款/撤销）
 */
export function validateClaims(
  payload: AppleTransactionPayload,
  expected: {
    bundleId: string;
    environment: AppleEnvironment;
    productId: string;
    transactionId: string;
  },
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (payload.bundleId !== expected.bundleId) {
    return { ok: false, reason: `bundleId 不匹配：${String(payload.bundleId)}` };
  }
  if (payload.environment !== expected.environment) {
    return { ok: false, reason: `environment 不匹配：${String(payload.environment)} != ${expected.environment}` };
  }
  if (payload.productId !== expected.productId) {
    return { ok: false, reason: `productId 不匹配：${String(payload.productId)} != ${expected.productId}` };
  }
  // transactionId 必须与请求一致；originalTransactionId 若存在需与 transactionId 自洽。
  const txMatches =
    payload.transactionId === expected.transactionId ||
    payload.originalTransactionId === expected.transactionId;
  if (!txMatches) {
    return { ok: false, reason: `transactionId 不匹配：${String(payload.transactionId)} != ${expected.transactionId}` };
  }
  if (typeof payload.revocationDate === "number") {
    return { ok: false, reason: "交易已撤销（revocationDate 存在）" };
  }
  if (typeof payload.expiresDate === "number" && payload.expiresDate <= now.getTime()) {
    return { ok: false, reason: "交易/订阅已过期（expiresDate 已过）" };
  }
  return { ok: true };
}

/**
 * 是否已配置 Apple 真实校验（bundleId + environment 齐全）。
 * 未配置时仅非生产可走 mock（见 verifyAppleTransaction）。
 */
export function isAppleConfigured(): boolean {
  return Boolean(process.env.APPLE_BUNDLE_ID && process.env.APPLE_IAP_ENVIRONMENT);
}

function readEnvironment(): AppleEnvironment {
  return process.env.APPLE_IAP_ENVIRONMENT === "Production" ? "Production" : "Sandbox";
}

/**
 * 主入口：真实校验 Apple 交易。
 *
 * - 未配置 Apple（缺 bundleId/environment）：
 *     · 生产 → 返回 { ok:false }（绝不放行；路由层生产闸门 APPLE_IAP_ENABLED 亦已拦截，双保险）；
 *     · 非生产 → 返回 { ok:true, payload:{ mock:true } }，本机/测试保持直发行为不变。
 * - 已配置：必须提供 jwsRepresentation（signedTransactionInfo），执行完整 JWS + 证书链 + claims 校验。
 */
export async function verifyAppleTransaction(input: VerifyInput): Promise<VerifyResult> {
  if (!isAppleConfigured()) {
    // mock 路径：仅非生产可达。生产环境即便漏配也绝不放行。
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "生产环境未配置 Apple 校验（缺 APPLE_BUNDLE_ID / APPLE_IAP_ENVIRONMENT）" };
    }
    return { ok: true, payload: { mock: true } as AppleTransactionPayload };
  }

  const jws = input.jwsRepresentation;
  if (!jws) {
    return { ok: false, reason: "缺少 jwsRepresentation（已配置 Apple 校验时必需）" };
  }

  let parsed: ParsedJws;
  try {
    parsed = parseJws(jws);
  } catch (e) {
    return { ok: false, reason: `JWS 解析失败：${(e as Error).message}` };
  }

  let leaf: X509Certificate;
  try {
    leaf = verifyCertChain(parsed.header.x5c as string[]);
  } catch (e) {
    return { ok: false, reason: `证书链校验失败：${(e as Error).message}` };
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifyJwsSignature(leaf, parsed.signingInput, parsed.signature);
  } catch (e) {
    return { ok: false, reason: `JWS 签名核验异常：${(e as Error).message}` };
  }
  if (!signatureValid) {
    return { ok: false, reason: "JWS 签名核验不通过" };
  }

  const claims = validateClaims(parsed.payload, {
    bundleId: process.env.APPLE_BUNDLE_ID as string,
    environment: readEnvironment(),
    productId: input.productId,
    transactionId: input.transactionId,
  });
  if (!claims.ok) {
    return { ok: false, reason: claims.reason };
  }

  return { ok: true, payload: parsed.payload };
}

// createHash 仅为暴露给潜在的指纹自检（当前未在主流程使用，保留以便运维核对根证书）。
export function appleRootFingerprintSha256(): string {
  const root = new X509Certificate(APPLE_ROOT_CA_G3_PEM);
  return createHash("sha256").update(root.raw).digest("hex");
}
