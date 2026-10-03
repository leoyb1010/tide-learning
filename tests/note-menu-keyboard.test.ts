// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import React,{act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ExportMenu} from '@/components/ExportMenu';
import NotebookAiTidy from '@/components/NotebookAiTidy';
import NotesClient,{type NoteRow} from '@/app/notes/NotesClient';
const {toastMock}=vi.hoisted(()=>({toastMock:vi.fn()}));
vi.mock('@/components/motion',()=>({TidalReveal:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/Toast',()=>({useToast:()=>({toast:toastMock})}));
vi.mock('@/lib/analytics-client',()=>({track:vi.fn()}));
let dom:JSDOM,root:Root;
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><div id="root"></div><button id="outside">Outside</button>',{url:'http://localhost:3100',pretendToBeVisual:true});
 for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent','Node'] as const)vi.stubGlobal(name,dom.window[name]);
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 root=createRoot(document.getElementById('root')!);toastMock.mockReset();
});
afterEach(()=>{act(()=>root.unmount());dom.window.close();vi.useRealTimers();vi.unstubAllGlobals();});
async function key(value:string){await act(async()=>document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})));await act(async()=>new Promise(r=>setTimeout(r,10)));}
function notesView(){const note:NoteRow={id:'synthetic',title:'Fixture',contentMd:'Synthetic note',excerpt:null,sourceText:null,kind:'text',source:'manual',captureUrl:null,starred:false,pinned:false,timestampSec:null,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString(),notebookId:null,courseId:null,lessonId:null,course:null,lesson:null,tags:[]};return createElement(NotesClient,{initialData:{notes:[note],nextCursor:null,total:1,tags:[],loggedIn:true,renderedAt:0}});}
function triggerFor(name:string){return (name==='notes tidy'?[...document.querySelectorAll('#root button')].find(x=>x.textContent?.trim()==='AI 整理'):document.querySelector('#root button')) as HTMLButtonElement;}
const components=[['export',()=>createElement(ExportMenu,{scope:{kind:'single',noteId:'synthetic'}})],['notebook tidy',()=>createElement(NotebookAiTidy,{noteIds:['synthetic'],title:'Fixture'})],['notes tidy',notesView]] as const;
it.each(components)('%s menu supports arrow opening, wrap, Home/End and Escape focus return',async(name,component)=>{
 await act(async()=>root.render(component()));const trigger=triggerFor(name);trigger.focus();
 await key('ArrowDown');expect(trigger.getAttribute('aria-expanded')).toBe('true');
 let items=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];expect(items.length).toBeGreaterThan(1);expect(document.activeElement).toBe(items[0]);
 await key('ArrowUp');expect(document.activeElement).toBe(items.at(-1));
 await key('Home');expect(document.activeElement).toBe(items[0]);await key('End');expect(document.activeElement).toBe(items.at(-1));
 await key('ArrowDown');expect(document.activeElement).toBe(items[0]);
 await key('Escape');expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(trigger);
 await key('ArrowUp');items=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];expect(document.activeElement).toBe(items.at(-1));
});
it.each(components)('%s pointer outside closes without reclaiming focus',async(name,component)=>{
 await act(async()=>root.render(component()));const trigger=triggerFor(name);await act(async()=>trigger.click());
 const outside=document.getElementById('outside')!;await act(async()=>{outside.dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true}));outside.focus();});
 await act(async()=>new Promise(r=>setTimeout(r,10)));expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(outside);
});

