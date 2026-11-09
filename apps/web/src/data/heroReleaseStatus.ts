import { Hero } from '../types';

/**
 * Hero IDs that are currently exclusive to King's Glory (CN server / KPL)
 * and NOT yet released in Honor of Kings Global server.
 */
export const CN_ONLY_HERO_IDS = new Set<number>([
  194, // Su Lie (苏烈)
  525, // Luban Master (鲁班大师)
  312, // Shen Mengxi (沈梦溪)
  548, // Geya (戈娅)
  186, // Taiyi Zhenren (太乙真人)
  527, // Meng Tian (蒙恬)
  518, // Ma Chao (马超)
  550, // Kongkong'er (空空儿)
  544, // Zhao Huaizhen (赵怀真)
  515, // Chang'e (嫦娥)
  136, // Wu Zetian (武则天)
  549, // Macaque (心魔六耳)
  151, // Sun Quan (孙权)
  540, // Jin Chan (金蝉)
  188, // Da Yu (大禹)
  529, // Pangu (盘古)
  144, // Cheng Yaojin (程咬金)
  511, // Zhu Bajie (Merged to Ata 556 in Global)
]);

export function isHeroGlobalReleased(hero: Hero | number): boolean {
  const id = typeof hero === 'number' ? hero : hero.hero_id;
  if (CN_ONLY_HERO_IDS.has(id)) {
    return false;
  }
  if (typeof hero === 'object' && hero.is_global_released === false) {
    return false;
  }
  return true;
}
