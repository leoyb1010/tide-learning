/** One focus visit owns one start and one end, even when start resolves after leaving. */
export interface FocusSummary { minutes: number; noteCount: number; summary: string | null }
export function createFocusSessionRun(
  start: () => Promise<string | null>,
  finish: (sessionId: string, aiSummary: boolean) => Promise<FocusSummary | null>,
) {
  const started = Promise.resolve().then(start).catch(() => null);
  let ended: Promise<FocusSummary | null> | null = null;
  return {
    started,
    get ending() { return ended !== null; },
    end(aiSummary = false): Promise<FocusSummary | null> {
      ended ??= started.then(id => id ? finish(id, aiSummary) : null).catch(() => null);
      return ended;
    },
  };
}
export type FocusSessionRun = ReturnType<typeof createFocusSessionRun>;
