import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PRIVATE_MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), ".data", "media");
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

const ASSET_ID_RE = /^media_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PrivateMediaMetadata {
  assetId: string;
  fileName: string;
  mimeType: "video/mp4" | "video/webm";
  size: number;
  sha256: string;
  createdAt: string;
}

function pathsFor(assetId: string) {
  if (!ASSET_ID_RE.test(assetId)) return null;
  return {
    data: path.join(PRIVATE_MEDIA_DIR, `${assetId}.bin`),
    metadata: path.join(PRIVATE_MEDIA_DIR, `${assetId}.json`),
  };
}

export function detectVideoMime(header: Uint8Array): PrivateMediaMetadata["mimeType"] | null {
  if (header.length >= 12 && Buffer.from(header.subarray(4, 8)).toString("ascii") === "ftyp") return "video/mp4";
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) return "video/webm";
  return null;
}

function cleanFileName(name: string): string {
  const cleaned = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  return (cleaned || "video").slice(0, 180);
}

export async function storePrivateMedia(file: File): Promise<PrivateMediaMetadata> {
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) throw new Error("视频大小必须在 1B 到 500MB 之间");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mimeType = detectVideoMime(header);
  if (!mimeType) throw new Error("仅支持真实 MP4/WebM 视频（不仅检查扩展名）");

  await mkdir(PRIVATE_MEDIA_DIR, { recursive: true, mode: 0o700 });
  const assetId = `media_${randomUUID()}`;
  const target = pathsFor(assetId)!;
  const tempData = `${target.data}.${process.pid}.tmp`;
  const tempMetadata = `${target.metadata}.${process.pid}.tmp`;
  const hash = createHash("sha256");
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_MEDIA_BYTES) return callback(new Error("视频超过 500MB 上限"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.from(file.stream() as unknown as AsyncIterable<Uint8Array>),
      counter,
      createWriteStream(tempData, { flags: "wx", mode: 0o600 }),
    );
    if (size !== file.size) throw new Error("视频传输长度与声明不一致");
    await rename(tempData, target.data);
    const metadata: PrivateMediaMetadata = {
      assetId,
      fileName: cleanFileName(file.name),
      mimeType,
      size,
      sha256: hash.digest("hex"),
      createdAt: new Date().toISOString(),
    };
    await writeFile(tempMetadata, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
    await rename(tempMetadata, target.metadata);
    return metadata;
  } catch (error) {
    await Promise.all([unlink(tempData).catch(() => {}), unlink(tempMetadata).catch(() => {}), unlink(target.data).catch(() => {})]);
    throw error;
  }
}

/** 将仓库内不对外暴露的种子视频安装到运行时私有目录，供 seed 幂等调用。 */
export async function installPrivateMediaFromPath(params: {
  sourcePath: string;
  assetId: string;
  fileName?: string;
}): Promise<PrivateMediaMetadata> {
  const target = pathsFor(params.assetId);
  if (!target) throw new Error("种子视频 assetId 格式无效");
  const source = await readFile(params.sourcePath);
  if (source.length <= 0 || source.length > MAX_MEDIA_BYTES) throw new Error("种子视频大小越界");
  const mimeType = detectVideoMime(source.subarray(0, 16));
  if (!mimeType) throw new Error("种子视频不是有效 MP4/WebM");
  const metadata: PrivateMediaMetadata = {
    assetId: params.assetId,
    fileName: cleanFileName(params.fileName ?? path.basename(params.sourcePath)),
    mimeType,
    size: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  await mkdir(PRIVATE_MEDIA_DIR, { recursive: true, mode: 0o700 });
  const suffix = `${process.pid}.tmp`;
  const tempData = `${target.data}.${suffix}`;
  const tempMetadata = `${target.metadata}.${suffix}`;
  try {
    await copyFile(params.sourcePath, tempData);
    await writeFile(tempMetadata, JSON.stringify(metadata), { mode: 0o600 });
    await rename(tempData, target.data);
    await rename(tempMetadata, target.metadata);
    return metadata;
  } catch (error) {
    await Promise.all([unlink(tempData).catch(() => {}), unlink(tempMetadata).catch(() => {})]);
    throw error;
  }
}

export async function readPrivateMedia(assetId: string): Promise<{ metadata: PrivateMediaMetadata; dataPath: string } | null> {
  const target = pathsFor(assetId);
  if (!target) return null;
  try {
    const metadata = JSON.parse(await readFile(target.metadata, "utf8")) as PrivateMediaMetadata;
    if (
      metadata.assetId !== assetId ||
      !["video/mp4", "video/webm"].includes(metadata.mimeType) ||
      !Number.isSafeInteger(metadata.size) || metadata.size <= 0 ||
      !/^[a-f0-9]{64}$/i.test(metadata.sha256)
    ) return null;
    const fileStat = await lstat(target.data);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== metadata.size) return null;
    return { metadata, dataPath: target.data };
  } catch {
    return null;
  }
}

export interface ByteRange { start: number; end: number }

export function parseByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || !value.startsWith("bytes=") || value.includes(",")) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return "invalid";
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function streamSigningSecret(): string {
  const secret = process.env.STREAM_SIGNING_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("STREAM_SIGNING_SECRET 未配置");
  return "development-only-stream-secret";
}

export function createStreamSignature(assetId: string, expiresAt: number): string {
  return createHmac("sha256", streamSigningSecret()).update(`${assetId}.${expiresAt}`).digest("hex");
}

export function verifyStreamSignature(assetId: string, expiresAt: number, signature: string | null, now = Date.now()): boolean {
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 10 * 60_000 + 5_000) return false;
  try {
    const expected = Buffer.from(createStreamSignature(assetId, expiresAt), "hex");
    const actual = Buffer.from(signature, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function privateMediaStream(dataPath: string, range: ByteRange | null): ReadableStream<Uint8Array> {
  const stream = range
    ? createReadStream(dataPath, { start: range.start, end: range.end })
    : createReadStream(dataPath);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
