/**
 * scaleDimensionTactics.ts
 *
 * Modul Evaluasi Taktis Level 3:
 * 1. Dimensi 1: Skala Pertarungan (Battle Scale: Duel vs. Skirmish vs. Teamfight)
 * 2. Dimensi 2: Jarak dan Waktu (Distance & Time: Poke vs. Dive vs. Peel)
 * 3. Analisis Benturan Skala (Scale Clash Check) & Risiko Runtuhnya Lini Belakang (Carry Collapse Risk)
 * 4. Constraint Removal Synergies & Anti-Impostor Tempo Tactics
 */

import type { Hero } from '../types';

export interface BattleScaleVector {
  duel: number;      // 1v1 / side-lane bully / split-push pressure
  skirmish: number;  // 2v2 - 3v3 rapid ganker / small-area skirmisher
  teamfight: number; // 5v5 mass brawl / area CC & cluster fight
}

export interface DimensionVector {
  poke: number; // Jarak jauh / mengikis waktu & HP sebelum kontak
  dive: number; // Menghapus jarak & waktu / burst gap-closer
  peel: number; // Menciptakan kembali jarak & waktu / bodyguard counter-dive
}

/**
 * Peta Vektor Skala Pertarungan (Duel / Skirmish / Teamfight).
 * Tiap entri ternormalisasi ke total ~1.0.
 */
export const HERO_SCALE_VECTORS: Record<number, BattleScaleVector> = {
  // --- Spesialis Duel (1v1 / Side-lane Bully) ---
  139: { duel: 0.8, skirmish: 0.1, teamfight: 0.1 }, // Fuzi (Old Master) - Kuncian 1v1 terkuat
  514: { duel: 0.7, skirmish: 0.2, teamfight: 0.1 }, // Allain - True damage duel sustain
  193: { duel: 0.6, skirmish: 0.3, teamfight: 0.1 }, // Kaizer - Monster 1v1 / single target finisher
  121: { duel: 0.8, skirmish: 0.1, teamfight: 0.1 }, // Mi Yue - Ratu duel lifesteal side-lane
  128: { duel: 0.6, skirmish: 0.3, teamfight: 0.1 }, // Cao Cao / Fatih - Sustain duel terus-menerus
  536: { duel: 0.7, skirmish: 0.2, teamfight: 0.1 }, // Charlotte - Debuff attack speed & execute 1v1
  525: { duel: 0.6, skirmish: 0.3, teamfight: 0.1 }, // Mayene - Combo kompresi 1v1
  107: { duel: 0.5, skirmish: 0.4, teamfight: 0.1 }, // Miyamoto Musashi - Single-target anti-heal lock
  144: { duel: 0.6, skirmish: 0.3, teamfight: 0.1 }, // Cheng Yaojin - Regen split push sustain

  // --- Spesialis Skirmish (2v2 - 3v3 / Rapid Gankers) ---
  528: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Lam - Pengeroyokan cepat & isolasi arus air
  502: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Pei (Tiger) - Tempo invasi 2 bentuk awal
  163: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Ukyo Tachibana - Burst zoning early-mid
  531: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Jing - Mirror domain reset skirmish
  162: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Nakoruru - Nuker gank satu target
  153: { duel: 0.2, skirmish: 0.7, teamfight: 0.1 }, // Gao Changgong (Prince of Lanling) - Kamuflase gank
  137: { duel: 0.2, skirmish: 0.6, teamfight: 0.2 }, // Sima Yi - Silence flank ganker
  167: { duel: 0.3, skirmish: 0.6, teamfight: 0.1 }, // Wukong - Critical burst pick-off

  // --- Spesialis Teamfight (5v5 / Mass Brawl) ---
  123: { duel: 0.2, skirmish: 0.2, teamfight: 0.6 }, // Lu Bu - Domain lompat AoE & true damage brawl
  171: { duel: 0.0, skirmish: 0.2, teamfight: 0.8 }, // Zhang Fei - Raungan monster pembalik tawuran
  127: { duel: 0.0, skirmish: 0.2, teamfight: 0.8 }, // Lady Zhen - Rantai beku & burst AoE luas
  105: { duel: 0.1, skirmish: 0.2, teamfight: 0.7 }, // Lian Po - Multi-knockup garis depan
  120: { duel: 0.1, skirmish: 0.2, teamfight: 0.7 }, // Bai Qi - Taunt massal penentu teamfight
  115: { duel: 0.1, skirmish: 0.2, teamfight: 0.7 }, // Gao Jianli - Melodi konser burst di tengah gerombolan
  197: { duel: 0.0, skirmish: 0.2, teamfight: 0.8 }, // Yixing - Kotak catur pengurung 5v5
  124: { duel: 0.0, skirmish: 0.3, teamfight: 0.7 }, // Zhou Yu - Zona api merata di choke point
  186: { duel: 0.0, skirmish: 0.3, teamfight: 0.7 }, // Tai Yi - Stun gerombolan & revive tim
  505: { duel: 0.2, skirmish: 0.2, teamfight: 0.6 }, // Meng Tian - Barisan perisai formasi tentara
};

