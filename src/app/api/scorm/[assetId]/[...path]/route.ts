import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { creatorAssetDiskPath } from "@/lib/creator-assets";
import { scormSafePath } from "@/lib/import-faithful";
import { canViewCourse, hasPurchasedCourse } from "@/lib/queries";
import { verifyScormToken } from "@/lib/scorm-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
};

/** 单个包内文件解压后的上限:防「100MB zip 解出数 GB」的解压炸弹把进程 OOM(审查 H2)。 */
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

const SCORM_SHIM = `<script>(function(){if(window.API||window.API_1484_11)return;var data={};function post(k,v){try{parent.postMessage({type:'ct-scorm',key:k,value:v},'*')}catch(e){}}var api={LMSInitialize:function(){post('initialize','true');return'true'},LMSFinish:function(){post('finish','true');return'true'},LMSGetValue:function(k){return data[k]||''},LMSSetValue:function(k,v){data[k]=String(v);post(k,String(v));return'true'},LMSCommit:function(){post('commit','true');return'true'},LMSGetLastError:function(){return'0'},LMSGetErrorString:function(){return'No error'},LMSGetDiagnostic:function(){return''}};var api2004={Initialize:api.LMSInitialize,Terminate:api.LMSFinish,GetValue:api.LMSGetValue,SetValue:api.LMSSetValue,Commit:api.LMSCommit,GetLastError:api.LMSGetLastError,GetErrorString:api.LMSGetErrorString,GetDiagnostic:api.LMSGetDiagnostic};window.API=api;window.API_1484_11=api2004})();</script>`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string; path: string[] }> }) {
  const { assetId, path: rawSegments } = await params;
  // 双通道鉴权(审查 M1):首段是合法签名 token → 免 cookie 放行(权益已在发号端校验过);
  // 否则回落 cookie 会话 + 完整权益链(直接打开/旧链接仍可用)。
  let segments = rawSegments;
  let tokenAuthed = false;
  if (segments.length > 1 && verifyScormToken(assetId, segments[0])) {
    tokenAuthed = true;
    segments = segments.slice(1);
  }
  if (!tokenAuthed) {
    const user = await requireUser().catch(() => null);
    if (!user) return new NextResponse("需要登录", { status: 401 });
    const source = await prisma.importedSource.findFirst({
      where: { assetId, generatedCourseId: { not: null } },
      select: { userId: true, generatedCourseId: true },
    });
    if (!source?.generatedCourseId) return new NextResponse("资源不存在", { status: 404 });
    const course = await prisma.course.findUnique({
      where: { id: source.generatedCourseId },
      select: { id: true, authorUserId: true, visibility: true, sharedStatus: true },
    });
    if (!course) return new NextResponse("课程不存在", { status: 404 });
    const owned = await hasPurchasedCourse(course.id, user.id);
    if (!canViewCourse(course, user.id, owned)) return new NextResponse("无权访问", { status: 403 });
  }
  const asset = await prisma.asset.findFirst({ where: { id: assetId, kind: "scorm" } });
  if (!asset) return new NextResponse("资源不存在", { status: 404 });
  const filePath = scormSafePath(segments.join("/"));
  if (!filePath) return new NextResponse("路径无效", { status: 400 });
  const diskPath = creatorAssetDiskPath(asset.storagePath);
  const bytes = diskPath ? await readFile(diskPath).catch(() => null) : null;
  if (!bytes) return new NextResponse("资源文件不存在", { status: 404 });
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { return new NextResponse("SCORM 包损坏", { status: 422 }); }
  const entry = zip.file(filePath);
  if (!entry) return new NextResponse("包内文件不存在", { status: 404 });
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";
  // 逐条限量解压(审查 H2):流式累计,超 25MB 立即中止——绝不整条解到内存再检查,
  // 否则单条高压缩比条目(zip 炸弹)在检查前就把进程 OOM。
  let payload: Buffer;
  try {
    payload = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = entry.nodeStream();
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_ENTRY_BYTES) {
          stream.pause();
          reject(new Error("entry_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  } catch (e) {
    return (e as Error).message === "entry_too_large"
      ? new NextResponse("包内文件过大", { status: 413 })
      : new NextResponse("包内文件读取失败", { status: 422 });
  }
  if (mime.startsWith("text/html")) {
    const html = payload.toString("utf8");
    payload = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${SCORM_SHIM}`) : `${SCORM_SHIM}${html}`, "utf8");
  }
  return new NextResponse(new Uint8Array(payload), {
    headers: {
      "content-type": mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // sandbox 指令(审查 H1):强制文档为不透明源——即使被顶层直接打开(不经我们的 sandbox iframe),
      // 包内恶意 JS 也拿不到应用同源身份(localStorage/改写同源页面均不可及)。不给 allow-popups:
      // 创作者内容不应能弹窗导航学员到任意外站(审查 L)。
      "content-security-policy": "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
    },
  });
}
