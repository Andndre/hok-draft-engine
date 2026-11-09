import type { Hero } from '../types';

/** Release flags come from the reviewed dataset. Unknown means unavailable. */
export function isHeroGlobalReleased(hero: Hero): boolean {
  return hero.hero_id !== 511 && hero.is_global_released === true;
}
