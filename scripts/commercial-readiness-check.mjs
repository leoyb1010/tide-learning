#!/usr/bin/env node
/*
 * Release gate for real-money deployment.
 * It deliberately fails closed in production when payment, persistence, or
 * billing-reconciliation prerequisites are missing. In development it reports
 * the same facts without pretending that mock payment is production-ready.
 */
import fs from "node:fs";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const jsonMode = process.argv.includes("--json");
const production = process.env.NODE_ENV === "production";
const failures = [];
const warnings = [];
const checks = [];

function check(name, ok, detail, severity = "failure") {
  const row = { name, ok, detail, severity };
  checks.push(row);
  if (!ok) (severity === "warning" ? warnings : failures).push(row);
}

const payChannel = (process.env.NEXT_PUBLIC_PAY_CHANNEL || "").trim().toLowerCase();
const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
check("payment_channel", production ? payChannel === "stripe" : payChannel === "stripe" || payChannel === "mock" || payChannel === "", `channel=${payChannel || "unset"}`);
check("stripe_credentials", !production || stripeConfigured, stripeConfigured ? "configured" : "STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing");

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
check("public_site_url", !production || /^https:\/\//i.test(siteUrl), siteUrl || "unset");

const dbPath = process.env.DATABASE_URL?.replace(/^file:/, "") || process.env.DB_PATH || "./dev.db";
check("database_path", fs.existsSync(dbPath), dbPath);
check("encrypted_backups", !production || (process.env.REQUIRE_ENCRYPTION === "1" && Boolean(process.env.BACKUP_ENCRYPTION_PASSWORD_FILE)), production ? "REQUIRE_ENCRYPTION=1 and password file are required" : "development mode");

let prisma;
try {
  prisma = new PrismaClient();
  const [pendingReconciliation, expiredReservations, runningJobs, failedCourses] = await Promise.all([
    prisma.llmBillingReconciliation.count({ where: { status: "pending" } }),
    prisma.creditReservation.count({ where: { status: "active", expiresAt: { lt: new Date() } } }),
    prisma.generationJob.count({ where: { status: "running" } }),
    prisma.course.count({ where: { genStatus: "failed" } }),
  ]);
  check("billing_reconciliation", pendingReconciliation === 0, `pending=${pendingReconciliation}`);
  check("expired_credit_reservations", expiredReservations === 0, `expired=${expiredReservations}`);
  check("failed_courses", failedCourses === 0, `failed=${failedCourses}`);
  check("running_generation_jobs", true, `running=${runningJobs}`, "warning");
} catch (error) {
  check("database_queries", false, error instanceof Error ? error.message : String(error));
} finally {
  await prisma?.$disconnect();
}

const result = { ok: failures.length === 0, production, failures, warnings, checks };
if (jsonMode) console.log(JSON.stringify(result, null, 2));
else {
  for (const row of checks) console.log(`${row.ok ? "PASS" : row.severity === "warning" ? "WARN" : "FAIL"} ${row.name}: ${row.detail}`);
  console.log(result.ok ? "Commercial readiness: PASS" : "Commercial readiness: FAIL");
}
if (!result.ok) process.exitCode = 1;
