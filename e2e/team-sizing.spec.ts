import { test, expect } from '@playwright/test';

const ready = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
const base = 'http://localhost:3000';

test('solo players and one-player competing teams can start', async ({ browser }) => {
  test.skip(!ready, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run team-size integration coverage.');
  test.setTimeout(45_000);
  const adminContext = await browser.newContext();
  const soloContext = await browser.newContext();
  const teamAContext = await browser.newContext();
  const teamBContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await admin.goto('/admin/login');
    await admin.getByLabel('EMAIL').fill(process.env.E2E_ADMIN_EMAIL!);
    await admin.getByLabel('PASSWORD').fill(process.env.E2E_ADMIN_PASSWORD!);
    await admin.getByRole('button', { name: /sign in securely/i }).click();
    await expect(admin).toHaveURL(/\/admin$/);

    const soloGameResponse = await adminContext.request.post(`${base}/api/admin`, { data: {
      name: `Solo QA ${Date.now()}`, theme: 'detective', numberOfTeams: 1,
      puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4
    } });
    expect(soloGameResponse.ok()).toBeTruthy();
    const soloGame = await soloGameResponse.json() as { id: string; pin: string };
    expect((await soloContext.request.post(`${base}/api/join`, { data: { pin: soloGame.pin, name: 'Solo Agent' } })).ok()).toBeTruthy();
    expect((await adminContext.request.post(`${base}/api/admin/session/${soloGame.id}`, { data: { action: 'start' } })).ok()).toBeTruthy();
    const soloPage = await soloContext.newPage();
    await soloPage.goto('/play');
    await soloPage.getByRole('button', { name: /accept mission/i }).click();
    await expect(soloPage.locator('[aria-label="Your assigned puzzles"] button')).toHaveCount(5);

    const versusResponse = await adminContext.request.post(`${base}/api/admin`, { data: {
      name: `One Each QA ${Date.now()}`, theme: 'treasure', numberOfTeams: 2,
      puzzleMinutes: 5, collaborationMinutes: 3, finalMinutes: 4
    } });
    expect(versusResponse.ok()).toBeTruthy();
    const versusGame = await versusResponse.json() as { id: string; pin: string };
    const [joinA, joinB] = await Promise.all([
      teamAContext.request.post(`${base}/api/join`, { data: { pin: versusGame.pin, name: 'Team A Agent' } }),
      teamBContext.request.post(`${base}/api/join`, { data: { pin: versusGame.pin, name: 'Team B Agent' } })
    ]);
    expect(joinA.ok()).toBeTruthy();
    expect(joinB.ok()).toBeTruthy();
    expect((await joinA.json()).teamName).not.toBe((await joinB.json()).teamName);
    const started = await adminContext.request.post(`${base}/api/admin/session/${versusGame.id}`, { data: { action: 'start' } });
    expect(started.ok()).toBeTruthy();
    const control = await (await adminContext.request.get(`${base}/api/admin/session/${versusGame.id}`)).json();
    expect(control.teams.map((team: { players: unknown[] }) => team.players.length)).toEqual([1, 1]);
    expect(control.teams.map((team: { status: string }) => team.status)).toEqual(['active', 'waiting']);
  } finally {
    await Promise.all([adminContext, soloContext, teamAContext, teamBContext].map((context) => context.close()));
  }
});
