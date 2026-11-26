export type TeamScore = { id: string; success: boolean; rawSeconds: number; penaltySeconds: number };
export function adjustedSeconds(rawSeconds: number, penaltySeconds: number) { return Math.max(0, rawSeconds) + Math.max(0, penaltySeconds); }
export function rankTeams<T extends TeamScore>(teams: T[]) {
  return [...teams].sort((a, b) => Number(b.success) - Number(a.success) || (a.success ? adjustedSeconds(a.rawSeconds, a.penaltySeconds) - adjustedSeconds(b.rawSeconds, b.penaltySeconds) : a.rawSeconds - b.rawSeconds));
}
