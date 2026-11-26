import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../storage/InMemoryStore';
import { GameService } from './GameService';

let now: number;
let game: GameService;
function createOneTeam() {
  const session = game.createSession({ name: 'Local QA', theme: 'detective', numberOfTeams: 1, puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4 });
  const joined = Array.from({ length: 5 }, (_, index) => game.join(session.pin, `Agent ${index + 1}`));
  return { ...session, players: joined.map((entry) => entry.player), team: joined[0].team };
}
function assignmentFor(playerId: string) {
  const assignment = [...game.data.assignments.values()].find((entry) => entry.player_id === playerId);
  if (!assignment) throw new Error('Player puzzle assignment missing.');
  return assignment;
}
function solve(playerId: string) {
  const assignment = assignmentFor(playerId);
  const puzzle = game.data.puzzles.get(assignment.puzzle_id)!;
  return game.submitPuzzleAnswer(playerId, assignment.id, puzzle.correct_answer);
}

beforeEach(() => {
  now = Date.UTC(2026, 0, 1);
  game = new GameService(new InMemoryStore(), () => now);
});

describe('local room and puzzle behavior', () => {
  it('validates PINs, prevents duplicate names, fills capacity, and restores the existing token session', () => {
    const session = game.createSession({ name: 'Room test', theme: 'zigzag', numberOfTeams: 1, puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4 });
    expect(() => game.join('bad', 'One')).toThrow(/six-digit/i);
    const first = game.join(session.pin, 'Player One');
    expect(() => game.join(session.pin, 'player one')).toThrow(/already used/i);
    for (let i = 2; i <= 10; i++) game.join(session.pin, `Player ${i}`);
    expect(() => game.join(session.pin, 'Eleventh Player')).toThrow(/10-player capacity/i);
    const player = [...game.data.players.values()][0];
    expect(game.getPlayerByToken(first.token)?.id).toBe(player.id);
    expect(game.adminDashboard().sessions[0].playerCount).toBe(10);
  });

  it('allows a solo player to solve one easy riddle and submit the secret word', () => {
    const session = game.createSession({ name: 'Solo run', theme: 'detective', gameMode: 'solo', numberOfTeams: 1, playersPerTeam: 1, puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4 });
    const joined = game.join(session.pin, 'Solo Detective');
    expect(game.data.sessions.get(session.id)?.status).toBe('ready');
    game.startSession(session.id);
    game.acceptMission(joined.player.id);
    const state = game.stateForPlayer(joined.player.id);
    expect(state.puzzles).toHaveLength(1);
    expect(state.puzzles[0].details.category).toBe('riddle');
    expect([...game.data.assignments.values()].every((assignment) => assignment.player_id === joined.player.id)).toBe(true);
    for (const assignment of state.puzzles) {
      const puzzle = game.data.puzzles.get(assignment.details.id)!;
      expect(game.submitPuzzleAnswer(joined.player.id, assignment.id, puzzle.correct_answer).correct).toBe(true);
    }
    expect(game.data.teams.get(joined.team.id)?.phase).toBe('final_answer');
    expect(game.submitFinalAnswer(joined.player.id, joined.team.secret_word).correct).toBe(true);
    expect(game.data.sessions.get(session.id)?.status).toBe('completed');
  });

  it('balances one player into each team and allows both teams to start', () => {
    const session = game.createSession({ name: 'One each', theme: 'zigzag', numberOfTeams: 2, playersPerTeam: 1, puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4 });
    const first = game.join(session.pin, 'Team A player');
    const second = game.join(session.pin, 'Team B player');
    expect(first.team.id).not.toBe(second.team.id);
    expect(game.data.sessions.get(session.id)?.status).toBe('ready');
    expect(() => game.join(session.pin, 'Unexpected third player')).toThrow(/1-player capacity/i);
    game.startSession(session.id);
    expect([...game.data.teams.values()].filter((team) => team.session_id === session.id).map((team) => team.status)).toEqual(['active', 'waiting']);
    expect([...game.data.assignments.values()].filter((assignment) => assignment.team_id === first.team.id)).toHaveLength(5);
    expect([...game.data.assignments.values()].filter((assignment) => assignment.team_id === second.team.id)).toHaveLength(5);
  });

  it('assigns five distinct puzzle categories and never returns answer keys to player state', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    const assignments = [...game.data.assignments.values()].filter((entry) => entry.team_id === room.team.id);
    const categories = assignments.map((assignment) => game.data.puzzles.get(assignment.puzzle_id)!.category);
    expect(new Set(categories).size).toBe(5);
    game.acceptMission(room.players[0].id);
    const state = game.stateForPlayer(room.players[0].id);
    expect(state.puzzle?.details).not.toHaveProperty('correct_answer');
    expect(state.team.clues).toHaveLength(5);
  });
});

