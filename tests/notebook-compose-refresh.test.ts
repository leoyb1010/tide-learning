// @vitest-environment jsdom
// Real NotebookDetailPage server tree is reconciled from empty to nonempty.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import React,{act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
const mocks=vi.hoisted(()=>({notes:vi.fn(),refresh:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{notebook:{findFirst:async()=>({id:'book',title:'Synthetic notebook'})},note:{findMany:mocks.notes}}}));
vi.mock('@/lib/session',()=>({getCurrentUser:async()=>({id:'owner'})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh}),redirect:vi.fn(),notFound:vi.fn()}));
vi.mock('@/components/motion',()=>({TidalReveal:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/NotebookAiTidy',()=>({default:()=>null}));
vi.mock('@/components/SmartBackLink',()=>({SmartBackLink:()=>null}));
vi.mock('@/components/ExportMenu',()=>({ExportMenu:()=>null}));
vi.mock('@/components/Toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/lib/analytics-client',()=>({track:vi.fn()}));
import NotebookDetailPage from '@/app/notes/notebook/[id]/page';
let dom:JSDOM,root:Root;
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3100',pretendToBeVisual:true});
 for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent'] as const)vi.stubGlobal(name,dom.window[name]);
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 root=createRoot(document.getElementById('root')!);vi.clearAllMocks();mocks.notes.mockResolvedValue([]);
});
afterEach(()=>{act(()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
async function renderPage(){const tree=await NotebookDetailPage({params:Promise.resolve({id:'book'})});await act(async()=>root.render(tree));}
async function fill(text:string){const el=document.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
function buttons(){return [...document.querySelectorAll('button')].filter(x=>x.textContent?.includes('在此笔记本记一条'));}
it('empty-state trigger can disappear after A persists without unmounting replacement draft B',async()=>{
 let deliver!:(value:Response)=>void;const pending=new Promise<Response>(r=>{deliver=r;});let writes=0;
 vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>{
  if(url==='/api/notes'&&init?.method==='POST'){writes++;return writes===1?pending:Promise.resolve(new Response(JSON.stringify({ok:true,data:{id:'B'}})));}
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:{notebooks:[],tags:[],courses:[]}})));
 }));
 await renderPage();expect(buttons()).toHaveLength(2);
 await act(async()=>{buttons()[1].focus();buttons()[1].click();});await fill('A');
 await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存')!.click());
 act(()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await act(async()=>{buttons()[1].focus();buttons()[1].click();});await fill('B draft');
 const textarea=document.querySelector('textarea');
 mocks.refresh.mockImplementation(()=>{mocks.notes.mockResolvedValue([{id:'A',title:'Saved A',source:'manual',pinned:false,updatedAt:new Date(),courseId:null,course:null,lesson:null}]);});
 await act(async()=>deliver(new Response(JSON.stringify({ok:true,data:{id:'A'}}))));
 expect(mocks.refresh).toHaveBeenCalledTimes(1);
 await renderPage();expect(buttons()).toHaveLength(1);expect(document.body.textContent).toContain('Saved A');
 expect(document.querySelector('textarea')).toBe(textarea);expect(document.querySelector('textarea')?.value).toBe('B draft');
 await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存')!.click());
 expect(writes).toBe(2);expect(mocks.refresh).toHaveBeenCalledTimes(2);expect(document.querySelector('textarea')).toBeNull();
 await act(async()=>new Promise(r=>setTimeout(r,10)));expect(document.activeElement).toBe(buttons()[0]);
});
