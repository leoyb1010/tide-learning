// Real render fingerprints + publication fence; DB fixture honors the actual requested projection.
import {beforeEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({course:vi.fn(),lessons:vi.fn(),collect:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{course:{findFirst:mocks.course},lesson:{findMany:mocks.lessons}}}));
vi.mock('@/lib/session',()=>({requireUser:async()=>({id:'buyer'}),AuthError:class extends Error{status=401;}}));
vi.mock('@/lib/rate-limit',()=>({assertUserRateLimit:vi.fn(),RateLimitError:class extends Error{status=429;}}));
vi.mock('@/lib/analytics',()=>({track:vi.fn()}));
vi.mock('@/lib/credits',()=>({ensureAccount:vi.fn()}));
vi.mock('@/lib/credit-trade',()=>({collectFreeCourse:mocks.collect,purchaseCourse:vi.fn(),FREE_COLLECT_AUTHOR_BONUS:1}));
import {POST} from '@/app/api/market/collect/route';
import {clearMarketFenceCache,filterCurrentMarketCoursesByRevision} from '@/lib/market-eligibility';
import {resolveCourseDesign,serializeCourseDesign} from '@/lib/ai/courseware-design';
import {resolveCoursewareMode} from '@/lib/ai/courseware-catalog';
import {renderSourceHash} from '@/lib/ai/courseware-gen';
function fixture(){
 const design=resolveCourseDesign({id:'synthetic-original',category:'ai_skill',template:null,designJson:null});
 const course={id:'synthetic-clone',title:'Synthetic current course',category:'ai_skill',template:null,designJson:serializeCourseDesign(design),origin:'user_created',genStatus:'ready',status:'published',sharedStatus:'shared',contentBriefJson:null,modelUsed:null,generationQualityJson:null,presentationRevision:0,authorUserId:'author',priceCredits:0};
 const html='<html><body><h1>Synthetic current lesson</h1></body></html>';
 const lesson={id:'synthetic-lesson',courseId:course.id,title:'Current lesson',summary:null,sortOrder:0,blocksJson:'{"version":1,"blocks":[]}',htmlJson:JSON.stringify({renderMode:'sandbox_srcdoc',contractVersion:2,html,checksum:'sha256:'+createHash('sha256').update(html).digest('hex')}),renderEngine:'deterministic',designJson:null,qualityJson:null,renderSourceHash:''};
 const mode=resolveCoursewareMode({title:course.title,template:course.template,artKey:design.art.key,layout:design.art.layout});
 lesson.renderSourceHash=renderSourceHash({...lesson,design,lessonDesignJson:null,mode});
 return {course,lesson};
}
function project(row:Record<string,unknown>,select:Record<string,unknown>){return Object.fromEntries(Object.keys(select).filter(key=>select[key]===true).map(key=>[key,row[key]]));}
beforeEach(()=>{vi.clearAllMocks();clearMarketFenceCache();mocks.collect.mockResolvedValue({status:'collected'});});
it.each([false,true])('actual collect route preserves sortOrder for current/stale=%s presentation',async stale=>{
 const {course,lesson}=fixture();if(stale)lesson.sortOrder=1;
 mocks.course.mockImplementation(async({select})=>({...course,lessons:[project(lesson,select.lessons.select)]}));
 const response=await POST(new NextRequest('http://localhost:3100/api/market/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({courseId:course.id})}));
 expect(response.status).toBe(stale?404:200);
 expect(mocks.course.mock.calls[0][0].select.lessons.select.sortOrder).toBe(true);
 expect(mocks.collect).toHaveBeenCalledTimes(stale?0:1);
});
it('market list/detail revision-cache cold reader projects all fingerprint fields',async()=>{
 const {course,lesson}=fixture();
 mocks.lessons.mockImplementation(async({select})=>[project(lesson,select)]);
 expect(await filterCurrentMarketCoursesByRevision([course])).toEqual([course]);
 expect(mocks.lessons.mock.calls[0][0].select.sortOrder).toBe(true);
 expect(await filterCurrentMarketCoursesByRevision([course])).toEqual([course]);expect(mocks.lessons).toHaveBeenCalledTimes(1);
 lesson.sortOrder=1;
 expect(await filterCurrentMarketCoursesByRevision([{...course,presentationRevision:1}])).toEqual([]);
});
