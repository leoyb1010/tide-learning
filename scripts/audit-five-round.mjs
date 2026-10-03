/** Disposable full-surface regression matrix. Run against an isolated seeded CI DB only. */
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
const round = process.env.AUDIT_ROUND || '1';
const out = path.join(process.env.QA_OUT || 'evidence/five-round', `round-${round}`);
await mkdir(out, {recursive:true});
const prisma = new PrismaClient();
const browser = await chromium.launch({headless:true});
const report = {round, routes:[], journeys:[], failures:[], limits:['Synthetic seeded fixtures only; no live payment, LLM, OAuth, APNs or production data','Native app screens are not exercised by this browser matrix']};
const stamp = `Five-round-${round}-${Date.now()}`;
let notebook, note;
async function pages(dir) {
 const rows=[];
 for(const e of await readdir(dir,{withFileTypes:true})) {
  if(e.isDirectory() && e.name !== 'api') rows.push(...await pages(path.join(dir,e.name)));
  else if(e.name==='page.tsx') rows.push(path.dirname(path.relative('src/app',path.join(dir,e.name))));
 }
 return rows.sort();
}
async function snap(page, name) {await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});}
async function check(name, task) {
 try {await task();report.journeys.push({name,status:'passed'});} catch(e) {report.failures.push({name,error:e.message});report.journeys.push({name,status:'failed'});}
}
async function login(options,user) {
 const ctx=await browser.newContext({...options, serviceWorkers:'block'});
 await restrictToLocalApp(ctx,base);
 if(user) {
  const r=await ctx.request.post(base+'/api/auth/login',{data:{identifier:user,password:user==='admin'?'admin123':'demo123'}});
  assert.equal(r.status(),200);assert.equal((await r.json()).ok,true);
 }
 return ctx;
}
try {
 const learner=await prisma.user.findUniqueOrThrow({where:{username:'dingyue'}});
 const course=await prisma.course.findFirstOrThrow({where:{slug:'ai-office-005'}});
 const lesson=await prisma.lesson.findFirstOrThrow({where:{courseId:course.id}});
 const demand=await prisma.demand.findFirst();
 notebook=await prisma.notebook.create({data:{userId:learner.id,title:stamp}});
 note=await prisma.note.create({data:{userId:learner.id,notebookId:notebook.id,title:stamp,contentMd:'Synthetic baseline note',kind:'text'}});
 const sourcePages=await pages('src/app');
 for(const viewport of [{name:'phone',width:390,height:844},{name:'tablet',width:820,height:1180},{name:'desktop',width:1440,height:1000}]) {
  for(const colorScheme of ['light','dark']) for(const reducedMotion of ['no-preference','reduce']) {
   const variant=`${viewport.name}-${colorScheme}-${reducedMotion}`;
   const opts={viewport:{width:viewport.width,height:viewport.height},colorScheme,reducedMotion};
   const user=await login(opts,'dingyue'),admin=await login(opts,'admin'),guest=await login(opts,null);
   for(const source of sourcePages) {
    let route=source==='.'?'/':'/'+source;
    let expected;
    if(route==='/checkout/mock') {expected='/pricing';}
    if(route.startsWith('/notes/notebook/')) route=route.replace('[id]',notebook.id);
    else if(route.startsWith('/notes/')) route=route.replace('[id]',note.id);
    else if(route.startsWith('/u/')) route=route.replace('[id]',learner.id);
    else route=route.replace('[id]',course.slug).replace('[slug]',course.slug).replace('[lessonId]',lesson.id).replace('[demandId]',demand?.id??'missing-fixture');
    const ctx=route.startsWith('/admin')?admin:route==='/login'?guest:user;
    const page=await ctx.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const row={source,route,variant,expected:expected??route,status:'failed'};
    try {
     assert(!route.includes('missing-fixture'),'demand fixture missing');
     const response=await page.goto(base+route,{waitUntil:'networkidle'});
     await page.waitForTimeout(350);
     assert.equal(response.status(),200,'expected a rendered page, not error response');
     const actual=new URL(page.url()).pathname;
     const allowed=source==='.'?['/','/desk']:[expected??route];
     assert(allowed.includes(actual),`unexpected redirect ${actual}`);
     const content=await page.locator('body').innerText();
     assert(!/This page could not be found|Application error|页面不存在|找不到该笔记/.test(content),'wrong or missing-resource screen');
     assert(content.length>30,'empty page');
     row.layout=await page.evaluate(()=>({theme:document.documentElement.dataset.theme??"system",systemDark:matchMedia("(prefers-color-scheme: dark)").matches,reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,surface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,height:document.documentElement.scrollHeight,heading:[...document.querySelectorAll('h1')].map(e=>e.textContent),unnamedButtons:[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length}));
     await snap(page,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}`);
     await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
     await page.keyboard.press('Tab');
     row.keyboard=await page.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label')||document.activeElement.textContent?.trim().slice(0,80)}));
     assert.equal(row.layout.systemDark,colorScheme==='dark');
     assert.equal(row.layout.reducedMotion,reducedMotion==='reduce');
     await page.screenshot({path:path.join(out,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}-bottom.png`),fullPage:false});
     assert(row.layout.overflow<=2,`horizontal overflow ${row.layout.overflow}px`);
     assert.equal(errors.length,0,`unexpected browser errors: ${errors.join('; ')}`);
     row.status='render-pass-interactions-separate';
    }catch(e){row.error=e.message;report.failures.push({name:variant+':'+route,error:e.message});}
    row.errors=errors;report.routes.push(row);await page.close();
   }
   const page=await user.newPage();
   await check(variant+':note edit cancel save reload persistence',async()=>{
    await page.goto(`${base}/notes/${note.id}`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await page.getByPlaceholder('标题（可留空）').fill(stamp+' cancelled');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert(!(await page.locator('body').innerText()).includes(stamp+' cancelled'));
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await page.getByPlaceholder('用 Markdown 记录你的想法…').fill(`Round ${round} ${variant}`);
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByRole('button',{name:'编辑',exact:true}).waitFor();
    await page.reload({waitUntil:'networkidle'});
    assert((await page.locator('body').innerText()).includes(`Round ${round} ${variant}`));
    assert.equal((await prisma.note.findUniqueOrThrow({where:{id:note.id}})).contentMd,`Round ${round} ${variant}`);
    await snap(page,variant+'-note-saved');
   });
   await check(variant+':note failed save preserves draft then retry',async()=>{
    await page.goto(`${base}/notes/${note.id}`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    const text=`Retry ${round} ${variant}`;
    await page.getByPlaceholder('用 Markdown 记录你的想法…').fill(text);
    await page.route(`**/api/notes/${note.id}`,route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic offline'})}):route.continue());
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByText('Synthetic offline',{exact:true}).waitFor();
    assert.equal(await page.getByPlaceholder('用 Markdown 记录你的想法…').inputValue(),text);
    await snap(page,variant+'-note-retry');
    await page.unroute(`**/api/notes/${note.id}`);
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByRole('button',{name:'编辑',exact:true}).waitFor();
    assert.equal((await prisma.note.findUniqueOrThrow({where:{id:note.id}})).contentMd,text);
   });
   await check(variant+':persisted A late response cannot dismiss draft B',async()=>{
    await page.goto(`${base}/notes/notebook/${notebook.id}`,{waitUntil:'networkidle'});
    const titleA=stamp+' '+variant+' A',titleB=stamp+' '+variant+' B';
    let release;const held=new Promise(resolve=>{release=resolve;});
    let saved;const persisted=new Promise(resolve=>{saved=resolve;});
    let hold=true;
    await page.route('**/api/notes',async route=>{
     if(route.request().method()!=='POST'||!hold)return route.continue();
     hold=false;const response=await route.fetch();const json=await response.json();saved(json.data.id);await held;await route.fulfill({response});
    });
    try{
     await page.getByRole('button',{name:'在此笔记本记一条',exact:true}).click();
     await page.getByPlaceholder('标题（可留空）').fill(titleA);
     await page.getByPlaceholder('随手写点什么…支持 Markdown').fill('Synthetic A');
     await page.getByRole('button',{name:'保存',exact:true}).click();
     const idA=await persisted;
     assert.equal((await prisma.note.findUniqueOrThrow({where:{id:idA}})).title,titleA);
     await page.keyboard.press('Escape');
     await page.getByRole('dialog').waitFor({state:'hidden'});
     await page.getByRole('button',{name:'在此笔记本记一条',exact:true}).click();
     await page.getByPlaceholder('标题（可留空）').fill(titleB);
     await page.getByPlaceholder('随手写点什么…支持 Markdown').fill('Synthetic B');
     const completion=page.waitForResponse(r=>r.url().endsWith('/api/notes')&&r.request().method()==='POST');
     release();await completion;
     await page.getByRole('link').filter({hasText:titleA}).waitFor();
     assert(await page.getByRole('dialog').isVisible());
     assert.equal(await page.getByPlaceholder('随手写点什么…支持 Markdown').inputValue(),'Synthetic B');
     await snap(page,variant+'-late-A-preserved-B');
     await page.getByRole('button',{name:'保存',exact:true}).click();
     await page.getByRole('dialog').waitFor({state:'hidden'});
     await page.reload({waitUntil:'networkidle'});
     assert.equal(await prisma.note.count({where:{userId:learner.id,title:{in:[titleA,titleB]}}}),2);
     assert((await page.locator('body').innerText()).includes(titleA));
     assert((await page.locator('body').innerText()).includes(titleB));
    }finally{release();await page.unroute('**/api/notes');}
   });
   await page.close();await user.close();await admin.close();await guest.close();
  }
 }
}finally {
 await writeFile(path.join(out,'matrix.json'),JSON.stringify(report,null,2));
 await browser.close();
 if(notebook) await prisma.note.deleteMany({where:{notebookId:notebook.id}});
 if(notebook) await prisma.notebook.deleteMany({where:{id:notebook.id}});
 await prisma.$disconnect();
}
console.log(JSON.stringify({round,routes:report.routes.length,journeys:report.journeys.length,failures:report.failures},null,2));
assert.equal(report.failures.length,0,'five-round matrix has unresolved findings');
