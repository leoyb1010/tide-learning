import { createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const base = process.env.RUNTIME_BASE ?? "http://127.0.0.1:3100";
const consentVersion = "2026-07-13";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.error ?? "invalid response"}`);
  return json.data;
}

async function createSessionFor(userId) {
  const token = randomBytes(32).toString("hex");
  const id = createHash("sha256").update(token).digest("hex");
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}

async function mediaIntegrityFlow() {
  const lessons = await prisma.lesson.findMany({
    where: { videoAssetId: { not: null } },
    select: { id: true, videoAssetId: true },
  });
  check(lessons.length > 0, "seed has no private media lesson");
  const ids = new Set(lessons.map((lesson) => lesson.videoAssetId));
  check(ids.size === lessons.length, "multiple lessons share one private asset id");
  for (const lesson of lessons) {
    const assetId = lesson.videoAssetId;
    check(/^media_[0-9a-f-]{36}$/i.test(assetId), `lesson ${lesson.id} contains fake asset id ${assetId}`);
    const basePath = path.join(process.cwd(), ".data", "media", assetId);
    await access(`${basePath}.bin`);
    const metadata = JSON.parse(await readFile(`${basePath}.json`, "utf8"));
    check(
      metadata.assetId === assetId && metadata.size > 0 && /^[a-f0-9]{64}$/i.test(metadata.sha256),
      `invalid media metadata ${assetId}`,
    );
  }
  return { lessons: lessons.length, uniqueAssets: ids.size };
}

async function accountErasureFlow() {
  const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const email = `runtime-${stamp}@example.test`;
  const password = "AuditPass123!";
  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: { email, identifier: email, password, nickname: "Runtime Audit", termsAccepted: true, privacyAccepted: true, consentVersion },
  });
  const userId = signup.id;
  const token = signup.sessionToken;
  check(userId && token, "signup did not return user and token");

  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  check(account?.balance === 0 && account.totalEarned === 0, "unverified signup received credits");
  check(await prisma.creditLedger.count({ where: { userId, type: "signup_bonus" } }) === 0, "signup_bonus ledger was created");

  const lesson = await prisma.lesson.findFirst({ include: { course: true } });
  const plan = await prisma.plan.findFirst({ where: { isActive: true } });
  check(lesson && plan, "seed must provide a lesson and active plan");

  await prisma.note.create({ data: { userId, contentMd: "runtime private note", source: "manual" } });
  await prisma.learningProgress.create({
    data: { userId, courseId: lesson.courseId, lessonId: lesson.id, progressSec: 9 },
  });
  await prisma.device.create({ data: { userId, token: `runtime-device-${stamp}`, platform: "ios" } });
  const demand = await prisma.demand.create({ data: { userId, title: `runtime-delete-${stamp}` } });
  await prisma.demandFollow.create({ data: { userId, demandId: demand.id } });
  await prisma.analyticsEvent.create({ data: { userId, anonymousId: `anon-${stamp}`, eventName: "lesson_start" } });
  const lead = await prisma.lead.create({ data: { userId, name: "Private Name", phone: "13800138000", followUpNote: "secret" } });
  await prisma.creditAccount.update({ where: { userId }, data: { balance: 50, totalEarned: 50 } });
  await prisma.creditLedger.create({ data: { userId, delta: 50, type: "admin_adjust", balanceAfter: 50 } });
  const sub = await prisma.subscription.create({
    data: {
      userId, planId: plan.id, channel: "stripe", scope: plan.scope, status: "active",
      priceSnapshotCents: plan.priceCents, currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
    },
  });
  await prisma.entitlement.create({
    data: { userId, sourceSubscriptionId: sub.id, status: "active", accessLevel: "premium", validUntil: sub.currentPeriodEnd },
  });
  const order = await prisma.order.create({
    data: {
      userId, planId: plan.id, channel: "stripe", amountCents: plan.priceCents,
      currency: plan.currency, status: "paid", externalOrderId: `runtime-order-${stamp}`, subscriptionId: sub.id,
    },
  });

  const result = await api("/api/account/delete", { token, method: "POST", body: { password, confirmation: "DELETE_ACCOUNT" } });
  check(result.deleted && result.personalDataErased && result.financialRecordsAnonymized, "delete response contract failed");

  const erased = await prisma.user.findUnique({ where: { id: userId } });
  check(erased?.deletedAt && !erased.email && !erased.phone && !erased.passwordHash && erased.authProvider === "deleted", "user was not anonymized");
  for (const [name, count] of await Promise.all([
    prisma.session.count({ where: { userId } }).then((n) => ["session", n]),
    prisma.note.count({ where: { userId } }).then((n) => ["note", n]),
    prisma.learningProgress.count({ where: { userId } }).then((n) => ["progress", n]),
    prisma.device.count({ where: { userId } }).then((n) => ["device", n]),
    prisma.demand.count({ where: { userId } }).then((n) => ["demand", n]),
    prisma.demandFollow.count({ where: { userId } }).then((n) => ["demandFollow", n]),
    prisma.userProfile.count({ where: { userId } }).then((n) => ["profile", n]),
  ])) check(count === 0, `${name} personal rows remain after deletion`);

  const keptOrder = await prisma.order.findUnique({ where: { id: order.id } });
  const revokedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
  const revokedEnt = await prisma.entitlement.findUnique({ where: { userId_sourceSubscriptionId: { userId, sourceSubscriptionId: sub.id } } });
  const zero = await prisma.creditAccount.findUnique({ where: { userId } });
  const detachedEvent = await prisma.analyticsEvent.findFirst({ where: { eventName: "lesson_start", userId: null, anonymousId: null } });
  const scrubbedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
  check(keptOrder?.status === "paid", "financial order was incorrectly deleted or changed");
  check(revokedSub?.status === "revoked", "subscription was not revoked");
  check(revokedEnt?.status === "revoked", "entitlement was not revoked");
  check(zero?.balance === 0, "credit balance was not zeroed");
  check(detachedEvent, "analytics identity was not detached");
  check(scrubbedLead && !scrubbedLead.userId && !scrubbedLead.name && !scrubbedLead.phone && !scrubbedLead.followUpNote, "lead PII was not scrubbed");

  return { userId, orderId: order.id };
}

async function demandLifecycleFlow() {
  const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const users = await Promise.all([
    prisma.user.create({ data: { email: `author-${stamp}@example.test`, nickname: "需求作者" } }),
    prisma.user.create({ data: { email: `voter-${stamp}@example.test`, nickname: "投票者" } }),
    prisma.user.create({ data: { email: `follower-${stamp}@example.test`, nickname: "关注者" } }),
    prisma.user.create({ data: { email: `moderator-${stamp}@example.test`, nickname: "审核员", role: "demand_moderator" } }),
  ]);
  const [author, voter, follower, moderator] = users;
  const token = await createSessionFor(moderator.id);
  const demand = await prisma.demand.create({
    data: { userId: author.id, title: `完整闭环需求 ${stamp}`, description: "runtime lifecycle", status: "pending_review" },
  });
  await prisma.demandVote.create({ data: { demandId: demand.id, userId: voter.id, weekKey: "2099-W01" } });
  await prisma.demandFollow.create({ data: { demandId: demand.id, userId: follower.id } });
  const course = await prisma.course.create({
    data: {
      slug: `runtime-demand-${stamp}`, title: "已上线验证课", category: "ai_skill", level: "L1",
      status: "published", visibility: "public", origin: "official", sourceDemandId: demand.id,
    },
  });

  for (const status of ["collecting", "evaluating", "scheduled", "producing"]) {
    await api(`/api/admin/demands/${demand.id}/status`, {
      token, method: "PATCH", body: { status, officialReply: `推进到 ${status}` },
    });
  }
  await api(`/api/admin/demands/${demand.id}/status`, {
    token, method: "PATCH", body: { status: "launched", launchedCourseId: course.id, officialReply: "课程已上线" },
  });

  const finalDemand = await prisma.demand.findUnique({ where: { id: demand.id } });
  const logs = await prisma.demandStatusLog.findMany({ where: { demandId: demand.id }, orderBy: { createdAt: "asc" } });
  const launchRecipients = await prisma.notification.findMany({
    where: { refType: "demand", refId: demand.id, title: "你关注的需求已上线" },
    select: { userId: true },
  });
  const recipientIds = new Set(launchRecipients.map((n) => n.userId));
  check(finalDemand?.status === "launched" && finalDemand.launchedCourseId === course.id, "demand did not reach launched with course");
  check(logs.map((l) => l.toStatus).join(",") === "collecting,evaluating,scheduled,producing,launched", "demand status audit chain is incomplete");
  for (const id of [author.id, voter.id, follower.id]) check(recipientIds.has(id), `launch notification missing for ${id}`);

  await prisma.course.delete({ where: { id: course.id } });
  await prisma.demand.delete({ where: { id: demand.id } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  return { demandId: demand.id, transitions: logs.length, launchRecipients: recipientIds.size };
}

try {
  const media = await mediaIntegrityFlow();
  const account = await accountErasureFlow();
  const demand = await demandLifecycleFlow();
  console.log(JSON.stringify({ ok: true, media, account, demand }, null, 2));
} finally {
  await prisma.$disconnect();
}
