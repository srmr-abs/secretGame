export type HelpCandidate = { playerId: string; teamId: string; connected: boolean; requestOwnerId: string; requestTeamId: string; activeHelpers: string[]; requestOpen: boolean };
export const MAX_HELPERS_PER_REQUEST = 2;
/** Owner puzzle progress intentionally does not appear here: teammates can help while solving their own puzzles. */
export function canAcceptHelp(candidate: HelpCandidate) {
  return candidate.requestOpen && candidate.connected && candidate.teamId === candidate.requestTeamId && candidate.playerId !== candidate.requestOwnerId && !candidate.activeHelpers.includes(candidate.playerId) && candidate.activeHelpers.length < MAX_HELPERS_PER_REQUEST;
}
