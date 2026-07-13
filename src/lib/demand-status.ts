export const DEMAND_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending_review: ["collecting", "rejected"],
  collecting: ["evaluating", "rejected"],
  evaluating: ["scheduled", "rejected"],
  scheduled: ["producing"],
  producing: ["launched"],
};

export function canTransitionDemand(from: string, to: string): boolean {
  return from === to || (DEMAND_TRANSITIONS[from]?.includes(to) ?? false);
}
