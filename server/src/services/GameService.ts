import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { availableThemeIds, normalizeAnswer, puzzleCategories, themeById } from '../../../src/lib/themes';
import { adjustedSeconds, rankTeams } from '../../../src/lib/scoring';
import { InMemoryStore, store as defaultStore } from '../storage/InMemoryStore';
import type { CreateGameInput, GamePhase, GameSession, HelpRequest, Player, PublicPuzzle, Puzzle, PuzzleAssignment, Team, TeamResult, UploadedImage } from '../types/game.types';

export const PLAYER_COOKIE = 'secret_player';
export const ADMIN_COOKIE = 'secret_admin';
export const MAX_HELPERS_PER_REQUEST = 2;
const HELP_REQUEST_TTL_MS = 90_000;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const iso = (time = Date.now()) => new Date(time).toISOString();
const shuffle = <T,>(values: T[]) => [...values].sort(() => Math.random() - 0.5);
function splitClueIntoFragments(clue: string, count: number) {
  const words = clue.match(/\S+\s*/gu) ?? [clue];
  if (count <= words.length) {
    const baseSize = Math.floor(words.length / count);
    const extra = words.length % count;
    let offset = 0;
    return Array.from({ length: count }, (_, index) => {
      const size = baseSize + (index < extra ? 1 : 0);
      const fragment = words.slice(offset, offset + size).join('').trim();
      offset += size;
      return fragment;
    });
  }
  const characters = [...clue];
  const baseSize = Math.floor(characters.length / count);
  const extra = characters.length % count;
  let offset = 0;
  return Array.from({ length: count }, (_, index) => {
    const size = baseSize + (index < extra ? 1 : 0);
    const fragment = characters.slice(offset, offset + size).join('').trim();
    offset += size;
    return fragment;
  });
}
const safePuzzle = (puzzle: Puzzle): PublicPuzzle => ({
  id: puzzle.id, category: puzzle.category, difficulty: puzzle.difficulty,
  question: puzzle.question, image_url: puzzle.image_url ? puzzle.image_url : null,
  answer_type: puzzle.answer_type, choices: puzzle.choices ?? undefined
});

export class GameService {
  private broadcast: (teamId: string, kind: string) => void = () => undefined;
  private adminBroadcast: (sessionId: string, kind: string) => void = () => undefined;
  constructor(readonly data: InMemoryStore = defaultStore, private readonly clock: () => number = Date.now) {}

  setBroadcasters(team: (teamId: string, kind: string) => void, admin: (sessionId: string, kind: string) => void) {
    this.broadcast = team;
    this.adminBroadcast = admin;
  }
  notifyTeam(teamId: string, kind: string) { this.notify(teamId, kind); }
  private now() { return this.clock(); }
  private event(sessionId: string, teamId: string | null, playerId: string | null, eventType: string) {
    this.data.events.push({ id: randomUUID(), session_id: sessionId, team_id: teamId, player_id: playerId, event_type: eventType, created_at: iso(this.now()) });
  }
  private notify(teamId: string, kind: string) {
    this.broadcast(teamId, kind);
    const team = this.data.teams.get(teamId);
    if (team) this.adminBroadcast(team.session_id, kind);
  }
  private sessionForTeam(team: Team) { return this.data.sessions.get(team.session_id); }
  private teamPlayers(teamId: string) { return [...this.data.players.values()].filter((player) => player.team_id === teamId).sort((a, b) => a.joined_at.localeCompare(b.joined_at)); }
  private teamAssignments(teamId: string) { return [...this.data.assignments.values()].filter((assignment) => assignment.team_id === teamId).sort((a, b) => a.clue_number - b.clue_number); }
  private activeRequests(teamId?: string) { return [...this.data.helpRequests.values()].filter((request) => (!teamId || request.team_id === teamId) && ['requested', 'accepted', 'active'].includes(request.status)); }
  private countTeamPlayers(teamId: string) { return this.teamPlayers(teamId).length; }

  createSession(input: CreateGameInput) {
    const name = String(input.name ?? '').trim();
    if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Game name must be 2 to 80 characters.');
    if (!availableThemeIds.includes(input.theme as typeof availableThemeIds[number])) throw new HttpError(400, 'Choose Detective Case or Zigzag Puzzle Hunt.');
    const gameMode = input.gameMode === 'solo' ? 'solo' : 'multiplayer';
    if (input.gameMode && !['solo', 'multiplayer'].includes(input.gameMode)) throw new HttpError(400, 'Choose solo or multiplayer mode.');
    const numberOfTeams = gameMode === 'solo' ? 1 : input.numberOfTeams;
    if (!Number.isInteger(numberOfTeams) || numberOfTeams < 1 || numberOfTeams > 20) throw new HttpError(400, 'Choose between 1 and 20 teams.');
    const playersPerTeam = gameMode === 'solo' ? 1 : input.playersPerTeam ?? 10;
    if (!Number.isInteger(playersPerTeam) || playersPerTeam < (gameMode === 'solo' ? 1 : 2) || playersPerTeam > 10) throw new HttpError(400, gameMode === 'solo' ? 'Solo mode has one player.' : 'Each multiplayer team must allow between 2 and 10 players.');
    const durations = [input.puzzleMinutes, input.collaborationMinutes, input.finalMinutes];
    if (!durations.every((duration) => Number.isInteger(duration) && duration >= 1 && duration <= 30)) throw new HttpError(400, 'Each phase timer must be from 1 to 30 minutes.');
    const theme = themeById(input.theme);
    let pin = '';
    do { pin = String(randomInt(0, 1_000_000)).padStart(6, '0'); } while ([...this.data.sessions.values()].some((session) => session.pin === pin));
    const now = iso(this.now());
    const session: GameSession = {
      id: randomUUID(), name, pin, theme: input.theme, game_mode: gameMode, status: 'waiting_for_players', team_count: numberOfTeams,
      players_per_team: playersPerTeam, puzzle_seconds: input.puzzleMinutes * 60, collaboration_seconds: input.collaborationMinutes * 60,
      final_seconds: input.finalMinutes * 60, hints_enabled: input.hintsEnabled !== false, surprise_events: input.surpriseEvents === true,
      current_team_index: -1, started_at: null, completed_at: null, paused_at: null, paused_seconds: 0, remaining_time_before_pause: null, created_at: now
    };
    this.data.sessions.set(session.id, session);
    for (let i = 0; i < numberOfTeams; i++) {
      const team: Team = {
        id: randomUUID(), session_id: session.id, name: `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? ` ${Math.floor(i / 26) + 1}` : ''}`,
        play_order: i + 1, status: 'waiting', phase: 'waiting', secret_word: theme.words[randomInt(0, theme.words.length)].word,
        phase_started_at: null, phase_ends_at: null, activated_at: null, completed_at: null, hints_used: 0,
        incorrect_final_attempts: 0, penalty_seconds: 0, paused_seconds: 0, final_attempts: 0
      };
      this.data.teams.set(team.id, team);
    }
    this.event(session.id, null, null, 'session_created');
    return { id: session.id, pin };
  }

