import type {
  CompArchetypeSummary,
  CounterItemInfo,
  GamePlanAnalysis,
  GankTargetPriority,
  Hero,
  HeroTempoCurve,
  JungleAndGankPlan,
  KplLaneRate,
  Lane,
  LaneAssignmentMap,
  LaneMatchupEvaluation,
  SwapFeasibility,
  SwapSuggestion,
  TempoCurveComparison,
  TempoPhaseShare,
  TempoProfile,
  TempoWindowSummary,
  WinningConditionAnalysis,
} from "../types";
import { ALL_LANES, assignHeroLanes, oppositeSide } from "./draftRules";
import type { KplLaneRateMap, Side } from "./draftRules";
import { evaluateTacticalScores } from "./tournamentInference";

export type TempoCurveMap = Record<string, HeroTempoCurve>;

export interface GamePlanInput {
  ourSide: Side;
  ourHeroes: Hero[];
  enemyHeroes: Hero[];
  synergy?: Record<string, any> | null;
  ourAssignmentOverride?: LaneAssignmentMap | null;
  enemyAssignmentOverride?: LaneAssignmentMap | null;
}

const LANE_SWAP_PAIRS: ReadonlyArray<[Lane, Lane]> = [
  ["Mid", "Farm"],
  ["Clash", "Farm"],
  ["Clash", "Mid"],
  ["Mid", "Roam"],
  ["Clash", "Roam"],
  ["Farm", "Roam"],
  ["Clash", "Jungle"],
  ["Mid", "Jungle"],
  ["Farm", "Jungle"],
  ["Roam", "Jungle"],
];

function buildHeroMap(heroes: Hero[]): Map<number, Hero> {
  return new Map(heroes.map((h) => [h.hero_id, h]));
}

export function buildDefaultLaneAssignments(
  heroes: Hero[],
  kplLaneRates?: KplLaneRateMap,
): LaneAssignmentMap {
  const { byLane } = assignHeroLanes(heroes, kplLaneRates);
  const assignedIds = new Set(
    Object.values(byLane).filter((id): id is number => id !== null),
  );
  const unassigned = heroes.filter((h) => !assignedIds.has(h.hero_id));
  const result: LaneAssignmentMap = { ...byLane };
  for (const lane of ALL_LANES) {
    if (result[lane] === null && unassigned.length > 0) {
      result[lane] = unassigned.shift()!.hero_id;
    }
  }
  return result;
}

export function swapAssignedLanes(
  assignment: LaneAssignmentMap,
  laneA: Lane,
  laneB: Lane,
): LaneAssignmentMap {
  if (laneA === laneB) return assignment;
  return {
    ...assignment,
    [laneA]: assignment[laneB],
    [laneB]: assignment[laneA],
  };
}

export function assignmentToHeroLaneMap(
  assignment: LaneAssignmentMap,
): Map<number, Lane> {
  const map = new Map<number, Lane>();
  for (const lane of ALL_LANES) {
    const heroId = assignment[lane];
    if (heroId !== null) map.set(heroId, lane);
  }
  return map;
}

function hasKplFlexLane(
  hero: Hero,
  lane: Lane,
  kplLaneRates?: KplLaneRateMap,
): KplLaneRate | null {
  const stat = kplLaneRates?.[String(hero.hero_id)]?.[lane];
  if (stat && stat.games >= 15 && stat.share >= 0.12) return stat;
  return null;
}

function evaluateSwapMacroProfile(
  hero: Hero,
  lane: Lane,
  enemyHero: Hero | null,
  kplLaneRates?: KplLaneRateMap,
): {
  swapFeasibility: SwapFeasibility;
  macroCost: number;
  macroSwapNote?: string;
  reswapAdvice?: string;
} {
  if (hero.primary_lane === lane) {
    return { swapFeasibility: "PRIMARY", macroCost: 0 };
  }
  if (hero.lanes.includes(lane)) {
    return {
      swapFeasibility: "OFFICIAL_FLEX",
      macroCost: 0.05,
      macroSwapNote: `${hero.name} fleksibel resmi di ${lane} tanpa penalti ekonomi.`,
    };
  }
  const kplFlex = hasKplFlexLane(hero, lane, kplLaneRates);
  if (kplFlex) {
    return {
      swapFeasibility: "KPL_PRO_FLEX",
      macroCost: 0.1,
      macroSwapNote: `Terbukti di KPL (${kplFlex.games} game, ${Math.round(kplFlex.win_rate * 100)}% WR di ${lane}).`,
    };
  }

  const tags = hero.tactical_profile?.tags;
  const hasEscape = Boolean(
    tags?.mobility || tags?.dash || tags?.blink || tags?.leap,
  );
  const reswapAt4 = `Tukarkan kembali ${hero.name} ke ${hero.primary_lane} setelah 04:00 (saat shield turret habis).`;

  if (lane === "Jungle") {
    return {
      swapFeasibility: "TACTICAL_SWAP",
      macroCost: 4.5,
      macroSwapNote: `${hero.name} bukan jungler alami; tanpa clear camp & Smite cepat tempo tim berisiko runtuh.`,
      reswapAdvice: "Kembalikan peran Jungle ke jungler utama pada draft.",
    };
  }
  if (lane === 'Roam') {
    return {
      swapFeasibility: 'TACTICAL_SWAP',
      macroCost: 3.5,
      macroSwapNote: `${hero.name} bukan Roam flex resmi/KPL; mengorbankan farm wave demi item Roam merusak ekonomi tim.`,
      reswapAdvice: 'Kembalikan peran Roam ke hero support/roam alami pada draft.',
    };
  }
  if (hero.primary_lane === 'Roam') {
    return {
      swapFeasibility: 'TACTICAL_SWAP',
      macroCost: 3.0,
      macroSwapNote: `${hero.name} tidak memiliki flex resmi/KPL di ${lane}; meninggalkan pos Roam mengosongkan peran support utama tim.`,
      reswapAdvice: `Kembalikan ${hero.name} ke pos Roam; swap taktis pra-04:00 hanya dilakukan antar-laner (Clash/Mid/Farm).`,
    };
  }
  if (hero.primary_lane === "Farm" && (lane === "Clash" || lane === "Mid")) {
    const cost = hasEscape ? 0.65 : 0.95;
    return {
      swapFeasibility: "TACTICAL_SWAP",
      macroCost: cost,
      macroSwapNote:
        lane === "Clash"
          ? `Laning awal ${hero.name} di Clash melepas bonus gold minion Farm Lane & rawan gank.`
          : `Taruh ${hero.name} di Mid mengurangi prioritas waveclear mage${hasEscape ? "" : " & rentan gank dua arah"}.`,
      reswapAdvice: reswapAt4,
    };
  }
  if (
    lane === "Mid" &&
    hero.primary_role !== "Mage" &&
    hero.primary_role !== "Marksman"
  ) {
    return {
      swapFeasibility: "TACTICAL_SWAP",
      macroCost: 1.25,
      macroSwapNote: `${hero.name} (${hero.primary_role}) berisiko kalah tempo waveclear di Mid & melepas kendali rotasi sungai awal.`,
      reswapAdvice: reswapAt4,
    };
  }
  if (
    lane === "Farm" &&
    enemyHero?.primary_role === "Marksman" &&
    hero.primary_role !== "Marksman"
  ) {
    const gapClose = Boolean(
      tags?.dash || tags?.mobility || tags?.engage || tags?.frontline,
    );
    return {
      swapFeasibility: "TACTICAL_SWAP",
      macroCost: gapClose ? 0.55 : 0.85,
      macroSwapNote: `${hero.name} kalah jarak di Farm vs ${enemyHero.name}; perlu freeze wave aman sebelum 04:00.`,
      reswapAdvice: reswapAt4,
    };
  }

  return {
    swapFeasibility: "TACTICAL_SWAP",
    macroCost: 0.45,
    macroSwapNote: `Penyesuaian lane darurat pra-04:00 untuk ${hero.name} dari ${hero.primary_lane} ke ${lane}.`,
    reswapAdvice: reswapAt4,
  };
}

