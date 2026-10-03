// Real async page + real GET handler share one deterministic, ownership-scoped fixture.
import {beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({count:vi.fn(),findMany:vi.fn(),tags:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{note:{count:mock.count,findMany:mock.findMany},noteTag:{findMany:mock.tags}}}));
vi.mock('@/lib/session',()=>({getCurrentUser:async()=>({id:'owner'}),requireUser:async()=>({id:'owner'}),AuthError:class extends Error{status=401;}}));
vi.mock('@/lib/queries',()=>({hasPurchasedCourse:vi.fn()}));
vi.mock('@/lib/entitlement',()=>({resolveEntitlement:vi.fn(),canAccessLesson:vi.fn()}));
vi.mock('@/lib/gamification',()=>({recordActivity:vi.fn()}));
vi.mock('@/lib/analytics',()=>({track:vi.fn()}));
vi.mock('@/lib/rate-limit',()=>({assertRateLimit:vi.fn()}));
vi.mock('@/app/notes/NotesClient',()=>({default:()=>null}));
import NotesPage from '@/app/notes/page';
import {GET} from '@/app/api/notes/route';
function rows(count:number){return Array.from({length:count},(_,i)=>({id:`note-${String(count-i).padStart(4,'0')}`,title:`Note ${i+1}`,contentMd:'synthetic',excerpt:'synthetic',sourceText:null,kind:'text',source:'manual',captureUrl:null,starred:false,pinned:false,timestampSec:null,createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01'),notebookId:null,courseId:null,lessonId:null,course:null,lesson:null,tags:[]}));}
beforeEach(()=>{vi.clearAllMocks();mock.tags.mockResolvedValue([]);});
it.each([30,31,32,61])('SSR followed by Load more never omits or duplicates any of %i notes',async count=>{
 const all=rows(count);mock.count.mockResolvedValue(count);
 mock.findMany.mockImplementation(async args=>{expect(args.where.userId).toBe('owner');expect(args.orderBy).toEqual([{updatedAt:'desc'},{id:'desc'}]);const offset=args.cursor?all.findIndex(x=>x.id===args.cursor.id)+(args.skip??0):0;return all.slice(offset,offset+args.take);});
 const page=await NotesPage({searchParams:Promise.resolve({})}) as ReactElement<{initialData:{notes:{id:string}[];nextCursor:string|null;total:number}}>;
 const first=page.props.initialData;expect(first.notes).toHaveLength(Math.min(count,30));
 const seen=first.notes.map(x=>x.id);let cursor=first.nextCursor;
 while(cursor){
  const response=await GET(new NextRequest(`http://localhost:3100/api/notes?limit=30&cursor=${cursor}`));expect(response.status).toBe(200);
  const data=(await response.json()).data;seen.push(...data.notes.map((x:{id:string})=>x.id));cursor=data.nextCursor;
 }
 expect(seen).toEqual(all.map(x=>x.id));expect(new Set(seen).size).toBe(count);
});
