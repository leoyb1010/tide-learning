// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import React,{act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Dialog} from '@/components/Dialog';
let dom:JSDOM,root:Root,frames:Map<number,FrameRequestCallback>,next:number;
function render(open:boolean){return createElement(Dialog,{open,onClose:()=>{},title:'Fixture'} as React.ComponentProps<typeof Dialog>,createElement('div',null,createElement('input',{'aria-label':'Title'}),createElement('textarea',{'aria-label':'Body'})));}
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><button id="trigger">Open</button><div id="root"></div>',{url:'http://localhost:3100',pretendToBeVisual:true});
 for(const name of ['window','document','HTMLElement','Event','KeyboardEvent'] as const)vi.stubGlobal(name,dom.window[name]);
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);frames=new Map();next=0;
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 root=createRoot(document.getElementById('root')!);document.getElementById('trigger')!.focus();
});
afterEach(()=>{act(()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
function flush(){const pending=[...frames];frames.clear();act(()=>pending.forEach(([,callback])=>callback(0)));}
it('opening frame never steals focus from a user-selected textarea',async()=>{
 await act(async()=>root.render(render(true)));const body=document.querySelector('textarea')!;body.focus();flush();expect(document.activeElement).toBe(body);
});
it('close cancels the old frame before a rapid reopen',async()=>{
 await act(async()=>root.render(render(true)));expect(frames.size).toBe(1);
 await act(async()=>root.render(render(false)));expect(frames.size).toBe(0);
 await act(async()=>root.render(render(true)));expect(frames.size).toBe(1);flush();expect(document.activeElement?.getAttribute('aria-label')).toBe('Title');
});
it('without user focus, first form field still receives initial focus and Escape still closes',async()=>{
 const close=vi.fn();await act(async()=>root.render(createElement(Dialog,{open:true,onClose:()=>close(),title:'Fixture'} as React.ComponentProps<typeof Dialog>,createElement('input',{'aria-label':'Title'}))));flush();expect(document.activeElement?.getAttribute('aria-label')).toBe('Title');
 act(()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(close).toHaveBeenCalledTimes(1);
});
it('an async result dialog can return to its explicit trigger even when focus was lost during loading',async()=>{
 const target=document.getElementById('trigger')!;target.blur();expect(document.activeElement).toBe(document.body);
 const returnFocusRef={current:target};const child=createElement('input',{'aria-label':'Result'});
 const props={open:true,onClose:()=>{},title:'Async result',returnFocusRef} as React.ComponentProps<typeof Dialog>;
 await act(async()=>root.render(createElement(Dialog,props,child)));flush();
 await act(async()=>root.render(createElement(Dialog,{...props,open:false},child)));expect(document.activeElement).toBe(target);
});
