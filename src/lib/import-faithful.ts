import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { prisma } from "./db";
import { slugify } from "./format";
import { creatorLibrarySlug } from "./creator-library";
import { storeCreatorAsset } from "./creator-assets";
import { buildContract, CSP_META, injectBespokeAdapter } from "./ai/courseware-html";
import { AppError } from "./errors";

const execFileAsync = promisify(execFile);

export interface FaithfulImportResult {
  courseId: string;
  slug: string;
  title: string;
  charCount: number;
  lessons: { id: string; title: string }[];
  directReady: true;
  faithfulKind: "presentation" | "scorm";
}

interface PresentationSlide {
  title: string;
  text: string;
  html: string;
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function attr(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? xmlText(match[1]) : null;
}

function texts(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)].map((match) => xmlText(match[1]).trim()).filter(Boolean);
}

function safeHex(value: string | null, fallback: string): string {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : fallback;
}

function geometry(xml: string, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const xfrm = xml.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/i)?.[0] ?? xml;
  const off = xfrm.match(/<a:off\b[^>]*>/i)?.[0] ?? "";
  const ext = xfrm.match(/<a:ext\b[^>]*>/i)?.[0] ?? "";
  const x = Number(attr(off, "x")) || 0;
  const y = Number(attr(off, "y")) || 0;
  const cx = Number(attr(ext, "cx")) || width;
  const cy = Number(attr(ext, "cy")) || height;
  return {
    left: Math.max(0, Math.min(100, x / width * 100)),
    top: Math.max(0, Math.min(100, y / height * 100)),
    width: Math.max(0.2, Math.min(100, cx / width * 100)),
    height: Math.max(0.2, Math.min(100, cy / height * 100)),
  };
}

function relMap(xml: string, slidePath: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/>/gi)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (!id || !target || /^\w+:/.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(slidePath), target));
    if (!resolved.startsWith("ppt/") || resolved.includes("..")) continue;
    map.set(id, resolved);
  }
  return map;
}

function dataMime(filePath: string): string | null {
  const ext = path.posix.extname(filePath).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" } as Record<string, string>)[ext] ?? null;
}

/** 解压炸弹护栏(2026-07-21 审查 H2):单条媒体解压 ≤8MB、单条文本 ≤2MB、整份导入内联媒体总预算 25MB。
 * 上传门(100MB)只约束压缩后体积,高压缩比条目可解出数 GB;逐条+总量双限后,最坏内存占用有界,
 * 超限媒体跳过(该图缺位,不炸导入),超限文本按损坏文件拒绝。 */
const MAX_MEDIA_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 25 * 1024 * 1024;

/** 限量读 zip 文本条目:流式累计,超限即弃(防解压炸弹,勿用 async("text") 直读)。 */
async function zipTextCapped(entry: import("jszip").JSZipObject, cap = MAX_TEXT_ENTRY_BYTES): Promise<string | null> {
  const buf = await zipBufferCapped(entry, cap);
  return buf ? buf.toString("utf8") : null;
}

/** 限量读 zip 二进制条目:超限返回 null。 */
function zipBufferCapped(entry: import("jszip").JSZipObject, cap: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = entry.nodeStream();
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) { stream.pause(); resolve(null); return; }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(null));
  });
}