  join(pinValue: unknown, nameValue: unknown) {
    const pin = String(pinValue ?? '').trim();
    const name = String(nameValue ?? '').trim();
    if (!/^\d{6}$/.test(pin)) throw new HttpError(400, 'Enter the six-digit game PIN.');
    if (name.length < 2 || name.length > 24) throw new HttpError(400, 'Your name must be 2 to 24 characters.');
    const session = [...this.data.sessions.values()].find((entry) => entry.pin === pin);
    if (!session || !['waiting_for_players', 'ready'].includes(session.status)) throw new HttpError(400, 'Game PIN is invalid or the game has already started.');
    const teams = [...this.data.teams.values()].filter((team) => team.session_id === session.id).sort((a, b) => a.play_order - b.play_order);
    const team = teams.filter((candidate) => candidate.status === 'waiting' && this.countTeamPlayers(candidate.id) < session.players_per_team)
      .sort((a, b) => this.countTeamPlayers(a.id) - this.countTeamPlayers(b.id) || a.play_order - b.play_order)[0];
    if (!team) throw new HttpError(409, `All teams have reached their ${session.players_per_team}-player capacity.`);
    const sessionTeamIds = new Set(teams.map((candidate) => candidate.id));
    if ([...this.data.players.values()].some((player) => sessionTeamIds.has(player.team_id) && player.display_name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new HttpError(409, 'That name is already used in this game.');
    const token = randomBytes(32).toString('base64url');
    const player: Player = {
      id: randomUUID(), team_id: team.id, display_name: name, token_hash: tokenHash(token), connected: true,
      last_seen_at: iso(this.now()), disconnected_at: null, mission_accepted_at: null, joined_at: iso(this.now()), ready: false, answerAttempts: []
    };
    this.data.players.set(player.id, player);
    this.data.playerTokens.set(player.token_hash, player.id);
    const minimumPlayers = session.game_mode === 'solo' ? 1 : 2;
    session.status = teams.every((candidate) => this.countTeamPlayers(candidate.id) >= minimumPlayers) ? 'ready' : 'waiting_for_players';
    this.event(session.id, team.id, player.id, 'player_joined');
    this.notify(team.id, 'player-joined');
    return { token, player, team };
  }

  getPlayerByToken(token: string | undefined) {
    if (!token) return null;
    const id = this.data.playerTokens.get(tokenHash(token));
    const player = id ? this.data.players.get(id) : undefined;
    if (!player) return null;
    player.connected = true;
    player.last_seen_at = iso(this.now());
    player.disconnected_at = null;
    return player;
  }
  playerForSocketToken(token: string | undefined) { return token ? this.data.players.get(this.data.playerTokens.get(tokenHash(token)) ?? '') ?? null : null; }
  markDisconnected(playerId: string) {
    const player = this.data.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.disconnected_at = iso(this.now());
    this.notify(player.team_id, 'player-left');
  }
  markConnected(playerId: string) {
    const player = this.data.players.get(playerId);
    if (!player) return;
    player.connected = true;
    player.last_seen_at = iso(this.now());
    player.disconnected_at = null;
    this.notify(player.team_id, 'player-connected');
  }

  private assignPuzzles(teamId: string) {
    const team = this.data.teams.get(teamId);
    if (!team) throw new HttpError(404, 'Team not found.');
    const players = this.teamPlayers(teamId);
    if (players.length < 1 || players.length > 10) return false;
    const session = this.sessionForTeam(team);
    const solo = session?.game_mode === 'solo';
    const expectedAssignments = solo ? 1 : players.length;
    const existing = this.teamAssignments(teamId);
    if (existing.length === expectedAssignments) return true;
    for (const assignment of existing) this.data.assignments.delete(assignment.id);
    const theme = themeById(session?.theme ?? 'detective');
    const mission = theme.words.find((entry) => entry.word === team.secret_word);
    if (!mission) throw new HttpError(500, 'The selected theme is missing its clue set.');
    const categories = solo ? ['riddle'] : shuffle([...puzzleCategories]);
    const fragments = solo ? [mission.clues.riddle] : splitClueIntoFragments(mission.clues.logical, players.length);
    const assignedIds = new Set<string>();
    for (const [index, player] of players.entries()) {
      const category = categories[index % categories.length];
      const pool = shuffle([...this.data.puzzles.values()].filter((puzzle) => puzzle.active && puzzle.category === category && !assignedIds.has(puzzle.id)));
      if (!pool.length) throw new HttpError(500, `No active ${category} puzzles are available.`);
      const puzzle = pool[0];
      assignedIds.add(puzzle.id);
      const assignment: PuzzleAssignment = {
        id: randomUUID(), team_id: team.id, player_id: player.id, puzzle_id: puzzle.id,
        clue_number: index + 1, clue: fragments[index], completed_at: null, hints_used: 0, attempts: []
      };
      this.data.assignments.set(assignment.id, assignment);
    }
    return true;
  }

  startSession(sessionId: string) {
    const session = this.data.sessions.get(sessionId);
    if (!session || !['ready', 'waiting_for_players'].includes(session.status)) throw new HttpError(409, 'Session cannot be started.');
    const teams = [...this.data.teams.values()].filter((team) => team.session_id === session.id).sort((a, b) => a.play_order - b.play_order);
    const minimumPlayers = session.game_mode === 'solo' ? 1 : 2;
    if (teams.length !== session.team_count || teams.some((team) => this.countTeamPlayers(team.id) < minimumPlayers || this.countTeamPlayers(team.id) > session.players_per_team)) throw new HttpError(409, `Every team needs at least ${minimumPlayers} player${minimumPlayers === 1 ? '' : 's'} and can have no more than ${session.players_per_team}.`);
    for (const team of teams) this.assignPuzzles(team.id);
    if (teams.some((team) => this.teamAssignments(team.id).length !== (session.game_mode === 'solo' ? 1 : this.countTeamPlayers(team.id)))) throw new HttpError(409, 'Puzzle assignments are not ready.');
    const now = this.now();
    session.status = 'running';
    session.started_at = iso(now);
    session.current_team_index = teams[0].play_order;
    this.activateTeam(teams[0], now);
    this.event(session.id, teams[0].id, null, 'session_started');
    this.notify(teams[0].id, 'team-activated');
    return { ok: true };
  }
  private activateTeam(team: Team, now: number) {
    const session = this.sessionForTeam(team);
    if (!session) return;
    team.status = 'active';
    team.phase = 'puzzles';
    team.activated_at = iso(now);
    team.phase_started_at = iso(now);
    team.phase_ends_at = iso(now + session.puzzle_seconds * 1000);
  }

  acceptMission(playerId: string) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player.team_id);
    if (team.status !== 'active') throw new HttpError(409, 'Your team is not active yet.');
    if (!player.mission_accepted_at) player.mission_accepted_at = iso(this.now());
    this.event(team.session_id, team.id, player.id, 'mission_accepted');
    this.notify(team.id, 'mission-accepted');
    return { ok: true };
  }

