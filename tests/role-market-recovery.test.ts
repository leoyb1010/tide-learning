import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({findCourse:vi.fn(),findRequest:vi.fn(),createRequest:vi.fn(),notify:vi.fn(),track:vi.fn(),fence:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{course:{findFirst:mocks.findCourse},courseAccessRequest:{findUnique:mocks.findRequest,create:mocks.createRequest}}}));
vi.mock('@/lib/session',()=>({requireUser:async()=>({id:'synthetic-learner',role:'user'}),AuthError:class extends Error{status=401;}}));
vi.mock('@/lib/rate-limit',()=>({assertUserRateLimit:vi.fn(),RateLimitError:class extends Error{status=429;}}));
vi.mock('@/lib/notify',()=>({notify:mocks.notify}));
vi.mock('@/lib/analytics',()=>({track:mocks.track}));
vi.mock('@/lib/market-eligibility',()=>({marketBaseWhere:(where:unknown)=>where,currentMarketPublicationFence:mocks.fence}));
import { POST } from '@/app/api/market/request/route';
function request(body:unknown){return new NextRequest('http://localhost:3100/api/market/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{
 vi.clearAllMocks();mocks.findCourse.mockResolvedValue({id:'synthetic-course',title:'合成课程',authorUserId:'synthetic-author',lessons:[]});
 mocks.findRequest.mockResolvedValue(null);mocks.createRequest.mockResolvedValue({id:'synthetic-request'});mocks.fence.mockResolvedValue({});mocks.notify.mockResolvedValue(undefined);mocks.track.mockResolvedValue(undefined);
});
describe('R1 learner-to-author handoff',()=>{
 it('normal request binds requester and recipient to authenticated learner and real author',async()=>{
  const response=await POST(request({courseId:'synthetic-course',message:'想学习',requesterId:'forged',ownerId:'forged'}));
  expect(response.status).toBe(200);
  expect(mocks.createRequest).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({requesterId:'synthetic-learner',ownerId:'synthetic-author',status:'pending'})}));
  expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({userId:'synthetic-author',refId:'synthetic-request'}));
 });
 it('does not report success when the request was never stored',async()=>{
  mocks.createRequest.mockRejectedValue(new Error('synthetic unavailable storage'));
  const response=await POST(request({courseId:'synthetic-course'}));expect(response.status).toBe(500);
  expect((await response.json()).ok).toBe(false);expect(mocks.notify).not.toHaveBeenCalled();
 });
 it('existing approved request is recovered without duplicate handoff',async()=>{
  mocks.findRequest.mockResolvedValue({id:'already',status:'approved'});
  const response=await POST(request({courseId:'synthetic-course'}));expect((await response.json()).data.status).toBe('approved');expect(mocks.createRequest).not.toHaveBeenCalled();
 });
});
describe('R2 repeated clicks and invalid inputs',()=>{
 it('a learner can retry a storage failure and receive the real saved request',async()=>{
  mocks.createRequest.mockRejectedValueOnce(new Error('synthetic transient outage'));
  expect((await POST(request({courseId:'synthetic-course'}))).status).toBe(500);
  expect(mocks.notify).not.toHaveBeenCalled();
  const retry=await POST(request({courseId:'synthetic-course'}));
  expect(retry.status).toBe(200);
  expect((await retry.json()).data).toMatchObject({requestId:'synthetic-request',status:'pending'});
  expect(mocks.notify).toHaveBeenCalledTimes(1);
 });
 it('concurrent duplicate recovery preserves a rejected author decision',async()=>{
  mocks.findRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'winner',status:'rejected'});
  mocks.createRequest.mockRejectedValue(Object.assign(new Error('duplicate'),{code:'P2002'}));
  const response=await POST(request({courseId:'synthetic-course'}));
  expect((await response.json()).data).toMatchObject({status:'rejected',requestId:'winner'});
  expect(mocks.notify).not.toHaveBeenCalled();
 });

 it('duplicate-create recovery returns the persisted winning decision instead of invented pending',async()=>{
  mocks.findRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'winner',status:'approved'});
  mocks.createRequest.mockRejectedValue(Object.assign(new Error('duplicate'),{code:'P2002'}));
  const response=await POST(request({courseId:'synthetic-course'}));expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({status:'approved',requestId:'winner'});expect(mocks.notify).not.toHaveBeenCalled();
 });
 it('does not claim a duplicate exists when no scoped winning request can be read',async()=>{
  mocks.createRequest.mockRejectedValue(Object.assign(new Error('duplicate'),{code:'P2002'}));
  expect((await POST(request({courseId:'synthetic-course'}))).status).toBeGreaterThanOrEqual(400);
 });
 it.each([{courseId:12},{courseId:{}},{courseId:'synthetic-course',message:{}},null,[],42])('invalid learner input is a recoverable 400: %j',async body=>{
  expect((await POST(request(body))).status).toBe(400);expect(mocks.createRequest).not.toHaveBeenCalled();
 });
});
