import type { Hero } from '../types';

export interface SkillItemView {
  name: string;
  type: string;
  desc: string;
  idx?: number;
  iconIndex: number;
  cd?: number;
  cost?: number;
  tags?: string[];
  comboBadge?: string;
  roleLabel?: string;
}

export interface SkillStance {
  id: string;
  label: string;
  badge?: string;
  description?: string;
  skills: SkillItemView[];
}

/**
 * Universal Stance & Multi-Mode Skill Classifier.
 * 
 * Works automatically for ANY hero in Honor of Kings that has multiple modes,
 * combo branches, enhanced skills, or stance transitions.
 * 
 * Survives automated crawler updates:
 * 1. Honors curated metadata (skill_stances_meta & recast_skills_meta) when available.
 * 2. Automatically infers multi-mode partitions from skill structure:
 *    - Pattern A: Multiple passives (e.g. Li Xin, Mulan)
 *    - Pattern B: Title prefix colons/hyphens (e.g. Yao "Brilliance:", Nuwa "Divine Glow -")
 *    - Pattern C: Combo branching (e.g. Mayene 1-1, 1-2, 2-1, 2-2)
 *    - Pattern D: Post-ultimate slot index repetition (e.g. Yango, Zhang Fei, Pei)
 *    - Pattern E: Two-stage recast detection (e.g. Ukyo Tachibana, Dun, Kongkong'er)
 */
