import {afterEach,expect,it,vi} from 'vitest';
import {blockAuditServiceWorkers,createAuditContext} from '../scripts/audit-context.mjs';
afterEach(()=>vi.unstubAllGlobals());
it('registration is rejected, not silently fulfilled, in an ordinary same-origin context',async()=>{
 const original=vi.fn();const serviceWorker={register:original};vi.stubGlobal('navigator',{serviceWorker});blockAuditServiceWorkers();await expect(serviceWorker.register('/sw.js')).rejects.toMatchObject({name:'NotAllowedError'});expect(original).not.toHaveBeenCalled();
});
it('opaque-origin SecurityError is already denied; unrelated failures remain errors',()=>{
 const object={};Object.defineProperty(object,'serviceWorker',{get(){throw new DOMException('Opaque frame','SecurityError');}});vi.stubGlobal('navigator',object);expect(()=>blockAuditServiceWorkers()).not.toThrow();
 vi.stubGlobal('navigator',Object.defineProperty({},'serviceWorker',{get(){throw new Error('Unexpected platform failure');}}));expect(()=>blockAuditServiceWorkers()).toThrow('Unexpected platform failure');
});
it('fresh context installs the guard and network restrictions before any page exists',async()=>{
 const context={addInitScript:vi.fn(),routeWebSocket:vi.fn(),route:vi.fn()};const browser={newContext:vi.fn(async()=>context)};
 expect(await createAuditContext(browser,{colorScheme:'dark'},'http://127.0.0.1:3100')).toBe(context);expect(browser.newContext).toHaveBeenCalledWith({colorScheme:'dark'});expect(context.addInitScript).toHaveBeenCalledWith(blockAuditServiceWorkers);expect(context.routeWebSocket).toHaveBeenCalledOnce();expect(context.route).toHaveBeenCalledOnce();
 const handle=context.route.mock.calls[0][1];const local={request:()=>({url:()=> 'http://127.0.0.1:3100/page'}),continue:vi.fn(),abort:vi.fn()};await handle(local);expect(local.continue).toHaveBeenCalledOnce();
 const remote={request:()=>({url:()=> 'https://example.com/external'}),continue:vi.fn(),abort:vi.fn()};await handle(remote);expect(remote.abort).toHaveBeenCalledWith('blockedbyclient');expect(remote.continue).not.toHaveBeenCalled();
});
