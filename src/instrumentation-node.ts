import { prisma } from "./lib/db";
import {
  shouldStartGenerationRecoveryWorker,
  startGenerationRecoveryWorker,
  type GenerationRecoveryWorkerController,
} from "./lib/generation-worker";

type NodeInstrumentationGlobal = typeof globalThis & {
  __tideSigtermRegistered?: boolean;
  __tideGenerationWorkerController?: GenerationRecoveryWorkerController;
};

/**
 * Node-only startup surface. This module is loaded only from the NEXT_RUNTIME=nodejs branch
 * in instrumentation.ts, so Prisma, SQLite and course generation are unreachable to Edge bundles.
 */
export function registerNodeInstrumentation(): void {
  const global = globalThis as NodeInstrumentationGlobal;
  if (shouldStartGenerationRecoveryWorker()) {
    global.__tideGenerationWorkerController ??= startGenerationRecoveryWorker();
  }

  if (global.__tideSigtermRegistered) return;
  global.__tideSigtermRegistered = true;
  process.on("SIGTERM", () => {
    global.__tideGenerationWorkerController?.stop();
    void prisma.$disconnect().catch(() => {
      /* 退出路径上断连失败无补救意义。 */
    });
  });
}