/** OOXML PPTX：按原始坐标映射文本框与图片；每张幻灯片成为一个完整课件屏。 */
export async function parsePptx(bytes: Buffer): Promise<PresentationSlide[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new AppError("该文件不是有效的 PPTX", 422); }
  const presEntry = zip.file("ppt/presentation.xml");
  const presentationXml = presEntry ? await zipTextCapped(presEntry) : null;
  if (!presentationXml) throw new AppError("PPTX 缺少 presentation.xml", 422);
  const sizeTag = presentationXml.match(/<p:sldSz\b[^>]*>/i)?.[0] ?? "";
  const slideWidth = Number(attr(sizeTag, "cx")) || 12_192_000;
  const slideHeight = Number(attr(sizeTag, "cy")) || 6_858_000;
  const numericSlideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1]) - Number(b.match(/slide(\d+)/i)?.[1]));
  // 幻灯片真实顺序以 presentation.xml 的 r:id 列表为准；文件名编号不一定随作者拖拽排序而改变。
  const presRelsEntry = zip.file("ppt/_rels/presentation.xml.rels");
  const presentationRels = relMap((presRelsEntry ? await zipTextCapped(presRelsEntry) : null) ?? "", "ppt/presentation.xml");
  const ordered = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/gi)]
    .map((match) => presentationRels.get(match[1]))
    .filter((name): name is string => Boolean(name && zip.file(name)));
  const slideNames = ordered.length === numericSlideNames.length ? ordered : numericSlideNames;
  if (slideNames.length === 0) throw new AppError("PPTX 中没有可读取的幻灯片", 422);
  if (slideNames.length > 200) throw new AppError("一次最多导入 200 张幻灯片", 422);

  const slides: PresentationSlide[] = [];
  let mediaBudget = MAX_TOTAL_MEDIA_BYTES;
  for (const [index, slidePath] of slideNames.entries()) {
    const xml = await zipTextCapped(zip.file(slidePath)!);
    if (xml === null) throw new AppError("PPTX 幻灯片内容超出大小限制", 422);
    const relPath = slidePath.replace("/slides/", "/slides/_rels/") + ".rels";
    const relEntry = zip.file(relPath);
    const relationships = relMap((relEntry ? await zipTextCapped(relEntry) : null) ?? "", slidePath);
    const bg = safeHex(xml.match(/<p:bg[\s\S]*?<a:srgbClr\b[^>]*val="([0-9a-f]{6})"/i)?.[1] ?? null, "#ffffff");
    const elements: string[] = [];
    const slideTexts: string[] = [];
    const nodes = xml.match(/<p:(?:sp|pic)\b[\s\S]*?<\/p:(?:sp|pic)>/gi) ?? [];
    for (const node of nodes) {
      const g = geometry(node, slideWidth, slideHeight);
      const style = `left:${g.left.toFixed(3)}%;top:${g.top.toFixed(3)}%;width:${g.width.toFixed(3)}%;height:${g.height.toFixed(3)}%`;
      if (/^<p:pic\b/i.test(node)) {
        const rid = node.match(/<a:blip\b[^>]*r:embed="([^"]+)"/i)?.[1];
        const mediaPath = rid ? relationships.get(rid) : null;
        const mime = mediaPath ? dataMime(mediaPath) : null;
        const media = mediaPath ? zip.file(mediaPath) : null;
        if (mime && media) {
          const mediaBytes = await zipBufferCapped(media, Math.min(MAX_MEDIA_ENTRY_BYTES, mediaBudget));
          if (mediaBytes) {
            mediaBudget -= mediaBytes.length;
            elements.push(`<img class="ppt-image" src="data:${mime};base64,${mediaBytes.toString("base64")}" alt="" style="${style}">`);
          }
          // 超限媒体跳过:该图缺位但导入不炸、内存有界(审查 H2)
        }
        continue;
      }
      const runs = texts(node);
      if (runs.length === 0) continue;
      const text = runs.join("\n");
      slideTexts.push(text);
      const fontSize = Math.max(10, Math.min(72, (Number(node.match(/<a:rPr\b[^>]*sz="(\d+)"/i)?.[1]) || Number(node.match(/<a:defRPr\b[^>]*sz="(\d+)"/i)?.[1]) || 1800) / 100));
      const color = safeHex(node.match(/<a:srgbClr\b[^>]*val="([0-9a-f]{6})"/i)?.[1] ?? null, bg.toLowerCase() === "#ffffff" ? "#111827" : "#ffffff");
      const fill = node.match(/<p:spPr[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*val="([0-9a-f]{6})"/i)?.[1];
      const bold = /<a:rPr\b[^>]*\bb="1"/i.test(node) || /<a:defRPr\b[^>]*\bb="1"/i.test(node);
      const align = node.match(/<a:pPr\b[^>]*algn="(ctr|r|l)"/i)?.[1];
      elements.push(`<div class="ppt-text" style="${style};font-size:clamp(10px,${fontSize / 16}vw,${fontSize}px);color:${color};font-weight:${bold ? 700 : 400};text-align:${align === "ctr" ? "center" : align === "r" ? "right" : "left"};${fill ? `background:${safeHex(fill, "transparent")};` : ""}">${runs.map((run) => `<div>${esc(run)}</div>`).join("")}</div>`);
    }
    const text = slideTexts.join("\n").trim();
    const title = (slideTexts[0]?.split("\n")[0] || `第 ${index + 1} 页`).slice(0, 120);
    const rawHtml = `<!doctype html><html lang="zh-CN"><head>${CSP_META}<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:${bg};font-family:system-ui,-apple-system,'PingFang SC',sans-serif}.ppt-slide{position:relative;width:100%;aspect-ratio:${slideWidth}/${slideHeight};overflow:hidden;background:${bg}}.ppt-text{position:absolute;display:flex;flex-direction:column;justify-content:center;overflow:hidden;white-space:pre-wrap;line-height:1.2;padding:.25%}.ppt-image{position:absolute;object-fit:contain} @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style></head><body><main class="ppt-slide" aria-label="${esc(title)}">${elements.join("")}</main></body></html>`;
    slides.push({ title, text, html: injectBespokeAdapter(rawHtml) });
  }
  return slides;
}