describe('assistance authorization and lifecycle', () => {
  it('lets an unsolved teammate view a private puzzle and message, while restricting answer submission to its owner', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    const owner = room.players[3];
    const helper = room.players[0];
    const ownerAssignment = assignmentFor(owner.id);
    const helperAssignment = assignmentFor(helper.id);
    const created = game.createHelpRequest(owner.id, ownerAssignment.id, 'Please look at this pattern.');
    game.acceptHelp(helper.id, created.id);
    const helperState = game.stateForPlayer(helper.id);
    const privateSession = helperState.helpSessions.find((entry) => entry.id === created.id);
    expect(privateSession?.puzzle?.question).toBe(game.data.puzzles.get(ownerAssignment.puzzle_id)?.question);
    expect(privateSession?.puzzle).not.toHaveProperty('correct_answer');
    expect(helperState.puzzle?.id).toBe(helperAssignment.id);
    expect(helperState.puzzle?.completed).toBe(false);
    expect(() => game.submitPuzzleAnswer(helper.id, ownerAssignment.id, 'answer')).toThrow(/only the puzzle owner/i);
    game.sendHelpMessage(helper.id, created.id, 'Look at the shapes from left to right.');
    expect(game.stateForPlayer(owner.id).helpSessions[0].messages[0].body).toContain('left to right');
    expect(solve(owner.id).correct).toBe(true);
    expect(game.stateForPlayer(helper.id).helpSessions).toHaveLength(0);
    expect(game.data.teams.get(room.team.id)?.penalty_seconds).toBe(0);
  });

  it('restores an accepted help session after a brief browser-refresh disconnect and expires a sustained disconnect', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    const owner = room.players[4];
    const helper = room.players[0];
    const request = game.createHelpRequest(owner.id, assignmentFor(owner.id).id, 'Stay with me while I refresh.');
    game.acceptHelp(helper.id, request.id);
    game.markDisconnected(helper.id);
    game.markConnected(helper.id);
    expect(game.stateForPlayer(helper.id).helpSessions.some((entry) => entry.id === request.id)).toBe(true);
    game.markDisconnected(helper.id);
    now += 16_000;
    game.tickAll();
    expect(game.stateForPlayer(owner.id).helpSessions[0].helpers).toHaveLength(0);
  });

  it('enforces a two-helper cap and rejects duplicate helper acceptance', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    const owner = room.players[4];
    const request = game.createHelpRequest(owner.id, assignmentFor(owner.id).id, 'Help');
    game.acceptHelp(room.players[0].id, request.id);
    expect(() => game.acceptHelp(room.players[0].id, request.id)).toThrow(/already joined/i);
    game.acceptHelp(room.players[1].id, request.id);
    expect(() => game.acceptHelp(room.players[2].id, request.id)).toThrow(/two helpers/i);
    expect(game.stateForPlayer(owner.id).helpSessions[0].helpers).toHaveLength(2);
  });
});

