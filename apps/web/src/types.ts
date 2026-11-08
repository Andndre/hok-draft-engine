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
  
  // Dynamic client-side score computed by Jev AI
  ai_choice_score?: number;
}

export interface TacticalVector {
  win_probability: number;      // 0.0 - 1.0
  early_game_pressure: number;  // 0.0 - 1.0
  cc_chain_lockdown: number;    // 0.0 - 1.0
  frontline_durability: number; // 0.0 - 1.0
  enemy_carry_shutdown: number; // 0.0 - 1.0
  draft_flexibility: number;    // 0.0 - 1.0
}

export interface TacticalDelta {
  dimension: keyof TacticalVector;
  label: string;
  deltaPercent: number;
  direction: 'up' | 'down' | 'neutral';
  impactDescription: string;
}

export interface DraftSlot {
  id: string;
  side: 'blue' | 'red';
  type: 'ban' | 'pick';
  index: number;
  hero: Hero | null;
}

export interface ModelManifest {
  model_version: string;
  model_name: string;
  model_file: string;
  model_size_bytes: number;
  sha256: string;
  updated_at: string;
  hero_count: number;
  tactical_dimensions: string[];
}

export type SortMode = 'az' | 'win' | 'pick' | 'ai';
export type ViewMode = 'compact' | 'detailed';
export type ActiveTab = 'counter' | 'draft' | 'wiki' | 'favorites';
