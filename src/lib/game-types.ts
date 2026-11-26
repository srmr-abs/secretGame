export const puzzleCategories = ['logical', 'riddle', 'visual', 'mathematical', 'word'] as const;
export type PuzzleCategory = (typeof puzzleCategories)[number];