function scoreHeroMatchup(
  ourHero: Hero,
  enemyHero: Hero,
  ourHeroMap?: Hero,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const directCounter = ourHero.counters.find(
    (c) => c.target_id === enemyHero.hero_id,
  );
  const reverseEnemyWeak = enemyHero.countered_by?.find(
    (c) => c.counter_id === ourHero.hero_id,
  );
  if (directCounter || reverseEnemyWeak) {
    const isHard =
      directCounter?.severity === "hard" ||
      reverseEnemyWeak?.severity === "hard";
    score += isHard ? 1.35 : 0.75;
    const reason = directCounter?.reason || reverseEnemyWeak?.reason;
    reasons.push(
      reason
        ? `Unggul vs ${enemyHero.name}: ${reason}`
        : `${ourHero.name} meng-counter langsung ${enemyHero.name}.`,
    );
  }

  const counteredBy = ourHero.countered_by?.find(
    (c) => c.counter_id === enemyHero.hero_id,
  );
  const reverseEnemyStrong = enemyHero.counters.find(
    (c) => c.target_id === ourHero.hero_id,
  );
  if (counteredBy || reverseEnemyStrong) {
    const isHard =
      counteredBy?.severity === "hard" ||
      reverseEnemyStrong?.severity === "hard";
    score -= isHard ? 1.35 : 0.75;
    const reason = counteredBy?.reason || reverseEnemyStrong?.reason;
    reasons.push(
      reason
        ? `Terancam ${enemyHero.name}: ${reason}`
        : `${enemyHero.name} merupakan counter ${isHard ? "keras" : "alami"} ${ourHero.name}.`,
    );
  }

  const approvedStrong = ourHero.hokstats_guide?.matchups?.some(
    (m) =>
      m.relation === "strong_against" &&
      m.hero_id === enemyHero.hero_id &&
      m.source.review_status === "approved",
  );
  const approvedWeak = ourHero.hokstats_guide?.matchups?.some(
    (m) =>
      m.relation === "countered_by" &&
      m.hero_id === enemyHero.hero_id &&
      m.source.review_status === "approved",
  );
  if (approvedStrong) score += 0.4;
  if (approvedWeak) score -= 0.4;

  const h2h =
    ourHero.kpl_matchup?.best_matchups?.find(
      (m) => m.opponent_id === enemyHero.hero_id,
    ) ||
    ourHero.kpl_matchup?.worst_matchups?.find(
      (m) => m.opponent_id === enemyHero.hero_id,
    );
  if (h2h && h2h.total_matches >= 12) {
    const delta = Math.max(-0.5, Math.min(0.5, (h2h.hero_winrate - 0.5) * 2.0));
    score += delta;
    if (Math.abs(delta) >= 0.14) {
      reasons.push(
        `Histori KPL: ${ourHero.name} ${Math.round(h2h.hero_winrate * 100)}% WR vs ${enemyHero.name} (${h2h.total_matches} match).`,
      );
    }
  }

  const ourTags = ourHero.tactical_profile?.tags;
  const enemyTags = enemyHero.tactical_profile?.tags;
  if (
    ourTags?.weak_early &&
    enemyTags?.weak_early === false &&
    (enemyTags?.engage || enemyTags?.mobility)
  ) {
    score -= 0.25;
    if (!reasons.length) {
      reasons.push(
        `${ourHero.name} lemah di early melawan tekanan awal ${enemyHero.name}.`,
      );
    }
  }
  if (
    ourTags?.dive_vulnerable &&
    !ourTags.mobility &&
    enemyTags?.engage &&
    (enemyTags.dash || enemyTags.blink || enemyTags.leap)
  ) {
    score -= 0.25;
  }
  if (!reasons.length && ourHeroMap) {
    reasons.push(
      `Matchup relatif seimbang antara ${ourHero.name} vs ${enemyHero.name}.`,
    );
  }

  return { score, reasons };
}

function getPairWinRate(
  heroA: Hero,
  heroB: Hero,
  proPairs: Record<string, any>,
): number | null {
  const key = `${Math.min(heroA.hero_id, heroB.hero_id)}_${Math.max(heroA.hero_id, heroB.hero_id)}`;
  const pair = proPairs?.[key];
  if (pair && pair.matches >= 20 && pair.win_rate >= 0.51) return pair.win_rate;
  return null;
}