/**
 * Peta Vektor Jarak & Waktu (Poke / Dive / Peel).
 * Tiap entri ternormalisasi ke total ~1.0.
 */
export const HERO_DIMENSION_VECTORS: Record<number, DimensionVector> = {
  // --- Spesialis Poke (Jarak Jauh / Mengikis Waktu) ---
  108: { poke: 0.8, dive: 0.0, peel: 0.2 }, // Mozi - Meriam stun jarak jauh
  182: { poke: 0.9, dive: 0.0, peel: 0.1 }, // Gan & Mo - Pedang kembar lengkung burst jarak jauh
  196: { poke: 0.9, dive: 0.0, peel: 0.1 }, // Shouyue - Sniper tembus pandang jarak ekstrem
  174: { poke: 0.6, dive: 0.0, peel: 0.4 }, // Consort Yu - Panah jarak jauh + immune fisik
  179: { poke: 0.7, dive: 0.0, peel: 0.3 }, // Nuwa - Kotak rintangan & laser global
  181: { poke: 0.8, dive: 0.0, peel: 0.2 }, // Garuda / Shen Mengxi - Bom area rentang tinggi
  508: { poke: 0.7, dive: 0.0, peel: 0.3 }, // Garo - Panah kritis jarak jauh + slow berat
  112: { poke: 0.6, dive: 0.0, peel: 0.4 }, // Luban No. 7 - Tembakan pasif % HP garis lurus
  169: { poke: 0.5, dive: 0.0, peel: 0.5 }, // Hou Yi - Hujan panah & burung inisiasi global
  192: { poke: 0.7, dive: 0.0, peel: 0.3 }, // Huang Zhong - Artileri meriam stasioner

  // --- Spesialis Dive (Menghapus Jarak & Waktu / Burst Gap-Closer) ---
  150: { poke: 0.0, dive: 0.9, peel: 0.1 }, // Han Xin - Triple dash penerobos garis belakang
  157: { poke: 0.2, dive: 0.8, peel: 0.0 }, // Mai Shiranui - Kipas poke ke dive combo instan
  167: { poke: 0.0, dive: 0.9, peel: 0.1 }, // Wukong - Terjangan klon & gebukan burst instan
  116: { poke: 0.0, dive: 1.0, peel: 0.0 }, // Arke (Ake) - Invisible dive & reset punggung
  510: { poke: 0.0, dive: 0.8, peel: 0.2 }, // Sun Ce - Kapal laut penabrak garis belakang
  506: { poke: 0.0, dive: 0.9, peel: 0.1 }, // Cirrus - Terbang menembus tebing ke carry
  137: { poke: 0.0, dive: 0.9, peel: 0.1 }, // Sima Yi - Sabit bayangan silence penerobos
  528: { poke: 0.0, dive: 0.8, peel: 0.2 }, // Lam - Hiu menerjang formasi musuh
  531: { poke: 0.0, dive: 0.8, peel: 0.2 }, // Jing - Domain cermin penerobos
  142: { poke: 0.1, dive: 0.8, peel: 0.1 }, // Mulan - Pedang ganda dash ke pedang berat silence
  134: { poke: 0.0, dive: 0.8, peel: 0.2 }, // Dharma - Flash kick penabrak dinding

  // --- Spesialis Peel (Menciptakan Jarak & Waktu / Bodyguard Anti-Dive) ---
  171: { poke: 0.0, dive: 0.2, peel: 0.8 }, // Zhang Fei - Knockback S1, Shield S2, Roar Counter-Engage
  187: { poke: 0.0, dive: 0.0, peel: 1.0 }, // Donghuang - Suppress jarak nol pengunci diver
  509: { poke: 0.0, dive: 0.2, peel: 0.8 }, // Dunshan - Tembok tameng pemblok proyektil & pentalan
  640: { poke: 0.2, dive: 0.0, peel: 0.8 }, // Annette - Badai penolak musuh penjaga carry
  156: { poke: 0.2, dive: 0.0, peel: 0.8 }, // Liang (Zhang Liang) - Tali pengekang suppress anti-diver
  135: { poke: 0.0, dive: 0.2, peel: 0.8 }, // Xiang Yu - Dorongan mundur pembuka ruang bagi carry
  114: { poke: 0.0, dive: 0.3, peel: 0.7 }, // Liu Shan - Stun beruntun pengawal turret
  113: { poke: 0.0, dive: 0.0, peel: 1.0 }, // Zhuangzi - Pembersih CC massal pencegah follow-up dive
  186: { poke: 0.0, dive: 0.3, peel: 0.7 }, // Tai Yi - Revive penjaga nyawa carry kedua
};

