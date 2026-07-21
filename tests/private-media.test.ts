import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, unlink } from "node:fs/promises";
import {
  createStreamSignature,
  detectVideoMime,
  parseByteRange,
  privateMediaStream,
  readPrivateMedia,
  storePrivateMedia,
  verifyStreamSignature,
} from "@/lib/private-media";

const created: string[] = [];

beforeEach(() => {
  process.env.STREAM_SIGNING_SECRET = "test-stream-signing-secret-at-least-32-characters";
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((file) => unlink(file).catch(() => {})));
});

function mp4Bytes() {
  return Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
}

describe("私有媒体文件边界", () => {
  it("按文件魔数识别 MP4/WebM，拒绝伪扩展名", () => {
    expect(detectVideoMime(mp4Bytes())).toBe("video/mp4");
    expect(detectVideoMime(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video/webm");
    expect(detectVideoMime(new TextEncoder().encode("not-a-video.mp4"))).toBeNull();
  });

  it("流式落盘后可从私有目录读取，元数据与 SHA-256 完整", async () => {
    const bytes = mp4Bytes();
    const metadata = await storePrivateMedia(new File([bytes], "../../lesson.mp4", { type: "text/plain" }));
    const stored = await readPrivateMedia(metadata.assetId);
    expect(stored).not.toBeNull();
    expect(metadata).toMatchObject({ fileName: "lesson.mp4", mimeType: "video/mp4", size: bytes.length });
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Uint8Array(await readFile(stored!.dataPath))).toEqual(bytes);
    created.push(stored!.dataPath, stored!.dataPath.replace(/\.bin$/, ".json"));

    const reader = privateMediaStream(stored!.dataPath, { start: 4, end: 7 }).getReader();
    const chunks: number[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(...value);
    }
    expect(Uint8Array.from(chunks)).toEqual(Uint8Array.from([0x66, 0x74, 0x79, 0x70]));
  });

  it("拒绝非视频内容和路径穿越 assetId", async () => {
    await expect(storePrivateMedia(new File(["hello"], "fake.mp4", { type: "video/mp4" }))).rejects.toThrow(/MP4\/WebM/);
    await expect(readPrivateMedia("../../etc/passwd")).resolves.toBeNull();
  });
});

describe("HTTP Range 解析", () => {
  it("支持完整、开放结尾、后缀和超长结尾范围", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=95-999", 100)).toEqual({ start: 95, end: 99 });
  });

  it("拒绝越界、倒序、多范围与非 bytes 请求", () => {
    for (const value of ["bytes=100-101", "bytes=9-2", "bytes=0-1,4-5", "items=0-1", "bytes=-0", "bytes=-"]) {
      expect(parseByteRange(value, 100)).toBe("invalid");
    }
  });
});

describe("短时流地址签名", () => {
  it("只放行正确 asset + exp，拒绝篡改、过期和过长有效期", () => {
    const now = 1_800_000_000_000;
    const exp = now + 60_000;
    const signature = createStreamSignature("media_test", exp);
    expect(verifyStreamSignature("media_test", exp, signature, now)).toBe(true);
    expect(verifyStreamSignature("media_other", exp, signature, now)).toBe(false);
    expect(verifyStreamSignature("media_test", now - 1, createStreamSignature("media_test", now - 1), now)).toBe(false);
    // 接受窗口 2026-07-21 起为 20min+5s(signedVideoUrl 改取 +2 窗口边界,修窗口尾部即刻过期):
    // 15 分钟在窗口内应放行,21 分钟超窗应拒绝。
    const withinWindow = now + 15 * 60_000;
    expect(verifyStreamSignature("media_test", withinWindow, createStreamSignature("media_test", withinWindow), now)).toBe(true);
    const tooLong = now + 21 * 60_000;
    expect(verifyStreamSignature("media_test", tooLong, createStreamSignature("media_test", tooLong), now)).toBe(false);
  });
});