/** Keynote 在服务端先经 LibreOffice 无界面转换为 PPTX，再走同一忠实映射管线。 */
export async function parseKeynote(bytes: Buffer): Promise<PresentationSlide[]> {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") throw new AppError("该文件不是有效的 Keynote 文稿", 422);
  const dir = await mkdtemp(path.join(tmpdir(), "tide-keynote-"));
  const source = path.join(dir, "source.key");
  try {
    await writeFile(source, bytes, { mode: 0o600 });
    const executable = process.env.SOFFICE_PATH || "soffice";
    await execFileAsync(executable, ["--headless", "--convert-to", "pptx", "--outdir", dir, source], { timeout: 60_000, maxBuffer: 2_000_000 });
    const converted = path.join(dir, "source.pptx");
    const pptx = await readFile(converted).catch(() => null);
    if (!pptx) throw new AppError("当前运行环境无法转换该 Keynote 文稿，请先导出为 PPTX 后重试", 422);
    return await parsePptx(pptx);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("当前运行环境无法转换该 Keynote 文稿，请先导出为 PPTX 后重试", 422);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function createPresentationCourse(input: { userId: string; title: string; bytes: Buffer; kind: "pptx" | "key" }): Promise<FaithfulImportResult> {
  const slides = input.kind === "pptx" ? await parsePptx(input.bytes) : await parseKeynote(input.bytes);
  const rawText = slides.map((slide) => `${slide.title}\n${slide.text}`).join("\n\n").slice(0, 200_000);
  const created = await prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        slug: `${slugify(input.title)}-${Math.random().toString(36).slice(2, 7)}`, title: input.title,
        description: `忠实导入的 ${input.kind === "pptx" ? "PowerPoint" : "Keynote"} 课件，共 ${slides.length} 页`,
        category: "user_imported", level: "L1", status: "published", origin: "user_imported",
        authorUserId: input.userId, ownerId: input.userId, visibility: "private", sharedStatus: "private", genStatus: "ready",
        disclaimer: "本课程按原演示文稿版式映射；文本与图片来源于用户上传文件",
        totalDurationSec: slides.length * 60,
      },
    });
    for (const [index, slide] of slides.entries()) {
      const blocks = slide.text
        ? [{ id: `slide_${index + 1}`, type: "concept", title: slide.title, markdown: slide.text.slice(0, 4000) }]
        : [{ id: `slide_${index + 1}`, type: "concept", title: slide.title, markdown: "本页以视觉内容为主，请查看忠实映射课件。" }];
      await tx.lesson.create({
        data: {
          courseId: course.id, title: slide.title, summary: slide.text.slice(0, 300) || null, sortOrder: index,
          contentType: "ai_html", blocksJson: JSON.stringify({ version: 1, blocks }),
          htmlJson: JSON.stringify(buildContract(slide.html)), renderEngine: "faithful_import",
          durationSec: 60, isFree: index === 0, status: "published", publishedAt: new Date(),
        },
      });
    }
    await tx.importedSource.create({
      data: { userId: input.userId, kind: `file_${input.kind}`, title: input.title, rawText, charCount: rawText.length, parseStatus: "parsed", generatedCourseId: course.id },
    });
    const lessons = await tx.lesson.findMany({ where: { courseId: course.id }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } });
    return { course, lessons };
  });
  return { courseId: created.course.id, slug: created.course.slug, title: created.course.title, charCount: rawText.length, lessons: created.lessons, directReady: true, faithfulKind: "presentation" };
}

function safeScormPath(value: string): string | null {
  const decoded = (() => { try { return decodeURIComponent(value); } catch { return value; } })().replace(/^\.\//, "");
  const normalized = path.posix.normalize(decoded);
  if (!normalized || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || /^(?:[a-z]+:|\/\/)/i.test(normalized)) return null;
  return normalized;
}

function manifestItems(xml: string): { title: string; href: string }[] {
  const resources = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:\w+:)?resource\b([^>]*)>/gi)) {
    const id = attr(match[1], "identifier");
    const href = attr(match[1], "href");
    const safe = href ? safeScormPath(href) : null;
    if (id && safe) resources.set(id, safe);
  }
  const items: { title: string; href: string }[] = [];
  const itemStarts = [...xml.matchAll(/<(?:\w+:)?item\b([^>]*)>/gi)];
  for (const [index, match] of itemStarts.entries()) {
    const ref = attr(match[1], "identifierref");
    const start = (match.index ?? 0) + match[0].length;
    const end = itemStarts[index + 1]?.index ?? Math.min(xml.length, start + 2000);
    const nearby = xml.slice(start, Math.min(end, start + 2000));
    const title = xmlText(nearby.match(/<(?:\w+:)?title\b[^>]*>([\s\S]*?)<\/(?:\w+:)?title>/i)?.[1] ?? "").trim();
    const href = ref ? resources.get(ref) : null;
    if (href) items.push({ title: (title || `学习单元 ${items.length + 1}`).slice(0, 120), href });
  }
  if (items.length === 0) for (const [id, href] of resources) items.push({ title: id.slice(0, 120), href });
  return items;
}

