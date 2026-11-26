import { puzzleSeeds } from '../src/lib/puzzle-seed';
import { puzzleCategories } from '../src/lib/themes';

for (const category of puzzleCategories) {
  const count = puzzleSeeds.filter((puzzle) => puzzle.category === category).length;
  if (count < 10) throw new Error(`The local seed bank needs at least ten ${category} puzzles; found ${count}.`);
}
console.log(`Validated ${puzzleSeeds.length} local puzzles across five categories. They are loaded into backend memory at startup.`);
