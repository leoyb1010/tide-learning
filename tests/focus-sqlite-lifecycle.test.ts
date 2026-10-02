import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const holder = vi.hoisted(() => ({ client: null as unknown, chat: vi.fn() }));
vi.mock('@/lib/db', () => ({ get prisma() { return holder.client; } }));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'focus-audit-user' }), AuthError: class extends Error { status = 401; } }));
vi.mock('@/lib/rate-limit', () => ({ assertUserRateLimit: vi.fn(), RateLimitError: class extends Error { status = 429; } }));
vi.mock('@/lib/entitlement', () => ({ resolveEntitlement: async () => ({ canUseLLM: true }) }));
vi.mock('@/lib/llm', () => ({ chat: holder.chat }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
let root: string; let client: PrismaClient;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tide-focus-test-'));
  const db = `file:${join(root, 'test.db')}`;
  execFileSync('bash', ['scripts/migrate-deploy.sh'], { env: { ...process.env, DATABASE_URL: db }, stdio: 'pipe' });
  client = new PrismaClient({ datasources: { db: { url: `${db}?connection_limit=1` } } }); holder.client = client;
  await client.user.create({ data: { id: 'focus-audit-user', nickname: 'Synthetic focus user' } });
}, 30_000);
afterAll(async () => { await client?.$disconnect(); if (root) rmSync(root, { recursive: true, force: true }); });
beforeEach(async () => { await client.focusSession.deleteMany(); await client.note.deleteMany(); holder.chat.mockReset().mockResolvedValue('Synthetic summary'); });
function request(id: string, aiSummary = true) { return new NextRequest('http://localhost:3100/api/focus', { method: 'PATCH', body: JSON.stringify({ sessionId: id, aiSummary }), headers: { 'content-type': 'application/json' } }); }
describe('real SQLite focus completion', () => {
  it('concurrent finish calls commit one completion and one optional summary; replay keeps timestamp', async () => {
    const { PATCH } = await import('@/app/api/focus/route');
    const visit = await client.focusSession.create({ data: { userId: 'focus-audit-user', goal: 'Synthetic focus', startAt: new Date(Date.now() - 25 * 60_000) } });
    const responses = await Promise.all(Array.from({ length: 3 }, () => PATCH(request(visit.id))));
    expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
    expect(holder.chat).toHaveBeenCalledTimes(1);
    const first = await client.focusSession.findUniqueOrThrow({ where: { id: visit.id } });
    expect(first.endAt).not.toBeNull(); expect(first.minutes).toBe(25); expect(first.summary).toBe('Synthetic summary');
    const second = await client.focusSession.create({ data: { userId: 'focus-audit-user', goal: 'Next visit' } });
    await client.note.create({ data: { userId: 'focus-audit-user', contentMd: 'After focus', createdAt: new Date(first.endAt!.getTime() + 1_000) } });
    const replay = await PATCH(request(visit.id));
    expect((await replay.json()).data).toMatchObject({ minutes: 25, noteCount: 0, summary: 'Synthetic summary' });
    expect((await client.focusSession.findUniqueOrThrow({ where: { id: visit.id } })).endAt).toEqual(first.endAt);
    expect((await client.focusSession.findUniqueOrThrow({ where: { id: second.id } })).endAt).toBeNull();
    expect(holder.chat).toHaveBeenCalledTimes(1);
  });
});