/**
 * Mengambil vektor skala pertarungan hero dengan fallback heuristik jika belum terdaftar.
 */
export function getHeroScaleVector(hero: Hero): BattleScaleVector {
  if (HERO_SCALE_VECTORS[hero.hero_id]) {
    return HERO_SCALE_VECTORS[hero.hero_id];
  }
  const tags = hero.tactical_profile?.tags;
  const role = hero.primary_role;

  if (role === 'Assassin') {
    return { duel: 0.3, skirmish: 0.6, teamfight: 0.1 };
  }
  if (role === 'Tank') {
    return { duel: 0.1, skirmish: 0.2, teamfight: 0.7 };
  }
  if (role === 'Support') {
    return { duel: 0.0, skirmish: 0.3, teamfight: 0.7 };
  }
  if (role === 'Marksman') {
    return { duel: 0.2, skirmish: 0.3, teamfight: 0.5 };
  }
  if (role === 'Mage') {
    if (tags?.cc_stun || tags?.cc_knockup || tags?.cc_slow || tags?.disengage) {
      return { duel: 0.1, skirmish: 0.2, teamfight: 0.7 };
    }
    return { duel: 0.2, skirmish: 0.4, teamfight: 0.4 };
  }
  if (role === 'Fighter') {
    if (!tags?.frontline || tags?.kite_vulnerable) {
      return { duel: 0.6, skirmish: 0.3, teamfight: 0.1 };
    }
    return { duel: 0.3, skirmish: 0.3, teamfight: 0.4 };
  }
  return { duel: 0.33, skirmish: 0.34, teamfight: 0.33 };
}

/**
 * Mengambil vektor dimensi jarak & waktu hero dengan fallback heuristik.
 */
