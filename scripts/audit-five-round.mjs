/** Disposable full-surface regression matrix. Run against an isolated seeded CI DB only. */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { createAuditContext } from './audit-context.mjs';
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
let notebook, note, buyerActor, reviewerActor, marketFixture, previewFixture;
async function pages(dir) {
 const rows=[];
 for(const e of await readdir(dir,{withFileTypes:true})) {
  if(e.isDirectory() && e.name !== 'api') rows.push(...await pages(path.join(dir,e.name)));
  else if(e.name==='page.tsx') rows.push(path.dirname(path.relative('src/app',path.join(dir,e.name))));
 }
 return rows.sort();
}
async function snap(page, name, fullPage = true, lossless = true) {
 const variant=name.match(/^(phone|tablet|desktop)-(light|dark)-(no-preference|reduce)/)?.[0]??'other';
 await mkdir(path.join(out,variant),{recursive:true});
 const relative=path.join(variant,`${name}.${lossless?'png':'jpg'}`);
 await page.screenshot({path:path.join(out,relative),fullPage,...(lossless?{}:{type:'jpeg',quality:90})});
 return relative;
}
async function settleVisible(page) {
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.waitForFunction(()=>document.getAnimations().every(animation=>{
  if(animation.playState!=='running'||animation.effect?.getTiming().iterations===Infinity)return true;
  const target=animation.effect?.target;
  if(!(target instanceof Element))return true;
  const box=target.getBoundingClientRect();return box.bottom<0||box.top>innerHeight;
 }),undefined,{timeout:4000});
}
async function revealDocument(page) {
 const height=await page.evaluate(()=>document.documentElement.scrollHeight);
 const step=Math.max(300,Math.floor(page.viewportSize().height*.8));
 assert(height<60000,'fixture page exceeds capture bound; inspect separately');
 for(let y=0;y<height;y+=step){await page.evaluate(value=>scrollTo(0,value),y);await settleVisible(page);}
 await page.evaluate(()=>scrollTo(0,0));await settleVisible(page);
}
async function exerciseMenu(page, trigger, label) {
 await trigger.focus();await page.keyboard.press('Enter');
 const menu=page.getByRole('menu');await menu.waitFor({state:'visible'});
 const items=menu.getByRole('menuitem');const count=await items.count();assert(count>1);
 const focused=locator=>locator.evaluate(element=>element===document.activeElement);
 assert(await focused(items.first()),'menu did not focus first item after Enter');
 await page.keyboard.press('ArrowUp');assert(await focused(items.last()),'ArrowUp did not wrap');
 await page.keyboard.press('Home');assert(await focused(items.first()),'Home did not select first');
 await page.keyboard.press('End');assert(await focused(items.last()),'End did not select last');
 const focusStyle=await items.last().evaluate(element=>({visible:element.matches(':focus-visible'),outline:getComputedStyle(element).outlineStyle,width:getComputedStyle(element).outlineWidth}));
 assert(focusStyle.visible&&focusStyle.outline!=='none'&&focusStyle.width!=='0px','keyboard focus not visibly indicated');
 await snap(page,label+'-keyboard-focus',false);
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await focused(trigger),'Escape did not return focus');
 await page.keyboard.press('Space');await menu.waitFor({state:'visible'});assert(await focused(items.first()));
 await page.keyboard.press('Tab');await menu.waitFor({state:'hidden'});
 assert(!(await focused(trigger)),'Tab was trapped at trigger');assert(await page.evaluate(()=>document.activeElement!==document.body),'Tab lost focus');
 await trigger.focus();await page.keyboard.press('ArrowUp');await menu.waitFor({state:'visible'});assert(await focused(items.last()));
 await page.keyboard.press('Shift+Tab');await menu.waitFor({state:'hidden'});assert(!(await focused(trigger)),'Shift+Tab was trapped at trigger');
 return {items:count,focusStyle};
}
async function check(name, task) {
 try {await task();report.journeys.push({name,status:'passed'});} catch(e) {report.failures.push({name,error:e.message});report.journeys.push({name,status:'failed'});}
}
// Positive readiness markers for every routed surface, beyond shell/HTTP success.
const readyHeadings = {
 '.':'今天想学点什么？','desk':'今天想学点什么？','admin':'数据看板',
 'admin/billing':'费用对账','admin/content-calendar':'内容排期','admin/courses':'课程管理',
 'admin/credits':'积分管理','admin/demands':'需求审核','admin/errors':'500 错误日志',
 'admin/gen-quality':'生成质量看板','admin/leads':'建联队列（预约试听 · 电联转化）',
 'admin/moderation':'内容审核台','admin/orders':'订单与订阅','admin/permissions':'权限矩阵管理',
 'admin/redemption-codes':'兑换码管理','admin/users':'用户管理','courses':'课程库',
 'create':'一句话，生成你的专属课','demands':'你想学的课，投票决定','demands/new':'提交学习需求',
 'login':'登录','market':'课程集市','me/courses':'我的课','me/creator':'创作者中心',
 'me/earnings':'我的收益','me/history':'学习记录','me/subscription':'订阅管理',
 'notes':'笔记馆','privacy':'隐私政策','review':'今日复习概览','terms':'用户服务协议','updates':'本周上新',
 'pricing':'一次订阅，AI 帮你把想学的都造成课','checkout/mock':'一次订阅，AI 帮你把想学的都造成课'
};
async function assertReady(page,source,fixtures) {
 let heading=readyHeadings[source];let level=1;
 if(source.startsWith('me/settings')) {
  const section=source.split('/')[2]||'profile';
  heading={profile:'证件信息',account:'账号安全',help:'帮助',preferences:'偏好',privacy:'隐私与数据',subscription:'订阅与积分'}[section];level=2;
 } else if(source==='me'){heading='学习进度';level=2;}
 else if(source==='courses/[id]')heading=fixtures.course.title;
 else if(source==='courses/[id]/learn/[lessonId]')heading=fixtures.lesson.title;
 else if(source==='courses/[id]/preview'||source==='market/[slug]')heading=fixtures.previewFixture.title;
 else if(source==='demands/[demandId]')heading=fixtures.demand.title;
 else if(source==='u/[id]')heading=fixtures.learner.nickname;
 else if(source==='notes/[id]')heading=fixtures.note.title;
 else if(source==='notes/notebook/[id]')heading=fixtures.notebook.title;
 assert(heading,`missing positive ready assertion: ${source}`);
 await page.getByRole('heading',{name:heading,exact:true,level}).waitFor({state:'visible'});
 return {heading,level};
}
async function login(options,user) {
 const ctx=await createAuditContext(browser,options,base);
 ctx.setDefaultTimeout(15_000);ctx.setDefaultNavigationTimeout(20_000);
 if(user && typeof user==='object') {
  await ctx.addCookies([{name:'tide_session',value:user.token,url:base,httpOnly:true,sameSite:'Strict'}]);
 } else if(user) {
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
 previewFixture=await prisma.course.findFirstOrThrow({where:{title:'课件双协议 E2E 临时课程',slug:{startsWith:'e2e-courseware-'}},include:{lessons:{orderBy:{sortOrder:'asc'},take:1}}});
 const source=previewFixture.lessons[0];
 assert(source?.htmlJson&&source.renderSourceHash,'embed fixture must provide actual current HTML');
 if(round==='1') {
  // Calibration only: retain the exact stack from the upstream instrumentation
  // error. Actual product contexts below still require zero pageerrors.
  const original=await browser.newContext({serviceWorkers:'block'});await restrictToLocalApp(original,base);
  const probe=await original.newPage();const errors=[];probe.on('pageerror',error=>errors.push({name:error.name,message:error.message,stack:error.stack}));
  await probe.goto(`${base}/courses/${previewFixture.slug}/preview`,{waitUntil:'networkidle'});
  await probe.getByRole('tab',{name:'翻页',exact:true}).waitFor({state:'visible'});
  assert(errors.some(error=>error.name==='SecurityError'&&error.message.includes('serviceWorker')),'upstream sandbox instrumentation calibration changed; reassess guard');
  report.harnessCalibration={source:'playwright-core/lib/server/browserContext.js serviceWorkers=block init script',errors};await original.close();
 }

 marketFixture=await prisma.course.create({data:{slug:`synthetic-market-${Date.now()}`,title:previewFixture.title,category:previewFixture.category,level:previewFixture.level,status:'published',visibility:'public',origin:'user_created',authorUserId:learner.id,sharedStatus:'shared',genStatus:'ready',designJson:previewFixture.designJson,priceCredits:0,lessons:{create:{title:source.title,summary:source.summary,sortOrder:source.sortOrder,contentType:source.contentType,isFree:true,status:'published',blocksJson:source.blocksJson,htmlJson:source.htmlJson,renderSourceHash:source.renderSourceHash,renderEngine:source.renderEngine,designJson:source.designJson}}}});
 const marketCourse=marketFixture;
 const buyer=await prisma.user.create({data:{email:`buyer-${Date.now()}@example.test`,nickname:'Synthetic Buyer',profile:{create:{}}}});
 const token=randomBytes(32).toString('hex');
 await prisma.session.create({data:{id:createHash('sha256').update(token).digest('hex'),userId:buyer.id,expiresAt:new Date(Date.now()+3600_000)}});
 buyerActor={id:buyer.id,token};
 const reviewer=await prisma.user.create({data:{email:`reviewer-${Date.now()}@example.test`,nickname:'Synthetic Reviewer',role:'reviewer'}});
 const reviewToken=randomBytes(32).toString('hex');
 await prisma.session.create({data:{id:createHash('sha256').update(reviewToken).digest('hex'),userId:reviewer.id,expiresAt:new Date(Date.now()+3600_000)}});
 reviewerActor={id:reviewer.id,token:reviewToken};
 const pageNotes=Array.from({length:61},(_,i)=>({id:`audit-${round}-${Date.now()}-${String(i).padStart(3,'0')}`,userId:buyer.id,title:`Synthetic note ${i+1}`,contentMd:`Synthetic pagination ${i+1}`,kind:'text',source:'manual',updatedAt:new Date('2026-01-01T00:00:00Z')}));
 await prisma.note.createMany({data:pageNotes});
 notebook=await prisma.notebook.create({data:{userId:learner.id,title:stamp}});
 note=await prisma.note.create({data:{userId:learner.id,notebookId:notebook.id,title:stamp,contentMd:'Synthetic baseline note',kind:'text'}});
 const sourcePages=await pages('src/app');
 for(const viewport of [{name:'phone',width:390,height:844},{name:'tablet',width:820,height:1180},{name:'desktop',width:1440,height:1000}]) {
  for(const colorScheme of ['light','dark']) for(const reducedMotion of ['no-preference','reduce']) {
   const variant=`${viewport.name}-${colorScheme}-${reducedMotion}`;
   console.log(`Starting full matrix variant ${variant}`);
   const opts={viewport:{width:viewport.width,height:viewport.height},colorScheme,reducedMotion};
   const user=await login(opts,'dingyue'),admin=await login(opts,'admin'),guest=await login(opts,null),buyer=await login(opts,buyerActor);
   for(const source of sourcePages) {
    let route=source==='.'?'/':'/'+source;
    let expected;
    if(route==='/checkout/mock') {expected='/pricing';}
    if(route==='/me/settings') {expected='/me/settings/profile';}
    if(route.startsWith('/notes/notebook/')) route=route.replace('[id]',notebook.id);
    else if(route.startsWith('/notes/')) route=route.replace('[id]',note.id);
    else if(route.startsWith('/u/')) route=route.replace('[id]',learner.id);
    else route=route.replace('[id]',course.slug).replace('[slug]',marketCourse.slug).replace('[lessonId]',lesson.id).replace('[demandId]',demand?.id??'missing-fixture');
    if(source==='courses/[id]/preview') route=`/courses/${previewFixture.slug}/preview`;
    const ctx=route.startsWith('/admin')?admin:route==='/login'||source==='courses/[id]/preview'?guest:route.startsWith('/market/')?buyer:user;
    const page=await ctx.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||e.message));
    const row={source,route,variant,expected:expected??route,status:'failed'};
    try {
     assert(!route.includes('missing-fixture'),'demand fixture missing');
     const response=await page.goto(base+route,{waitUntil:'networkidle'});
     await settleVisible(page);
     assert.equal(response.status(),200,'expected a rendered page, not error response');
     const actual=new URL(page.url()).pathname;
     const allowed=source==='.'?['/','/desk']:[expected??route];
     assert(allowed.includes(actual),`unexpected redirect ${actual}`);
     const content=await page.locator('body').innerText();
     assert(!/This page could not be found|Application error|页面不存在|找不到该笔记/.test(content),'wrong or missing-resource screen');
     assert(content.length>30,'empty page');
     row.ready=await assertReady(page,source,{course,lesson,previewFixture,demand,learner,note,notebook});
     if(source==='courses/[id]/preview') {
      await page.getByRole('tab',{name:'翻页',exact:true}).waitFor({state:'visible'});
      assert((await page.frameLocator('iframe[title="AI 课件"]').locator('h1,.lead,.q,.body').first().innerText()).trim());
     }
     await revealDocument(page);
     if(source==='.'||source==='desk'||source==='courses') {
      row.contrast=await page.locator('[data-testid="course-trial"], [data-ui="badge"][data-tone="success"]').evaluateAll(nodes=>nodes.map(node=>{
       const style=getComputedStyle(node);
       const rgb=value=>{const values=value.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3)throw new Error(`Unrecognized computed color ${value}`);return values;};
       const foreground=rgb(style.color),background=rgb(style.backgroundColor);
       const luminance=color=>color.slice(0,3).map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
       const a=luminance(foreground),b=luminance(background);
       return {kind:node.matches('[data-testid="course-trial"]')?'trial':'success',label:node.textContent.trim(),foreground:style.color,background:style.backgroundColor,opaque:background.length===3||background[3]===1,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      }));
      assert(row.contrast.some(sample=>sample.kind==='trial')&&row.contrast.some(sample=>sample.kind==='success'),'contrast fixture lacks trial or success labels');
      for(const sample of row.contrast){assert(sample.opaque,'contrast measurement requires an opaque matched surface');assert(sample.ratio>=4.5,`course label contrast ${sample.ratio}: ${sample.label}`);}
     }

     row.layout=await page.evaluate(()=>({theme:document.documentElement.dataset.theme??"system",systemDark:matchMedia("(prefers-color-scheme: dark)").matches,reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,surface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,height:document.documentElement.scrollHeight,heading:[...document.querySelectorAll('h1')].map(e=>e.textContent),unnamedButtons:[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length}));
     row.unnamedButtonDetails=await page.getByRole('button',{name:'',exact:true}).evaluateAll(nodes=>nodes.map(node=>({html:node.outerHTML.slice(0,1000),box:{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}})));
     row.unnamedButtons=row.unnamedButtonDetails.length;
     if(source==='.'||source==='desk') row.sections=await page.locator('main section, main [data-reveal], main > div > div').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,classes:node.className,box:{top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height},opacity:getComputedStyle(node).opacity,visibility:getComputedStyle(node).visibility})));
     row.screenshot=await snap(page,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}`,true,false);
     await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
     await settleVisible(page);
     row.bottomScroll=await page.evaluate(()=>({y:scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight}));
     row.bottomScreenshot=await snap(page,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}-bottom`,false,false);
     await page.keyboard.press('Tab');
     row.keyboard=await page.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label')||document.activeElement.textContent?.trim().slice(0,80)}));
     assert.equal(row.layout.systemDark,colorScheme==='dark');
     assert((colorScheme==='dark'?['#191d25']:['#fff','#ffffff']).includes(row.layout.surface.trim()),'effective theme surface differs from requested variant');
     assert.equal(row.layout.reducedMotion,reducedMotion==='reduce');

     assert.equal(row.unnamedButtons,0,'visible button has no accessible name');
     assert(row.layout.overflow<=2,`horizontal overflow ${row.layout.overflow}px`);
     assert.equal(errors.length,0,`unexpected browser errors: ${errors.join('; ')}`);
     row.status='render-pass-interactions-separate';
    }catch(e){row.error=e.message;row.failureScreenshot=await snap(page,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}-failure`,false).catch(()=>null);report.failures.push({name:variant+':'+route,error:e.message});}
    row.errors=errors;report.routes.push(row);assert.equal(ctx.serviceWorkers().length,0,'audit context unexpectedly has a service worker');await page.close();
   }
   const probe=await guest.newPage();
   await probe.goto(base+'/login',{waitUntil:'networkidle'});
   const registration=await probe.evaluate(async()=>{try{await navigator.serviceWorker.register('/synthetic-audit-sw.js');return 'registered';}catch(error){return error.name;}});
   assert.equal(registration,'NotAllowedError');assert.equal(guest.serviceWorkers().length,0);await probe.close();
   const page=await user.newPage();
   await page.addInitScript(()=>{
    window.__captureTrace=[];const ids=new WeakMap();let next=0;
    const id=node=>{if(!ids.has(node))ids.set(node,++next);return ids.get(node);};
    window.__captureSnapshot=label=>({label,at:performance.now(),fields:[...document.querySelectorAll('input,textarea')].map(n=>({id:id(n),tag:n.tagName,type:n.type,placeholder:n.placeholder,length:n.value.length,connected:n.isConnected})),events:window.__captureTrace.slice()});
    addEventListener('tide:capture-audit',event=>window.__captureTrace.push({at:performance.now(),wallTime:Date.now(),...event.detail}));
    addEventListener('input',event=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)window.__captureTrace.push({at:performance.now(),wallTime:Date.now(),phase:'input',domId:id(event.target),length:event.target.value.length});},true);
   });
   page.on('pageerror',e=>report.failures.push({name:variant+':interactive-browser-error',error:e.message}));
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
   for(const initialState of ['nonempty','empty']) await check(variant+':'+initialState+' notebook persisted A late response cannot dismiss draft B',async()=>{
    const targetBook=initialState==='empty'?await prisma.notebook.create({data:{userId:learner.id,title:stamp+' empty '+variant}}):notebook;
    await page.goto(`${base}/notes/notebook/${targetBook.id}`,{waitUntil:'networkidle'});
    const titleA=stamp+' '+variant+' '+initialState+' A',titleB=stamp+' '+variant+' '+initialState+' B';
    let release;const held=new Promise(resolve=>{release=resolve;});
    let saved;const persisted=new Promise(resolve=>{saved=resolve;});
    let hold=true;
    await page.route('**/api/notes',async route=>{
     if(route.request().method()!=='POST'||!hold)return route.continue();
     hold=false;const response=await route.fetch();const json=await response.json();saved(json.data.id);await held;await route.fulfill({response});
    });
    try{
     await page.getByRole('button',{name:'在此笔记本记一条',exact:true}).last().click();
     await page.getByPlaceholder('标题（可留空）').fill(titleA);
     await page.getByPlaceholder('随手写点什么…支持 Markdown').fill('Synthetic A');
     await page.getByRole('button',{name:'保存',exact:true}).click();
     const idA=await Promise.race([persisted,new Promise((_,reject)=>setTimeout(()=>reject(new Error('note POST did not persist in 15s')),15000))]);
     assert.equal((await prisma.note.findUniqueOrThrow({where:{id:idA}})).title,titleA);
     await page.keyboard.press('Escape');
     await page.getByRole('dialog').waitFor({state:'hidden'});
     await page.getByRole('button',{name:'在此笔记本记一条',exact:true}).last().click();
     await page.getByPlaceholder('标题（可留空）').fill(titleB);
     await page.getByPlaceholder('随手写点什么…支持 Markdown').fill('Synthetic B');
     report.journeys.push({name:variant+':'+initialState+':releasing A without an input-settlement barrier',hostTime:Date.now()});
     const completion=page.waitForResponse(r=>r.url().endsWith('/api/notes')&&r.request().method()==='POST');
     release();await completion;
     report.journeys.push({name:variant+':'+initialState+':after A response',diagnostic:await page.evaluate(()=>window.__captureSnapshot('after-A-response'))});
     await page.getByRole('link').filter({hasText:titleA}).waitFor();
     report.journeys.push({name:variant+':'+initialState+':after A list refresh',diagnostic:await page.evaluate(()=>window.__captureSnapshot('after-A-list-refresh'))});
     await snap(page,variant+'-'+initialState+'-A-list-refresh-before-B-assert');
     assert(await page.getByRole('dialog').isVisible());
     assert.equal(await page.getByPlaceholder('随手写点什么…支持 Markdown').inputValue(),'Synthetic B');
     await snap(page,variant+'-'+initialState+'-late-A-preserved-B');
     await page.getByRole('button',{name:'保存',exact:true}).click();
     await page.getByRole('dialog').waitFor({state:'hidden'});
     await page.reload({waitUntil:'networkidle'});
     assert.equal(await prisma.note.count({where:{userId:learner.id,title:{in:[titleA,titleB]}}}),2);
     assert((await page.locator('body').innerText()).includes(titleA));
     assert((await page.locator('body').innerText()).includes(titleB));
    }finally{release();await page.unroute('**/api/notes');if(initialState==='empty'){await prisma.note.deleteMany({where:{notebookId:targetBook.id}});await prisma.notebook.delete({where:{id:targetBook.id}});}}
   });
   await check(variant+':note export and AI menus keyboard navigation and real export',async()=>{
    await page.goto(`${base}/notes/${note.id}`,{waitUntil:'networkidle'});
    await exerciseMenu(page,page.getByRole('button',{name:'导出',exact:true}),variant+'-export');
    const exported=await user.request.get(`${base}/api/notes/export?format=md&noteId=${note.id}`);
    assert.equal(exported.status(),200);assert((await exported.text()).includes(`Retry ${round} ${variant}`));
    await page.goto(`${base}/notes/notebook/${notebook.id}`,{waitUntil:'networkidle'});
    await exerciseMenu(page,page.getByRole('button',{name:'AI 整理本笔记本',exact:true}),variant+'-notebook-tidy');
    await page.goto(`${base}/notes`,{waitUntil:'networkidle'});
    await exerciseMenu(page,page.getByRole('button',{name:'AI 整理',exact:true}).first(),variant+'-notes-tidy');
   });
   await check(variant+':keyboard AI error retry synthetic result saved as actual note',async()=>{
    await page.goto(`${base}/notes`,{waitUntil:'networkidle'});
    let calls=0;const resultText=`Synthetic summary ${round} ${variant}`;
    await page.route('**/api/ai/note-summary',route=>{
     calls++;const body=route.request().postDataJSON();assert(body.noteIds?.length>0);assert.equal(body.mode,'summary');
     return route.fulfill({status:calls===1?503:200,contentType:'application/json',body:JSON.stringify(calls===1?{ok:false,error:'Synthetic AI unavailable'}:{ok:true,data:{summary:[resultText]}})});
    });
    try{
     const trigger=page.getByRole('button',{name:'AI 整理',exact:true}).first();
     await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'AI 总结',exact:true}).focus();await page.keyboard.press('Enter');
     await page.getByText('Synthetic AI unavailable',{exact:true}).waitFor();assert.equal(calls,1);
     await trigger.focus();await page.keyboard.press('Space');await page.getByRole('menuitem',{name:'AI 总结',exact:true}).focus();await page.keyboard.press('Space');
     const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});assert((await dialog.innerText()).includes(resultText));assert.equal(calls,2);
     await snap(page,variant+'-keyboard-ai-result',false);
     const before=await prisma.note.count({where:{userId:learner.id,source:'ai_transform',contentMd:{contains:resultText}}});assert.equal(before,0);
     await dialog.getByRole('button',{name:'存为笔记',exact:true}).click();
     await dialog.getByRole('button',{name:'已保存',exact:true}).waitFor();
     assert.equal(await prisma.note.count({where:{userId:learner.id,source:'ai_transform',contentMd:{contains:resultText}}}),1);
     await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
     assert(await trigger.evaluate(element=>element===document.activeElement),'AI result dismissal did not restore its trigger focus');
     await page.reload({waitUntil:'networkidle'});
     assert((await page.locator('body').innerText()).includes('AI整理·当前笔记'));
    }finally{await page.unroute('**/api/ai/note-summary');}
   });
   await check(variant+':author manual course create retry edit cancel and persisted courseware',async()=>{
    const creator=await buyer.newPage();const errors=[];creator.on('pageerror',e=>errors.push(e.message));let createdCourse;
    const title=`Synthetic manual ${round} ${variant}`,body=`Synthetic lesson content ${round} ${variant}`;
    try{
     await creator.goto(base+'/create',{waitUntil:'networkidle'});await creator.getByRole('button',{name:'空白建课',exact:true}).click();
     const titleInput=creator.getByPlaceholder('比如：我的产品设计方法课');await titleInput.fill(title);
     await creator.route('**/api/courses',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic course retry'})}):route.continue());
     await creator.getByRole('button',{name:'创建空白课程',exact:true}).click();await creator.getByText('Synthetic course retry',{exact:true}).waitFor();assert.equal(await titleInput.inputValue(),title);
     assert.equal(await prisma.course.count({where:{authorUserId:buyerActor.id,title}}),0);await creator.unroute('**/api/courses');
     const created=creator.waitForResponse(r=>r.url().endsWith('/api/courses')&&r.request().method()==='POST');await creator.getByRole('button',{name:'创建空白课程',exact:true}).click();
     const response=await created;assert.equal(response.status(),200);createdCourse=(await response.json()).data.course;
     await creator.getByText(`《${title}》已建立`,{exact:true}).waitFor();await creator.getByRole('button',{name:'编辑',exact:true}).first().waitFor();
     assert.equal(await prisma.course.count({where:{authorUserId:buyerActor.id,title}}),1);
     const first=await prisma.lesson.findFirstOrThrow({where:{courseId:createdCourse.id},orderBy:{sortOrder:'asc'}});
     await creator.getByRole('button',{name:'编辑',exact:true}).first().click();const dialog=creator.getByRole('dialog');
     await dialog.getByRole('button',{name:'插入块',exact:true}).click();await dialog.getByPlaceholder('正文',{exact:true}).fill(body);
     await creator.route(`**/api/lessons/${first.id}/blocks`,route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic block retry'})}):route.continue());
     await dialog.getByRole('button',{name:'保存并重排课件',exact:true}).click();await creator.getByText('Synthetic block retry',{exact:true}).waitFor();assert.equal(await dialog.getByPlaceholder('正文',{exact:true}).inputValue(),body);
     await creator.unroute(`**/api/lessons/${first.id}/blocks`);await dialog.getByRole('button',{name:'保存并重排课件',exact:true}).click();await dialog.waitFor({state:'hidden'});
     const saved=await prisma.lesson.findUniqueOrThrow({where:{id:first.id}});assert(saved.blocksJson.includes(body));assert(saved.htmlJson&&saved.renderSourceHash,'deterministic courseware was not produced');
     await creator.goto(`${base}/create?manual=${createdCourse.id}`,{waitUntil:'networkidle'});await creator.getByRole('button',{name:'编辑',exact:true}).first().click();assert.equal(await dialog.getByPlaceholder('正文',{exact:true}).inputValue(),body);
     await dialog.getByPlaceholder('正文',{exact:true}).fill('Cancelled synthetic change');await dialog.getByRole('button',{name:'取消',exact:true}).click();
     assert((await prisma.lesson.findUniqueOrThrow({where:{id:first.id}})).blocksJson.includes(body));
     await snap(creator,variant+'-author-manual-course');assert.equal(errors.length,0,errors.join('; '));
    }finally{await creator.close();if(createdCourse)await prisma.course.deleteMany({where:{id:createdCourse.id,authorUserId:buyerActor.id}});}
   });
   await check(variant+':buyer SSR 61 notes Load more has no gaps or duplicates',async()=>{
    const list=await buyer.newPage();
    try{
     await list.goto(base+'/notes',{waitUntil:'networkidle'});
     let loads=0;
     while(await list.getByRole('button',{name:'加载更多',exact:true}).count()){
      assert(loads++<3,'Load more did not converge for the 61-note fixture');
      await list.getByRole('button',{name:'加载更多',exact:true}).click();
      await list.getByRole('button',{name:'加载中…',exact:true}).waitFor({state:'hidden'});
     }
     const actual=await list.locator('a[href^="/notes/audit-"]').evaluateAll(links=>links.map(a=>a.getAttribute('href').split('/').pop()));
     assert.equal(actual.length,61);assert.equal(new Set(actual).size,61);
     assert.deepEqual([...actual].sort(),pageNotes.map(n=>n.id).sort());
     await snap(list,variant+'-61-notes-complete');
    }finally{await list.close();}
   });
   await check(variant+':reviewer actual approval retry keeps author and buyer state consistent',async()=>{
    const ctx=await login(opts,reviewerActor);const review=await ctx.newPage();
    const errors=[];review.on('pageerror',e=>errors.push(e.message));
    try{
     await prisma.course.update({where:{id:marketFixture.id},data:{sharedStatus:'pending'}});
     await review.goto(base+'/admin/moderation',{waitUntil:'networkidle'});assert.equal(new URL(review.url()).pathname,'/admin/moderation');
     const card=review.getByRole('article').filter({hasText:marketFixture.title});await card.waitFor({state:'visible'});
     await card.getByRole('button',{name:'拒绝',exact:true}).click();await card.getByPlaceholder('填写或从下方模板选择理由，将通知作者').fill('Cancelled synthetic reason');await card.getByRole('button',{name:'取消',exact:true}).click();
     assert.equal((await prisma.course.findUniqueOrThrow({where:{id:marketFixture.id}})).sharedStatus,'pending');
     await review.route('**/api/admin/moderation/course',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic review retry'})}));
     await card.getByRole('button',{name:'批准上架',exact:true}).click();await review.getByText('Synthetic review retry',{exact:true}).waitFor();assert(await card.isVisible());
     await review.unroute('**/api/admin/moderation/course');const before=await prisma.auditLog.count({where:{operatorId:reviewerActor.id,targetId:marketFixture.id}});
     await card.getByRole('button',{name:'批准上架',exact:true}).click();await card.waitFor({state:'hidden'});
     assert.equal((await prisma.course.findUniqueOrThrow({where:{id:marketFixture.id}})).sharedStatus,'shared');
     assert.equal(await prisma.auditLog.count({where:{operatorId:reviewerActor.id,targetId:marketFixture.id}}),before+1);
     const repeated=await ctx.request.post(base+'/api/admin/moderation/course',{data:{courseId:marketFixture.id,action:'approve'}});assert.equal(repeated.status(),409);
     assert.equal(await prisma.auditLog.count({where:{operatorId:reviewerActor.id,targetId:marketFixture.id}}),before+1);
     await review.reload({waitUntil:'networkidle'});assert.equal(await review.getByRole('article').filter({hasText:marketFixture.title}).count(),0);
     await snap(review,variant+'-reviewer-approval');assert.equal(errors.length,0,errors.join('; '));
    }finally{await prisma.course.update({where:{id:marketFixture.id},data:{sharedStatus:'shared'}});await ctx.close();}
   });
   await check(variant+':free buyer collect repeat hide and restore preserves ownership',async()=>{
    const request=method=>buyer.request.fetch(base+'/api/market/collect',{method,headers:{origin:new URL(base).origin},data:{courseId:marketFixture.id}});
    for(let i=0;i<2;i++){const response=await request('POST');assert.equal(response.status(),200);assert.equal((await response.json()).data.status,'collected');}
    assert.equal(await prisma.coursePurchase.count({where:{userId:buyerActor.id,courseId:marketFixture.id}}),1);
    const hidden=await request('DELETE');assert.equal(hidden.status(),200);
    assert.equal(await prisma.coursePurchase.count({where:{userId:buyerActor.id,courseId:marketFixture.id}}),1);
    const restored=await request('POST');assert.equal(restored.status(),200);
    assert.equal(await prisma.coursePurchase.count({where:{userId:buyerActor.id,courseId:marketFixture.id}}),1);
    assert(await prisma.learningProgress.count({where:{userId:buyerActor.id,courseId:marketFixture.id}})>0);
   });
   await page.close();await user.close();await admin.close();await guest.close();await buyer.close();
   console.log(`Completed full matrix variant ${variant}; routes ${report.routes.length}; failures ${report.failures.length}`);
  }
 }
}finally {
 await writeFile(path.join(out,'matrix.json'),JSON.stringify(report,null,2));
 await browser.close();
 if(notebook) await prisma.note.deleteMany({where:{notebookId:notebook.id}});
 if(notebook) await prisma.notebook.deleteMany({where:{id:notebook.id}});
 if(marketFixture) await prisma.course.deleteMany({where:{id:marketFixture.id,slug:marketFixture.slug}});
 if(previewFixture) await prisma.course.deleteMany({where:{id:previewFixture.id,slug:previewFixture.slug}});
 if(reviewerActor) await prisma.user.deleteMany({where:{id:reviewerActor.id}});
 if(buyerActor) await prisma.user.deleteMany({where:{id:buyerActor.id}});
 await prisma.$disconnect();
}
console.log(JSON.stringify({round,routes:report.routes.length,journeys:report.journeys.length,failures:report.failures},null,2));
assert.equal(report.failures.length,0,'five-round matrix has unresolved findings');
