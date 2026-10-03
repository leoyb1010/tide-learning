// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {hydrateRoot,type Root} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {useHydratedClock} from '@/hooks/useHydratedClock';
import {noteRelativeTime} from '@/lib/note-relative-time';
let root:Root|undefined;
function Fixture({serverNow}:{serverNow:number}){const now=useHydratedClock(serverNow);return createElement('time',null,noteRelativeTime('1970-01-01T00:00:00.000Z',now));}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML='';});
it.each([60_000,3_600_000,86_400_000,7*86_400_000])('SSR hydration crossing the %i-ms label boundary preserves markup',async boundary=>{
 const serverNow=boundary-1;vi.setSystemTime(serverNow);
 const html=renderToString(createElement(Fixture,{serverNow}));document.body.innerHTML='<div id="fixture">'+html+'</div>';
 vi.setSystemTime(boundary+1);const errors=vi.fn();
 await act(async()=>{root=hydrateRoot(document.getElementById('fixture')!,createElement(Fixture,{serverNow}),{onRecoverableError:errors});});
 expect(errors).not.toHaveBeenCalled();expect(document.querySelector('time')!.textContent).toBe(noteRelativeTime('1970-01-01T00:00:00.000Z',boundary+1));
 await act(async()=>vi.advanceTimersByTime(60_000));expect(document.querySelector('time')!.textContent).toBe(noteRelativeTime('1970-01-01T00:00:00.000Z',boundary+60_001));
 act(()=>root!.unmount());root=undefined;expect(vi.getTimerCount()).toBe(0);
});