export function getHeroDimensionVector(hero: Hero): DimensionVector {
  if (HERO_DIMENSION_VECTORS[hero.hero_id]) {
    return HERO_DIMENSION_VECTORS[hero.hero_id];
  }
  const tags = hero.tactical_profile?.tags;
  const role = hero.primary_role;

  if (role === 'Assassin') {
    return { poke: 0.0, dive: 0.85, peel: 0.15 };
  }
  if (role === 'Tank' || role === 'Support') {
    if (tags?.peel || tags?.suppress || tags?.ally_shield || tags?.ally_heal) {
      return { poke: 0.0, dive: 0.15, peel: 0.85 };
    }
    return { poke: 0.0, dive: 0.4, peel: 0.6 };
  }
  if (role === 'Marksman') {
    if (tags?.dive_vulnerable || tags?.kite_vulnerable) {
      return { poke: 0.8, dive: 0.0, peel: 0.2 };
    }
    return { poke: 0.5, dive: 0.0, peel: 0.5 };
  }
  if (role === 'Mage') {
    if (tags?.dive_vulnerable || !tags?.mobility) {
      return { poke: 0.8, dive: 0.0, peel: 0.2 };
    }
    if (tags?.mobility || tags?.dash || tags?.blink) {
      return { poke: 0.2, dive: 0.7, peel: 0.1 };
    }
    return { poke: 0.5, dive: 0.1, peel: 0.4 };
  }
  if (role === 'Fighter') {
    if (tags?.engage && tags?.mobility) {
      return { poke: 0.0, dive: 0.75, peel: 0.25 };
    }
    return { poke: 0.1, dive: 0.45, peel: 0.45 };
  }
  return { poke: 0.33, dive: 0.34, peel: 0.33 };
}

export interface ScaleClashAnalysis {
  ourDominantScale: 'DUEL_SPLIT' | 'SKIRMISH_GANK' | 'TEAMFIGHT_BRAWL';
  enemyDominantScale: 'DUEL_SPLIT' | 'SKIRMISH_GANK' | 'TEAMFIGHT_BRAWL';
  ourScaleScores: { duel: number; skirmish: number; teamfight: number };
  enemyScaleScores: { duel: number; skirmish: number; teamfight: number };
  matchupHeadline: string;
  tacticalAdvice: string;
  isSplitPushViable: boolean;
}

/**
 * Mengevaluasi benturan skala pertempuran (Battle Scale Clash):
 * Siklus: Duel dicounter Skirmish, Skirmish dicounter Teamfight, Teamfight dicounter Split Push / Tempo.
 */