export function detectHeroSkillStances(hero: Hero): SkillStance[] {
  const baseAbilities = hero.abilities || [];
  const guideSkills = hero.hokstats_guide?.skills || [];
  const recastMeta = hero.recast_skills_meta || [];
  const recastSlotMap = new Map<number, { badge: string; note?: string }>();
  for (const rm of recastMeta) {
    recastSlotMap.set(rm.slot, rm);
  }

  // Helper to format role label
  const getRoleLabel = (idx: number, type?: string, total: number = 4): string => {
    const t = (type || '').toLowerCase();
    if (t.includes('passive') || idx === 0) return 'Skill Pasif';
    if (t.includes('ultimate') || idx === total - 1) return 'Skill Pamungkas (Ultimate)';
    return `Skill Aktif #${idx}`;
  };

  // Check automatic recast detection for single abilities
  const checkRecast = (desc: string, slotIdx: number): string | undefined => {
    if (recastSlotMap.has(slotIdx)) return recastSlotMap.get(slotIdx)?.badge;
    const lower = desc.toLowerCase();
    if (/\b(?:can\s+be\s+used\s+again|used\s+a\s+second\s+time|recast\b|phase\s+2|2nd\s+(?:stage|cast)|can\s+recast)\b/i.test(lower)) {
      return '2 Tahap (Recast)';
    }
    return undefined;
  };

  // 1. CURATED STANCE METADATA (from hero_skill_overrides.json)
  if (hero.skill_stances_meta && hero.skill_stances_meta.length > 0) {
    const stanceMap = new Map<string, SkillItemView[]>();
    for (const sm of hero.skill_stances_meta) {
      stanceMap.set(sm.id, []);
    }
    const defaultStanceId = hero.skill_stances_meta[0].id;

    // Check skills from hokstats_guide first, otherwise fallback to baseAbilities
    if (guideSkills.length > 0) {
      guideSkills.forEach((s, idx) => {
        const stanceId = s.stance_id || (idx < baseAbilities.length ? defaultStanceId : hero.skill_stances_meta![1]?.id || defaultStanceId);
        const iconIdx = idx < baseAbilities.length ? idx : Math.min((idx % Math.max(1, baseAbilities.length)) + 1, Math.max(1, baseAbilities.length - 1));
        const itemView: SkillItemView = {
          name: s.name,
          type: s.type || 'Skill',
          desc: s.description,
          iconIndex: iconIdx,
          comboBadge: s.combo_badge || checkRecast(s.description, iconIdx),
          roleLabel: s.combo_badge || getRoleLabel(iconIdx, s.type, baseAbilities.length),
        };
        const list = stanceMap.get(stanceId) || stanceMap.get(defaultStanceId);
        if (list) list.push(itemView);
      });
    } else {
      baseAbilities.forEach((ab, idx) => {
        const itemView: SkillItemView = {
          name: ab.name,
          type: ab.type,
          desc: ab.desc,
          iconIndex: idx,
          cd: ab.cd,
          cost: ab.cost,
          tags: ab.tags,
          comboBadge: checkRecast(ab.desc, idx),
          roleLabel: getRoleLabel(idx, ab.type, baseAbilities.length),
        };
        stanceMap.get(defaultStanceId)?.push(itemView);
      });
    }

    // Build stances array
    const resultStances: SkillStance[] = [];
    for (const sm of hero.skill_stances_meta) {
      const skillsInStance = stanceMap.get(sm.id) || [];
      if (skillsInStance.length > 0) {
        resultStances.push({
          id: sm.id,
          label: sm.label,
          badge: sm.badge,
          description: sm.description,
          skills: skillsInStance,
        });
      }
    }
    if (resultStances.length > 0) return resultStances;
  }

  // 2. AUTOMATIC PATTERN INFERENCE (when no curated stance metadata is defined)

  // Pattern A: Multiple passives (e.g. Li Xin, Mulan)
  const passiveIndices = guideSkills
    .map((s, idx) => ((s.type || '').toLowerCase() === 'passive' ? idx : -1))
    .filter((idx) => idx !== -1);

  if (passiveIndices.length > 1 && passiveIndices[1] > 1) {
    const bounds = [...passiveIndices, guideSkills.length];
    const inferredStances: SkillStance[] = [];
    for (let b = 0; b < passiveIndices.length; b++) {
      const start = bounds[b];
      const end = bounds[b + 1];
      const slice = guideSkills.slice(start, end);
      const formNum = b + 1;
      const formPassiveName = slice[0]?.name || `Form ${formNum}`;
      inferredStances.push({
        id: `form_${formNum}`,
        label: `Bentuk ${formNum} (${formPassiveName})`,
        badge: `Mode ${formNum}`,
        description: `Rangkaian kemampuan untuk bentuk ke-${formNum} hero (${formPassiveName}).`,
        skills: slice.map((s, sIdx) => ({
          name: s.name,
          type: s.type || 'Skill',
          desc: s.description,
          iconIndex: Math.min(sIdx, Math.max(1, baseAbilities.length - 1)),
          comboBadge: s.combo_badge || checkRecast(s.description, sIdx),
          roleLabel: getRoleLabel(sIdx, s.type, slice.length),
        })),
      });
    }
    return inferredStances;
  }

  // Pattern B: Title prefix colons or hyphens (e.g. "Brilliance:", "Divine Glow -")
  if (guideSkills.length > baseAbilities.length && guideSkills.length >= 5) {
    const prefixes = new Map<string, typeof guideSkills>();
    for (const s of guideSkills) {
      let pfx = 'Base';
      if (s.name.includes(':')) {
        pfx = s.name.split(':')[0].trim();
      } else if (s.name.includes(' - ')) {
        pfx = s.name.split(' - ')[0].trim();
      }
      if (!prefixes.has(pfx)) prefixes.set(pfx, []);
      prefixes.get(pfx)!.push(s);
    }

    const nonBaseEntries = [...prefixes.entries()].filter(([k, v]) => k !== 'Base' && v.length >= 2);
    if (nonBaseEntries.length >= 1) {
      const baseList = prefixes.get('Base') || guideSkills.slice(0, Math.max(4, baseAbilities.length));
      const altEntry = nonBaseEntries[0];
      const altList = altEntry[1];
      const altName = altEntry[0];

      return [
        {
          id: 'base',
          label: 'Kemampuan Dasar',
          badge: 'Normal',
          description: 'Bentuk kemampuan dasar hero tanpa aktivasi mode khusus.',
          skills: baseList.map((s, idx) => ({
            name: s.name,
            type: s.type || 'Skill',
            desc: s.description,
            iconIndex: idx < baseAbilities.length ? idx : Math.min(idx, 3),
            comboBadge: s.combo_badge || checkRecast(s.description, idx),
            roleLabel: getRoleLabel(idx, s.type, baseList.length),
          })),
        },
        {
          id: 'alt_mode',
          label: `${altName} (Mode Khusus)`,
          badge: altName,
          description: `Varian kemampuan yang aktif saat mode ${altName} dipicu.`,
          skills: altList.map((s, idx) => ({
            name: s.name,
            type: s.type || 'Enhanced Skill',
            desc: s.description,
            iconIndex: Math.min(idx + 1, Math.max(1, baseAbilities.length - 1)),
            comboBadge: s.combo_badge || altName,
            roleLabel: `Skill Diperkuat #${idx + 1}`,
          })),
        },
      ];
    }
  }

  // Pattern C: Combo branching (e.g. Mayene 1-1, 1-2, 2-1, 2-2)
  const comboSkills = guideSkills.filter((s) => {
    const desc = (s.description || '').toLowerCase();
    const name = (s.name || '').toLowerCase();
    return /\b[1-4]-[1-4]\s+combo\b/i.test(desc) || /\bcombo\b/i.test(name);
  });

  if (comboSkills.length >= 2 && guideSkills.length > baseAbilities.length) {
    const baseList = baseAbilities.length > 0 ? baseAbilities : guideSkills.slice(0, 4);
    return [
      {
        id: 'base',
        label: 'Skill Dasar',
        badge: 'Normal',
        description: 'Kemampuan dasar yang menyimpan charge untuk memicu kombinasi serangan.',
        skills: baseList.map((ab: any, idx: number) => ({
          name: ab.name,
          type: ab.type,
          desc: ab.desc || ab.description,
          iconIndex: idx,
          cd: ab.cd,
          cost: ab.cost,
          tags: ab.tags,
          comboBadge: checkRecast(ab.desc || ab.description, idx),
          roleLabel: getRoleLabel(idx, ab.type, baseList.length),
        })),
      },
      {
        id: 'combos',
        label: `Varian Combo (${comboSkills.length} Cabang)`,
        badge: `${comboSkills.length} Combo`,
        description: 'Hasil kombinasi penekanan tombol skill yang memicu efek mekanik unik berbeda.',
        skills: comboSkills.map((s, idx) => {
          const match = (s.description || '').match(/\b([1-4]-[1-4]\s+combo)\b/i);
          const badgeText = match ? match[1].toUpperCase() : `Combo #${idx + 1}`;
          return {
            name: s.name,
            type: s.type || 'Combo Skill',
            desc: s.description,
            iconIndex: Math.min(idx < 2 ? 1 : 2, Math.max(1, baseAbilities.length - 1)),
            comboBadge: s.combo_badge || badgeText,
            roleLabel: badgeText,
          };
        }),
      },
    ];
  }

  // Pattern D: Post-ultimate slot repetition (e.g. Yango, Zhang Fei, Pei)
  let seenUltimate = false;
  let repeatStartIndex = -1;
  for (let i = 0; i < guideSkills.length; i++) {
    const stype = (guideSkills[i].type || '').toLowerCase();
    if (stype.includes('ultimate')) {
      seenUltimate = true;
    } else if (seenUltimate && (stype.includes('skill') || stype.includes('active'))) {
      repeatStartIndex = i;
      break;
    }
  }

  if (repeatStartIndex !== -1 && guideSkills.length > baseAbilities.length) {
    const form1List = guideSkills.slice(0, repeatStartIndex);
    const form2List = guideSkills.slice(repeatStartIndex);
    return [
      {
        id: 'form_1',
        label: 'Bentuk Utama',
        badge: 'Bentuk 1',
        description: 'Kemampuan yang aktif dalam bentuk default.',
        skills: form1List.map((s, idx) => ({
          name: s.name,
          type: s.type || 'Skill',
          desc: s.description,
          iconIndex: Math.min(idx, Math.max(1, baseAbilities.length - 1)),
          comboBadge: s.combo_badge || checkRecast(s.description, idx),
          roleLabel: getRoleLabel(idx, s.type, form1List.length),
        })),
      },
      {
        id: 'form_2',
        label: 'Bentuk Transformasi / Stance 2',
        badge: 'Bentuk 2',
        description: 'Kemampuan yang aktif saat bertransformasi atau memasuki mode kedua.',
        skills: form2List.map((s, idx) => ({
          name: s.name,
          type: s.type || 'Transformed Skill',
          desc: s.description,
          iconIndex: Math.min(idx + 1, Math.max(1, baseAbilities.length - 1)),
          comboBadge: s.combo_badge || `Bentuk 2 #${idx + 1}`,
          roleLabel: `Bentuk Transformasi #${idx + 1}`,
        })),
      },
    ];
  }

  // 3. DEFAULT: Single Stance with automatic recast badges on relevant skills
  const sourceSkills: SkillItemView[] = baseAbilities.length > 0
    ? baseAbilities.map((ab, idx) => ({
        name: ab.name,
        type: ab.type,
        desc: ab.desc,
        iconIndex: idx,
        cd: ab.cd,
        cost: ab.cost,
        tags: ab.tags,
        comboBadge: checkRecast(ab.desc, idx),
        roleLabel: getRoleLabel(idx, ab.type, baseAbilities.length),
      }))
    : guideSkills.map((s, idx) => ({
        name: s.name,
        type: s.type || 'Skill',
        desc: s.description,
        iconIndex: idx,
        comboBadge: checkRecast(s.description, idx),
        roleLabel: getRoleLabel(idx, s.type, guideSkills.length),
      }));

  return [
    {
      id: 'default',
      label: 'Kemampuan Utama',
      skills: sourceSkills,
    },
  ];
}
