# The Great Secret Unlock

**Each Player. One Puzzle. One Clue Fragment. One Team Secret.**

A local multiplayer mystery-game proof of concept. The existing Next.js and React application is preserved; its Supabase database, authentication, storage, and Realtime dependencies have been replaced by a local Express and Socket.IO backend with process-local in-memory state.

## Current migration checklist

| Area | Status |
|---|---|
| Existing Next.js App Router, visual design, player/admin screens, Detective Case theme, and visual assets | Preserved |
| New-game theme choices | Limited to Detective Case and Zigzag Puzzle Hunt |
| Bundled 55-puzzle bank | Retained and rewritten at easy difficulty across all five categories |
| Supabase clients, queries, authentication, Realtime, packages, migrations, and cloud deployment config | Removed |
| Local Express API and Socket.IO server | Implemented on port 4000 |
| Rooms, PIN joining, player sessions, answers, clues, chat, results, and sequential teams | Implemented in memory; multiplayer teams require at least 2 players and support up to 10 |
| Solo and multiplayer modes | Solo players receive one easy riddle; multiplayer teams receive one unique puzzle per joined player (1–10) and private, ordered clue fragments that must be combined |
| Two-helper assistance, private help-session state, visual puzzle authorization, and owner-only answers | Implemented |
| Server-owned phase timers and admin pause/resume | Implemented |
| Local admin password-hash login and signed session cookie | Implemented |
| Unit coverage for rooms, puzzles, assistance, phases, and scoring | Implemented |
| Five-browser local assistance integration test | Implemented; run with E2E admin credentials |
| Persistent game history and state across backend restarts | Not included by design |
| Surprise-event gameplay | The existing code exposed the setting but contained no event rules or event content; the setting remains configurable, but no surprise events are triggered |

The migration was backed up before refactoring. This workspace did not contain a Git repository, so no Git checkpoint was available.

## Architecture

- **Frontend:** Next.js App Router, React, TypeScript, Tailwind CSS, and the existing detective-themed UI at `http://localhost:3000`.
- **Backend:** Express, TypeScript, Socket.IO, and HTTP APIs at `http://localhost:4000`.
- **API requests:** The Next.js `/api/*` rewrite forwards to Express. Existing screens continue using same-origin API paths; Socket.IO connects directly to the backend.
- **State:** Maps and arrays in `server/src/storage/InMemoryStore.ts`. The backend is authoritative for rooms, identities, puzzles, answers, clues, assistance, timers, chat, and results.
- **Puzzle content:** Local TypeScript seed data. The local puzzle bank retains 55 easy puzzles, at least ten per category, and ten SVG visual assets. New games expose only the Detective Case and Zigzag Puzzle Hunt themes.
- **Tests:** Vitest unit tests and Playwright browser tests.

Socket updates carry room-safe change signals. Puzzle answers and puzzle-owner data are not broadcast to the team. Authorized players retrieve their own puzzle and accepted helpers retrieve shared puzzle details through server-validated state and image routes. Helpers can accept while solving their own puzzle; only the puzzle owner can submit an answer. Assistance does not pause timers and adds no penalty.

## Local setup

Requirements: Node.js 20 or newer and npm. No database, Supabase account, cloud account, or external service is used.

1. Install the dependencies and create a local environment file:

   ```bash
   npm install
   cp .env.example .env.local
   ```

2. Set a local administrator password hash. Generate a hash with a password of at least twelve characters:

   ```bash
   npm run admin:hash -- 'choose-a-long-local-password'
   ```

   Copy the printed `scrypt$...` value into `ADMIN_PASSWORD_HASH` in `.env.local`. Set `ADMIN_EMAIL` and replace `SESSION_SECRET` with a long random value, for example `openssl rand -hex 32`. Do not commit `.env.local` or a real password.

3. Optionally validate the bundled puzzle content, then start both servers:

   ```bash
   npm run seed
   npm run dev
   ```

   The seed command validates local content; puzzle data is loaded automatically when the backend starts. The combined development command starts the backend and frontend together.

Open `http://localhost:3000`. The backend health check is `http://localhost:4000/health`.

Separate terminals are also supported:

```bash
npm run dev:server
npm run dev:client
```

## Admin and multiplayer demonstration

