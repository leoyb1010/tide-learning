// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import React,{act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import NotesClient,{type NoteRow} from '@/app/notes/NotesClient';
const {toastMock}=vi.hoisted(()=>({toastMock:vi.fn()}));
vi.mock('@/components/motion',()=>({TidalReveal:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/Toast',()=>({useToast:()=>({toast:toastMock})}));
vi.mock('@/lib/analytics-client',()=>({track:vi.fn()}));
let dom:JSDOM,root:Root;
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3100',pretendToBeVisual:true});
 for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent','Node'] as const)vi.stubGlobal(name,dom.window[name]);
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 root=createRoot(document.getElementById('root')!);toastMock.mockReset();
});
afterEach(()=>{act(()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
function note(id:string):NoteRow{return{id,title:`Note ${id}`,contentMd:`Body ${id}`,excerpt:null,sourceText:null,kind:'text',source:'manual',captureUrl:null,starred:id==='B',pinned:false,timestampSec:null,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString(),notebookId:null,courseId:null,lessonId:null,course:null,lesson:null,tags:[]};}
async function render(){await act(async()=>root.render(createElement(NotesClient,{initialData:{notes:[note('A')],nextCursor:null,total:1,tags:[],loggedIn:true,renderedAt:0}})));}
const response=(data:unknown,ok=true)=>new Response(JSON.stringify(ok?{ok:true,data}:{ok:false,error:data}));
function trigger(){return document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;}
async function click(text:string){await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()===text)!.click());}
async function summarize(){await act(async()=>trigger().click());await click('AI 总结');}
it.each([['before B load',true],['before B load',false],['after B load',true],['after B load',false]] as const)('filter intent invalidates late A %s success=%s without contaminating B',async(timing,success)=>{
 let loadB!:(value:Response)=>void;const ai:((value:Response)=>void)[]=[];
 const request=vi.fn((url:string,_init?:RequestInit)=>url.startsWith('/api/notes?')?new Promise<Response>(r=>{loadB=r;}):new Promise<Response>(r=>ai.push(r)));vi.stubGlobal('fetch',request);
 await render();await summarize();await click('仅收藏');expect(trigger().disabled).toBe(true);
 if(timing==='before B load'){await act(async()=>ai[0](response(success?{summary:['Old A']}:'Old A failed',success)));expect(document.querySelector('[role="dialog"]')).toBeNull();expect(toastMock).not.toHaveBeenCalled();}
 await act(async()=>loadB(response({notes:[note('B')],nextCursor:null,total:1})));expect(document.body.textContent).toContain('Note B');expect(trigger().disabled).toBe(false);
 await summarize();expect(ai).toHaveLength(2);
 if(timing==='after B load')await act(async()=>ai[0](response(success?{summary:['Old A']}:'Old A failed',success)));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(toastMock).not.toHaveBeenCalled();expect(trigger().disabled).toBe(true);
 const bodies=request.mock.calls.filter(([url])=>url==='/api/ai/note-summary').map(([,init])=>JSON.parse(String(init?.body)));expect(bodies.map(body=>body.noteIds)).toEqual([['A'],['B']]);
 await act(async()=>ai[1](response({summary:['Current B']})));expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Current B');expect(document.body.textContent).not.toContain('Old A');
});
it('failed filter load cannot summarize the old hidden list; retry restores the new scope',async()=>{
 const request=vi.fn().mockResolvedValueOnce(response('Synthetic load failure',false)).mockResolvedValueOnce(response({notes:[note('B')],nextCursor:null,total:1}));vi.stubGlobal('fetch',request);
 await render();await click('仅收藏');expect(document.body.textContent).toContain('笔记加载失败');expect(trigger().disabled).toBe(true);
 await click('重试');expect(document.body.textContent).toContain('Note B');expect(trigger().disabled).toBe(false);
});
it('saving a completed AI result preserves its confirmation while the note list refreshes',async()=>{
 const request=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/ai/note-summary')return response({summary:['Saved result']});
  if(url==='/api/notes'&&init?.method==='POST')return response({id:'saved-ai'});
  if(url.startsWith('/api/notes?'))return response({notes:[note('saved-ai'),note('A')],nextCursor:null,total:2});
  return response({tags:[]});
 });vi.stubGlobal('fetch',request);await render();await summarize();await click('存为笔记');
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Saved result');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已保存');
 expect(document.body.textContent).toContain('Note saved-ai');expect(request.mock.calls.filter(([url,init])=>url==='/api/notes'&&init?.method==='POST')).toHaveLength(1);
});
