export type Role = 'Marksman' | 'Mage' | 'Fighter' | 'Tank' | 'Assassin' | 'Support';
export type Lane = 'Clash' | 'Jungle' | 'Mid' | 'Farm' | 'Roam';
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface CounterInfo {
  target_id: number | null;
  target_name: string;
  severity: 'hard' | 'soft';
  reason: string;
}

export interface CounterItemInfo {
  name: string;
  description: string;
}

export interface CounteredByInfo {
  counter_id: number;
  counter_name: string;
  severity: 'hard' | 'soft';
  reason: string;
}

export interface SituationalSwap {
  from: string;
  to: string;
  vs: string;
}

export interface ArcanaItem {
  name: string;
  count: number;
  id?: number;
  color?: string;
  desc?: string;
  icon_url?: string;
}

export interface HeroAbility {
  type: string;
  name: string;
  desc: string;
  idx?: number;
  icon_url?: string;
}

export interface HokfireGuide {
  difficulty: number;
  pros: string[];
  cons: string[];
  start_item: string;
  boots: string;
  core_items: string[];
  full_build: string[];
  situational_items: SituationalSwap[];
  arcana: ArcanaItem[];
  spell: string;
  spell_icon?: string;
  skill_priority: string;
  gameplay_tips: string;
}

export interface HokfireCounters {
  strong_against: string[];
  weak_against: string[];
  synergizes: string[];
}

export interface SourceAttribution {
  source: string;
  url: string;
  fetched_at: string;
  patch_version: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  source_hash?: string;
  reviewed_by?: string;
}

export interface HoKStatsMatchup {
  relation: 'strong_against' | 'countered_by';
  hero_id: number;
  hero_name: string;
  evidence: string;
  source: SourceAttribution;
}

export interface HoKStatsGuide {
  skills: Array<{ name: string; description: string; type?: string }>;
  pick_when: string[];
  avoid_when: string[];
  power_spikes: string[];
  common_mistakes: string[];
  pros: string[];
  cons: string[];
  matchups: HoKStatsMatchup[];
  partners: Array<{ hero_id: number | null; hero_name: string; source: SourceAttribution }>;
  build_variants: Array<{ id: string; name: string; use_case: string; items: string[] }>;
  source: SourceAttribution;
}

export interface ItemCatalogEntry {
  id: number | string | null;
  name: string;
  type: string;
  desc: string;
  icon: string;
  sources: {
    hokfire?: { description: string; source: { source: string; url: string } };
    hokstats?: { stats: Record<string, string>; passive: string; active?: string; build_path: string[]; source: SourceAttribution };
  };
}

export interface SpellCatalogEntry {
  id: string;
  name: string;
  effect: string;
  icon: string;
  sources: {
    hokfire?: { effect: string; source: { source: string; url: string } };
    hokstats?: { effect: string; cooldown: string; best_for: string[]; source: SourceAttribution };
  };
}

export interface KplMatchupEntry {
  opponent_id: number;
  opponent_name: string;
  opponent_avatar: string;
  hero_winrate: number;
  wins: number;
  losses: number;
  total_matches: number;
}

export interface KplSynergyEntry {
  partner_id: number;
  partner_name: string;
  partner_avatar: string;
  duet_winrate: number;
  wins: number;
  losses: number;
  total_matches: number;
}

export interface KplMatchup {
  total_picks: number;
  total_bans: number;
  overall_winrate: number;
  worst_matchups: KplMatchupEntry[];
  best_matchups: KplMatchupEntry[];
  synergies?: KplSynergyEntry[];
}