export async function createScormCourse(input: { userId: string; title: string; bytes: Buffer; fileName: string }): Promise<FaithfulImportResult> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(input.bytes); }
  catch { throw new AppError("该文件不是有效的 SCORM 压缩包", 422); }
  const names = Object.keys(zip.files);
  if (names.length > 3000) throw new AppError("SCORM 包文件数量过多（最多 3000 个）", 422);
  if (names.some((name) => !safeScormPath(name.replace(/\/$/, "")) && !name.endsWith("/"))) throw new AppError("SCORM 包含不安全的文件路径", 422);
  const manifestName = names.find((name) => name.toLowerCase() === "imsmanifest.xml") ?? names.find((name) => name.toLowerCase().endsWith("/imsmanifest.xml"));
  if (!manifestName) throw new AppError("SCORM 包缺少 imsmanifest.xml", 422);
  const manifest = await zipTextCapped(zip.file(manifestName)!);
  if (manifest === null) throw new AppError("SCORM 清单超出大小限制", 422);
  const baseDir = path.posix.dirname(manifestName) === "." ? "" : `${path.posix.dirname(manifestName)}/`;
  const items = manifestItems(manifest).map((item) => ({ ...item, href: safeScormPath(`${baseDir}${item.href}`)! })).filter((item) => item.href && zip.file(item.href));
  if (items.length === 0) throw new AppError("SCORM 清单中没有可启动的学习单元", 422);
  if (items.length > 200) throw new AppError("一次最多导入 200 个 SCORM 学习单元", 422);
  const stored = await storeCreatorAsset(input.bytes, "zip");
  try {
    const created = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({ data: { userId: input.userId, kind: "scorm", fileName: input.fileName.slice(0, 255), mimeType: "application/zip", size: input.bytes.length, storagePath: stored.storagePath, sha256: stored.sha256 } });
      const course = await tx.course.create({
        data: {
          slug: creatorLibrarySlug(input.title), title: input.title, description: `忠实导入的 SCORM 课程，共 ${items.length} 个学习单元`,
          category: "user_imported", level: "L1", status: "published", origin: "user_imported", authorUserId: input.userId,
          ownerId: input.userId, visibility: "private", sharedStatus: "private", genStatus: "ready",
          disclaimer: "本课程保留原 SCORM 包内容，并在隔离沙箱内运行",
        },
      });
      for (const [index, item] of items.entries()) {
        await tx.lesson.create({
          data: {
            courseId: course.id, title: item.title, summary: "SCORM 忠实导入学习单元", sortOrder: index, contentType: "scorm",
            articleMd: JSON.stringify({ v: 1, assetId: asset.id, launchPath: item.href }),
            blocksJson: JSON.stringify({ version: 1, blocks: [{ id: `sco_${index + 1}`, type: "concept", title: item.title, markdown: "本节内容由原 SCORM 包提供。" }] }),
            durationSec: 0, isFree: index === 0, status: "published", publishedAt: new Date(),
          },
        });
      }
      const source = await tx.importedSource.create({ data: { userId: input.userId, kind: "file_scorm", title: input.title, rawText: items.map((item) => item.title).join("\n"), assetId: asset.id, charCount: items.reduce((sum, item) => sum + item.title.length, 0), parseStatus: "parsed", generatedCourseId: course.id } });
      void source;
      const lessons = await tx.lesson.findMany({ where: { courseId: course.id }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } });
      return { course, lessons };
    });
    return { courseId: created.course.id, slug: created.course.slug, title: created.course.title, charCount: items.reduce((sum, item) => sum + item.title.length, 0), lessons: created.lessons, directReady: true, faithfulKind: "scorm" };
  } catch (error) {
    const { unlink } = await import("node:fs/promises");
    const { creatorAssetDiskPath } = await import("./creator-assets");
    const diskPath = creatorAssetDiskPath(stored.storagePath);
    if (diskPath) await unlink(diskPath).catch(() => {});
    throw error;
  }
}

export function scormSafePath(value: string): string | null {
  return safeScormPath(value);
}
