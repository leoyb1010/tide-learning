import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({role:'user',authenticated:true,permissions:vi.fn()}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({authorization:`Bearer ${'a'.repeat(64)}`}),cookies:async()=>({get:()=>undefined})}));
vi.mock('@/lib/db',()=>({prisma:{
 session:{findUnique:async()=>mocks.authenticated?{user:{id:'synthetic-role',role:mocks.role,deletedAt:null},expiresAt:new Date(Date.now()+60000)}:null},
 rolePermission:{findMany:mocks.permissions},
}}));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();mocks.authenticated=true;mocks.role='user';mocks.permissions.mockResolvedValue([]);});
const matrix:Record<string,string[]>={
 user:[],admin:['course:write','demand:moderate','order:read','order:refund','user:read','lead:manage','content:review','dashboard:read'],
 content_manager:['course:write','dashboard:read'],demand_moderator:['demand:moderate','dashboard:read'],
 support:['user:read','lead:manage','order:read'],finance:['order:read','order:refund','dashboard:read'],reviewer:['content:review'],
};
describe('R1 actual product role journeys',()=>{
 for(const [role,grants] of Object.entries(matrix))it(`${role}: normal authorized operations and all negative permission paths`,async()=>{
  mocks.role=role;const s=await import('@/lib/session');
  for(const perm of s.ALL_PERMISSIONS){if(grants.includes(perm))await expect(s.requirePermission(perm)).resolves.toMatchObject({role});else await expect(s.requirePermission(perm)).rejects.toMatchObject({status:403});}
  if(role==='admin')await expect(s.requireAdminRole()).resolves.toMatchObject({role});else await expect(s.requireAdminRole()).rejects.toMatchObject({status:403});
 });
 it('anonymous session cannot enter any privileged route',async()=>{mocks.authenticated=false;const s=await import('@/lib/session');for(const p of s.ALL_PERMISSIONS)await expect(s.requirePermission(p)).rejects.toMatchObject({status:401});});
 it('in-flight old role snapshot cannot undo an explicit revoke',async()=>{
  const stale=deferred<Array<{role:string;permission:string}>>();
  mocks.permissions.mockReturnValueOnce(stale.promise).mockResolvedValue([{role:'reviewer',permission:'__override__'}]);
  const s=await import('@/lib/session');const oldRead=s.primePermissionCache(true);
  s.invalidatePermissionCache();const afterRevoke=s.primePermissionCache(true);
  stale.resolve([{role:'reviewer',permission:'content:review'}]);await Promise.all([oldRead,afterRevoke]);
  expect(s.hasPermission('reviewer','content:review')).toBe(false);
  expect(mocks.permissions).toHaveBeenCalledTimes(2);
 });
});
describe('R2 challenge revocation repair',()=>{
 it('multiple forced readers after repeated invalidations converge on the newest revoke',async()=>{
  const stale=deferred<Array<{role:string;permission:string}>>();
  const second=deferred<Array<{role:string;permission:string}>>();
  mocks.permissions.mockReturnValueOnce(stale.promise).mockReturnValueOnce(second.promise).mockResolvedValue([{role:'reviewer',permission:'__override__'}]);
  const s=await import('@/lib/session');const first=s.primePermissionCache(true);
  s.invalidatePermissionCache();const other=s.primePermissionCache(true);
  stale.resolve([{role:'reviewer',permission:'content:review'}]);
  await vi.waitFor(()=>expect(mocks.permissions).toHaveBeenCalledTimes(2));
  s.invalidatePermissionCache();const newest=s.primePermissionCache(true);
  second.resolve([{role:'reviewer',permission:'content:review'}]);
  await Promise.all([first,other,newest]);
  expect(s.hasPermission('reviewer','content:review')).toBe(false);
  expect(mocks.permissions).toHaveBeenCalledTimes(3);
 });

 it('a post-revocation database outage rejects all waiters instead of caching old access',async()=>{
  const stale=deferred<Array<{role:string;permission:string}>>();
  mocks.permissions.mockReturnValueOnce(stale.promise).mockRejectedValue(new Error('synthetic post-revoke outage'));
  const s=await import('@/lib/session');const old=s.primePermissionCache(true);
  s.invalidatePermissionCache();const fresh=s.primePermissionCache(true);
  const outcomes=Promise.allSettled([old,fresh]);stale.resolve([{role:'reviewer',permission:'content:review'}]);
  for(const outcome of await outcomes){expect(outcome.status).toBe('rejected');if(outcome.status==='rejected')expect(outcome.reason.status).toBe(503);}
 });
 it('a role switch and expired authority use current account role and session',async()=>{
  const s=await import('@/lib/session');mocks.role='admin';await expect(s.requirePermission('course:write')).resolves.toMatchObject({role:'admin'});
  mocks.role='support';await expect(s.requirePermission('course:write')).rejects.toMatchObject({status:403});
  await expect(s.requirePermission('lead:manage')).resolves.toMatchObject({role:'support'});
  mocks.authenticated=false;await expect(s.requirePermission('lead:manage')).rejects.toMatchObject({status:401});
 });
});