export interface Hero {
  hero_id: number;
  name: string;
  chinese_name: string;
  slug: string;
  title: string;
  primary_role: Role;
  primary_lane: Lane;
  lanes: Lane[];
  tier: Tier;
  win_rate: number;
  pick_rate: number;
  ban_rate: number;
  counters: CounterInfo[];
  countered_by: CounteredByInfo[];
  tactical_tips: string;
  counter_items: CounterItemInfo[];
  portrait_asset: string;
  kpl_id: number | null;
  is_global_exclusive: boolean;
  is_global_released?: boolean;
  hokfire_guide?: HokfireGuide | null;
  hokfire_counters?: HokfireCounters | null;
  hokstats_guide?: HoKStatsGuide;
  kpl_matchup?: KplMatchup | null;
  abilities?: HeroAbility[];
  tactical_profile?: TacticalProfile;
  
  // Dynamic client-side score computed by the tournament engine
  ai_choice_score?: number;
}

export interface TacticalVector {
  draft_advantage: number;      // Heuristic index, not a calibrated win probability
  early_game_pressure: number;  // 0.0 - 1.0
  cc_chain_lockdown: number;    // 0.0 - 1.0
  frontline_durability: number; // 0.0 - 1.0
  enemy_carry_shutdown: number; // 0.0 - 1.0
  draft_flexibility: number;    // 0.0 - 1.0
  team_utility: number;         // 0.0 - 1.0, reviewed ally effects
}

export const TACTICAL_TAGS = [
  'mobility', 'suppress', 'engage', 'disengage', 'frontline', 'dive_vulnerable',
  'dash', 'blink', 'leap', 'teleport', 'cc_knockup', 'cc_knockback', 'cc_pull', 'cc_stun', 'cc_root', 'cc_silence', 'cc_taunt', 'cc_slow',
  'ally_shield', 'ally_heal', 'ally_move_speed_buff', 'ally_attack_speed_buff', 'ally_damage_buff', 'ally_cleanse', 'ally_cc_immunity',
  'peel', 'kite_vulnerable', 'low_damage', 'weak_early',
] as const;
export type TacticalTag = typeof TACTICAL_TAGS[number];
export interface TacticalProfile {
  tags: Partial<Record<TacticalTag, boolean>>;
  source_hash: string;
  model: string;
  reviewed_by: string;
  provider?: 'evidence';
}
export interface DataManifest {
  schema_version: 2;
  dataset_version: string;
  hero_count: number;
  artifacts: Record<'heroes' | 'synergy' | 'releases' | 'items' | 'spells', { file: string; sha256: string }>;
}
export interface TournamentDataset {
  version: string;
  heroes: Hero[];
  synergy: Record<string, any>;
  items: ItemCatalogEntry[];
  spells: SpellCatalogEntry[];
  manifest: DataManifest;
}

export interface TacticalDelta {
  dimension: keyof TacticalVector;
  label: string;
  deltaPercent: number;
  direction: 'up' | 'down' | 'neutral';
  impactDescription: string;
}

export type DraftFormat = 'tournament' | 'ranked';

export interface DraftSlot {
  id: string;
  side: 'blue' | 'red';
  type: 'ban' | 'pick';
  index: number;
  hero: Hero | null;
}

export interface GameDraftData {
  bluePicks: Array<Hero | null>;
  redPicks: Array<Hero | null>;
  blueBans: Array<Hero | null>;
  redBans: Array<Hero | null>;
  draftStep: number;
  bluePlanAId: number | null;
  bluePlanBId: number | null;
  redPlanAId: number | null;
  redPlanBId: number | null;
}

export type LaneAssignmentMap = Record<Lane, number | null>;
export type SwapFeasibility = 'PRIMARY' | 'OFFICIAL_FLEX' | 'KPL_PRO_FLEX' | 'TACTICAL_SWAP';
export type TempoProfile = 'early' | 'mid' | 'late' | 'balanced' | 'insufficient';

export interface HeroTempoBucket {
  games: number;
  win_rate: number;
}

export interface HeroTempoCurve {
  total_games: number;
  avg_duration_sec: number;
  early: HeroTempoBucket;
  mid: HeroTempoBucket;
  late: HeroTempoBucket;
  profile: TempoProfile;
}

export interface KplLaneRate {
  games: number;
  share: number;
  win_rate: number;
}