export function evaluateScaleClash(
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
): ScaleClashAnalysis {
  const ourScores = { duel: 0, skirmish: 0, teamfight: 0 };
  for (const h of ourHeroes) {
    const v = getHeroScaleVector(h);
    ourScores.duel += v.duel;
    ourScores.skirmish += v.skirmish;
    ourScores.teamfight += v.teamfight;
  }

  const enemyScores = { duel: 0, skirmish: 0, teamfight: 0 };
  for (const h of enemyHeroes) {
    const v = getHeroScaleVector(h);
    enemyScores.duel += v.duel;
    enemyScores.skirmish += v.skirmish;
    enemyScores.teamfight += v.teamfight;
  }

  const getDominant = (scores: { duel: number; skirmish: number; teamfight: number }) => {
    if (scores.duel >= scores.skirmish && scores.duel >= scores.teamfight) return 'DUEL_SPLIT';
    if (scores.skirmish >= scores.duel && scores.skirmish >= scores.teamfight) return 'SKIRMISH_GANK';
    return 'TEAMFIGHT_BRAWL';
  };

  const ourDominant = getDominant(ourScores);
  const enemyDominant = getDominant(enemyScores);

  let matchupHeadline = '';
  let tacticalAdvice = '';
  let isSplitPushViable = false;

  // Skenario 1: Musuh Teamfight Brawl Masif vs Tim Kita Memiliki Potensi Duel / Split
  if (enemyDominant === 'TEAMFIGHT_BRAWL' && (ourScores.duel >= 1.5 || ourDominant === 'DUEL_SPLIT')) {
    isSplitPushViable = true;
    matchupHeadline = 'Split Push & Rotasi Makro vs Tawuran 5v5 Musuh';
    tacticalAdvice =
      'Komposisi lawan sangat kuat dalam tawuran massal 5v5 berkumpul. Jangan memaksakan contest simetris di lorong sempit; terapkan formasi 1-3-1 atau 4-1 untuk menguras toren samping dan merusak formasi mereka.';
  }
  // Skenario 2: Tim Kita Teamfight Brawl Masif vs Musuh Skirmish / Gank
  else if (ourDominant === 'TEAMFIGHT_BRAWL' && enemyDominant === 'SKIRMISH_GANK') {
    matchupHeadline = 'Keunggulan Tawuran 5v5 vs Formasi Penyergap Lawan';
    tacticalAdvice =
      'Musuh unggul menyergap target terisolasi (2v2/3v3) tetapi lemah saat berhadapan dengan barisan 5v5 utuh. Segera satukan grup di menit 08:00+ untuk memaksa perang memperebutkan Tyrant/Overlord sebelum mereka sempat memetik kawan yang terpisah.';
  }
  // Skenario 3: Tim Kita Skirmish Ganker vs Musuh Duelist Split Push
  else if (ourDominant === 'SKIRMISH_GANK' && enemyDominant === 'DUEL_SPLIT') {
    matchupHeadline = 'Penyergapan Cepat Berkelompok vs Side-Lane Bully Lawan';
    tacticalAdvice =
      'Duelist musuh menang adu mekanik 1v1 di side-lane. Jangan hadapi mereka secara duel adil; gunakan rotasi cepat 2v1 atau 3v1 untuk mematikan carry split lawan begitu mereka melangkah melewati sungai.';
  }
  // Skenario 4: Musuh Skirmish Gank vs Tim Kita Duelis
  else if (ourDominant === 'DUEL_SPLIT' && enemyDominant === 'SKIRMISH_GANK') {
    matchupHeadline = 'Waspada Jebakan Rotasi Gank Musuh di Side-Lane';
    tacticalAdvice =
      'Duelist kita unggul 1v1 tetapi menjadi mangsa empuk bagi rotasi gank cepat 2v2/3v3 musuh. Pastikan roamer menaruh visi di sungai sebelum duelist mendorong minion melampaui separuh peta.';
  }
  // Default / Simetris
  else {
    matchupHeadline = `Adu Skala: ${ourDominant.replace('_', ' ')} vs ${enemyDominant.replace('_', ' ')}`;
    tacticalAdvice =
      'Kedua tim memiliki profil skala pertempuran yang serupa; pemenang ditentukan oleh kedisiplinan positioning lini belakang dan eksekusi kuncian CC pertama di objektif sungai.';
  }

  return {
    ourDominantScale: ourDominant,
    enemyDominantScale: enemyDominant,
    ourScaleScores: ourScores,
    enemyScaleScores: enemyScores,
    matchupHeadline,
    tacticalAdvice,
    isSplitPushViable,
  };
}

export interface BacklineSafetyAnalysis {
  riskLevel: 'SAFE' | 'ELEVATED' | 'CRITICAL';
  enemyDiveScore: number;
  ourPeelScore: number;
  vulnerableCarries: Hero[];
  threatDivers: Hero[];
  warningMessage?: string;
  defensiveActionAdvice?: string;
}

/**
 * Mengevaluasi Risiko Kolapsnya Lini Belakang (Backline Safety / Carry Collapse Risk).
 * Menghitung pertukaran jarak dan waktu: Dive musuh vs Peel tim kawan terhadap carry statis/poke.
 */