function computeRoamContextAdjustment(
  lane: Lane,
  ourHero: Hero,
  enemyHero: Hero,
  ourRoam: Hero | null,
  enemyRoam: Hero | null,
  proPairs: Record<string, any>,
): { bonus: number; note?: string } {
  if (lane !== "Farm" && lane !== "Mid") return { bonus: 0 };

  let bonus = 0;
  const notes: string[] = [];

  if (ourRoam && ourRoam.hero_id !== ourHero.hero_id) {
    const roamTags = ourRoam.tactical_profile?.tags;
    const defensiveUtility = [
      roamTags?.ally_heal,
      roamTags?.ally_shield,
      roamTags?.peel,
      roamTags?.disengage,
      roamTags?.ally_cleanse,
    ].filter(Boolean).length;
    if (defensiveUtility > 0) {
      bonus += Math.min(0.42, defensiveUtility * 0.14);
      notes.push(`${ourRoam.name} memberi peel/sustain`);
    }
    if (
      ourRoam.counters.some((c) => c.target_id === enemyHero.hero_id) ||
      (enemyRoam &&
        ourRoam.counters.some((c) => c.target_id === enemyRoam.hero_id))
    ) {
      bonus += 0.25;
      notes.push(`${ourRoam.name} menekan agresivitas lawan`);
    }
    const duoWr = getPairWinRate(ourHero, ourRoam, proPairs);
    if (duoWr !== null) {
      bonus += 0.22;
      notes.push(
        `kombo KPL ${ourHero.name}+${ourRoam.name} (${Math.round(duoWr * 100)}% WR)`,
      );
    }
  }

  if (enemyRoam && enemyRoam.hero_id !== enemyHero.hero_id) {
    const eRoamTags = enemyRoam.tactical_profile?.tags;
    if (
      enemyRoam.counters.some((c) => c.target_id === ourHero.hero_id) ||
      ourHero.countered_by?.some((c) => c.counter_id === enemyRoam.hero_id)
    ) {
      bonus -= 0.35;
      notes.push(`waspada ancaman 2v2 dari ${enemyRoam.name}`);
    } else if (
      eRoamTags?.engage &&
      (eRoamTags.cc_pull || eRoamTags.cc_knockup || eRoamTags.suppress)
    ) {
      bonus -= 0.15;
    }
  }

  return {
    bonus,
    note:
      notes.length > 0 ? `Konteks 2v2 Roam: ${notes.join("; ")}.` : undefined,
  };
}

export function evaluateLaneMatchup(
  lane: Lane,
  ourHero: Hero | null,
  enemyHero: Hero | null,
  ourRoam: Hero | null,
  enemyRoam: Hero | null,
  kplLaneRates?: KplLaneRateMap,
  proPairs: Record<string, any> = {},
): LaneMatchupEvaluation {
  if (!ourHero || !enemyHero) {
    return {
      lane,
      ourHero,
      enemyHero,
      soloScore: 0,
      contextualScore: 0,
      verdict: "SEIMBANG",
      swapFeasibility: "PRIMARY",
      macroCost: 0,
      reasons: ["Slot hero belum lengkap untuk lane ini."],
    };
  }

  const macro = evaluateSwapMacroProfile(
    ourHero,
    lane,
    enemyHero,
    kplLaneRates,
  );
  const { score: soloScore, reasons } = scoreHeroMatchup(
    ourHero,
    enemyHero,
    ourHero,
  );
  const roamAdj = computeRoamContextAdjustment(
    lane,
    ourHero,
    enemyHero,
    ourRoam,
    enemyRoam,
    proPairs,
  );
  const contextualScore = Number((soloScore + roamAdj.bonus).toFixed(2));

  let verdict: LaneMatchupEvaluation["verdict"] = "SEIMBANG";
  if (macro.macroCost >= 2.0) {
    verdict = "SWAP_BERISIKO";
  } else if (contextualScore >= 0.45) {
    verdict = "UNGGUL";
  } else if (contextualScore <= -0.45) {
    verdict = "KALAH";
  } else if (soloScore <= -0.45 && contextualScore > -0.45) {
    verdict = "TERTOLONG_ROAM";
  }

  return {
    lane,
    ourHero,
    enemyHero,
    soloScore: Number(soloScore.toFixed(2)),
    contextualScore,
    verdict,
    swapFeasibility: macro.swapFeasibility,
    macroCost: macro.macroCost,
    reasons,
    roamContextNote: roamAdj.note,
    macroSwapNote: macro.macroSwapNote,
    reswapAdvice: macro.reswapAdvice,
  };
}

function evaluateAllLanes(
  ourAssignment: LaneAssignmentMap,
  enemyAssignment: LaneAssignmentMap,
  ourMap: Map<number, Hero>,
  enemyMap: Map<number, Hero>,
  kplLaneRates?: KplLaneRateMap,
  proPairs: Record<string, any> = {},
): LaneMatchupEvaluation[] {
  const ourRoam =
    ourAssignment.Roam !== null
      ? (ourMap.get(ourAssignment.Roam) ?? null)
      : null;
  const enemyRoam =
    enemyAssignment.Roam !== null
      ? (enemyMap.get(enemyAssignment.Roam) ?? null)
      : null;
  return ALL_LANES.map((lane) =>
    evaluateLaneMatchup(
      lane,
      ourAssignment[lane] !== null
        ? (ourMap.get(ourAssignment[lane]!) ?? null)
        : null,
      enemyAssignment[lane] !== null
        ? (enemyMap.get(enemyAssignment[lane]!) ?? null)
        : null,
      ourRoam,
      enemyRoam,
      kplLaneRates,
      proPairs,
    ),
  );
}