  private requirePlayer(playerId: string) {
    const player = this.data.players.get(playerId);
    if (!player) throw new HttpError(401, 'Player session expired. Join the game again.');
    return player;
  }
  private requireTeam(teamId: string) {
    const team = this.data.teams.get(teamId);
    if (!team) throw new HttpError(404, 'Team not found.');
    return team;
  }
  private requireOwnAssignment(player: Player, assignmentId: string) {
    const assignment = this.data.assignments.get(assignmentId);
    if (!assignment || assignment.team_id !== player.team_id || assignment.player_id !== player.id) throw new HttpError(403, 'Only the puzzle owner can access this assignment.');
    return assignment;
  }
  private requirePuzzlePhase(team: Team) {
    const session = this.sessionForTeam(team);
    if (!session || team.status !== 'active' || team.phase !== 'puzzles' || session.status !== 'running' || session.paused_at || !team.phase_ends_at || Date.parse(team.phase_ends_at) <= this.now()) throw new HttpError(409, 'Your puzzle is not accepting actions right now.');
    return session;
  }

  submitPuzzleAnswer(playerId: string, assignmentId: string, answerValue: unknown) {
    const player = this.requirePlayer(playerId);
    const answer = typeof answerValue === 'string' ? answerValue.trim() : '';
    if (!answer || answer.length > 500) throw new HttpError(400, 'Enter an answer of up to 500 characters.');
    if (!player.mission_accepted_at) throw new HttpError(409, 'Accept the mission before submitting.');
    const assignment = this.requireOwnAssignment(player, assignmentId);
    const team = this.requireTeam(player.team_id);
    this.requirePuzzlePhase(team);
    if (assignment.completed_at) return { correct: true, feedback: 'Correct. Your personal clue is unlocked.', alreadyCompleted: true };
    const cutoff = this.now() - 60_000;
    player.answerAttempts = player.answerAttempts.filter((time) => time > cutoff);
    if (player.answerAttempts.length >= 20) throw new HttpError(429, 'Too many attempts. Wait a minute before trying again.');
    player.answerAttempts.push(this.now());
    const puzzle = this.data.puzzles.get(assignment.puzzle_id);
    if (!puzzle) throw new HttpError(500, 'Puzzle content is unavailable.');
    const normalized = normalizeAnswer(answer);
    const correct = [puzzle.correct_answer, ...puzzle.accepted_answers].some((accepted) => normalizeAnswer(accepted) === normalized);
    assignment.attempts.push({ answer: answer.slice(0, 500), correct, created_at: iso(this.now()) });
    if (correct) {
      assignment.completed_at = iso(this.now());
      this.closeHelpForAssignment(assignment.id, 'completed');
      this.event(team.session_id, team.id, player.id, 'puzzle_solved');
      this.notify(team.id, 'clue-unlocked');
      this.tickSession(team.session_id);
      return { correct: true, feedback: 'Correct. Your personal clue is unlocked.', alreadyCompleted: false };
    }
    this.notify(team.id, 'puzzle-attempt');
    return { correct: false, feedback: 'Not quite. Compare notes and try again.', alreadyCompleted: false };
  }

  requestHint(playerId: string, assignmentId: string) {
    const player = this.requirePlayer(playerId);
    if (!player.mission_accepted_at) throw new HttpError(409, 'Accept the mission before requesting a hint.');
    const assignment = this.requireOwnAssignment(player, assignmentId);
    const team = this.requireTeam(player.team_id);
    const session = this.requirePuzzlePhase(team);
    if (!session.hints_enabled) throw new HttpError(409, 'Hints are disabled for this game.');
    if (assignment.completed_at || assignment.hints_used >= 2) throw new HttpError(409, 'No hints remain for this puzzle.');
    const puzzle = this.data.puzzles.get(assignment.puzzle_id);
    if (!puzzle) throw new HttpError(500, 'Puzzle content is unavailable.');
    const hint = assignment.hints_used === 0 ? puzzle.hint_one : puzzle.hint_two;
    assignment.hints_used += 1;
    team.hints_used += 1;
    team.penalty_seconds += 15;
    this.event(team.session_id, team.id, player.id, 'hint_used');
    this.notify(team.id, 'hint-used');
    return { hint };
  }

