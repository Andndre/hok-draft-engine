/**
 * roamJungleTactics.ts
 *
 * Modul Evaluasi Taktis Arketipe Roamer & Sinkronisasi Tempo Jungle-Roam
 * Berdasarkan mekanika kit murni/hibrida dan prinsip makro Honor of Kings.
 */

export type RoamArchetype = 'engage' | 'disengage' | 'poke' | 'enchanter' | 'tempo';

export interface RoamArchetypeVector {
  engage: number;
  disengage: number;
  poke: number;
  enchanter: number;
  tempo: number;
}

/**
 * 18 Roamer resmi + Mozi (Flex Mid-Roam) dipetakan ke vektor 5-D ternormalisasi (total = 1.0).
 */
export const ROAMER_VECTORS: Record<number, RoamArchetypeVector> = {
  // --- Murni / Dominan Engage ---
  189: { engage: 1.0, disengage: 0.0, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Guiguzi
  168: { engage: 1.0, disengage: 0.0, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Lapulapu (Niu Mo)
  114: { engage: 1.0, disengage: 0.0, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Liu Shan
  175: { engage: 0.8, disengage: 0.2, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Kui (Hook Pick-off + Zone Slow)

  // --- Murni / Dominan Disengage ---
  113: { engage: 0.0, disengage: 1.0, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Zhuangzi (Anti-CC Cleanse)
  187: { engage: 0.0, disengage: 1.0, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Donghuang (Anti-Dive Suppress point-blank)
  640: { engage: 0.0, disengage: 0.8, poke: 0.2, enchanter: 0.0, tempo: 0.0 }, // Annette (Hurricane Wall + S1 Poke)
  509: { engage: 0.2, disengage: 0.8, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Dunshan (Shield Wall + S2 Toss)
  171: { engage: 0.4, disengage: 0.6, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Zhang Fei (Peel S1/S2 -> Ult Hard Engage)

  // --- Flex Poke ---
  108: { engage: 0.2, disengage: 0.0, poke: 0.8, enchanter: 0.0, tempo: 0.0 }, // Mozi (Long-range Cannon Poke)

  // --- Enchanter ---
  184: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 1.0, tempo: 0.0 }, // Cai Yan
  505: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 1.0, tempo: 0.0 }, // Yaria
  501: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 1.0, tempo: 0.0 }, // Ming
  577: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 1.0, tempo: 0.0 }, // Dyadia
  534: { engage: 0.1, disengage: 0.1, poke: 0.0, enchanter: 0.8, tempo: 0.0 }, // Sakeer (Heal Kunang-kunang)
  585: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 1.0, tempo: 0.0 }, // Flowborn (Roamer)

  // --- Tempo & Tempo Hibrida ---
  191: { engage: 0.0, disengage: 0.0, poke: 0.0, enchanter: 0.0, tempo: 1.0 }, // Da Qiao (Makro-Relokasi Portal)
  118: { engage: 0.0, disengage: 0.0, poke: 0.2, enchanter: 0.4, tempo: 0.4 }, // Sun Bin (Speed/CDR + Rewind Heal)
  159: { engage: 0.0, disengage: 0.1, poke: 0.0, enchanter: 0.4, tempo: 0.5 }, // Dolia (Cooldown Reset)

  // --- Roamer Flex Ekstra ---
  149: { engage: 0.1, disengage: 0.4, poke: 0.0, enchanter: 0.0, tempo: 0.5 }, // Liu Bang (Global Shield + Teleport)
  186: { engage: 0.6, disengage: 0.4, poke: 0.0, enchanter: 0.0, tempo: 0.0 }, // Taiyi Zhenren (Stun Jump + Revive Ult)
};

/**
 * Matriks Saling Counter Arketipe (5x5).
 * Rantai: Engage -> Disengage -> Poke -> Enchanter -> Tempo -> Engage
 * Skala bobot dibatasi maks +/- 0.35 agar terkalibrasi terhadap sebaran term inferensi KPL.
 */
const ARCHETYPE_ORDER: RoamArchetype[] = ['engage', 'disengage', 'poke', 'enchanter', 'tempo'];

const ARCHETYPE_MATRIX: number[][] = [
  // [Engage, Disengage, Poke, Enchanter, Tempo]
  [  0.00,     -0.35,   +0.25,     -0.10,   +0.35 ], // vs Engage
  [ +0.35,      0.00,   -0.35,     +0.10,   -0.10 ], // vs Disengage
  [ -0.25,     +0.35,    0.00,     -0.35,   +0.10 ], // vs Poke
  [ +0.10,     -0.10,   +0.35,      0.00,   -0.35 ], // vs Enchanter
  [ -0.35,     +0.10,   -0.10,     +0.35,    0.00 ], // vs Tempo
];

/**
 * Hitung keuntungan/kerugian arketipe roamer kita terhadap roamer musuh.
 */
export function evaluateRoamArchetypeAdvantage(
  ourRoamId: number,
  enemyRoamId: number
): { delta: number; label?: string } {
  const vOur = ROAMER_VECTORS[ourRoamId];
  const vEnemy = ROAMER_VECTORS[enemyRoamId];
  if (!vOur || !vEnemy) return { delta: 0 };

  const ourArr = [vOur.engage, vOur.disengage, vOur.poke, vOur.enchanter, vOur.tempo];
  const enemyArr = [vEnemy.engage, vEnemy.disengage, vEnemy.poke, vEnemy.enchanter, vEnemy.tempo];

  let totalScore = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      totalScore += ourArr[i] * ARCHETYPE_MATRIX[i][j] * enemyArr[j];
    }
  }

  // Cari label dominan jika ada keunggulan/kerugian jelas
  if (totalScore >= 0.15) {
    const dominantOur = ARCHETYPE_ORDER[ourArr.indexOf(Math.max(...ourArr))];
    const dominantEnemy = ARCHETYPE_ORDER[enemyArr.indexOf(Math.max(...enemyArr))];
    return {
      delta: Math.min(0.35, totalScore),
      label: `🛡️ Keunggulan Arketipe: ${dominantOur.toUpperCase()} vs ${dominantEnemy.toUpperCase()}`,
    };
  } else if (totalScore <= -0.15) {
    const dominantOur = ARCHETYPE_ORDER[ourArr.indexOf(Math.max(...ourArr))];
    const dominantEnemy = ARCHETYPE_ORDER[enemyArr.indexOf(Math.max(...enemyArr))];
    return {
      delta: Math.max(-0.35, totalScore),
      label: `⚠️ Waspada Arketipe: ${dominantOur.toUpperCase()} rentan terhadap ${dominantEnemy.toUpperCase()}`,
    };
  }

  return { delta: totalScore };
}

// =============================================================================
// PROFIL TEMPO JUNGLER & KOHERENSI JUNGLE-ROAM
// =============================================================================

export type JungleTempoType = 'early_invade' | 'mid_skirmish' | 'late_scaling';
export type MobilityTier = 'cross_terrain' | 'dashing' | 'ground_walking';

export interface JungleTempoProfile {
  tempo: JungleTempoType;
  mobility: MobilityTier;
  level4Dependent: boolean;
}

/**
 * Profil tempo Jungler utama dengan penyesuaian:
 * - Jing: cross_terrain (domain cermin menembus tebing)
 * - Gao Changgong: level4Dependent = false (stealth aktif sejak Level 1)
 * - Lam: ID 528 (bukan 533 Agudo)
 */
export const JUNGLE_TEMPO_PROFILES: Record<number, JungleTempoProfile> = {
  // Early Invade (Menekan resource hutan musuh sejak Lv 1-2)
  502: { tempo: 'early_invade', mobility: 'dashing',       level4Dependent: false }, // Pei
  163: { tempo: 'early_invade', mobility: 'dashing',       level4Dependent: false }, // Ukyo Tachibana
  150: { tempo: 'early_invade', mobility: 'cross_terrain', level4Dependent: false }, // Han Xin
  170: { tempo: 'early_invade', mobility: 'dashing',       level4Dependent: false }, // Liu Bei
  506: { tempo: 'early_invade', mobility: 'cross_terrain', level4Dependent: false }, // Cirrus (Terbang tembus tebing)

  // Late Scaling (Wajib proteksi EXP & Buff sebelum Lv 4)
  146: { tempo: 'late_scaling', mobility: 'cross_terrain', level4Dependent: true },  // Luna
  131: { tempo: 'late_scaling', mobility: 'cross_terrain', level4Dependent: true },  // Li Bai
  167: { tempo: 'late_scaling', mobility: 'dashing',       level4Dependent: true },  // Wukong

  // Mid Skirmish (Power spike saat Ulti terbuka atau rotasi gank pertama)
  528: { tempo: 'mid_skirmish', mobility: 'dashing',       level4Dependent: true },  // Lam (ID resmi 528)
  531: { tempo: 'mid_skirmish', mobility: 'cross_terrain', level4Dependent: true },  // Jing (Domain cermin menembus tebing)
  162: { tempo: 'mid_skirmish', mobility: 'dashing',       level4Dependent: true },  // Nakoruru
  153: { tempo: 'mid_skirmish', mobility: 'dashing',       level4Dependent: false }, // Gao Changgong (Stealth sejak Lv 1)
  107: { tempo: 'mid_skirmish', mobility: 'dashing',       level4Dependent: true },  // Zilong
  193: { tempo: 'mid_skirmish', mobility: 'ground_walking',level4Dependent: true },  // Kaizer
  556: { tempo: 'mid_skirmish', mobility: 'ground_walking',level4Dependent: false }, // Ata
  137: { tempo: 'mid_skirmish', mobility: 'cross_terrain', level4Dependent: true },  // Sima Yi
  533: { tempo: 'mid_skirmish', mobility: 'dashing',       level4Dependent: true },  // Agudo
};

export interface CoherenceResult {
  delta: number;
  badge?: string;
  isMismatch?: boolean;
  isGolden?: boolean;
}

/**
 * Evaluasi koherensi tempo dan sinergi mekanik antara Roamer dan Jungler satu tim.
 */
export function evaluateRoamJungleCoherence(roamId: number, jungleId: number): CoherenceResult {
  // ---------------------------------------------------------------------------
  // 1. KOMBO EMAS (Golden Synergies) -> Bonus Taktis +0.35 s/d +0.45
  // ---------------------------------------------------------------------------
  // Pei + Da Qiao: The Global Invade Engine
  if (jungleId === 502 && roamId === 191) {
    return { delta: +0.40, badge: '⚡ Kombo Emas: The Global Invade Engine (Pei + Da Qiao)', isGolden: true };
  }
  // Guiguzi + Liu Bei / Sima Yi: Point-Blank Ambush
  if ((jungleId === 170 || jungleId === 137) && roamId === 189) {
    return { delta: +0.40, badge: '⚡ Kombo Emas: Point-Blank Ambush (Hisapan Guiguzi)', isGolden: true };
  }
  // Yaria + Nimble Divers (Lam 528, Jing 531, Luna 146): Hyper-Dive Symbiosis
  if ([528, 531, 146].includes(jungleId) && roamId === 505) {
    return { delta: +0.45, badge: '⚡ Kombo Emas: Hyper-Dive Symbiosis (Yaria Shield + Carry Tempel)', isGolden: true };
  }
  // Dolia + Ult-Reliant Jungler (Zilong 107, Gao Changgong 153): Double Ult Reset
  if ([107, 153].includes(jungleId) && roamId === 159) {
    return { delta: +0.40, badge: '⚡ Kombo Emas: Double Ult Reset (Refresh Dolia)', isGolden: true };
  }
  // Sun Bin + Heavy Bruisers (Kaizer 193, Ata 556): Bruiser Speed-Blitz
  if ([193, 556].includes(jungleId) && roamId === 118) {
    return { delta: +0.35, badge: '⚡ Kombo Emas: Bruiser Speed-Blitz (Akselerasi Sun Bin S2)', isGolden: true };
  }

  // ---------------------------------------------------------------------------
  // 2. KOMBO TERLARANG (Forbidden Mismatches) -> Penalti Koherensi -0.45 s/d -0.55
  // ---------------------------------------------------------------------------
  const rVec = ROAMER_VECTORS[roamId];
  const jProf = JUNGLE_TEMPO_PROFILES[jungleId];

  // Mismatch 1: Early Roam Engage Agresif + Jungler Manja Farm Lv 4
  const isEarlyEngageRoam = (rVec?.engage ?? 0) >= 0.8 || [189, 114].includes(roamId);
  const isLateFarmJungler = (jProf?.tempo === 'late_scaling' && jProf?.level4Dependent) || [146, 131, 167].includes(jungleId);
  if (isEarlyEngageRoam && isLateFarmJungler) {
    return {
      delta: -0.50,
      badge: '⚠️ Tempo Mismatch: Roam Agresif Menekan Jungler Butuh Farm Level 4',
      isMismatch: true,
    };
  }

  // Mismatch 2: Roam Pejalan Kaki / Tali Tether + Jungler Lintas Tebing
  const isWalkingTetherRoam = (rVec?.enchanter ?? 0) >= 0.8 || [501, 184].includes(roamId);
  const isCrossTerrainJungler = jProf?.mobility === 'cross_terrain' || [150, 506, 531, 131].includes(jungleId);
  if (isWalkingTetherRoam && isCrossTerrainJungler) {
    return {
      delta: -0.55,
      badge: '⚠️ Tempo Mismatch: Tali/Heal Tertinggal di Belakang Jungler Lintas Medan',
      isMismatch: true,
    };
  }

  // Mismatch 3: Roam Pasif Scaling Lv 1 + Jungler Early Snowball
  const isPassiveScalingRoam = ((rVec?.tempo ?? 0) >= 0.3 || (rVec?.enchanter ?? 0) >= 0.8) && [118, 505].includes(roamId);
  const isEarlySnowballJungler = jProf?.tempo === 'early_invade' || [502, 163].includes(jungleId);
  if (isPassiveScalingRoam && isEarlySnowballJungler) {
    return {
      delta: -0.45,
      badge: '⚠️ Tempo Mismatch: Roam Pasif Membuang Keunggulan Snowball Early Jungler',
      isMismatch: true,
    };
  }

  return { delta: 0.0 };
}