export function suggestBeneficialLaneSwaps(
  ourAssignment: LaneAssignmentMap,
  enemyAssignment: LaneAssignmentMap,
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
  kplLaneRates?: KplLaneRateMap,
  proPairs: Record<string, any> = {},
): SwapSuggestion[] {
  const ourMap = buildHeroMap(ourHeroes);
  const enemyMap = buildHeroMap(enemyHeroes);
  const LANING_ROLES = new Set<Lane>(['Clash', 'Mid', 'Farm']);
  const baseline = evaluateAllLanes(
    ourAssignment,
    enemyAssignment,
    ourMap,
    enemyMap,
    kplLaneRates,
    proPairs,
  );
  const byLane = new Map(baseline.map((m) => [m.lane, m]));
  const hasLosingLane = baseline.some((m) => LANING_ROLES.has(m.lane) && m.verdict === 'KALAH');

  const suggestions: SwapSuggestion[] = [];
  for (const [laneA, laneB] of LANE_SWAP_PAIRS) {
    const evalA = byLane.get(laneA);
    const evalB = byLane.get(laneB);
    if (!evalA?.ourHero || !evalB?.ourHero) continue;

    // Never propose moving a non-jungler into Jungle unless officially/KPL flexible for Jungle
    const heroA = evalA.ourHero;
    const heroB = evalB.ourHero;
    if (
      (laneA === "Jungle" &&
        heroB.primary_lane !== "Jungle" &&
        !heroB.lanes.includes("Jungle") &&
        !hasKplFlexLane(heroB, "Jungle", kplLaneRates)) ||
      (laneB === "Jungle" &&
        heroA.primary_lane !== "Jungle" &&
        !heroA.lanes.includes("Jungle") &&
        !hasKplFlexLane(heroA, "Jungle", kplLaneRates))
    ) {
      continue;
    }

    const swapped = swapAssignedLanes(ourAssignment, laneA, laneB);
    const afterAll = evaluateAllLanes(
      swapped,
      enemyAssignment,
      ourMap,
      enemyMap,
      kplLaneRates,
      proPairs,
    );
    const afterA = afterAll.find((m) => m.lane === laneA)!;
    const afterB = afterAll.find((m) => m.lane === laneB)!;

    // Tactical pre-04:00 lane swaps only apply between laners (Clash/Mid/Farm);
    // swaps involving Jungle or Roam are role changes and require BOTH sides to be valid primary/official/KPL flex.
    const isLanerOnlyPair = LANING_ROLES.has(laneA) && LANING_ROLES.has(laneB);
    const bothFlexValid =
      afterA.swapFeasibility !== 'TACTICAL_SWAP' && afterB.swapFeasibility !== 'TACTICAL_SWAP';
    if (!isLanerOnlyPair && !bothFlexValid) {
      continue;
    }

    const beforeScore = evalA.contextualScore + evalB.contextualScore;
    const afterScore = afterA.contextualScore + afterB.contextualScore;
    const matchupGain = Number((afterScore - beforeScore).toFixed(2));
    const macroDelta = Number(
      (
        afterA.macroCost +
        afterB.macroCost -
        (evalA.macroCost + evalB.macroCost)
      ).toFixed(2),
    );
    const netBenefit = Number((matchupGain - macroDelta).toFixed(2));

    const fixesLosingLane =
      ((LANING_ROLES.has(evalA.lane) && evalA.verdict === 'KALAH') ||
        (LANING_ROLES.has(evalB.lane) && evalB.verdict === 'KALAH')) &&
      afterA.verdict !== 'KALAH' &&
      afterB.verdict !== 'KALAH';

    if (!hasLosingLane && !bothFlexValid) continue;
    if (netBenefit < 0.25 && !(fixesLosingLane && netBenefit > 0.1)) continue;

    const isMacroHeavy =
      afterA.swapFeasibility === "TACTICAL_SWAP" ||
      afterB.swapFeasibility === "TACTICAL_SWAP";
    const targetDesc = fixesLosingLane
      ? `Menghilangkan status kalah lane pra-04:00 (gain matchup +${matchupGain.toFixed(1)}, biaya makro ${macroDelta.toFixed(1)})`
      : `Optimalkan fleksibilitas (${heroA.name} / ${heroB.name}) untuk keuntungan matchup +${matchupGain.toFixed(1)}`;

    suggestions.push({
      laneA,
      laneB,
      heroA,
      heroB,
      teamSide: "our",
      matchupGain,
      macroCost: macroDelta,
      netBenefit,
      title: `Tukar ${laneA} / ${laneB} (${heroA.name} / ${heroB.name})`,
      rationale: targetDesc,
      reswapAdvice: isMacroHeavy
        ? "Terapkan untuk laning 00:00–04:00; kembalikan formasi lane/teamfight setelah shield turret 04:00 turun."
        : "Penempatan flex resmi/KPL — valid dipertahankan sepanjang pertandingan.",
    });
  }

  return suggestions.sort((a, b) => b.netBenefit - a.netBenefit).slice(0, 3);
}

function estimateHeroTempoFromProfile(
  hero: Hero,
  curve?: HeroTempoCurve,
): {
  earlyWr: number;
  midWr: number;
  lateWr: number;
  avgSec: number;
  profile: TempoProfile;
  sourceKind: "kpl_empirical" | "profile_estimate";
  totalGames: number;
} {
  if (curve && curve.total_games >= 15 && curve.profile !== "insufficient") {
    return {
      earlyWr: curve.early.games >= 5 ? curve.early.win_rate : hero.win_rate,
      midWr: curve.mid.games >= 5 ? curve.mid.win_rate : hero.win_rate,
      lateWr: curve.late.games >= 5 ? curve.late.win_rate : hero.win_rate,
      avgSec: curve.avg_duration_sec,
      profile: curve.profile,
      sourceKind: "kpl_empirical",
      totalGames: curve.total_games,
    };
  }

  const tags = hero.tactical_profile?.tags;
  const base = Math.max(0.45, Math.min(0.55, hero.win_rate || 0.5));
  let early = base;
  let mid = base;
  let late = base;
  let profile: TempoProfile = "balanced";

  if (tags?.weak_early) {
    early -= 0.05;
    mid += 0.01;
    late += 0.05;
    profile = "late";
  } else if (hero.primary_role === "Marksman") {
    early -= 0.03;
    mid += 0.01;
    late += 0.05;
    profile = "late";
  } else if (
    hero.primary_role === "Assassin" ||
    (hero.primary_role === "Fighter" && tags?.mobility)
  ) {
    early += 0.04;
    mid += 0.02;
    late -= 0.03;
    profile = "early";
  } else if (hero.primary_role === "Mage" && tags?.engage) {
    mid += 0.03;
    profile = "mid";
  }

  return {
    earlyWr: Number(early.toFixed(3)),
    midWr: Number(mid.toFixed(3)),
    lateWr: Number(late.toFixed(3)),
    avgSec: curve?.avg_duration_sec || 1020,
    profile,
    sourceKind: "profile_estimate",
    totalGames: curve?.total_games ?? 0,
  };
}

function computeRelativeTempoShare(
  ourAvg: number,
  enemyAvg: number,
): TempoPhaseShare {
  const total = ourAvg + enemyAvg;
  const rawOurs = total > 0 ? Math.round((ourAvg / total) * 100) : 50;
  const oursShare = Math.max(0, Math.min(100, rawOurs));
  return {
    oursShare,
    enemyShare: 100 - oursShare,
    ourAvgPct: Number((ourAvg * 100).toFixed(1)),
    enemyAvgPct: Number((enemyAvg * 100).toFixed(1)),
  };
}

function summarizeTeamTempoWithExact(
  heroes: Hero[],
  tempoCurves: TempoCurveMap,
): {
  summary: TempoWindowSummary;
  exact: { early: number; mid: number; late: number };
} {
  if (!heroes.length) {
    return {
      summary: {
        earlyScore: 50,
        midScore: 50,
        lateScore: 50,
        avgDurationMinutes: 17,
        kplSampleCount: 0,
        profileEstimatedCount: 0,
        dominantWindow: "MID",
        heroes: [],
      },
      exact: { early: 0.5, mid: 0.5, late: 0.5 },
    };
  }

  const items = heroes.map((hero) => ({
    hero,
    ...estimateHeroTempoFromProfile(hero, tempoCurves[String(hero.hero_id)]),
  }));

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const exactEarly = avg(items.map((x) => x.earlyWr));
  const exactMid = avg(items.map((x) => x.midWr));
  const exactLate = avg(items.map((x) => x.lateWr));
  const earlyScore = Math.round(exactEarly * 100);
  const midScore = Math.round(exactMid * 100);
  const lateScore = Math.round(exactLate * 100);
  const avgDurationMinutes = Number(
    (avg(items.map((x) => x.avgSec)) / 60).toFixed(1),
  );
  const kplSampleCount = items.filter(
    (x) => x.sourceKind === "kpl_empirical",
  ).length;
  const profileEstimatedCount = items.length - kplSampleCount;

  const dominantWindow: TempoWindowSummary["dominantWindow"] =
    earlyScore >= midScore && earlyScore >= lateScore
      ? "EARLY"
      : lateScore >= earlyScore && lateScore >= midScore
        ? "LATE"
        : "MID";

  return {
    summary: {
      earlyScore,
      midScore,
      lateScore,
      avgDurationMinutes,
      kplSampleCount,
      profileEstimatedCount,
      dominantWindow,
      heroes: items.map(
        ({ hero, profile, sourceKind, totalGames, earlyWr, midWr, lateWr }) => ({
          hero,
          profile,
          sourceKind,
          totalGames,
          earlyWr: Math.round(earlyWr * 100),
          midWr: Math.round(midWr * 100),
          lateWr: Math.round(lateWr * 100),
        }),
      ),
    },
    exact: { early: exactEarly, mid: exactMid, late: exactLate },
  };
}