export function evaluateBacklineSafety(
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
): BacklineSafetyAnalysis {
  let enemyDive = 0;
  const threatDivers: Hero[] = [];
  for (const eh of enemyHeroes) {
    const dim = getHeroDimensionVector(eh);
    enemyDive += dim.dive;
    if (dim.dive >= 0.7) {
      threatDivers.push(eh);
    }
  }

  let ourPeel = 0;
  for (const oh of ourHeroes) {
    const dim = getHeroDimensionVector(oh);
    ourPeel += dim.peel;
  }

  // Identifikasi carry rentan (minim mobilitas atau marksman/mage poke statis)
  const vulnerableCarries = ourHeroes.filter((h) => {
    const tags = h.tactical_profile?.tags;
    const isCarryRole = h.primary_role === 'Marksman' || h.primary_role === 'Mage';
    const isImmobile =
      !tags?.mobility && !tags?.dash && !tags?.blink && !tags?.leap && !tags?.teleport;
    const isVulnerable = Boolean(tags?.dive_vulnerable || tags?.kite_vulnerable || tags?.weak_early);
    return isCarryRole && (isImmobile || isVulnerable);
  });

  const diff = enemyDive - ourPeel;
  let riskLevel: 'SAFE' | 'ELEVATED' | 'CRITICAL' = 'SAFE';
  let warningMessage: string | undefined;
  let defensiveActionAdvice: string | undefined;

  if (vulnerableCarries.length > 0 && (diff >= 0.9 || (enemyDive >= 2.2 && ourPeel < 1.4))) {
    riskLevel = 'CRITICAL';
    const carryNames = vulnerableCarries.map((c) => c.name).join(', ');
    const diverNames = threatDivers.map((d) => d.name).join(', ') || 'diver musuh';
    warningMessage = `RISIKO KOLAPS LINI BELAKANG: Carry kita (${carryNames}) menghadapi tekanan dive masif (${diverNames}) tanpa pengawalan peel yang memadai.`;
    defensiveActionAdvice = `Roamer & Tank wajib bermain 'peel-first' (menempel carry alih-alih mengejar lini belakang lawan). Carry wajib membawa Battle Spell Purify/Flash dan menyegerakan item defensif (Ominous Premonition / Splendor / Sage's Sanctuary).`;
  } else if (vulnerableCarries.length > 0 && diff >= 0.3) {
    riskLevel = 'ELEVATED';
    const carryNames = vulnerableCarries.map((c) => c.name).join(', ');
    warningMessage = `Tekanan Lini Belakang: ${carryNames} rentan terhadap burst gank musuh saat posisi terbuka.`;
    defensiveActionAdvice = `Jaga formasi rapat saat rotasi sungai dan jangan biarkan carry berjalan sendirian tanpa pembuka visi di semak.`;
  }

  return {
    riskLevel,
    enemyDiveScore: Number(enemyDive.toFixed(2)),
    ourPeelScore: Number(ourPeel.toFixed(2)),
    vulnerableCarries,
    threatDivers,
    warningMessage,
    defensiveActionAdvice,
  };
}

export interface ConstraintSynergyPair {
  enabler: Hero;
  beneficiary: Hero;
  constraintRemoved: string;
  tacticalImpact: string;
}

/**
 * Mendeteksi sinergi pembebas batasan (Constraint Removal Synergies):
 * Bukan sekadar cocok di atas kertas, tetapi menghapus kelemahan inheren rekan satu tim.
 */
