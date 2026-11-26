import { describe, expect, it } from 'vitest';
import { puzzleSeeds } from './puzzle-seed';
import { normalizeAnswer, puzzleCategories, themes } from './themes';
import { adjustedSeconds, rankTeams } from './scoring';
import { canAcceptHelp } from './assistance';

describe('puzzle content', () => {
  it('ships at least 50 valid puzzles, with ten of every required type', () => {
    expect(puzzleSeeds.length).toBeGreaterThanOrEqual(50);
    expect(puzzleSeeds.every((puzzle) => puzzle.difficulty === 'easy')).toBe(true);
    for (const category of puzzleCategories) {
      const puzzles = puzzleSeeds.filter((p) => p.category === category);
      expect(puzzles.length).toBeGreaterThanOrEqual(10);
      expect(puzzles.every((p) => p.title && p.question && p.correct_answer && p.hint_one && p.hint_two)).toBe(true);
    }
  });
  it('provides a visual asset for every visual puzzle', () => {
    const visuals = puzzleSeeds.filter((p) => p.category === 'visual');
    expect(visuals.length).toBeGreaterThanOrEqual(10);
    expect(visuals.every((p) => p.image_url?.startsWith('visual-'))).toBe(true);
  });
  it('gives each theme multiple valid words and five category clues per word', () => {
    for (const theme of themes) {
      expect(theme.words.length).toBeGreaterThanOrEqual(2);
      for (const mission of theme.words) {
        expect(mission.word.length).toBeGreaterThan(3);
        expect(Object.keys(mission.clues).sort()).toEqual([...puzzleCategories].sort());
      }
    }
  });
});

describe('answer normalization and results', () => {
  it('normalizes spaces, punctuation, and case consistently', () => {
    expect(normalizeAnswer('  What Would the Other Guard Say? ')).toBe('whatwouldtheotherguardsay');
  });
  it('adds only hint and wrong-final penalties; assistance adds none', () => {
    expect(adjustedSeconds(300, 15 + 10)).toBe(325);
    expect(adjustedSeconds(300, 0)).toBe(300);
  });
  it('ranks every successful team before failed teams and uses adjusted time', () => {
    const ranks = rankTeams([
      { id: 'slow-fail', success: false, rawSeconds: 40, penaltySeconds: 0 },
      { id: 'winner', success: true, rawSeconds: 280, penaltySeconds: 10 },
      { id: 'runner-up', success: true, rawSeconds: 275, penaltySeconds: 20 }
    ]);
    expect(ranks.map((team) => team.id)).toEqual(['winner', 'runner-up', 'slow-fail']);
  });
});

describe('peer assistance authorization', () => {
  const base = { playerId: 'helper-1', teamId: 'team-a', connected: true, requestOwnerId: 'owner', requestTeamId: 'team-a', activeHelpers: [] as string[], requestOpen: true };
  it('lets a connected teammate accept before finishing their own puzzle', () => {
    // Own puzzle completion/progress is deliberately irrelevant to the help authorization policy.
    expect(canAcceptHelp(base)).toBe(true);
  });
  it('rejects owners, outsiders, disconnected players, closed requests, duplicates, and a full two-helper slot', () => {
    expect(canAcceptHelp({ ...base, playerId: 'owner' })).toBe(false);
    expect(canAcceptHelp({ ...base, teamId: 'other' })).toBe(false);
    expect(canAcceptHelp({ ...base, connected: false })).toBe(false);
    expect(canAcceptHelp({ ...base, requestOpen: false })).toBe(false);
    expect(canAcceptHelp({ ...base, activeHelpers: ['helper-1'] })).toBe(false);
    expect(canAcceptHelp({ ...base, activeHelpers: ['helper-2', 'helper-3'] })).toBe(false);
  });
});
