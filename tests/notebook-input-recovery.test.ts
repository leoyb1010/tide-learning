import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { notebook: { create: mock.create, findFirst: mock.find, update: mock.update } } }));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'learner' }), AuthError: class extends Error { status = 401; } }));
import { POST } from '@/app/api/notebooks/route';
import { PATCH } from '@/app/api/notebooks/[id]/route';
function request(body: unknown, method: string) { return new NextRequest('http://localhost:3100/api/notebooks/book', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }
beforeEach(() => { vi.clearAllMocks(); mock.create.mockResolvedValue({ id: 'new' }); mock.find.mockResolvedValue({ id: 'book' }); mock.update.mockResolvedValue({ id: 'book' }); });
describe('notebook form error/retry boundary', () => {
  for (const method of ['POST', 'PATCH']) {
    const call = (body: unknown) => method === 'POST' ? POST(request(body, method)) : PATCH(request(body, method), { params: Promise.resolve({ id: 'book' }) });
    it.each([null, [], 42, { title: 2 }, { title: 'Valid', description: {} }, { title: 'Valid', icon: [] }])(`${method} returns recoverable 400 without mutating for %j`, async body => {
      expect((await call(body)).status).toBe(400); expect(mock.create).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    });
    it(`${method} still accepts normal form values after invalid input`, async () => {
      await call({ title: [] });
      expect((await call({ title: '  Notes  ', description: '', icon: '📘' })).status).toBe(200);
      const write = method === 'POST' ? mock.create : mock.update;
      expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Notes', description: null, icon: '📘' }) }));
    });
  }
  it('PATCH preserves omitted fields and ownership checks', async () => {
    expect((await PATCH(request({ description: null }, 'PATCH'), { params: Promise.resolve({ id: 'book' }) })).status).toBe(200);
    expect(mock.find).toHaveBeenCalledWith({ where: { id: 'book', userId: 'learner' }, select: { id: true } });
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: { description: null } }));
    mock.find.mockResolvedValue(null);
    expect((await PATCH(request({ title: 'Other' }, 'PATCH'), { params: Promise.resolve({ id: 'other' }) })).status).toBe(404);
  });
});
