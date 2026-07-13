import { describe, expect, it } from "vitest";
import { isPlayableVideoUrl } from "@/lib/media-url";

describe("播放器真实媒体识别", () => {
  it("把无扩展名的受控私有流交给原生 video", () => {
    expect(isPlayableVideoUrl("/api/stream/media_123?exp=1&sig=x")).toBe(true);
  });

  it("支持明确的 MP4/WebM/HLS 地址", () => {
    expect(isPlayableVideoUrl("https://cdn.example/lesson.MP4?token=x")).toBe(true);
    expect(isPlayableVideoUrl("/video/lesson.webm")).toBe(true);
    expect(isPlayableVideoUrl("/video/lesson.m3u8")).toBe(true);
  });

  it("拒绝 mock 标识、JSON 和空地址", () => {
    expect(isPlayableVideoUrl("/api/stream-mock/asset_1")).toBe(false);
    expect(isPlayableVideoUrl("/mock-assets/asset_1")).toBe(false);
    expect(isPlayableVideoUrl(null)).toBe(false);
  });
});
