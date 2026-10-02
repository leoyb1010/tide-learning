/** Read-only route crawl plus disposable focus visits. No external services or production data. */
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { restrictToLocalApp } from './audit-browser-network.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:3100';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
assert.equal(process.env.PRODUCT_AUDIT_ALLOW_SYNTHETIC, '1');
assert(process.env.DATABASE_URL?.startsWith('file:'));
const out = path.join(process.env.QA_OUT || 'evidence/browser-qa', 'product-20261003');
await mkdir(out, { recursive: true });
const prisma = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const report = { routes: [], journeys: [] };
const contexts = [];
let notebook;
const goal = `Synthetic audit ${Date.now()}`;
async function pages(dir) {
  const names = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== 'api') names.push(...await pages(path.join(dir, e.name)));
    else if (e.name === 'page.tsx') names.push(path.dirname(path.relative('src/app', path.join(dir, e.name))));
  }
  return names;
}
async function context(width, height, user) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  contexts.push(ctx); await restrictToLocalApp(ctx, base);
  const login = await ctx.request.post(`${base}/api/auth/login`, { data: { identifier: user === 'admin' ? 'admin' : 'dingyue', password: user === 'admin' ? 'admin123' : 'demo123' } });
  assert.equal(login.status(), 200, `synthetic ${user} login`);
  const json = await login.json(); assert.equal(json.ok, true);
  return ctx;
}
try {
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'dingyue' } });
  const course = await prisma.course.findFirstOrThrow({ where: { slug: 'ai-office-005' } });
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { courseId: course.id } });
  const note = await prisma.note.findFirst({ where: { userId: user.id, deletedAt: null } });
  const demand = await prisma.demand.findFirst();
  notebook = await prisma.notebook.create({ data: { userId: user.id, title: 'Synthetic audit notebook' } });
  const replacements = { '[id]': course.slug, '[lessonId]': lesson.id, '[demandId]': demand?.id, '[slug]': course.slug };
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const learner = await context(viewport.width, viewport.height, 'learner');
    const admin = await context(viewport.width, viewport.height, 'admin');
    for (const source of (await pages('src/app')).sort()) {
      if (source === 'checkout/mock') { report.routes.push({ source, viewport: viewport.name, status: 'not-run', reason: 'requires a separate checkout fixture; existing runtime-critical covers mock payment' }); continue; }
      let route = source === '.' ? '/' : '/' + source;
      if (route.startsWith('/notes/notebook/')) route = route.replace('[id]', notebook.id);
      else if (route.startsWith('/notes/')) route = route.replace('[id]', note?.id ?? 'missing');
      else if (route.startsWith('/u/')) route = route.replace('[id]', user.id);
      else for (const [token, value] of Object.entries(replacements)) route = route.replace(token, value ?? 'missing');
      const page = await (route.startsWith('/admin') ? admin : learner).newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(250);
      assert((response?.status() ?? 500) < 500, `${route}: server error`);
      const snapshot = await page.evaluate(() => ({
        title: document.title, headings: [...document.querySelectorAll('h1')].map(e => e.textContent),
        controls: [...document.querySelectorAll('button,a[href],input,select,textarea')].map(e => ({ tag: e.tagName, label: e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 100) || e.getAttribute('placeholder'), disabled: e.disabled ?? false, href: e.getAttribute('href') })),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      const screenshot = `${viewport.name}-${source === '.' ? 'home' : source.replaceAll('/', '-').replaceAll('[', '').replaceAll(']', '')}.png`;
      await page.screenshot({ path: path.join(out, screenshot), fullPage: false });
      report.routes.push({ source, route, viewport: viewport.name, status: 'rendered-not-all-controls-exercised', httpStatus: response.status(), finalUrl: page.url(), screenshot, errors, ...snapshot });
      await page.close();
    }
    // Real UI -> actual API -> disposable DB. Hold only the response, after POST persistence.
    const page = await learner.newPage();
    await page.goto(`${base}/courses/${course.slug}/learn/${lesson.id}`, { waitUntil: 'networkidle' });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let created;
    const createdReady = new Promise(resolve => { created = resolve; });
    let patchCount = 0;
    await page.route('**/api/focus', async route => {
      if (route.request().method() === 'PATCH') { patchCount++; return route.continue(); }
      const response = await route.fetch();
      const json = await response.json(); created(json.data.sessionId);
      await held; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '专注模式', exact: true }).click();
    const prep = page.getByRole('dialog', { name: '准备好进入专注了吗' });
    await prep.locator('input').fill(goal);
    await prep.getByRole('button', { name: '进入专注', exact: true }).click();
    const firstId = await createdReady;
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '这次专注结束' }).waitFor();
    release();
    await page.waitForFunction(() => !document.body.innerText.includes('正在生成小结'));
    for (let i = 0; i < 40; i++) {
      const saved = await prisma.focusSession.findUniqueOrThrow({ where: { id: firstId } });
      if (saved.endAt) break;
      await page.waitForTimeout(100);
    }
    assert((await prisma.focusSession.findUniqueOrThrow({ where: { id: firstId } })).endAt, 'exit before POST response left an open DB visit');
    assert.equal(patchCount, 1, 'duplicate finish requests');
    await page.screenshot({ path: path.join(out, `${viewport.name}-focus-interrupted-review.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.unroute('**/api/focus');
    await page.getByRole('button', { name: '专注模式', exact: true }).click();
    await prep.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    report.journeys.push({ viewport: viewport.name, flow: 'focus delayed create -> immediate Escape -> saved completion -> dismiss -> reopen -> Cancel', status: 'passed', patchCount });
    // R2: an older PATCH response must not clear the next visit's session or loading state.
    let releasePatch; const patchHeld = new Promise(resolve => { releasePatch = resolve; });
    let patchSaved; const patchReady = new Promise(resolve => { patchSaved = resolve; });
    let holdNextPatch = true;
    await page.route('**/api/focus', async route => {
      if (route.request().method() !== 'PATCH' || !holdNextPatch) return route.continue();
      holdNextPatch = false;
      const response = await route.fetch(); patchSaved(); await patchHeld; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '专注模式', exact: true }).click();
    await prep.getByRole('button', { name: '进入专注', exact: true }).click();
    await page.getByRole('button', { name: '退出并生成AI小结', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await patchReady;
    await page.getByRole('dialog', { name: '这次专注结束' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '专注模式', exact: true }).click();
    await prep.getByRole('button', { name: '进入专注', exact: true }).click();
    await page.getByRole('button', { name: '退出并生成AI小结', exact: true }).waitFor();
    const current = await prisma.focusSession.findFirstOrThrow({ where: { userId: user.id, goal, endAt: null }, orderBy: { createdAt: 'desc' } });
    releasePatch(); await page.waitForTimeout(250);
    assert(await page.getByRole('button', { name: '退出并生成AI小结', exact: true }).isVisible(), 'old PATCH cleared the new focus session');
    assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: current.id } })).endAt, null);
    await page.screenshot({ path: path.join(out, `${viewport.name}-focus-new-visit-after-late-response.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '这次专注结束' }).waitFor();
    report.journeys.push({ viewport: viewport.name, flow: 'late finish -> dismiss -> new visit -> old response does not clear new visit', status: 'passed' });

    await page.close(); await learner.close(); await admin.close();
  }
  await writeFile(path.join(out, 'product-journeys.json'), JSON.stringify(report, null, 2));
  console.log(`Product routes: ${report.routes.length}; focus journeys: ${report.journeys.length}`);
} finally {
  await writeFile(path.join(out, 'product-journeys.partial.json'), JSON.stringify(report, null, 2));
  await browser.close();
  if (notebook) await prisma.notebook.deleteMany({ where: { id: notebook.id } });
  await prisma.focusSession.deleteMany({ where: { goal } });
  await prisma.$disconnect();
}