  submitFinalAnswer(playerId: string, answerValue: unknown) {
    const player = this.requirePlayer(playerId);
    const answer = typeof answerValue === 'string' ? answerValue.trim() : '';
    if (!answer || answer.length > 100) throw new HttpError(400, 'Enter a short secret word.');
    const team = this.requireTeam(player.team_id);
    const session = this.sessionForTeam(team);
    if (!player.mission_accepted_at || !session || team.status !== 'active' || !['collaboration', 'final_answer'].includes(team.phase) || session.status !== 'running' || session.paused_at || !team.phase_ends_at || Date.parse(team.phase_ends_at) <= this.now()) throw new HttpError(409, 'The final answer is not currently available.');
    const requiredClues = session.game_mode === 'solo' ? 1 : this.countTeamPlayers(team.id);
    if (this.teamAssignments(team.id).filter((assignment) => assignment.completed_at).length !== requiredClues) throw new HttpError(409, `Unlock all ${requiredClues} clue${requiredClues === 1 ? '' : 's'} first.`);
    if (team.incorrect_final_attempts >= 3) throw new HttpError(409, 'No final answer attempts remain.');
    team.final_attempts += 1;
    const correct = normalizeAnswer(answer) === normalizeAnswer(team.secret_word);
    if (correct) {
      team.status = 'completed'; team.phase = 'completed'; team.completed_at = iso(this.now());
      this.event(session.id, team.id, player.id, 'team_completed');
    } else {
      team.incorrect_final_attempts += 1; team.penalty_seconds += 10;
      this.event(session.id, team.id, player.id, 'incorrect_final_answer');
      if (team.incorrect_final_attempts >= 3) { team.status = 'failed'; team.phase = 'failed'; team.completed_at = iso(this.now()); }
    }
    this.notify(team.id, correct ? 'team-completed' : 'final-attempt');
    if (team.status === 'completed' || team.status === 'failed') this.finishTeam(team);
    return { correct, attemptsRemaining: Math.max(0, 3 - team.incorrect_final_attempts), feedback: correct ? 'The secret is unlocked. Mission complete.' : session.game_mode === 'solo' ? 'Not the secret word. Review your clue and try again.' : 'Not the secret word. Bring the clues together and try again.' };
  }

  createHelpRequest(playerId: string, assignmentId: string, messageValue: unknown) {
    const player = this.requirePlayer(playerId);
    if (!player.mission_accepted_at) throw new HttpError(409, 'Accept the mission before requesting help.');
    const assignment = this.requireOwnAssignment(player, assignmentId);
    const team = this.requireTeam(player.team_id);
    this.requirePuzzlePhase(team);
    if (assignment.completed_at) throw new HttpError(409, 'Your puzzle is already solved.');
    if (this.activeRequests(team.id).some((request) => request.assignment_id === assignment.id)) throw new HttpError(409, 'Your help request is already open.');
    const message = String(messageValue ?? '').trim();
    if (message.length > 300) throw new HttpError(400, 'Help request messages can be up to 300 characters.');
    const request: HelpRequest = {
      id: randomUUID(), team_id: team.id, owner_player_id: player.id, assignment_id: assignment.id,
      message, status: 'requested', expires_at: iso(Math.min(this.now() + HELP_REQUEST_TTL_MS, Date.parse(team.phase_ends_at!))),
      created_at: iso(this.now()), closed_at: null, helper_ids: new Set(), accepted_helper_ids: new Set(), declined_by: new Set()
    };
    this.data.helpRequests.set(request.id, request);
    this.event(team.session_id, team.id, player.id, 'help_requested');
    this.notify(team.id, 'help-requested');
    return { ok: true, id: request.id };
  }

  acceptHelp(playerId: string, requestId: string) {
    const player = this.requirePlayer(playerId);
    const request = this.requireHelpRequest(requestId, player.team_id);
    const owner = this.requirePlayer(request.owner_player_id);
    const assignment = this.data.assignments.get(request.assignment_id);
    const team = this.requireTeam(player.team_id);
    this.requirePuzzlePhase(team);
    if (player.id === owner.id) throw new HttpError(400, 'Puzzle owners cannot accept their own request.');
    if (!player.connected || this.now() - Date.parse(player.last_seen_at) > 30_000) throw new HttpError(409, 'Only a connected teammate can accept.');
    if (!assignment || assignment.completed_at || !['requested', 'accepted', 'active'].includes(request.status) || Date.parse(request.expires_at) <= this.now()) throw new HttpError(409, 'Help request is no longer available.');
    if (request.helper_ids.has(player.id)) throw new HttpError(409, 'You already joined this help session.');
    if (request.helper_ids.size >= MAX_HELPERS_PER_REQUEST) throw new HttpError(409, 'This request already has two helpers.');
    request.helper_ids.add(player.id);
    request.accepted_helper_ids.add(player.id);
    request.status = 'accepted';
    request.expires_at = team.phase_ends_at!;
    this.event(team.session_id, team.id, player.id, 'help_accepted');
    this.notify(team.id, 'help-accepted');
    return { ok: true };
  }

  declineHelp(playerId: string, requestId: string) {
    const player = this.requirePlayer(playerId);
    const request = this.requireHelpRequest(requestId, player.team_id);
    if (request.owner_player_id === player.id) throw new HttpError(400, 'The requester cannot decline their own request.');
    if (!['requested', 'accepted', 'active'].includes(request.status)) throw new HttpError(409, 'This request is already closed.');
    request.declined_by.add(player.id);
    return { ok: true };
  }

  cancelHelp(playerId: string, requestId: string) {
    const player = this.requirePlayer(playerId);
    const request = this.requireHelpRequest(requestId, player.team_id);
    if (request.owner_player_id !== player.id) throw new HttpError(403, 'Only the requester can cancel this request.');
    if (['completed', 'cancelled', 'expired'].includes(request.status)) throw new HttpError(409, 'This request is already closed.');
    this.closeHelpRequest(request, 'cancelled');
    this.notify(player.team_id, 'help-cancelled');
    return { ok: true };
  }

  leaveHelp(playerId: string, requestId: string) {
    const player = this.requirePlayer(playerId);
    const request = this.requireHelpRequest(requestId, player.team_id);
    if (request.owner_player_id === player.id) throw new HttpError(403, 'The requester cannot leave their own session.');
    if (!request.helper_ids.delete(player.id)) throw new HttpError(403, 'You are not an active helper in this session.');
    if (request.helper_ids.size === 0 && ['accepted', 'active'].includes(request.status)) request.status = 'requested';
    this.notify(player.team_id, 'helper-left');
    return { ok: true };
  }

  sendHelpMessage(playerId: string, requestId: string, messageValue: unknown) {
    const player = this.requirePlayer(playerId);
    const request = this.requireHelpRequest(requestId, player.team_id);
    if (request.owner_player_id !== player.id && !request.helper_ids.has(player.id)) throw new HttpError(403, 'You are not part of this help session.');
    if (!['accepted', 'active'].includes(request.status) || Date.parse(request.expires_at) <= this.now()) throw new HttpError(409, 'This help session is closed.');
    const body = String(messageValue ?? '').trim();
    if (!body || body.length > 1000) throw new HttpError(400, 'Message must be 1 to 1000 characters.');
    this.data.helpMessages.push({ id: randomUUID(), request_id: request.id, sender_player_id: player.id, body, created_at: iso(this.now()) });
    request.status = 'active';
    this.notify(player.team_id, 'help-message');
    return { ok: true };
  }

