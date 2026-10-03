// @vitest-environment jsdom
// Actual ComposeDialog React lifecycle, disposable DOM and synthetic provider responses.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import React,{act,createElement,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ComposeDialog} from '@/app/notes/NotesClient';
const {toastMock}=vi.hoisted(()=>({toastMock:vi.fn()}));
vi.mock('@/components/Toast',()=>({useToast:()=>({toast:toastMock})}));
vi.mock('@/lib/analytics-client',()=>({track:vi.fn()}));
let dom:JSDOM,root:Root;
let setOpen:(value:boolean)=>void;
const completed=vi.fn();
const persisted=vi.fn();
function Harness(){const [open,update]=useState(true);setOpen=update;return createElement(ComposeDialog,{open,onClose:()=>update(false),onCreated:()=>{completed();update(false);},prefillNotebookId:'fixture-notebook',onPersisted:persisted});}
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3100',pretendToBeVisual:true});
 for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent'] as const)vi.stubGlobal(name,dom.window[name]);
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 root=createRoot(document.getElementById('root')!);completed.mockReset();persisted.mockReset();toastMock.mockReset();
});
afterEach(()=>{act(()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
async function fill(text:string){
 const el=document.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
}
it('late saved note A cannot close or erase reopened note B',async()=>{
 let deliver!:(value:Response)=>void;
 const pending=new Promise<Response>(resolve=>{deliver=resolve;});
 const request=vi.fn((url:string,init?:RequestInit)=>{
  if(url==='/api/notes'&&init?.method==='POST')return pending;
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:{notebooks:[],tags:[],courses:[]}})));
 });vi.stubGlobal('fetch',request);
 await act(async()=>root.render(createElement(Harness)));
 await fill('note A');
 const save=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存')!;
 expect(save.disabled).toBe(false);
 await act(async()=>save.click());
 expect(request.mock.calls.some(([url,init])=>url==='/api/notes'&&init?.method==='POST')).toBe(true);
 act(()=>setOpen(false));act(()=>setOpen(true));await fill('note B');
 await act(async()=>deliver(new Response(JSON.stringify({ok:true,data:{id:'saved-A'}}))));
 expect(persisted).toHaveBeenCalledTimes(1);
 expect(completed).not.toHaveBeenCalled();
 expect(document.querySelector('textarea')?.value).toBe('note B');
});

it('late failed A does not contaminate B; B can still save exactly once',async()=>{
 let reject!:(error:Error)=>void;
 const pending=new Promise<Response>((_,r)=>{reject=r;});
 let writes=0;
 vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>{
  if(url==='/api/notes'&&init?.method==='POST'){
   writes++;
   return writes===1?pending:Promise.resolve(new Response(JSON.stringify({ok:true,data:{id:'saved-B'}})));
  }
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:{notebooks:[],tags:[],courses:[]}})));
 }));
 await act(async()=>root.render(createElement(Harness)));await fill('A');
 const save=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存')!;
 await act(async()=>{save.click();save.click();});expect(writes).toBe(1);
 expect(document.querySelector('fieldset')?.disabled).toBe(true);
 act(()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 act(()=>setOpen(true));await fill('B');
 await act(async()=>reject(new Error('synthetic offline')));
 expect(toastMock).not.toHaveBeenCalled();expect(persisted).not.toHaveBeenCalled();
 expect(document.querySelector('textarea')?.value).toBe('B');
 await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存')!.click());
 expect(writes).toBe(2);expect(persisted).toHaveBeenCalledTimes(1);expect(completed).toHaveBeenCalledTimes(1);
 expect(document.querySelector('textarea')).toBeNull();
});
