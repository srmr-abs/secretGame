import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server, type Socket } from 'socket.io';
import { puzzleCategories, normalizeAnswer } from '../../src/lib/themes';
import { GameService, ADMIN_COOKIE, PLAYER_COOKIE, HttpError } from './services/GameService';
import { readCookie, signAdminSession, verifyAdminSession, verifyPassword } from './utils/auth';
import type { Puzzle } from './types/game.types';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) callback(null, true);
  else callback(new HttpError(400, 'Upload a PNG, JPEG, or WebP image.'));
} });

function sendError(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  const message = known ? error.message : error instanceof Error ? error.message : 'Unexpected server error.';
  void _next;
  if (!known) console.error(error);
  response.status(status).json({ error: message });
}

function puzzleValues(form: Record<string, unknown>, existingImage: string | null = null): Omit<Puzzle, 'id' | 'created_at'> {
  const choices = String(form.choices ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
  const accepted = String(form.accepted_answers ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
  const category = String(form.category ?? '');
  const difficulty = String(form.difficulty ?? 'medium');
  const answer_type = String(form.answer_type ?? 'text');
  const title = String(form.title ?? '').trim();
  const question = String(form.question ?? '').trim();
  const correct_answer = String(form.correct_answer ?? '').trim();
  const hint_one = String(form.hint_one ?? '').trim();
  const hint_two = String(form.hint_two ?? '').trim();
  const personal_clue = String(form.personal_clue ?? '').trim();
  if (!title || !question || !correct_answer || !hint_one || !hint_two || !personal_clue) throw new HttpError(400, 'Title, question, answer, two hints, and personal clue are required.');
  if (title.length > 100 || question.length > 3000 || correct_answer.length > 300 || hint_one.length > 500 || hint_two.length > 500 || personal_clue.length > 500) throw new HttpError(400, 'One or more puzzle fields exceed their maximum length.');
  if (!puzzleCategories.includes(category as never) || !['easy', 'medium', 'hard'].includes(difficulty) || !['text', 'number', 'choice'].includes(answer_type)) throw new HttpError(400, 'Category, difficulty, or answer type is invalid.');
  if (answer_type === 'choice' && (choices.length < 2 || !choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(correct_answer)))) throw new HttpError(400, 'Multiple-choice puzzles need at least two choices and must include the correct answer.');
  return {
    title, category: category as Puzzle['category'], difficulty: difficulty as Puzzle['difficulty'], question,
    image_url: String(form.image_url ?? '').trim() || existingImage || undefined,
    answer_type: answer_type as Puzzle['answer_type'], choices: answer_type === 'choice' ? choices : undefined,
    correct_answer, accepted_answers: [...new Set([correct_answer, ...accepted])], hint_one, hint_two, personal_clue,
    active: String(form.active ?? 'true') !== 'false'
  };
}

export function createApp(frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000') {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: frontendUrl, credentials: true }, serveClient: true });
  const game = new GameService();
  const teamRoom = (teamId: string) => `team:${teamId}`;
  const adminRoom = (sessionId: string) => `admin-session:${sessionId}`;
  const adminEmail = (email: string) => email.toLocaleLowerCase() === String(process.env.ADMIN_EMAIL ?? '').trim().toLocaleLowerCase();

  game.setBroadcasters((teamId, kind) => {
    const team = game.data.teams.get(teamId);
    const payload = { teamId, kind, at: new Date().toISOString() };
    io.to(teamRoom(teamId)).emit('game-update', payload);
    io.to(teamRoom(teamId)).emit('game:state-updated', payload);
    if (team) {
      io.to(adminRoom(team.session_id)).emit('admin:team-status', { sessionId: team.session_id, teamId, kind });
      io.to(adminRoom(team.session_id)).emit('admin:state-updated', { sessionId: team.session_id, teamId, kind });
    }
  }, (sessionId, kind) => {
    io.to(adminRoom(sessionId)).emit('admin:team-status', { sessionId, kind });
  });

  app.disable('x-powered-by');
  app.use(cors({ origin: frontendUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'great-secret-unlock', storage: 'in-memory', puzzles: game.data.puzzles.size }));

  function currentPlayer(request: Request) {
    const player = game.getPlayerByToken(readCookie(request.headers.cookie, PLAYER_COOKIE));
    if (!player) throw new HttpError(401, 'Player session expired. Join the game again.');
    return player;
  }
  function requireAdmin(request: Request) {
    const email = verifyAdminSession(readCookie(request.headers.cookie, ADMIN_COOKIE));
    if (!email || !adminEmail(email)) throw new HttpError(401, 'Administrator access required.');
    return email;
  }
  function adminGuard(request: Request, _response: Response, next: NextFunction) {
    try { requireAdmin(request); next(); } catch (error) { next(error); }
  }
  function playerGuard(request: Request, _response: Response, next: NextFunction) {
    try { (request as Request & { playerId?: string }).playerId = currentPlayer(request).id; next(); } catch (error) { next(error); }
  }
  const playerId = (request: Request) => (request as Request & { playerId?: string }).playerId!;

  app.post('/api/admin/login', async (request, response, next) => {
    try {
      const email = String(request.body?.email ?? '').trim();
      const password = String(request.body?.password ?? '');
      if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH) throw new HttpError(503, 'Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in the local environment before signing in.');
      const validEmail = adminEmail(email);
      const validPassword = await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH);
      if (!validEmail || !validPassword) throw new HttpError(401, 'Email or password is incorrect.');
      response.cookie(ADMIN_COOKIE, signAdminSession(process.env.ADMIN_EMAIL), {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 60 * 60 * 1000
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post('/api/admin/logout', (_request, response) => {
    response.clearCookie(ADMIN_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    response.json({ ok: true });
  });
  app.get('/api/admin', adminGuard, (_request, response) => response.json(game.adminDashboard()));
  app.post('/api/admin', adminGuard, (request, response, next) => {
    try { response.status(201).json(game.createSession(request.body)); } catch (error) { next(error); }
  });
  app.get('/api/admin/session/:id', adminGuard, (request, response, next) => {
    try { response.json(game.adminSession(String(request.params.id))); } catch (error) { next(error); }
  });
  app.post('/api/admin/session/:id', adminGuard, (request, response, next) => {
    try {
      const result = game.adminAction(String(request.params.id), request.body ?? {});
      if ('playerId' in result) {
        for (const socket of io.sockets.sockets.values()) if (socket.data.playerId === result.playerId) {
          socket.leave(teamRoom(result.sourceTeamId));
          socket.join(teamRoom(result.targetTeamId));
          socket.data.teamId = result.targetTeamId;
          socket.emit('room:reassigned', { teamId: result.targetTeamId });
        }
      }
      response.json(result);
    } catch (error) { next(error); }
  });
  app.get('/api/admin/puzzles', adminGuard, (_request, response) => response.json({ puzzles: game.adminPuzzleList() }));
  app.post('/api/admin/puzzles', adminGuard, upload.single('image'), (request, response, next) => {
    try {
      const fields = request.body as Record<string, unknown>;
      const values = puzzleValues(fields);
      if (values.category === 'visual' && !request.file && !values.image_url) throw new HttpError(400, 'Visual puzzles require an image asset.');
      const image = request.file ? { data: request.file.buffer, mimeType: request.file.mimetype } : null;
      response.status(201).json(game.savePuzzle(null, values, image));
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/puzzles/:id', adminGuard, upload.single('image'), (request, response, next) => {
    try {
      const id = String(request.params.id);
      const existing = game.data.puzzles.get(id);
      if (!existing) throw new HttpError(404, 'Puzzle not found.');
      if (String(request.body?.action ?? '') === 'toggle') {
        response.json(game.togglePuzzle(id, String(request.body.active) === 'true'));
        return;
      }
      const values = puzzleValues(request.body as Record<string, unknown>, existing.image_url ?? null);
      if (values.category === 'visual' && !request.file && !values.image_url) throw new HttpError(400, 'Visual puzzles require an image asset.');
      const image = request.file ? { data: request.file.buffer, mimeType: request.file.mimetype } : null;
      response.json(game.savePuzzle(id, values, image));
    } catch (error) { next(error); }
  });

  app.post('/api/join', (request, response, next) => {
    try {
      const joined = game.join(request.body?.pin, request.body?.name);
      response.cookie(PLAYER_COOKIE, joined.token, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000
      });
      response.json({ ok: true, teamName: joined.team.name });
    } catch (error) { next(error); }
  });
  app.get('/api/game/state', playerGuard, (request, response, next) => {
    try { response.json(game.stateForPlayer(playerId(request))); } catch (error) { next(error); }
  });
  app.post('/api/game/accept', playerGuard, (request, response, next) => {
    try { response.json(game.acceptMission(playerId(request))); } catch (error) { next(error); }
  });
  app.post('/api/puzzle/answer', playerGuard, (request, response, next) => {
    try { response.json(game.submitPuzzleAnswer(playerId(request), String(request.body?.assignmentId ?? ''), request.body?.answer)); } catch (error) { next(error); }
  });
  app.post('/api/puzzle/hint', playerGuard, (request, response, next) => {
    try { response.json(game.requestHint(playerId(request), String(request.body?.assignmentId ?? ''))); } catch (error) { next(error); }
  });
  app.post('/api/final', playerGuard, (request, response, next) => {
    try { response.json(game.submitFinalAnswer(playerId(request), request.body?.answer)); } catch (error) { next(error); }
  });
  app.post('/api/chat', playerGuard, (request, response, next) => {
    try { response.json(game.sendTeamMessage(playerId(request), request.body?.message)); } catch (error) { next(error); }
  });
  app.post('/api/help', playerGuard, (request, response, next) => {
    try {
      const player = playerId(request);
      const action = String(request.body?.action ?? '');
      const requestId = String(request.body?.requestId ?? '');
      if (action === 'request') response.status(201).json(game.createHelpRequest(player, String(request.body?.assignmentId ?? ''), request.body?.message));
      else if (action === 'accept') response.json(game.acceptHelp(player, requestId));
      else if (action === 'decline') response.json(game.declineHelp(player, requestId));
      else if (action === 'cancel') response.json(game.cancelHelp(player, requestId));
      else if (action === 'leave') response.json(game.leaveHelp(player, requestId));
      else if (action === 'message') response.json(game.sendHelpMessage(player, requestId, request.body?.message));
      else throw new HttpError(400, 'Unknown assistance action.');
    } catch (error) { next(error); }
  });
  app.get('/api/puzzle-image/:assignment', playerGuard, async (request, response, next) => {
    try {
      const image = await game.puzzleImage(playerId(request), String(request.params.assignment));
      response.set({ 'Content-Type': image.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
      response.send(image.data);
    } catch (error) { next(error); }
  });

  io.use((socket, next) => {
    const cookie = socket.request.headers.cookie;
    const token = readCookie(cookie, PLAYER_COOKIE);
    const player = game.playerForSocketToken(token);
    if (player) { socket.data.playerId = player.id; socket.data.teamId = player.team_id; next(); return; }
    const email = verifyAdminSession(readCookie(cookie, ADMIN_COOKIE));
    if (email && adminEmail(email)) { socket.data.adminEmail = email; next(); return; }
    next(new Error('Authentication required'));
  });

  const acknowledge = async (socket: Socket, callback: unknown, action: () => unknown | Promise<unknown>) => {
    try {
      const result = await action();
      if (typeof callback === 'function') (callback as (value: unknown) => void)({ ok: true, result });
    } catch (error) {
      if (typeof callback === 'function') (callback as (value: unknown) => void)({ ok: false, error: error instanceof Error ? error.message : 'Action failed.' });
      else socket.emit('game:error', { message: error instanceof Error ? error.message : 'Action failed.' });
    }
  };
  io.on('connection', (socket) => {
    if (socket.data.playerId) {
      const id = String(socket.data.playerId);
      const player = game.data.players.get(id);
      if (player) {
        game.markConnected(id);
        socket.join(teamRoom(player.team_id));
        socket.emit('room:state', game.stateForPlayer(id));
        socket.to(teamRoom(player.team_id)).emit('room:player-joined', { playerId: player.id, name: player.display_name, connected: true });
      }
      socket.on('room:leave', (_payload, callback) => acknowledge(socket, callback, () => socket.leave(teamRoom(String(socket.data.teamId)))));
      socket.on('room:player-ready', (_payload, callback) => acknowledge(socket, callback, () => {
        const current = game.data.players.get(id); if (!current) throw new HttpError(401, 'Player session expired.');
        current.ready = true; game.notifyTeam(current.team_id, 'player-ready'); return { ready: true };
      }));
      socket.on('puzzle:submit-answer', (payload, callback) => acknowledge(socket, callback, () => game.submitPuzzleAnswer(id, String(payload?.assignmentId ?? ''), payload?.answer)));
      socket.on('puzzle:hint-request', (payload, callback) => acknowledge(socket, callback, () => game.requestHint(id, String(payload?.assignmentId ?? ''))));
      socket.on('help:request', (payload, callback) => acknowledge(socket, callback, () => game.createHelpRequest(id, String(payload?.assignmentId ?? ''), payload?.message)));
      socket.on('help:accept', (payload, callback) => acknowledge(socket, callback, () => game.acceptHelp(id, String(payload?.requestId ?? ''))));
      socket.on('help:decline', (payload, callback) => acknowledge(socket, callback, () => game.declineHelp(id, String(payload?.requestId ?? ''))));
      socket.on('help:cancel', (payload, callback) => acknowledge(socket, callback, () => game.cancelHelp(id, String(payload?.requestId ?? ''))));
      socket.on('help:leave', (payload, callback) => acknowledge(socket, callback, () => game.leaveHelp(id, String(payload?.requestId ?? ''))));
      socket.on('help:message', (payload, callback) => acknowledge(socket, callback, () => game.sendHelpMessage(id, String(payload?.requestId ?? ''), payload?.message)));
      socket.on('chat:message', (payload, callback) => acknowledge(socket, callback, () => game.sendTeamMessage(id, payload?.message)));
      socket.on('disconnect', () => {
        const samePlayerSockets = [...io.sockets.sockets.values()].some((entry) => entry.id !== socket.id && entry.data.playerId === id && entry.connected);
        if (!samePlayerSockets) game.markDisconnected(id);
      });
    } else if (socket.data.adminEmail) {
      socket.on('admin:monitor', (payload, callback) => acknowledge(socket, callback, () => {
        requireAdmin({ headers: { cookie: socket.request.headers.cookie } } as Request);
        const sessionId = String(payload?.sessionId ?? '');
        if (!game.data.sessions.has(sessionId)) throw new HttpError(404, 'Session not found.');
        socket.join(adminRoom(sessionId));
        socket.emit('admin:session-state', game.adminSession(sessionId));
        return { sessionId };
      }));
      socket.on('game:start', (payload, callback) => acknowledge(socket, callback, () => {
        requireAdmin({ headers: { cookie: socket.request.headers.cookie } } as Request);
        return game.startSession(String(payload?.sessionId ?? ''));
      }));
      socket.on('admin:pause', (payload, callback) => acknowledge(socket, callback, () => {
        requireAdmin({ headers: { cookie: socket.request.headers.cookie } } as Request);
        return game.adminAction(String(payload?.sessionId ?? ''), { action: 'pause' });
      }));
      socket.on('admin:resume', (payload, callback) => acknowledge(socket, callback, () => {
        requireAdmin({ headers: { cookie: socket.request.headers.cookie } } as Request);
        return game.adminAction(String(payload?.sessionId ?? ''), { action: 'resume' });
      }));
    }
  });

  const timer = setInterval(() => {
    game.tickAll();
    for (const team of game.data.teams.values()) if (team.status === 'active') {
      io.to(teamRoom(team.id)).emit('game:timer-update', { teamId: team.id, serverNow: Date.now(), phase: team.phase, phaseEndsAt: team.phase_ends_at });
    }
  }, 1000);
  timer.unref();
  app.use(sendError);
  return { app, httpServer, io, game };
}
