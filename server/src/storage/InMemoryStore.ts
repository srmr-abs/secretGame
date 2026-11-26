import { createHash } from 'node:crypto';
import { puzzleSeeds } from '../../../src/lib/puzzle-seed';
import type { GameSession, HelpMessage, HelpRequest, Player, Puzzle, PuzzleAssignment, Team, TeamMessage, TeamResult, UploadedImage } from '../types/game.types';

function stableId(value: string) {
  const hex = createHash('sha1').update(`great-secret-unlock:${value}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

const seededPuzzles: Puzzle[] = puzzleSeeds.map((seed) => ({
  ...seed,
  id: stableId(`${seed.category}:${seed.title}`),
  active: true,
  created_at: new Date(0).toISOString()
}));

/** Process-local storage. Restarting the backend intentionally clears all games and results. */
export class InMemoryStore {
  readonly sessions = new Map<string, GameSession>();
  readonly teams = new Map<string, Team>();
  readonly players = new Map<string, Player>();
  readonly playerTokens = new Map<string, string>();
  readonly puzzles = new Map<string, Puzzle>();
  readonly assignments = new Map<string, PuzzleAssignment>();
  readonly helpRequests = new Map<string, HelpRequest>();
  readonly helpMessages: HelpMessage[] = [];
  readonly teamMessages: TeamMessage[] = [];
  readonly results = new Map<string, TeamResult>();
  readonly events: { id: string; session_id: string; team_id: string | null; player_id: string | null; event_type: string; created_at: string }[] = [];
  readonly uploadedImages = new Map<string, UploadedImage>();

  constructor() {
    for (const puzzle of seededPuzzles) this.puzzles.set(puzzle.id, puzzle);
  }
}

export const store = new InMemoryStore();
