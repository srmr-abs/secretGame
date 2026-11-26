import type { PuzzleSeed } from '../../../src/lib/puzzle-seed';
import type { PuzzleCategory } from '../../../src/lib/game-types';

export type GameMode = 'solo' | 'multiplayer';
export type SessionStatus = 'waiting_for_players' | 'ready' | 'running' | 'completed';
export type TeamStatus = 'waiting' | 'active' | 'completed' | 'failed';
export type GamePhase = 'waiting' | 'puzzles' | 'collaboration' | 'final_answer' | 'completed' | 'failed';
export type HelpStatus = 'requested' | 'accepted' | 'active' | 'completed' | 'cancelled' | 'expired';

export type Puzzle = PuzzleSeed & { id: string; active: boolean; created_at: string };
export type GameSession = {
  id: string; name: string; pin: string; theme: string; game_mode: GameMode; status: SessionStatus; team_count: number; players_per_team: number;
  puzzle_seconds: number; collaboration_seconds: number; final_seconds: number; hints_enabled: boolean;
  surprise_events: boolean; current_team_index: number; started_at: string | null; completed_at: string | null;
  paused_at: string | null; paused_seconds: number; remaining_time_before_pause: number | null; created_at: string;
};
export type Team = {
  id: string; session_id: string; name: string; play_order: number; status: TeamStatus; phase: GamePhase;
  secret_word: string; phase_started_at: string | null; phase_ends_at: string | null; activated_at: string | null;
  completed_at: string | null; hints_used: number; incorrect_final_attempts: number; penalty_seconds: number;
  paused_seconds: number; final_attempts: number;
};
export type Player = {
  id: string; team_id: string; display_name: string; token_hash: string; connected: boolean;
  last_seen_at: string; disconnected_at: string | null; mission_accepted_at: string | null; joined_at: string; ready: boolean;
  answerAttempts: number[];
};
export type PuzzleAssignment = {
  id: string; team_id: string; player_id: string; puzzle_id: string; clue_number: number; clue: string;
  completed_at: string | null; hints_used: number; attempts: { answer: string; correct: boolean; created_at: string }[];
};
export type HelpRequest = {
  id: string; team_id: string; owner_player_id: string; assignment_id: string; message: string;
  status: HelpStatus; expires_at: string; created_at: string; closed_at: string | null;
  helper_ids: Set<string>; accepted_helper_ids: Set<string>; declined_by: Set<string>;
};
export type HelpMessage = { id: string; request_id: string; sender_player_id: string; body: string; created_at: string };
export type TeamMessage = { id: string; team_id: string; sender_player_id: string | null; body: string; system: boolean; created_at: string };
export type TeamResult = {
  team_id: string; success: boolean; raw_seconds: number; penalty_seconds: number; adjusted_seconds: number;
  hints_used: number; incorrect_final_attempts: number; assistance_requests: number; accepted_help_requests: number;
  unique_helpers: number; assisted_puzzles: number; rank: number | null;
};
export type UploadedImage = { data: Buffer; mimeType: string };
export type StoreOptions = { puzzles?: Puzzle[] };
export type CreateGameInput = {
  name: string; theme: string; gameMode?: GameMode; numberOfTeams: number; playersPerTeam?: number; puzzleMinutes: number; collaborationMinutes: number;
  finalMinutes: number; hintsEnabled?: boolean; surpriseEvents?: boolean;
};
export type PublicPuzzle = Pick<Puzzle, 'id' | 'title' | 'category' | 'difficulty' | 'question' | 'answer_type' | 'choices'> & { image_url: string | null };
export type PuzzleSeedDefinition = PuzzleSeed;
export type { PuzzleCategory };
