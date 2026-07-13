/** 只有受控私有流或明确媒体扩展名才交给原生 <video>。 */
export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/api/stream/") || /\.(mp4|m3u8|webm)(\?|$)/i.test(url);
}