export function computeTempoComparison(
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
  tempoCurves: TempoCurveMap = {},
): TempoCurveComparison {
  const ourResult = summarizeTeamTempoWithExact(ourHeroes, tempoCurves);
  const enemyResult = summarizeTeamTempoWithExact(enemyHeroes, tempoCurves);
  const ours = ourResult.summary;
  const enemy = enemyResult.summary;

  // Normalize directly from unrounded phase winrates so oursShare + enemyShare always equals 100%.
  const relativeShares = {
    early: computeRelativeTempoShare(ourResult.exact.early, enemyResult.exact.early),
    mid: computeRelativeTempoShare(ourResult.exact.mid, enemyResult.exact.mid),
    late: computeRelativeTempoShare(ourResult.exact.late, enemyResult.exact.late),
  };

  const earlyGap = ours.earlyScore - enemy.earlyScore;
  const lateGap = ours.lateScore - enemy.lateScore;

  let windowVerdict =
    "Kedua komposisi memiliki kurva tempo seimbang; eksekusi objektif 04:00 menjadi penentu.";
  if (earlyGap >= 3 && lateGap <= -2) {
    windowVerdict = `Komposisi tim unggul di Early (<15m: ${relativeShares.early.oursShare}% vs ${relativeShares.early.enemyShare}%), tetapi tertinggal jika game menembus >19 menit (${relativeShares.late.oursShare}% vs ${relativeShares.late.enemyShare}%) — percepat snowball sebelum late scaling lawan.`;
  } else if (lateGap >= 3 && earlyGap <= -2) {
    windowVerdict = `Tim lebih kuat di Late Game (>=19m: ${relativeShares.late.oursShare}% vs ${relativeShares.late.enemyShare}%), tetapi rawan di Early (<15m: ${relativeShares.early.oursShare}% vs ${relativeShares.early.enemyShare}%) — hindari skirmish paksa dan scale aman ke 3 item.`;
  } else if (ours.dominantWindow === "EARLY" && earlyGap > 0) {
    windowVerdict = `Timing spike tim aktif lebih cepat (Early ${relativeShares.early.oursShare}% vs ${relativeShares.early.enemyShare}%); manfaatkan unggul tekanan untuk ambil outer turret pasca 04:00.`;
  } else if (ours.dominantWindow === "LATE" && lateGap > 0) {
    windowVerdict = `Power spike utama tim berada di Late Game (${relativeShares.late.oursShare}% vs ${relativeShares.late.enemyShare}%); jaga ekonomi carry hingga teamfight Shadow/Tempest Dragon.`;
  }

  return { ours, enemy, relativeShares, windowVerdict };
}

function classifyCompArchetype(
  heroes: Hero[],
  radar: ReturnType<typeof evaluateTacticalScores>,
  tempo: TempoWindowSummary,
): CompArchetypeSummary {
  const diveCount = heroes.filter(
    (h) =>
      (h.primary_role === "Assassin" || h.tactical_profile?.tags.engage) &&
      h.tactical_profile?.tags.mobility,
  ).length;
  const peelProtectCount = heroes.filter(
    (h) =>
      h.tactical_profile?.tags.peel ||
      h.tactical_profile?.tags.ally_heal ||
      h.tactical_profile?.tags.ally_shield,
  ).length;

  if (
    radar.early_game_pressure >= 0.72 ||
    (tempo.dominantWindow === "EARLY" && radar.early_game_pressure >= 0.62)
  ) {
    return {
      id: "EARLY_SNOWBALL",
      label: "Early Tempo & Invade Snowball",
      summary:
        "Komposisi menekan tempo sejak menit awal untuk merusak ritme jungle lawan dan membuka map di menit 04:00.",
    };
  }
  if (peelProtectCount >= 2 && tempo.dominantWindow === "LATE") {
    return {
      id: "PROTECT_CARRY",
      label: "Protect Hypercarry & Late Scaling",
      summary:
        "Kekuatan tim bertumpu pada menjaga damage carry hidup selama teamfight panjang hingga item scaling matang.",
    };
  }
  if (diveCount >= 2 && radar.enemy_carry_shutdown >= 0.65) {
    return {
      id: "PICKOFF_DIVE",
      label: "Pick-off & Backline Dive",
      summary:
        "Unggul mobilitas dan burst untuk menangkap target rentan sebelum teamfight penuh terbentuk.",
    };
  }
  if (radar.cc_chain_lockdown >= 0.68 && radar.frontline_durability >= 0.62) {
    return {
      id: "FRONT_TO_BACK_CC",
      label: "Front-to-Back CC Teamfight",
      summary:
        "Mengunci musuh secara beruntun lewat kombinasi tank garis depan dan follow-up burst area.",
    };
  }
  return {
    id: "BALANCED_SIEGE",
    label: "Objective Control & Skirmish",
    summary:
      "Mengandalkan keseimbangan kontrol lane, perebutan Tyrant/Overlord, dan penalti kesalahan posisi lawan.",
  };
}

