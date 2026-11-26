import { test, expect } from '@playwright/test';

const ready = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
test('five-player local game supports simultaneous own-puzzle solving and private teammate assistance', async ({ browser }) => {
  test.skip(!ready, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the authenticated five-player local integration test.');
  test.setTimeout(150_000);
  const base = 'http://localhost:3000';
  const adminContext = await browser.newContext();
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
  const pages: import('@playwright/test').Page[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  try {
    const admin = await adminContext.newPage();
    admin.on('pageerror', (error) => pageErrors.push(error.message));
    admin.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`); });
    admin.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
    await admin.goto('/admin/login');
    await admin.getByLabel('EMAIL').fill(process.env.E2E_ADMIN_EMAIL!);
    await admin.getByLabel('PASSWORD').fill(process.env.E2E_ADMIN_PASSWORD!);
    await admin.getByRole('button', { name: /sign in securely/i }).click();
    await expect(admin).toHaveURL(/\/admin$/);

    const created = await adminContext.request.post(`${base}/api/admin`, { data: {
      name: `Local Assistance QA ${Date.now()}`, theme: 'detective', numberOfTeams: 1,
      puzzleMinutes: 5, collaborationMinutes: 1, finalMinutes: 1, hintsEnabled: true
    } });
    expect(created.ok()).toBeTruthy();
    const game = await created.json() as { id: string; pin: string };
    for (let index = 0; index < contexts.length; index++) {
      const response = await contexts[index].request.post(`${base}/api/join`, { data: { pin: game.pin, name: `Agent ${index + 1}` } });
      expect(response.ok()).toBeTruthy();
    }
    const started = await adminContext.request.post(`${base}/api/admin/session/${game.id}`, { data: { action: 'start' } });
    expect(started.ok()).toBeTruthy();
    const adminWebSocket = admin.waitForEvent('websocket', { timeout: 10000 });
    await admin.goto(`/admin/session/${game.id}`);
    await adminWebSocket;
    await expect(admin.locator('.pin-share-code')).toHaveText(game.pin);
    await adminContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await admin.getByRole('button', { name: /copy game pin/i }).click();
    await expect(admin.getByRole('button', { name: /copied/i })).toBeVisible();
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(game.pin);
    await expect(admin.getByRole('heading', { name: /team order & player status/i })).toBeVisible();

    await Promise.all(contexts.map(async (context, index) => {
      const page = await context.newPage();
      pages[index] = page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`); });
      page.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
      const websocket = page.waitForEvent('websocket', { timeout: 10000 });
      await page.goto('/play');
      await websocket;
      await page.getByRole('button', { name: /accept mission/i }).waitFor();
      await page.getByRole('button', { name: /accept mission/i }).click();
      await expect(page.getByText(/your responsibility/i)).toBeVisible();
    }));
    const states = await Promise.all(contexts.map(async (context) => await (await context.request.get(`${base}/api/game/state`)).json()));
    const ownerIndex = states.findIndex((state) => state.puzzle?.details?.category === 'visual');
    expect(ownerIndex).toBeGreaterThanOrEqual(0);
    const helperIndex = ownerIndex === 0 ? 1 : 0;
    const competitors = contexts.map((_, index) => index).filter((index) => index !== ownerIndex && index !== helperIndex);
    const owner = states[ownerIndex];
    const helper = states[helperIndex];
    expect(owner.puzzle.completed).toBe(false);
    expect(helper.puzzle.completed).toBe(false);

    const puzzleBankResponse = await adminContext.request.get(`${base}/api/admin/puzzles`);
    expect(puzzleBankResponse.ok()).toBeTruthy();
    const bank = (await puzzleBankResponse.json()).puzzles as Array<{ id: string; title: string; category: string; correct_answer: string }>;
    const ownerRequest = await contexts[ownerIndex].request.post(`${base}/api/help`, { data: {
      action: 'request', assignmentId: owner.puzzle.id, message: 'Could you look at this pattern with me?'
    } });
    expect(ownerRequest.ok()).toBeTruthy();
    const requestId = (await ownerRequest.json()).id as string;
    expect((await contexts[helperIndex].request.post(`${base}/api/help`, { data: { action: 'accept', requestId } })).ok()).toBeTruthy();
    await pages[helperIndex].reload();
    await expect(pages[helperIndex].locator('.help-panel')).toBeVisible();

    const helperState = await (await contexts[helperIndex].request.get(`${base}/api/game/state`)).json();
    const shared = helperState.helpSessions.find((entry: { id: string }) => entry.id === requestId);
    expect(shared?.puzzle?.question).toBe(owner.puzzle.details.question);
    expect(shared?.puzzle).not.toHaveProperty('correct_answer');
    expect(helperState.puzzle.id).toBe(helper.puzzle.id);
    expect(helperState.puzzle.completed).toBe(false);
    expect(shared?.puzzle?.image_url).toBe(`/api/puzzle-image/${owner.puzzle.id}`);
    await expect(pages[helperIndex].locator('.help-panel img')).toBeVisible();

    const simultaneousAccepts = await Promise.all(competitors.slice(0, 2).map((index) => contexts[index].request.post(`${base}/api/help`, { data: { action: 'accept', requestId } })));
    expect(simultaneousAccepts.filter((response) => response.ok())).toHaveLength(1);
    expect(simultaneousAccepts.filter((response) => response.status() === 409)).toHaveLength(1);
    const privateState = await (await contexts[helperIndex].request.get(`${base}/api/game/state`)).json();
    expect(privateState.helpSessions.find((entry: { id: string }) => entry.id === requestId).helpers).toHaveLength(2);

    const forbidden = await contexts[helperIndex].request.post(`${base}/api/puzzle/answer`, { data: { assignmentId: owner.puzzle.id, answer: 'not permitted' } });
    expect(forbidden.status()).toBe(403);
    expect((await contexts[helperIndex].request.post(`${base}/api/help`, { data: { action: 'message', requestId, message: 'Read the pattern from left to right.' } })).ok()).toBeTruthy();
    const ownerHelpState = await (await contexts[ownerIndex].request.get(`${base}/api/game/state`)).json();
    expect(ownerHelpState.helpSessions.find((entry: { id: string }) => entry.id === requestId).messages.some((message: { body: string }) => message.body.includes('left to right'))).toBe(true);

    const helperPuzzle = bank.find((puzzle) => puzzle.id === helper.puzzle.details.id);
    const ownerPuzzle = bank.find((puzzle) => puzzle.id === owner.puzzle.details.id);
    expect(helperPuzzle).toBeTruthy();
    expect(ownerPuzzle).toBeTruthy();
    const helperSolved = await contexts[helperIndex].request.post(`${base}/api/puzzle/answer`, { data: { assignmentId: helper.puzzle.id, answer: helperPuzzle!.correct_answer } });
    expect((await helperSolved.json()).correct).toBe(true);
    const helperAfterOwnSolve = await (await contexts[helperIndex].request.get(`${base}/api/game/state`)).json();
    expect(helperAfterOwnSolve.puzzle.completed).toBe(true);
    expect(helperAfterOwnSolve.helpSessions.some((entry: { id: string }) => entry.id === requestId)).toBe(true);

    const ownerSolved = await contexts[ownerIndex].request.post(`${base}/api/puzzle/answer`, { data: { assignmentId: owner.puzzle.id, answer: ownerPuzzle!.correct_answer } });
    expect((await ownerSolved.json()).correct).toBe(true);
    const ownerAfterSolve = await (await contexts[ownerIndex].request.get(`${base}/api/game/state`)).json();
    const helperAfterOwnerSolve = await (await contexts[helperIndex].request.get(`${base}/api/game/state`)).json();
    expect(ownerAfterSolve.puzzle.clue).toBeTruthy();
    expect(helperAfterOwnerSolve.helpSessions.some((entry: { id: string }) => entry.id === requestId)).toBe(false);
    expect(helperAfterOwnerSolve.team.penalty_seconds).toBe(0);

    expect((await contexts[helperIndex].request.post(`${base}/api/chat`, { data: { message: 'Sharing my clue with the team.' } })).ok()).toBeTruthy();
    const chatState = await (await contexts[ownerIndex].request.get(`${base}/api/game/state`)).json();
    expect(chatState.teamMessages.some((message: { body: string }) => message.body.includes('Sharing my clue'))).toBe(true);
    await expect(pages[ownerIndex].getByText('Sharing my clue with the team.')).toBeVisible({ timeout: 5000 });
    await expect(admin.getByText(/Sharing my clue with the team\./)).toBeVisible({ timeout: 5000 });

    await Promise.all(contexts.map(async (context, index) => {
      if (index === ownerIndex || index === helperIndex) return;
      const assignment = states[index].puzzle;
      const puzzle = bank.find((entry) => entry.id === assignment.details.id);
      expect(puzzle).toBeTruthy();
      const solved = await context.request.post(`${base}/api/puzzle/answer`, { data: { assignmentId: assignment.id, answer: puzzle!.correct_answer } });
      expect((await solved.json()).correct).toBe(true);
    }));
    await expect.poll(async () => {
      const control = await (await adminContext.request.get(`${base}/api/admin/session/${game.id}`)).json();
      return control.teams.find((team: { id: string }) => team.id === owner.team.id)?.phase;
    }, { timeout: 10_000, intervals: [500] }).toBe('collaboration');
    await expect(pages[ownerIndex].getByText(/FINAL SECRET WORD/)).toBeVisible({ timeout: 5000 });
    await pages[ownerIndex].getByPlaceholder('Enter the secret word').fill('wrong-word');
    await pages[ownerIndex].getByRole('button', { name: 'Unlock' }).click();
    await expect(pages[ownerIndex].locator('.final-feedback')).toContainText('FINAL ANSWER NOT CORRECT');
    const finalState = await (await contexts[ownerIndex].request.get(`${base}/api/game/state`)).json();
    expect(finalState.team.clues.filter((clue: { completed: boolean }) => clue.completed)).toHaveLength(5);
    const mathClue = finalState.team.clues.find((clue: { category: string }) => clue.category === 'mathematical').clue as string;
    const secretWord = mathClue.includes('19th letter') ? 'SHADOW' : 'LANTERN';
    const finalResponse = await contexts[ownerIndex].request.post(`${base}/api/final`, { data: { answer: secretWord } });
    expect((await finalResponse.json()).correct).toBe(true);
    await expect(pages[ownerIndex].getByRole('heading', { name: /well done, team/i })).toBeVisible({ timeout: 8000 });
    await expect(admin.getByRole('cell', { name: 'Success' })).toBeVisible({ timeout: 5000 });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await adminContext.close();
  }
});