export function detectConstraintRemovalSynergies(
  heroes: Hero[],
): ConstraintSynergyPair[] {
  const pairs: ConstraintSynergyPair[] = [];
  const heroIds = new Set(heroes.map((h) => h.hero_id));
  const heroMap = new Map(heroes.map((h) => [h.hero_id, h]));

  // 1. Sun Bin (118) menghapus batasan mobilitas hero lambat (Kaizer 193, Lu Bu 123)
  if (heroIds.has(118)) {
    const sunBin = heroMap.get(118)!;
    for (const bId of [193, 123]) {
      if (heroIds.has(bId)) {
        const beneficiary = heroMap.get(bId)!;
        pairs.push({
          enabler: sunBin,
          beneficiary,
          constraintRemoved: 'Batasan Mobilitas & Kiting',
          tacticalImpact: `Skill 2 Sun Bin memberikan lonjakan kecepatan gerak & rewind HP sehingga ${beneficiary.name} dapat menerjang target tanpa terkena kiting.`,
        });
      }
    }
  }

  // 2. Yaria (505) menghapus batasan squishy diver (Lam 528, Jing 531, Nakoruru 162)
  if (heroIds.has(505)) {
    const yaria = heroMap.get(505)!;
    for (const bId of [528, 531, 162]) {
      if (heroIds.has(bId)) {
        const beneficiary = heroMap.get(bId)!;
        pairs.push({
          enabler: yaria,
          beneficiary,
          constraintRemoved: 'Batasan Daya Tahan Squishy Assassin',
          tacticalImpact: `Perisai pasif Yaria menempel pada ${beneficiary.name}, memungkinkannya bertahan dari burst awal saat melakukan dive ke tengah formasi lawan.`,
        });
      }
    }
  }

  // 3. Dolia (159) menghapus batasan Cooldown Ultimate (Kaizer 193, Lu Bu 123, Heino 540)
  if (heroIds.has(159)) {
    const dolia = heroMap.get(159)!;
    for (const bId of [193, 123, 540]) {
      if (heroIds.has(bId)) {
        const beneficiary = heroMap.get(bId)!;
        pairs.push({
          enabler: dolia,
          beneficiary,
          constraintRemoved: 'Batasan Cooldown Jurus Ultimate',
          tacticalImpact: `Lagu Dolia me-refresh Ultimate ${beneficiary.name} seketika, memungkinkan aktivasi ganda dalam satu teamfight yang sama.`,
        });
      }
    }
  }

  // 4. Da Qiao (119) menghapus batasan Jarak & Sustain (Pei 502, Ukyo 163, Sun Ce 510)
  if (heroIds.has(119)) {
    const daQiao = heroMap.get(119)!;
    for (const bId of [502, 163, 510]) {
      if (heroIds.has(bId)) {
        const beneficiary = heroMap.get(bId)!;
        pairs.push({
          enabler: daQiao,
          beneficiary,
          constraintRemoved: 'Batasan Recall & Waktu Tempuh Peta',
          tacticalImpact: `Kolam pemulangan Da Qiao + Ultimate memulihkan darah ${beneficiary.name} hingga 100% dan membawanya kembali ke arena dalam 4 detik.`,
        });
      }
    }
  }

  return pairs;
}

export interface AntiImpostorAdvice {
  tempoRoamer: Hero;
  counterStrategy: string;
}

/**
 * Mendeteksi roamer tipe Tempo pada tim musuh dan memberikan taktik kontra-impostor.
 */
export function detectEnemyTempoImpostors(
  enemyHeroes: Hero[],
): AntiImpostorAdvice[] {
  const results: AntiImpostorAdvice[] = [];
  for (const eh of enemyHeroes) {
    if (eh.hero_id === 191) {
      // Da Qiao
      results.push({
        tempoRoamer: eh,
        counterStrategy:
          'KONTRA DA QIAO: Musuh akan memecah peta lewat teleportasi rotasi. Jangan biarkan portalnya terbentuk tanpa gangguan; gunakan CC pengganggu (knockback/silence) pada kolam recall atau serbu formasi lawan saat cooldown portal berlangsung.',
      });
    } else if (eh.hero_id === 118) {
      // Sun Bin
      results.push({
        tempoRoamer: eh,
        counterStrategy:
          'KONTRA SUN BIN: Waspadai pembalikan teamfight lewat S2 Rewind. Tahan skill burst damage tertinggi tim saat lingkaran waktu Sun Bin aktif, lalu lepaskan burst begitu durasi akselerasinya selesai.',
      });
    } else if (eh.hero_id === 159) {
      // Dolia
      results.push({
        tempoRoamer: eh,
        counterStrategy:
          'KONTRA DOLIA: Musuh mengincar rantai Ultimate ganda. Kunci dan eliminasi Dolia lebih awal sebelum ia sempat menyelesaikan tarian refresh pada carry musuh.',
      });
    }
  }
  return results;
}
