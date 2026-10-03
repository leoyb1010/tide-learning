import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),find:vi.fn(),tag:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{note:{findFirst:mock.find},noteTag:{upsert:mock.tag},$transaction:mock.transaction}}));
vi.mock('@/lib/session',()=>({requireUser:async()=>({id:'owner'}),getCurrentUser:async()=>({id:'owner'}),AuthError:class extends Error{status=401;}}));
vi.mock('@/lib/analytics',()=>({track:vi.fn()}));
vi.mock('@/lib/rate-limit',()=>({assertRateLimit:vi.fn(),RateLimitError:class extends Error{status=429;retryAfterSec=1;}}));
vi.mock('@/lib/queries',()=>({hasPurchasedCourse:vi.fn()}));
vi.mock('@/lib/entitlement',()=>({resolveEntitlement:async()=>({canCreateNoteUnlimited:true}),canAccessLesson:vi.fn()}));
vi.mock('@/lib/gamification',()=>({recordActivity:vi.fn()}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:vi.fn()}));
import {POST} from '@/app/api/notes/route';
import {PATCH} from '@/app/api/notes/[id]/route';
import {POST as TAG} from '@/app/api/note-tags/route';
function request(body:unknown,method='POST',raw=false){return new NextRequest('http://localhost:3100/api/notes/fixture',{method,body:raw?String(body):JSON.stringify(body),headers:{'content-type':'application/json'}});}
beforeEach(()=>{vi.clearAllMocks();mock.find.mockResolvedValue({id:'fixture',userId:'owner'});mock.create.mockImplementation(async args=>({id:'created',...args.data,tags:[]}));mock.update.mockImplementation(async args=>({id:'fixture',...args.data,tags:[]}));mock.tag.mockResolvedValue({id:'tag',name:'Valid',color:'accent'});mock.transaction.mockImplementation(async fn=>fn({note:{create:mock.create,update:mock.update}}));});
for(const name of ['create','edit','tag']){
 const call=(value:unknown,raw=false)=>name==='create'?POST(request(value,'POST',raw)):name==='edit'?PATCH(request(value,'PATCH',raw),{params:Promise.resolve({id:'fixture'})}):TAG(request(value,'POST',raw));
 it.each([null,[],42,'unexpected'])(`${name}: malformed shape %j returns 400 with no mutation`,async value=>{
  expect((await call(value)).status).toBe(400);expect(mock.create).not.toHaveBeenCalled();expect(mock.update).not.toHaveBeenCalled();expect(mock.tag).not.toHaveBeenCalled();
 });
 it(`${name}: invalid JSON can be corrected and retried`,async()=>{
  expect((await call('{broken',true)).status).toBe(400);
  const valid=name==='tag'?{name:'Valid',color:'accent'}:{title:'Restored',contentMd:'Saved after retry'};
  expect((await call(valid)).status).toBe(200);
  expect(name==='tag'?mock.tag:name==='create'?mock.create:mock.update).toHaveBeenCalledTimes(1);
 });
}
it('tag name has a recoverable type boundary',async()=>{expect((await TAG(request({name:42}))).status).toBe(400);expect(mock.tag).not.toHaveBeenCalled();});