it('notes tidy supports native click activation once and recovers after a provider error',async()=>{
 let resolve!:(value:Response)=>void;const pending=new Promise<Response>(r=>{resolve=r;});
 const fetchMock=vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{summary:['Recovered synthetic result']}})));vi.stubGlobal('fetch',fetchMock);
 await act(async()=>root.render(notesView()));await act(async()=>triggerFor('notes tidy').click());
 const item=[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()==='AI 总结')!;
 await act(async()=>{item.click();item.click();});expect(fetchMock).toHaveBeenCalledTimes(1);
 await act(async()=>resolve(new Response(JSON.stringify({ok:false,error:'Synthetic offline'}))));expect(toastMock).toHaveBeenCalledWith('Synthetic offline',{tone:'warn'});
 await act(async()=>triggerFor('notes tidy').click());await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()==='AI 总结')!.click());
 expect(fetchMock).toHaveBeenCalledTimes(2);expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Recovered synthetic result');
});
it('timed-out AI result cannot overwrite a newer retry or clear its busy ownership',async()=>{
 const replies:((value:Response)=>void)[]=[];vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>replies.push(r))));
 await act(async()=>root.render(notesView()));vi.useFakeTimers();
 async function choose(label:string){await act(async()=>triggerFor('notes tidy').click());await act(async()=>vi.advanceTimersByTimeAsync(10));await act(async()=>{const item=[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()===label)!;item.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true,cancelable:true}));item.click();});}
 await choose('AI 总结');await act(async()=>vi.advanceTimersByTimeAsync(15001));
 await choose('改写大纲');expect(replies).toHaveLength(2);
 await act(async()=>replies[0](new Response(JSON.stringify({ok:true,data:{summary:['Old A']}}))));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.body.textContent).toContain('整理中…');
 await act(async()=>replies[1](new Response(JSON.stringify({ok:true,data:{markdown:'# New B'}}))));
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New B');expect(document.body.textContent).not.toContain('Old A');
});

it('notebook action starts once, retains the selected scope and supports a legitimate retry',async()=>{
 let resolve!:(value:Response)=>void;const pending=new Promise<Response>(r=>{resolve=r;});const request=vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{markdown:'# Retry result'}})));vi.stubGlobal('fetch',request);
 await act(async()=>root.render(createElement(NotebookAiTidy,{noteIds:['note-a','note-b'],title:'Fixture'})));
 await act(async()=>triggerFor('notebook tidy').click());const item=document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
 await act(async()=>{item.click();item.click();});expect(request).toHaveBeenCalledTimes(1);expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({noteIds:['note-a','note-b'],action:'outline'});
 await act(async()=>resolve(new Response(JSON.stringify({ok:false,error:'Synthetic notebook failure'}))));expect(toastMock).toHaveBeenCalledWith('Synthetic notebook failure',{tone:'warn'});
 await act(async()=>triggerFor('notebook tidy').click());await act(async()=>document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());expect(request).toHaveBeenCalledTimes(2);expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Retry result');
});
it.each([['unmount',true],['unmount',false],['scope change',true],['scope change',false]] as const)('notebook late A after %s success=%s cannot contaminate B',async(change,success)=>{
 const replies:((value:Response)=>void)[]=[];const request=vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(()=>new Promise<Response>(r=>replies.push(r)));vi.stubGlobal('fetch',request);
 const render=(id:string)=>createElement(NotebookAiTidy,{...(change==='unmount'?{key:id}:{}),noteIds:[id],title:id});
 async function choose(){await act(async()=>triggerFor('notebook tidy').click());await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()==='改写大纲')!.click());}
 await act(async()=>root.render(render('A')));await choose();await act(async()=>root.render(render('B')));
 await choose();expect(replies).toHaveLength(2);
 await act(async()=>replies[0](new Response(JSON.stringify(success?{ok:true,data:{markdown:'# Old A'}}:{ok:false,error:'Old A failed'}))));
 expect(toastMock).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).toBeNull();expect(triggerFor('notebook tidy').disabled).toBe(true);
 await act(async()=>replies[1](new Response(JSON.stringify({ok:true,data:{markdown:'# Current B'}}))));
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Current B');expect(JSON.parse(String(request.mock.calls[1][1]?.body)).noteIds).toEqual(['B']);
});
it('menu focus commits synchronously before any scheduled animation frame',async()=>{
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 await act(async()=>root.render(createElement(ExportMenu,{scope:{kind:'all'}})));const trigger=document.querySelector('#root button') as HTMLButtonElement;trigger.focus();await act(async()=>trigger.click());
 expect(document.activeElement).toBe(document.querySelector('[role="menuitem"]'));
 await act(async()=>document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 await act(async()=>trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe([...document.querySelectorAll('[role="menuitem"]')].at(-1));
});