export function deriveWinningCondition(
  ourAssignment: LaneAssignmentMap,
  enemyAssignment: LaneAssignmentMap,
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
  tempo: TempoCurveComparison,
  ourRadar = evaluateTacticalScores(ourHeroes, enemyHeroes),
  enemyRadar = evaluateTacticalScores(enemyHeroes, ourHeroes),
): WinningConditionAnalysis {
  const ourMap = buildHeroMap(ourHeroes);
  const enemyMap = buildHeroMap(enemyHeroes);

  const archetype = classifyCompArchetype(ourHeroes, ourRadar, tempo.ours);
  const enemyArchetype = classifyCompArchetype(
    enemyHeroes,
    enemyRadar,
    tempo.enemy,
  );

  const ourFarm =
    ourAssignment.Farm !== null
      ? (ourMap.get(ourAssignment.Farm) ?? null)
      : null;
  const ourJungler =
    ourAssignment.Jungle !== null
      ? (ourMap.get(ourAssignment.Jungle) ?? null)
      : null;
  const ourRoam =
    ourAssignment.Roam !== null
      ? (ourMap.get(ourAssignment.Roam) ?? null)
      : null;
  const enemyFarm =
    enemyAssignment.Farm !== null
      ? (enemyMap.get(enemyAssignment.Farm) ?? null)
      : null;

  const diveableEnemy = enemyHeroes.find(
    (e) =>
      e.tactical_profile?.tags.dive_vulnerable ||
      (!e.tactical_profile?.tags.mobility &&
        !e.tactical_profile?.tags.dash &&
        (e.primary_role === "Marksman" || e.primary_role === "Mage")),
  );

  const winConditions: string[] = [];
  winConditions.push(tempo.windowVerdict);

  if (archetype.id === "EARLY_SNOWBALL" && ourJungler) {
    winConditions.push(
      `Manfaatkan tekanan awal ${ourJungler.name}${ourRoam ? ` + ${ourRoam.name}` : ""} untuk mengontrol sungai & mencuri farm sebelum ${enemyFarm?.name ?? "carry lawan"} menyelesaikan 2 core item.`,
    );
  } else if (archetype.id === "PROTECT_CARRY" && ourFarm) {
    winConditions.push(
      `Jadikan ${ourFarm.name} poros DPS utama: arahkan peel ${ourRoam?.name ?? "Roam/Tank"} untuk memblok dive lawan agar ${ourFarm.name} bebas menembak di teamfight 5v5.`,
    );
  } else if (diveableEnemy && ourJungler) {
    winConditions.push(
      `Eksploitasi target minim escape (${diveableEnemy.name}) — paksa engage beruntun sebelum fight melebar ke komposisi ${enemyArchetype.label} lawan.`,
    );
  }

  const counteredEnemies = enemyHeroes.filter((e) =>
    ourHeroes.some(
      (o) =>
        o.counters.some((c) => c.target_id === e.hero_id) ||
        e.countered_by?.some((c) => c.counter_id === o.hero_id),
    ),
  );
  if (counteredEnemies.length > 0) {
    winConditions.push(
      `Simpan skill kunci untuk mengunci ${counteredEnemies
        .slice(0, 2)
        .map((e) => e.name)
        .join(" & ")} yang secara langsung ter-counter oleh komposisi kita.`,
    );
  } else if (ourRadar.cc_chain_lockdown >= 0.65) {
    winConditions.push(
      `Rantai CC kita kuat (${Math.round(ourRadar.cc_chain_lockdown * 100)}/100) — paksa teamfight di area sempit Tyrant/Overlord alih-alih split skirmish terpisah.`,
    );
  }

  const loseConditions: string[] = [];
  if (ourRadar.frontline_durability < 0.48) {
    loseConditions.push(
      `Garis depan tipis (${Math.round(ourRadar.frontline_durability * 100)}/100): kalah jika tim terpaksa face-check semak atau engage dari posisi terburu-buru.`,
    );
  }
  if (
    ourRadar.cc_chain_lockdown < 0.48 &&
    enemyHeroes.some((e) => e.tactical_profile?.tags.mobility)
  ) {
    loseConditions.push(
      `Minim lockdown (${Math.round(ourRadar.cc_chain_lockdown * 100)}/100) menghadapi mobilitas lawan — hero lincah musuh bebas masuk keluar jika tim bertarung terpisah.`,
    );
  }

  const enemyThreatScores = enemyHeroes
    .map((enemy) => {
      const threats = ourHeroes.filter(
        (oh) =>
          oh.countered_by?.some((c) => c.counter_id === enemy.hero_id) ||
          enemy.counters.some((c) => c.target_id === oh.hero_id),
      );
      return {
        enemy,
        threats,
        weight:
          threats.length * 2 +
          (enemy.tier === "S" ? 1.5 : enemy.tier === "A" ? 0.8 : 0),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  if (enemyThreatScores[0]?.threats.length > 0) {
    const top = enemyThreatScores[0];
    loseConditions.push(
      `Membiarkan ${top.enemy.name} bebas menarget ${top.threats.map((t) => t.name).join(" / ")} tanpa peel atau item penangkal.`,
    );
  }
  if (tempo.enemy.lateScore - tempo.ours.lateScore >= 3) {
    loseConditions.push(
      `Menyeret game melewati menit 19+ tanpa keunggulan menara memberi peluang ${enemyFarm?.name ?? "carry lawan"} membalikkan teamfight.`,
    );
  }
  if (!loseConditions.length) {
    loseConditions.push(
      `Kehilangan disiplin visi di sungai 04:00 membuat komposisi ${enemyArchetype.label} lawan mencuri momentum objektif pertama.`,
    );
  }

  const counterChecklist = enemyThreatScores
    .slice(0, 3)
    .map(({ enemy, threats }) => {
      const items: CounterItemInfo[] = [];
      const seen = new Set<string>();
      for (const ci of enemy.counter_items || []) {
        if (!seen.has(ci.name)) {
          seen.add(ci.name);
          items.push(ci);
        }
      }
      const risk =
        threats.length > 0
          ? `Meng-counter langsung ${threats.map((t) => t.name).join(", ")}`
          : enemy.tactical_profile?.tags.suppress
            ? "Memiliki Suppress (tidak bisa ditembus Purify)"
            : enemy.tactical_profile?.tags.ally_heal
              ? "Memberi sustain/heal tinggi dalam teamfight"
              : `Power pick Tier ${enemy.tier} (${enemy.primary_lane})`;
      const counterAction = enemy.tactical_profile?.tags.suppress
        ? `Pancing skill suppress ${enemy.name} pada frontline atau gagalkan dengan CC jarak jauh.`
        : enemy.tactical_profile?.tags.ally_heal
          ? `Prioritaskan item anti-heal lebih awal & fokus burst sebelum heal berputar.`
          : items.length > 0
            ? `Sesuaikan build defensif/penetrasi terhadap ${enemy.name} dan pantau cooldown ultimatenya.`
            : `Kunci pergerakan ${enemy.name} dengan CC tim sebelum ia masuk ke garis belakang.`;

      return {
        enemy,
        risk,
        recommendedItems: items.slice(0, 3),
        counterAction,
      };
    });

  return {
    archetype,
    enemyArchetype,
    winConditions: winConditions.slice(0, 4),
    loseConditions: loseConditions.slice(0, 3),
    counterChecklist,
  };
}

function countHardCc(hero: Hero | null): number {
  if (!hero?.tactical_profile?.tags) return 0;
  const tags = hero.tactical_profile.tags;
  return [
    tags.cc_stun,
    tags.cc_knockup,
    tags.cc_pull,
    tags.cc_root,
    tags.suppress,
    tags.cc_knockback,
  ].filter(Boolean).length;
}

export function computeJungleAndGankPlan(
  ourSide: Side,
  ourAssignment: LaneAssignmentMap,
  enemyAssignment: LaneAssignmentMap,
  ourHeroes: Hero[],
  enemyHeroes: Hero[],
  laneMatchups: LaneMatchupEvaluation[],
  archetypeId: string,
  ourRadar = evaluateTacticalScores(ourHeroes, enemyHeroes),
  enemyRadar = evaluateTacticalScores(enemyHeroes, ourHeroes),
): JungleAndGankPlan {
  const ourMap = buildHeroMap(ourHeroes);
  const enemyMap = buildHeroMap(enemyHeroes);

  const ourJungler =
    ourAssignment.Jungle !== null
      ? (ourMap.get(ourAssignment.Jungle) ?? null)
      : null;
  const ourMid =
    ourAssignment.Mid !== null ? (ourMap.get(ourAssignment.Mid) ?? null) : null;
  const ourRoam =
    ourAssignment.Roam !== null
      ? (ourMap.get(ourAssignment.Roam) ?? null)
      : null;
  const enemyJungler =
    enemyAssignment.Jungle !== null
      ? (enemyMap.get(enemyAssignment.Jungle) ?? null)
      : null;
  const enemyMid =
    enemyAssignment.Mid !== null
      ? (enemyMap.get(enemyAssignment.Mid) ?? null)
      : null;
  const enemyRoam =
    enemyAssignment.Roam !== null
      ? (enemyMap.get(enemyAssignment.Roam) ?? null)
      : null;

  const roamCc = countHardCc(ourRoam);
  const junglerHasGankCc =
    countHardCc(ourJungler) > 0 ||
    Boolean(ourJungler?.tactical_profile?.tags.mobility);

  const gankCandidates: GankTargetPriority[] = (
    ["Farm", "Mid", "Clash"] as Lane[]
  )
    .map((lane) => {
      const targetEnemy =
        enemyAssignment[lane] !== null
          ? (enemyMap.get(enemyAssignment[lane]!) ?? null)
          : null;
      const ourLaner =
        ourAssignment[lane] !== null
          ? (ourMap.get(ourAssignment[lane]!) ?? null)
          : null;
      const matchup = laneMatchups.find((m) => m.lane === lane);
      if (!targetEnemy) return null;

      let score = lane === "Farm" ? 1.15 : lane === "Mid" ? 0.9 : 0.75;
      const setupParts: string[] = [];

      const allyCc = countHardCc(ourLaner);
      if (allyCc > 0) {
        score += Math.min(0.9, allyCc * 0.35);
        setupParts.push(`${ourLaner!.name} punya setup CC`);
      }
      if (roamCc > 0 && lane !== "Clash") {
        score += 0.25;
      }

      const enemyTags = targetEnemy.tactical_profile?.tags;
      const enemyLowEscape =
        !enemyTags?.mobility &&
        !enemyTags?.dash &&
        !enemyTags?.blink &&
        !enemyTags?.leap &&
        !enemyTags?.teleport;
      if (enemyLowEscape || enemyTags?.dive_vulnerable) {
        score += 0.85;
        setupParts.push(`${targetEnemy.name} minim escape`);
      }
      if (enemyTags?.weak_early) {
        score += 0.4;
        setupParts.push("lemah sebelum Lv 4/item");
      }
      if (matchup?.verdict === "KALAH") {
        score += 0.35;
        setupParts.push(
          "butuh relief/counter-gank agar rekan tidak tertinggal",
        );
      } else if (matchup?.verdict === "UNGGUL") {
        score += 0.2;
        setupParts.push("lane unggul membuka peluang tower dive/invade");
      }

      return {
        lane,
        targetEnemy,
        ourLaner,
        priorityScore: Number(score.toFixed(2)),
        priorityLabel: "SEKUNDER" as GankTargetPriority["priorityLabel"],
        setupSummary: setupParts.length
          ? setupParts.join(" · ")
          : `${junglerHasGankCc ? "Gank standar saat wave musuh maju" : "Clear camp dahulu lalu tunggu blunder posisi"}.`,
      };
    })
    .filter((x): x is GankTargetPriority => x !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const gankPriorities: GankTargetPriority[] = gankCandidates.map(
    (entry, idx) => ({
      ...entry,
      priorityLabel:
        idx === 0 ? "PRIORITAS #1" : idx === 1 ? "SEKUNDER" : "SITUASIONAL",
    }),
  );

  const farmPriority =
    gankPriorities.find((g) => g.lane === "Farm")?.priorityScore ?? 1.0;
  const clashPriority =
    gankPriorities.find((g) => g.lane === "Clash")?.priorityScore ?? 0.8;
  const strongSide: "Farm" | "Clash" =
    farmPriority >= clashPriority ? "Farm" : "Clash";
  const weakSide: "Farm" | "Clash" = strongSide === "Farm" ? "Clash" : "Farm";

  // Assess Level 1-2 Invade risk vs our early trio (Jungle + Mid + Roam)
  const ourTrio = [ourJungler, ourMid, ourRoam].filter(
    (h): h is Hero => h !== null,
  );
  const enemyTrio = [enemyJungler, enemyMid, enemyRoam].filter(
    (h): h is Hero => h !== null,
  );
  const ourWeakEarlyCount = ourTrio.filter(
    (h) => h.tactical_profile?.tags.weak_early,
  ).length;
  const enemyStrongInvaders = enemyTrio.filter(
    (h) =>
      !h.tactical_profile?.tags.weak_early &&
      (h.tactical_profile?.tags.suppress ||
        h.tactical_profile?.tags.cc_pull ||
        (h.primary_lane === "Jungle" &&
          (h.tactical_profile?.tags.engage ||
            h.tactical_profile?.tags.mobility))),
  );

  const invadeRiskReasons: string[] = [];
  if (enemyStrongInvaders.length >= 2) {
    invadeRiskReasons.push(
      `Trio awal lawan berbahaya (${enemyStrongInvaders.map((h) => h.name).join(" + ")})`,
    );
  }
  if (enemyRadar.early_game_pressure - ourRadar.early_game_pressure >= 0.08) {
    invadeRiskReasons.push(
      `Early pressure lawan unggul (${Math.round(enemyRadar.early_game_pressure * 100)} vs ${Math.round(ourRadar.early_game_pressure * 100)})`,
    );
  }
  if (ourWeakEarlyCount > 0) {
    invadeRiskReasons.push(
      `${ourTrio
        .filter((h) => h.tactical_profile?.tags.weak_early)
        .map((h) => h.name)
        .join(" & ")} lemah di duel Lv 1–3`,
    );
  }

  let openingPosture: JungleAndGankPlan["openingPosture"] =
    "STANDARD_FULL_CLEAR";
  let startQuadrant = "";
  let openingSummary = "";

  const oppositeQuadrant =
    weakSide === "Clash" ? "Kuadran Sisi Clash" : "Kuadran Sisi Farm";
  const targetQuadrant =
    strongSide === "Farm"
      ? "Kuadran Sisi Farm (arah Tyrant)"
      : "Kuadran Sisi Clash (arah Overlord)";

  if (
    invadeRiskReasons.length >= 2 ||
    (enemyRadar.early_game_pressure - ourRadar.early_game_pressure >= 0.1 &&
      ourWeakEarlyCount > 0)
  ) {
    openingPosture = "SAFE_SPLIT_OR_GUARD";
    startQuadrant = `Start Aman di ${targetQuadrant} (dekat ${strongSide})`;
    openingSummary = `Waspada invasi 00:30–01:15 (${invadeRiskReasons[0]}): minta ${ourMid?.name ?? "Mid"} & ${ourRoam?.name ?? "Roam"} cek semak buff. Jika lawan menyerbu sisi ${weakSide}, lakukan Split-Map Vertical Trade ke buff berseberangan lawan ketimbang kontes kalah jumlah.`;
  } else if (
    ourRadar.early_game_pressure - enemyRadar.early_game_pressure >= 0.08 &&
    ourWeakEarlyCount === 0 &&
    !ourJungler?.tactical_profile?.tags.weak_early
  ) {
    openingPosture = "INVADE_OR_CONTEST";
    startQuadrant = `Start Fleksibel (${oppositeQuadrant} → ${targetQuadrant}) dengan opsi Invasi/Kontes River`;
    openingSummary = `Trio ${ourJungler?.name ?? "Jungle"} + ${ourMid?.name ?? "Mid"} + ${ourRoam?.name ?? "Roam"} unggul tekanan awal: dorong wave Mid untuk membuka invasi buff/kontes Sprite menit 01:00–01:30 lalu tekan ${strongSide}.`;
  } else {
    openingPosture = "STANDARD_FULL_CLEAR";
    startQuadrant = `Mulai di ${oppositeQuadrant} → Clear Penuh menuju ${targetQuadrant}`;
    openingSummary = `Full clear ke Level 4 (tiba sekitar 01:25–01:35) langsung mengarah ke Strongside (${strongSide}) agar ${ourJungler?.name ?? "Jungler"} siap melakukan gank pertama bersama ${ourRoam?.name ?? "Roam"}.`;
  }

  const topGank = gankPriorities[0];
  const trioGoldSharingPlan = `Mekanik Gold-Sharing Pra-04:00: Item Jungle & Roam tidak mengurangi 100% gold/EXP ${ourMid?.name ?? "Midlaner"} sebelum menit 04:00. Arahkan ${ourJungler?.name ?? "Jungle"} + ${ourRoam?.name ?? "Roam"} ikut clear wave Mid bersama ${ourMid?.name ?? "Mid"} di sela rotasi camp untuk menggandakan ekonomi tim & merebut prioritas gank ke ${topGank?.lane ?? strongSide}!`;

  const preferOverlord =
    strongSide === "Clash" ||
    archetypeId === "BALANCED_SIEGE" ||
    archetypeId === "EARLY_SNOWBALL";
  const primaryObjective: "Tyrant" | "Overlord" =
    preferOverlord && strongSide === "Clash" ? "Overlord" : "Tyrant";
  const objectiveReason =
    primaryObjective === "Tyrant"
      ? `Prioritaskan Tyrant 04:00 di sisi ${strongSide}: menyuntikkan gold/XP tim dan bonus burst untuk mengonversi momentum saat shield turret baru habis.`
      : `Prioritaskan Overlord 04:00 di sisi Clash: memanggil Vanguard untuk memecah outer tower segera setelah proteksi turret 4 menit berakhir.`;

  return {
    ourSide,
    ourJungler,
    strongSide,
    weakSide,
    startQuadrant,
    openingPosture,
    openingSummary,
    invadeRiskReasons,
    trioGoldSharingPlan,
    objectiveFocusAt4Min: {
      primaryObjective,
      reason: objectiveReason,
    },
    gankPriorities,
  };
}

export function generatePostDraftGamePlan({
  ourSide,
  ourHeroes,
  enemyHeroes,
  synergy,
  ourAssignmentOverride,
  enemyAssignmentOverride,
}: GamePlanInput): GamePlanAnalysis {
  const kplLaneRates: KplLaneRateMap | undefined = synergy?.hero_lane_rates;
  const proPairs: Record<string, any> = synergy?.pairs || {};
  const tempoCurves: TempoCurveMap = synergy?.hero_tempo_curves || {};

  const ourAssignment =
    ourAssignmentOverride ??
    buildDefaultLaneAssignments(ourHeroes, kplLaneRates);
  const enemyAssignment =
    enemyAssignmentOverride ??
    buildDefaultLaneAssignments(enemyHeroes, kplLaneRates);

  const ourMap = buildHeroMap(ourHeroes);
  const enemyMap = buildHeroMap(enemyHeroes);

  const laneMatchups = evaluateAllLanes(
    ourAssignment,
    enemyAssignment,
    ourMap,
    enemyMap,
    kplLaneRates,
    proPairs,
  );
  const swapSuggestions = suggestBeneficialLaneSwaps(
    ourAssignment,
    enemyAssignment,
    ourHeroes,
    enemyHeroes,
    kplLaneRates,
    proPairs,
  );

  const activeReswapAlerts = laneMatchups
    .filter((m) => m.reswapAdvice)
    .map((m) => `${m.lane} (${m.ourHero?.name ?? "-"}): ${m.reswapAdvice}`);

  const ourRadar = evaluateTacticalScores(ourHeroes, enemyHeroes);
  const enemyRadar = evaluateTacticalScores(enemyHeroes, ourHeroes);
  const tempo = computeTempoComparison(ourHeroes, enemyHeroes, tempoCurves);
  const winningCondition = deriveWinningCondition(
    ourAssignment,
    enemyAssignment,
    ourHeroes,
    enemyHeroes,
    tempo,
    ourRadar,
    enemyRadar,
  );
  const junglePlan = computeJungleAndGankPlan(
    ourSide,
    ourAssignment,
    enemyAssignment,
    ourHeroes,
    enemyHeroes,
    laneMatchups,
    winningCondition.archetype.id,
    ourRadar,
    enemyRadar,
  );

  return {
    ourSide,
    ourAssignment,
    enemyAssignment,
    laneMatchups,
    swapSuggestions,
    activeReswapAlerts,
    tempo,
    winningCondition,
    junglePlan,
  };
}