  private requireHelpRequest(requestId: string, teamId: string) {
    const request = this.data.helpRequests.get(requestId);
    if (!request || request.team_id !== teamId) throw new HttpError(404, 'Help request not found.');
    return request;
  }
  private closeHelpRequest(request: HelpRequest, status: 'completed' | 'cancelled' | 'expired') {
    request.status = status;
    request.closed_at = iso(this.now());
    request.helper_ids.clear();
  }
  private closeHelpForAssignment(assignmentId: string, status: 'completed' | 'cancelled' | 'expired') {
    for (const request of this.activeRequests()) if (request.assignment_id === assignmentId) this.closeHelpRequest(request, status);
  }

  sendTeamMessage(playerId: string, messageValue: unknown) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player.team_id);
    const session = this.sessionForTeam(team);
    const body = String(messageValue ?? '').trim();
    if (!body || body.length > 1000) throw new HttpError(400, 'Message must be 1 to 1000 characters.');
    if (team.status !== 'active' || session?.status !== 'running') throw new HttpError(409, 'Team chat is available while your team is active.');
    const message = { id: randomUUID(), team_id: team.id, sender_player_id: player.id, body, system: false, created_at: iso(this.now()) };
    this.data.teamMessages.push(message);
    this.notify(team.id, 'team-message');
    return { ok: true };
  }

  stateForPlayer(playerId: string) {
    this.expireAndAdvance();
    const player = this.requirePlayer(playerId);
    player.last_seen_at = iso(this.now()); player.connected = true;
    const team = this.requireTeam(player.team_id);
    const session = this.sessionForTeam(team);
    if (!session) throw new HttpError(404, 'Game not found.');
    const players = this.teamPlayers(team.id);
    const assignments = this.teamAssignments(team.id);
    const playerById = new Map(players.map((entry) => [entry.id, entry]));
    const clues = assignments.map((assignment) => {
      const puzzle = this.data.puzzles.get(assignment.puzzle_id);
      const owner = playerById.get(assignment.player_id);
      return {
        clueNumber: assignment.clue_number, playerId: assignment.player_id, playerName: owner?.display_name ?? 'Player',
        category: puzzle?.category, completed: Boolean(assignment.completed_at),
        clue: assignment.completed_at && (session.game_mode === 'solo' || assignment.player_id === player.id || team.status !== 'active') ? assignment.clue : null,
        completedAt: assignment.completed_at
      };
    });
    const ownAssignments = assignments.filter((assignment) => assignment.player_id === player.id);
    const playerPuzzles = team.status === 'active' && player.mission_accepted_at ? ownAssignments.flatMap((assignment) => {
      const puzzle = this.data.puzzles.get(assignment.puzzle_id);
      if (!puzzle) return [];
      return [{
        id: assignment.id, completed: Boolean(assignment.completed_at), hintsUsed: assignment.hints_used,
        clue: assignment.completed_at ? assignment.clue : null,
        details: { ...safePuzzle(puzzle), image_url: puzzle.image_url ? `/api/puzzle-image/${assignment.id}` : null }
      }];
    }) : [];
    const playerPuzzle = playerPuzzles.find((puzzle) => !puzzle.completed) ?? playerPuzzles[0] ?? null;
    const requests = this.activeRequests(team.id).filter((request) => Date.parse(request.expires_at) > this.now());
    const visibleSessions = requests.filter((request) => request.owner_player_id === player.id || request.helper_ids.has(player.id));
    const helpSessions = visibleSessions.map((request) => {
      const assignment = this.data.assignments.get(request.assignment_id);
      const puzzle = assignment ? this.data.puzzles.get(assignment.puzzle_id) : undefined;
      const owner = this.data.players.get(request.owner_player_id);
      return {
        id: request.id, status: request.status, ownerId: request.owner_player_id, ownerName: owner?.display_name ?? 'Teammate',
        message: request.message, expiresAt: request.expires_at,
        puzzle: puzzle && assignment ? { ...safePuzzle(puzzle), image_url: puzzle.image_url ? `/api/puzzle-image/${assignment.id}` : null } : null,
        helpers: [...request.helper_ids].map((id) => ({ id, name: this.data.players.get(id)?.display_name ?? 'Teammate' })),
        messages: this.data.helpMessages.filter((message) => message.request_id === request.id).map((message) => ({
          id: message.id, senderId: message.sender_player_id, senderName: this.data.players.get(message.sender_player_id)?.display_name ?? 'Teammate',
          body: message.body, createdAt: message.created_at
        }))
      };
    });
    const helpRequests = requests.filter((request) => request.owner_player_id === player.id || !request.declined_by.has(player.id)).map((request) => {
      const assignment = this.data.assignments.get(request.assignment_id);
      const puzzle = assignment ? this.data.puzzles.get(assignment.puzzle_id) : undefined;
      return {
        id: request.id, ownerId: request.owner_player_id, assignmentId: request.assignment_id,
        ownerName: this.data.players.get(request.owner_player_id)?.display_name ?? 'Teammate',
        message: request.message, status: request.status, expiresAt: request.expires_at,
        category: puzzle?.category, title: puzzle?.title,
        helpers: [...request.helper_ids].map((id) => ({ id, name: this.data.players.get(id)?.display_name ?? 'Teammate' }))
      };
    });
    const theme = themeById(session.theme);
    const teamView = {
      id: team.id, name: team.name, play_order: team.play_order, status: team.status, phase: team.phase,
      phase_started_at: team.phase_started_at, phase_ends_at: team.phase_ends_at, activated_at: team.activated_at,
      completed_at: team.completed_at, session_id: team.session_id, incorrect_final_attempts: team.incorrect_final_attempts,
      penalty_seconds: team.penalty_seconds, hints_used: team.hints_used, queuePosition: team.play_order,
      players: Array.from({ length: session.players_per_team }, (_, index) => {
        const entry = players[index];
        return entry ? { id: entry.id, name: entry.display_name, connected: entry.connected, acceptedMission: Boolean(entry.mission_accepted_at) } : null;
      }), clues, remainingSeconds: team.phase_ends_at ? Math.max(0, Math.ceil((Date.parse(team.phase_ends_at) - this.now()) / 1000)) : null
    };
    const result = this.data.results.get(team.id);
    const teamMessages = this.data.teamMessages.filter((message) => message.team_id === team.id).slice(-100).map((message) => ({
      id: message.id, body: message.body, system: message.system, createdAt: message.created_at,
      senderName: message.sender_player_id ? this.data.players.get(message.sender_player_id)?.display_name ?? 'Player' : 'System'
    }));
    return {
      serverNow: this.now(), player: { id: player.id, name: player.display_name, acceptedMission: Boolean(player.mission_accepted_at) },
      session: {
        id: session.id, name: session.name, pin: session.pin, theme: session.theme, game_mode: session.game_mode, status: session.status, team_count: session.team_count,
        players_per_team: session.players_per_team, puzzle_seconds: session.puzzle_seconds, collaboration_seconds: session.collaboration_seconds, final_seconds: session.final_seconds,
        hints_enabled: session.hints_enabled, surprise_events: session.surprise_events, started_at: session.started_at,
        completed_at: session.completed_at, paused_at: session.paused_at, paused: Boolean(session.paused_at),
        themeInfo: { id: theme.id, title: theme.title, symbol: theme.symbol, intro: theme.intro, success: theme.success, timeout: theme.timeout }
      },
      team: teamView, puzzle: playerPuzzle, puzzles: playerPuzzles,
      revealedSecret: session.status === 'completed' ? team.secret_word : null,
      result: result ? { success: result.success, raw_seconds: result.raw_seconds, penalty_seconds: result.penalty_seconds,
        adjusted_seconds: result.adjusted_seconds, hints_used: result.hints_used, incorrect_final_attempts: result.incorrect_final_attempts,
        assistance_requests: result.assistance_requests, accepted_help_requests: result.accepted_help_requests,
        unique_helpers: result.unique_helpers, assisted_puzzles: result.assisted_puzzles, rank: result.rank } : null,
      helpRequests, helpSessions, teamMessages
    };
  }

  adminDashboard() {
    const sessions = [...this.data.sessions.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map((session) => {
      const teams = [...this.data.teams.values()].filter((team) => team.session_id === session.id).sort((a, b) => a.play_order - b.play_order)
        .map((team) => ({ id: team.id, name: team.name, status: team.status, phase: team.phase }));
      const playerCount = teams.reduce((count, team) => count + this.countTeamPlayers(team.id), 0);
      return { id: session.id, name: session.name, pin: session.pin, theme: session.theme, game_mode: session.game_mode, status: session.status,
        team_count: session.team_count, players_per_team: session.players_per_team, created_at: session.created_at, teams, playerCount };
    });
    return {
      sessions,
      totals: {
        sessions: this.data.sessions.size, teams: this.data.teams.size, players: this.data.players.size,
        completed: [...this.data.teams.values()].filter((team) => team.status === 'completed').length
      }
    };
  }

  adminSession(sessionId: string) {
    this.expireAndAdvance();
    const session = this.data.sessions.get(sessionId);
    if (!session) throw new HttpError(404, 'Session not found.');
    const teams = [...this.data.teams.values()].filter((team) => team.session_id === session.id).sort((a, b) => a.play_order - b.play_order).map((team) => {
      const assignments = this.teamAssignments(team.id);
      const players = this.teamPlayers(team.id).map((player) => {
        const playerAssignments = assignments.filter((entry) => entry.player_id === player.id);
        const categories = playerAssignments.map((assignment) => this.data.puzzles.get(assignment.puzzle_id)?.category).filter(Boolean);
        return { id: player.id, display_name: player.display_name, connected: player.connected, last_seen_at: player.last_seen_at,
          puzzleCategory: categories.length ? categories.join(', ') : null,
          puzzleCompleted: playerAssignments.length > 0 && playerAssignments.every((assignment) => Boolean(assignment.completed_at)),
          puzzleCount: playerAssignments.length };
      });
      const requests = [...this.data.helpRequests.values()].filter((request) => request.team_id === team.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
      const lastMessage = this.data.teamMessages.filter((message) => message.team_id === team.id).at(-1);
      const result = this.data.results.get(team.id);
      const attempts = assignments.reduce((count, assignment) => count + assignment.attempts.length, 0);
      return {
        id: team.id, name: team.name, play_order: team.play_order, status: team.status, phase: team.phase,
        phase_started_at: team.phase_started_at, phase_ends_at: team.phase_ends_at, activated_at: team.activated_at,
        completed_at: team.completed_at, secret_word: session.status === 'completed' ? team.secret_word : undefined,
        players, clueCount: assignments.filter((assignment) => assignment.completed_at).length,
        helpRequests: requests.map((request) => ({ id: request.id, status: request.status, owner_player_id: request.owner_player_id, message: request.message, created_at: request.created_at })),
        lastChat: lastMessage ? { body: lastMessage.body, createdAt: lastMessage.created_at, senderName: this.data.players.get(lastMessage.sender_player_id ?? '')?.display_name ?? 'System' } : null,
        result: result ? { ...result, success: result.success } : null, attemptCount: attempts
      };
    });
    return { session: { ...session }, teams };
  }

  adminAction(sessionId: string, input: Record<string, unknown>) {
    const session = this.data.sessions.get(sessionId);
    if (!session) throw new HttpError(404, 'Session not found.');
    const action = String(input.action ?? '');
    if (action === 'start') return this.startSession(sessionId);
    if (action === 'pause' || action === 'resume') {
      if (session.status !== 'running') throw new HttpError(409, 'Only a running session can be paused or resumed.');
      if (action === 'pause') {
        if (session.paused_at) throw new HttpError(409, 'Session is already paused.');
        const activeTeam = [...this.data.teams.values()].find((team) => team.session_id === session.id && team.status === 'active');
        session.remaining_time_before_pause = activeTeam?.phase_ends_at ? Math.max(0, Math.ceil((Date.parse(activeTeam.phase_ends_at) - this.now()) / 1000)) : null;
        session.paused_at = iso(this.now());
      } else {
        if (!session.paused_at) throw new HttpError(409, 'Session is not paused.');
        const elapsed = this.now() - Date.parse(session.paused_at);
        session.paused_seconds += Math.floor(elapsed / 1000);
        const activeTeam = [...this.data.teams.values()].find((team) => team.session_id === session.id && team.status === 'active');
        if (activeTeam) {
          if (activeTeam.phase_ends_at) activeTeam.phase_ends_at = iso(Date.parse(activeTeam.phase_ends_at) + elapsed);
          if (activeTeam.phase_started_at) activeTeam.phase_started_at = iso(Date.parse(activeTeam.phase_started_at) + elapsed);
          activeTeam.paused_seconds += Math.floor(elapsed / 1000);
          for (const request of this.activeRequests(activeTeam.id)) request.expires_at = iso(Date.parse(request.expires_at) + elapsed);
        }
        session.paused_at = null;
        session.remaining_time_before_pause = null;
      }
      this.event(session.id, null, null, action === 'pause' ? 'admin_paused' : 'admin_resumed');
      for (const team of this.data.teams.values()) if (team.session_id === session.id) this.notify(team.id, action);
      return { ok: true };
    }
    if (action === 'rename') {
      const team = this.data.teams.get(String(input.teamId ?? ''));
      const name = String(input.name ?? '').trim();
      if (!team || team.session_id !== session.id || team.status !== 'waiting') throw new HttpError(409, 'Only a waiting team in this session can be renamed.');
      if (!name || name.length > 32) throw new HttpError(400, 'Team name must be 1 to 32 characters.');
      if ([...this.data.teams.values()].some((other) => other.session_id === session.id && other.id !== team.id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new HttpError(409, 'Team names must be unique.');
      team.name = name; this.notify(team.id, 'team-renamed'); return { ok: true };
    }
    if (action === 'shuffle') {
      if (!['waiting_for_players', 'ready'].includes(session.status)) throw new HttpError(409, 'Teams can only be shuffled before the session starts.');
      const teams = shuffle([...this.data.teams.values()].filter((team) => team.session_id === session.id));
      teams.forEach((team, index) => { team.play_order = index + 1; });
      this.event(session.id, null, null, 'teams_shuffled'); return { ok: true };
    }
    if (action === 'reassign') {
      if (!['waiting_for_players', 'ready'].includes(session.status)) throw new HttpError(409, 'Players can only be reassigned before the session starts.');
      const player = this.data.players.get(String(input.playerId ?? ''));
      const target = this.data.teams.get(String(input.targetTeamId ?? ''));
      const source = player ? this.data.teams.get(player.team_id) : undefined;
      if (!player || !source || !target || source.session_id !== session.id || target.session_id !== session.id || source.id === target.id) throw new HttpError(409, 'Choose a valid player and destination team.');
      if (this.countTeamPlayers(target.id) >= session.players_per_team) throw new HttpError(409, `That team has reached its ${session.players_per_team}-player limit.`);
      if (this.teamPlayers(target.id).some((entry) => entry.display_name.toLocaleLowerCase() === player.display_name.toLocaleLowerCase())) throw new HttpError(409, 'That name already exists on the destination team.');
      for (const team of [source, target]) for (const assignment of this.teamAssignments(team.id)) this.data.assignments.delete(assignment.id);
      player.team_id = target.id; source.status = 'waiting'; target.status = 'waiting';
      this.assignPuzzles(source.id); this.assignPuzzles(target.id);
      const minimumPlayers = session.game_mode === 'solo' ? 1 : 2;
      session.status = [...this.data.teams.values()].filter((team) => team.session_id === session.id).every((team) => this.countTeamPlayers(team.id) >= minimumPlayers) ? 'ready' : 'waiting_for_players';
      this.notify(source.id, 'player-reassigned'); this.notify(target.id, 'player-reassigned'); return { ok: true, playerId: player.id, sourceTeamId: source.id, targetTeamId: target.id };
    }
    throw new HttpError(400, 'Unknown action.');
  }

  adminPuzzleList() { return [...this.data.puzzles.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)); }
  savePuzzle(id: string | null, values: Omit<Puzzle, 'id' | 'created_at'>, image?: UploadedImage | null) {
    if (id) {
      const puzzle = this.data.puzzles.get(id);
      if (!puzzle) throw new HttpError(404, 'Puzzle not found.');
      if ([...this.data.assignments.values()].some((assignment) => assignment.puzzle_id === id && this.data.teams.get(assignment.team_id)?.status === 'active')) throw new HttpError(409, 'This puzzle is assigned to a live team and cannot be edited yet.');
      if (image) {
        const imageId = randomUUID(); this.data.uploadedImages.set(imageId, image); values.image_url = `upload:${imageId}`;
      }
      Object.assign(puzzle, values);
      return { id: puzzle.id };
    }
    if ([...this.data.puzzles.values()].some((puzzle) => puzzle.category === values.category && puzzle.title.toLocaleLowerCase() === values.title.toLocaleLowerCase())) throw new HttpError(409, 'A puzzle with this title already exists in that category.');
    if (image) { const imageId = randomUUID(); this.data.uploadedImages.set(imageId, image); values.image_url = `upload:${imageId}`; }
    const puzzle: Puzzle = { ...values, id: randomUUID(), created_at: iso(this.now()) };
    this.data.puzzles.set(puzzle.id, puzzle);
    return { id: puzzle.id };
  }
  togglePuzzle(id: string, active: boolean) {
    const puzzle = this.data.puzzles.get(id);
    if (!puzzle) throw new HttpError(404, 'Puzzle not found.');
    puzzle.active = active; return { ok: true };
  }

  async puzzleImage(playerId: string, assignmentId: string) {
    const player = this.requirePlayer(playerId);
    const assignment = this.data.assignments.get(assignmentId);
    if (!assignment || assignment.team_id !== player.team_id) throw new HttpError(404, 'Image not found.');
    let authorized = assignment.player_id === player.id;
    if (!authorized) authorized = [...this.activeRequests(player.team_id)].some((request) => request.assignment_id === assignment.id && request.helper_ids.has(player.id));
    if (!authorized) throw new HttpError(404, 'Image not found.');
    const puzzle = this.data.puzzles.get(assignment.puzzle_id);
    if (!puzzle?.image_url) throw new HttpError(404, 'Image not found.');
    if (puzzle.image_url.startsWith('upload:')) {
      const image = this.data.uploadedImages.get(puzzle.image_url.slice('upload:'.length));
      if (!image) throw new HttpError(404, 'Image not found.');
      return image;
    }
    if (!/^visual-\d{2}\.svg$/.test(puzzle.image_url)) throw new HttpError(404, 'Image not found.');
    let assetRoot = path.resolve(process.cwd(), 'puzzle-assets');
    try { return { data: await readFile(path.join(assetRoot, puzzle.image_url)), mimeType: 'image/svg+xml' }; }
    catch {
      assetRoot = path.resolve(process.cwd(), '../puzzle-assets');
      try { return { data: await readFile(path.join(assetRoot, puzzle.image_url)), mimeType: 'image/svg+xml' }; }
      catch { throw new HttpError(404, 'Image not found.'); }
    }
  }

  private expireAndAdvance() {
    for (const request of this.activeRequests()) {
      if (Date.parse(request.expires_at) <= this.now()) this.closeHelpRequest(request, 'expired');
    }
    for (const session of this.data.sessions.values()) this.tickSession(session.id);
    const cutoff = this.now() - 30_000;
    for (const player of this.data.players.values()) {
      if (player.connected && Date.parse(player.last_seen_at) < cutoff) this.markDisconnected(player.id);
      if (!player.connected && player.disconnected_at && this.now() - Date.parse(player.disconnected_at) > 15_000) {
        for (const request of this.activeRequests(player.team_id)) {
          if (request.helper_ids.delete(player.id) && request.helper_ids.size === 0 && ['accepted', 'active'].includes(request.status)) request.status = 'requested';
        }
        player.disconnected_at = null;
      }
    }
  }
  tickAll() { this.expireAndAdvance(); }
  private tickSession(sessionId: string) {
    const session = this.data.sessions.get(sessionId);
    if (!session || session.status !== 'running' || session.paused_at) return;
    const team = [...this.data.teams.values()].find((entry) => entry.session_id === sessionId && entry.status === 'active');
    if (!team) return;
    const now = this.now();
    if (team.phase === 'completed' || team.phase === 'failed') { this.finishTeam(team); return; }
    if (team.phase === 'puzzles') {
      const puzzleCount = session.game_mode === 'solo' ? 1 : this.countTeamPlayers(team.id);
      if (this.teamAssignments(team.id).length === puzzleCount && this.teamAssignments(team.id).every((assignment) => assignment.completed_at)) {
        const nextPhase = session.game_mode === 'solo' ? 'final_answer' : 'collaboration';
        const nextDuration = session.game_mode === 'solo' ? session.final_seconds : session.collaboration_seconds;
        this.startPhase(team, nextPhase, nextDuration, now);
        this.closeRequestsForTeam(team.id, 'completed');
        this.notify(team.id, 'phase-changed');
        this.event(session.id, team.id, null, session.game_mode === 'solo' ? 'final_answer_started' : 'collaboration_started');
        return;
      }
      if (team.phase_ends_at && Date.parse(team.phase_ends_at) <= now) {
        team.status = 'failed'; team.phase = 'failed'; team.completed_at = iso(now);
        this.event(session.id, team.id, null, 'team_failed'); this.notify(team.id, 'game-failed'); this.finishTeam(team);
      }
      return;
    }
    if (team.phase_ends_at && Date.parse(team.phase_ends_at) <= now) {
      if (team.phase === 'collaboration') {
        this.startPhase(team, 'final_answer', session.final_seconds, now);
        this.notify(team.id, 'phase-changed'); this.event(session.id, team.id, null, 'final_answer_started');
      } else {
        team.status = 'failed'; team.phase = 'failed'; team.completed_at = iso(now);
        this.event(session.id, team.id, null, 'team_failed'); this.notify(team.id, 'game-failed'); this.finishTeam(team);
      }
    }
  }
  private startPhase(team: Team, phase: GamePhase, seconds: number, now: number) {
    team.phase = phase; team.phase_started_at = iso(now); team.phase_ends_at = iso(now + seconds * 1000);
  }
  private closeRequestsForTeam(teamId: string, status: 'completed' | 'cancelled' | 'expired') {
    for (const request of this.activeRequests(teamId)) this.closeHelpRequest(request, status);
  }
  private finishTeam(team: Team) {
    const session = this.sessionForTeam(team);
    if (!session || this.data.results.has(team.id)) return;
    const now = this.now();
    team.completed_at ??= iso(now);
    team.status = team.phase === 'completed' || team.status === 'completed' ? 'completed' : 'failed';
    team.phase = team.status;
    this.closeRequestsForTeam(team.id, 'completed');
    const elapsed = Math.max(1, Math.floor((Date.parse(team.completed_at) - Date.parse(team.activated_at ?? team.completed_at)) / 1000) - team.paused_seconds);
    const requests = [...this.data.helpRequests.values()].filter((request) => request.team_id === team.id);
    const acceptedRequests = requests.filter((request) => request.accepted_helper_ids.size > 0);
    const helperIds = new Set(acceptedRequests.flatMap((request) => [...request.accepted_helper_ids]));
    const result: TeamResult = {
      team_id: team.id, success: team.status === 'completed', raw_seconds: elapsed,
      penalty_seconds: team.penalty_seconds, adjusted_seconds: adjustedSeconds(elapsed, team.penalty_seconds),
      hints_used: team.hints_used, incorrect_final_attempts: team.incorrect_final_attempts,
      assistance_requests: requests.length, accepted_help_requests: acceptedRequests.length,
      unique_helpers: helperIds.size, assisted_puzzles: new Set(acceptedRequests.map((request) => request.assignment_id)).size, rank: null
    };
    this.data.results.set(team.id, result);
    this.event(session.id, team.id, null, team.status === 'completed' ? 'team_completed' : 'team_failed');
    const next = [...this.data.teams.values()].filter((candidate) => candidate.session_id === session.id && candidate.status === 'waiting').sort((a, b) => a.play_order - b.play_order)[0];
    if (next) {
      session.current_team_index = next.play_order;
      this.activateTeam(next, now);
      this.event(session.id, next.id, null, 'team_activated');
      this.notify(next.id, 'team-activated');
    } else {
      session.status = 'completed'; session.completed_at = iso(now);
      const ranked = rankTeams([...this.data.results.values()].filter((entry) => this.data.teams.get(entry.team_id)?.session_id === session.id).map((entry) => ({ id: entry.team_id, success: entry.success, rawSeconds: entry.raw_seconds, penaltySeconds: entry.penalty_seconds })));
      ranked.forEach((entry, index) => { const result = this.data.results.get(entry.id); if (result) result.rank = index + 1; });
      this.event(session.id, null, null, 'session_completed');
      for (const candidate of this.data.teams.values()) if (candidate.session_id === session.id) this.notify(candidate.id, 'session-completed');
    }
    this.notify(team.id, team.status === 'completed' ? 'game-completed' : 'game-failed');
  }
}