1. Sign in at `/admin/login` with the `ADMIN_EMAIL` and the original password used to generate `ADMIN_PASSWORD_HASH`.
2. Create a game, choose Detective Case or Zigzag Puzzle Hunt, then choose Single Player or Multiplayer. Solo mode creates one player and one easy riddle. Multiplayer lets you set team count and a capacity of 2 to 10 players per team; every team needs at least two joined players before the host can start. Multiplayer phase defaults are five, three, and four minutes.
3. Share the six-digit PIN. Each player must join from a separate browser profile or device and use a distinct display name. Tabs and windows in the same browser profile share one player cookie, so joining a second player there replaces the first player's session. Players are balanced across the configured teams, and the host can start once every multiplayer team has at least two players.
4. Start the session once. Multiplayer teams activate in sequence. Each joined player receives one unique puzzle and one private fragment of the team's final clue; clue fragments are split into the same number as players. In Solo mode, the player gets one easy riddle and one complete clue, then proceeds directly to the final secret word.
5. Players submit their own answers, share clues and team-chat messages, and may request help. Any connected teammate can accept while working on their own puzzle. The accepted helper receives the question and, for visual puzzles, the original authorized image in a separate help panel.
6. Solo mode opens the final answer after its clue is unlocked. Multiplayer opens the final answer after every player has solved their puzzle; each player can see their own fragment while teammates see its unlocked status, so they must share and combine the fragments. Results record completion, raw and adjusted times, penalties, hints, incorrect final attempts, and assistance statistics.

Use the admin control room for live team/player status, team order, pause/resume, and results. The game supports multiple browser profiles on one development machine; use separate profiles rather than separate tabs, since tabs share player authentication cookies.

## Authentication and local configuration

Copy `.env.example` to `.env.local` and configure:

- `PORT=4000`
- `FRONTEND_URL=http://localhost:3000`
- `NEXT_PUBLIC_API_URL=http://localhost:4000`
- `NEXT_PUBLIC_SOCKET_URL=http://localhost:4000`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH` (scrypt format generated by `npm run admin:hash`)
- `SESSION_SECRET`

Admin credentials are verified on the backend. Admin and player sessions use HttpOnly cookies. Player tokens are random bearer tokens; only SHA-256 token hashes are stored in memory. Puzzle answers remain backend-only. The development server is intended for local use and should not be exposed to an untrusted network.

## Game rules and timers

- Multiplayer individual puzzles: five minutes by default. Every player must solve their own assigned puzzle.
- Multiplayer collaboration: three minutes by default. Players share their private clue fragments and combine them to infer the secret word.
- Final secret-word phase: four minutes by default. Solo mode skips team collaboration and proceeds directly from its riddle to the final answer. The final-answer form appears as soon as all required clues are unlocked, even while the multiplayer collaboration timer is still running.
- Puzzle hints add fifteen seconds each; an incorrect final answer adds ten seconds; assistance adds zero seconds.
- A maximum of three incorrect final answers is allowed.
- The backend controls deadlines, automatic phase transitions, session pause/resume, team sequencing, and result calculations. The browser only renders the server deadline and reconnects to current state.
- Successful teams rank ahead of failed teams. Successful teams are ranked by adjusted completion time.

## Tests and checks

```bash
npm test
npm run typecheck:server
npm run lint
npm run build
npm run test:e2e
```

The public landing/admin-entry browser tests run without admin credentials. Solo/team-sizing and multiplayer browser tests are skipped unless `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` are set in the test process and match the locally configured administrator. For example, export those two values in the shell before `npm run test:e2e`; do not put the password in committed files. Playwright requires a Chromium browser; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if using a system-installed browser.

## Known limitations

- Game sessions, player sessions, uploaded puzzle images, chat, and results exist only in memory. A backend restart clears them; this is intentional for the local POC. A browser refresh does not clear a session while the backend is running.
- There is no permanent game history, database, cloud deployment, or production hosting configuration.
- Existing built-in puzzle content and ten visual assets were available locally and are retained. The original external database's generated row IDs could not be recovered from this repository, so seeded puzzle IDs are generated deterministically from category and title instead.
- The surprise-events switch is retained as a setting, but the existing repository did not contain event rules or event assets to execute.
# secretGame
