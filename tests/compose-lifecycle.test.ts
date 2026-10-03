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
function Harness({prefill=true}:{prefill?:boolean}){const [open,update]=useState(true);setOpen=update;return createElement(ComposeDialog,{open,onClose:()=>update(false),onCreated:()=>{completed();update(false);},prefillNotebookId:prefill?'fixture-notebook':undefined,onPersisted:persisted});}
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

async function clickNamed(text:string){await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.trim().startsWith(text))!.click());}
async function fillUrl(text:string){const el=document.querySelector<HTMLInputElement>('input[type="url"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
it.each([true,false])('late link import success=%s preserves the replacement write panel',async success=>{
 let deliver!:(value:Response)=>void;const pending=new Promise<Response>(r=>{deliver=r;});
 vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/notes/import-url'?pending:Promise.resolve(new Response(JSON.stringify({ok:true,data:{notebooks:[],tags:[],courses:[]}})))));
 await act(async()=>root.render(createElement(Harness,{prefill:false})));
 await clickNamed('链接导入');await fillUrl('https://example.com/synthetic');await clickNamed('导入');
 expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.disabled).toBe(true);
 await clickNamed('换个方式');await clickNamed('随手写');await fill('B after link');
 await act(async()=>deliver(new Response(JSON.stringify(success?{ok:true,data:{id:'import-A'}}:{ok:false,error:'old failure'}))));
 expect(document.querySelector('textarea')?.value).toBe('B after link');expect(completed).not.toHaveBeenCalled();
 expect(persisted).toHaveBeenCalledTimes(success?1:0);expect(toastMock).not.toHaveBeenCalled();
});
it('closing upload aborts the client; an already queued success refreshes data without closing B',async()=>{
 const transfers:FakeXHR[]=[];
 class FakeXHR {upload={onprogress:null};status=200;responseText='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;aborted=false;constructor(){transfers.push(this);}open(){}send(){}abort(){this.aborted=true;this.onabort?.();}}
 vi.stubGlobal('XMLHttpRequest',FakeXHR);vi.stubGlobal('FormData',dom.window.FormData);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true,data:{notebooks:[],tags:[],courses:[]}}))));
 await act(async()=>root.render(createElement(Harness,{prefill:false})));await clickNamed('附件');
 const input=document.querySelector<HTMLInputElement>('input[type="file"]')!;
 Object.defineProperty(input,'files',{value:[new dom.window.File(['synthetic text'],'fixture.txt',{type:'text/plain'})]});
 await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
 expect(transfers).toHaveLength(1);
 act(()=>setOpen(false));expect(transfers[0].aborted).toBe(true);expect(persisted).not.toHaveBeenCalled();
 act(()=>setOpen(true));await clickNamed('随手写');await fill('B after upload');
 transfers[0].responseText=JSON.stringify({ok:true,data:{noteId:'upload-A',attachment:{fileName:'fixture.txt',mimeType:'text/plain',path:'/api/notes/attachments/fixture',size:14}}});
 await act(async()=>transfers[0].onload?.());
 expect(persisted).toHaveBeenCalledTimes(1);expect(completed).not.toHaveBeenCalled();expect(toastMock).not.toHaveBeenCalled();expect(document.querySelector('textarea')?.value).toBe('B after upload');
});