export interface LaneMatchupEvaluation {
  lane: Lane;
  ourHero: Hero | null;
  enemyHero: Hero | null;
  soloScore: number;
  contextualScore: number;
  verdict: 'UNGGUL' | 'TERTOLONG_ROAM' | 'SEIMBANG' | 'KALAH' | 'SWAP_BERISIKO';
  swapFeasibility: SwapFeasibility;
  macroCost: number;
  reasons: string[];
  roamContextNote?: string;
  macroSwapNote?: string;
  reswapAdvice?: string;
}

export interface SwapSuggestion {
  laneA: Lane;
  laneB: Lane;
  heroA: Hero;
  heroB: Hero;
  teamSide: 'our' | 'enemy';
  matchupGain: number;
  macroCost: number;
  netBenefit: number;
  title: string;
  rationale: string;
  reswapAdvice?: string;
}

export interface TempoWindowSummary {
  earlyScore: number;
  midScore: number;
  lateScore: number;
  avgDurationMinutes: number;
  kplSampleCount: number;
  profileEstimatedCount: number;
  dominantWindow: 'EARLY' | 'MID' | 'LATE';
  heroes: Array<{
    hero: Hero;
    profile: TempoProfile;
    sourceKind: 'kpl_empirical' | 'profile_estimate';
    totalGames: number;
    earlyWr: number;
    midWr: number;
    lateWr: number;
  }>;
}

export interface TempoPhaseShare {
  oursShare: number;
  enemyShare: number;
  ourAvgPct: number;
  enemyAvgPct: number;
}

export interface TempoCurveComparison {
  ours: TempoWindowSummary;
  enemy: TempoWindowSummary;
  relativeShares: {
    early: TempoPhaseShare;
    mid: TempoPhaseShare;
    late: TempoPhaseShare;
  };
  windowVerdict: string;
}

export interface CompArchetypeSummary {
  id: string;
  label: string;
  summary: string;
}

export interface WinningConditionAnalysis {
  archetype: CompArchetypeSummary;
  enemyArchetype: CompArchetypeSummary;
  winConditions: string[];
  loseConditions: string[];
  counterChecklist: Array<{
    enemy: Hero;
    risk: string;
    recommendedItems: CounterItemInfo[];
    counterAction: string;
  }>;
}

export interface GankTargetPriority {
  lane: Lane;
  targetEnemy: Hero;
  ourLaner: Hero | null;
  priorityScore: number;
  priorityLabel: 'PRIORITAS #1' | 'SEKUNDER' | 'SITUASIONAL';
  setupSummary: string;
}

export interface JungleAndGankPlan {
  ourSide: 'blue' | 'red';
  ourJungler: Hero | null;
  strongSide: 'Farm' | 'Clash';
  weakSide: 'Farm' | 'Clash';
  startQuadrant: string;
  openingPosture: 'INVADE_OR_CONTEST' | 'SAFE_SPLIT_OR_GUARD' | 'STANDARD_FULL_CLEAR';
  openingSummary: string;
  invadeRiskReasons: string[];
  trioGoldSharingPlan: string;
  objectiveFocusAt4Min: {
    primaryObjective: 'Tyrant' | 'Overlord';
    reason: string;
  };
  gankPriorities: GankTargetPriority[];
}

export interface GamePlanAnalysis {
  ourSide: 'blue' | 'red';
  ourAssignment: LaneAssignmentMap;
  enemyAssignment: LaneAssignmentMap;
  laneMatchups: LaneMatchupEvaluation[];
  swapSuggestions: SwapSuggestion[];
  activeReswapAlerts: string[];
  tempo: TempoCurveComparison;
  winningCondition: WinningConditionAnalysis;
  junglePlan: JungleAndGankPlan;
}

export type SortMode = 'az' | 'win' | 'pick' | 'ai';
export type ViewMode = 'compact' | 'detailed';
export type ActiveTab = 'counter' | 'draft' | 'wiki' | 'favorites';
