/** Disposable full-surface regression matrix. Run against an isolated seeded CI DB only. */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
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
let notebook, note, buyerActor, marketFixture, previewFixture;
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
 const ctx=await browser.newContext({...options, serviceWorkers:'block'});
 ctx.setDefaultTimeout(15_000);ctx.setDefaultNavigationTimeout(20_000);
 await restrictToLocalApp(ctx,base);
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
 marketFixture=await prisma.course.create({data:{slug:`synthetic-market-${Date.now()}`,title:previewFixture.title,category:previewFixture.category,level:previewFixture.level,status:'published',visibility:'public',origin:'user_created',authorUserId:learner.id,sharedStatus:'shared',genStatus:'ready',designJson:previewFixture.designJson,priceCredits:0,lessons:{create:{title:source.title,summary:source.summary,sortOrder:source.sortOrder,contentType:source.contentType,isFree:true,status:'published',blocksJson:source.blocksJson,htmlJson:source.htmlJson,renderSourceHash:source.renderSourceHash,renderEngine:source.renderEngine,designJson:source.designJson}}}});
 const marketCourse=marketFixture;
 const buyer=await prisma.user.create({data:{email:`buyer-${Date.now()}@example.test`,nickname:'Synthetic Buyer',profile:{create:{}}}});
 const token=randomBytes(32).toString('hex');
 await prisma.session.create({data:{id:createHash('sha256').update(token).digest('hex'),userId:buyer.id,expiresAt:new Date(Date.now()+3600_000)}});
 buyerActor={id:buyer.id,token};
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
    page.on('pageerror',e=>errors.push(e.message));
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
     row.layout=await page.evaluate(()=>({theme:document.documentElement.dataset.theme??"system",systemDark:matchMedia("(prefers-color-scheme: dark)").matches,reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,surface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,height:document.documentElement.scrollHeight,heading:[...document.querySelectorAll('h1')].map(e=>e.textContent),unnamedButtons:[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length}));
     row.unnamedButtons=await page.getByRole('button',{name:'',exact:true}).count();
     assert.equal(row.unnamedButtons,0,'visible button has no accessible name');
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

     assert(row.layout.overflow<=2,`horizontal overflow ${row.layout.overflow}px`);
     assert.equal(errors.length,0,`unexpected browser errors: ${errors.join('; ')}`);
     row.status='render-pass-interactions-separate';
    }catch(e){row.error=e.message;row.failureScreenshot=await snap(page,`${variant}-${source==='.'?'home':source.replaceAll('/','-').replaceAll('[','').replaceAll(']','')}-failure`,false).catch(()=>null);report.failures.push({name:variant+':'+route,error:e.message});}
    row.errors=errors;report.routes.push(row);await page.close();
   }
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
 if(buyerActor) await prisma.user.deleteMany({where:{id:buyerActor.id}});
 await prisma.$disconnect();
}
console.log(JSON.stringify({round,routes:report.routes.length,journeys:report.journeys.length,failures:report.failures},null,2));
assert.equal(report.failures.length,0,'five-round matrix has unresolved findings');