describe('server-controlled phases and scoring', () => {
  it('runs the full phase sequence, applies no assistance penalty, and records successful results', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    const assistance = game.createHelpRequest(room.players[4].id, assignmentFor(room.players[4].id).id, 'Help');
    game.acceptHelp(room.players[0].id, assistance.id);
    for (const player of room.players) expect(solve(player.id).correct).toBe(true);
    expect(game.data.teams.get(room.team.id)?.phase).toBe('collaboration');
    expect(game.data.teams.get(room.team.id)?.penalty_seconds).toBe(0);
    now += 3 * 60_000;
    game.tickAll();
    expect(game.data.teams.get(room.team.id)?.phase).toBe('final_answer');
    const result = game.submitFinalAnswer(room.players[0].id, room.team.secret_word);
    expect(result.correct).toBe(true);
    expect(game.data.sessions.get(room.id)?.status).toBe('completed');
    const stored = game.data.results.get(room.team.id)!;
    expect(stored.success).toBe(true);
    expect(stored.rank).toBe(1);
    expect(stored.accepted_help_requests).toBe(1);
    expect(stored.unique_helpers).toBe(1);
    expect(stored.penalty_seconds).toBe(0);
  });

  it('accepts the final secret immediately when all five clues unlock during collaboration', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    for (const player of room.players) solve(player.id);
    expect(game.data.teams.get(room.team.id)?.phase).toBe('collaboration');
    const playerState = game.stateForPlayer(room.players[0].id);
    expect(playerState.team.clues.every((clue: { completed: boolean }) => clue.completed)).toBe(true);
    expect(game.submitFinalAnswer(room.players[0].id, room.team.secret_word).correct).toBe(true);
    expect(game.data.sessions.get(room.id)?.status).toBe('completed');
  });

  it('applies hint and incorrect-final penalties, caps hints, and fails after three incorrect secrets', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    room.players.forEach((player) => game.acceptMission(player.id));
    const firstAssignment = assignmentFor(room.players[0].id);
    expect(game.requestHint(room.players[0].id, firstAssignment.id).hint).toBeTruthy();
    game.requestHint(room.players[0].id, firstAssignment.id);
    expect(() => game.requestHint(room.players[0].id, firstAssignment.id)).toThrow(/no hints remain/i);
    expect(room.team.penalty_seconds).toBe(30);
    for (const player of room.players) solve(player.id);
    now += 3 * 60_000;
    game.tickAll();
    game.submitFinalAnswer(room.players[0].id, 'not-the-word');
    game.submitFinalAnswer(room.players[0].id, 'still-wrong');
    const final = game.submitFinalAnswer(room.players[0].id, 'third-wrong-answer');
    expect(final.attemptsRemaining).toBe(0);
    const result = game.data.results.get(room.team.id)!;
    expect(result.success).toBe(false);
    expect(result.hints_used).toBe(2);
    expect(result.incorrect_final_attempts).toBe(3);
    expect(result.penalty_seconds).toBe(60);
  });

  it('activates teams in sequence and ranks every successful team above failed teams', () => {
    const session = game.createSession({ name: 'Sequence QA', theme: 'zigzag', numberOfTeams: 2, puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4 });
    const joined = Array.from({ length: 10 }, (_, index) => game.join(session.pin, `Competitor ${index + 1}`));
    const teams = [...game.data.teams.values()].filter((team) => team.session_id === session.id).sort((a, b) => a.play_order - b.play_order);
    const firstTeam = joined.filter((entry) => entry.team.id === teams[0].id).map((entry) => entry.player);
    game.startSession(session.id);
    expect(teams.map((team) => team.status)).toEqual(['active', 'waiting']);
    firstTeam.forEach((player) => game.acceptMission(player.id));
    firstTeam.forEach((player) => solve(player.id));
    now += 3 * 60_000;
    game.tickAll();
    expect(game.submitFinalAnswer(firstTeam[0].id, teams[0].secret_word).correct).toBe(true);
    expect(teams[1].status).toBe('active');
    now += 5 * 60_000;
    game.tickAll();
    expect(game.data.sessions.get(session.id)?.status).toBe('completed');
    expect(game.data.results.get(teams[0].id)?.rank).toBe(1);
    expect(game.data.results.get(teams[1].id)?.rank).toBe(2);
    expect(game.data.results.get(teams[1].id)?.success).toBe(false);
  });

  it('freezes and restores the authoritative deadline across an admin pause', () => {
    const room = createOneTeam();
    game.startSession(room.id);
    const team = game.data.teams.get(room.team.id)!;
    const originalDeadline = Date.parse(team.phase_ends_at!);
    game.adminAction(room.id, { action: 'pause' });
    expect(game.data.sessions.get(room.id)?.remaining_time_before_pause).toBe(300);
    now += 30_000;
    game.tickAll();
    expect(team.status).toBe('active');
    game.adminAction(room.id, { action: 'resume' });
    expect(Date.parse(team.phase_ends_at!)).toBe(originalDeadline + 30_000);
    expect(team.paused_seconds).toBe(30);
    expect(game.data.sessions.get(room.id)?.remaining_time_before_pause).toBeNull();
  });
});
