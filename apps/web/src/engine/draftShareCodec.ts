import type { DraftFormat, GameDraftData, Hero, Lane, SeriesFormat, SeriesTeam } from '../types';
import type { Side } from './draftRules';
import { createInitialGameDraft } from './draftRules';
import type { PracticeConfig, PracticeGame, PracticeSession } from './practiceState';

export interface DecodedTournamentSeries {
  kind: 'tournament';
  version: number;
  seriesFormat: SeriesFormat;
  fearlessEnabled: boolean;
  gameNumber: number;
  teamAName: string;
  teamBName: string;
  gamesData: Record<number, GameDraftData>;
}

export interface DecodedRankedDraft {
  kind: 'ranked';
  version: number;
  rankedBanCount: 3 | 4 | 5;
  game: GameDraftData;
}

export interface DecodedPracticeDraft {
  kind: 'practice';
  version: number;
  playerSide: Side;
  format: DraftFormat;
  fearless: boolean;
  rankedBanCount: 3 | 4 | 5;
  assistance: boolean;
  session: PracticeSession;
}

export type DecodedDraftShare =
  | DecodedTournamentSeries
  | DecodedRankedDraft
  | DecodedPracticeDraft;

export interface EncodeSeriesOptions {
  seriesFormat: SeriesFormat;
  fearlessEnabled: boolean;
  gameNumber: number;
  teamAName: string;
  teamBName: string;
  gamesData: Record<number, GameDraftData>;
}

export interface EncodeRankedOptions {
  rankedBanCount: 3 | 4 | 5;
  game: GameDraftData;
}

/**
 * Compact Game representation as a tuple with optional trailing fields:
 * 0: blueTeam ('A' | 'B')
 * 1: winner (0: null, 1: 'blue', 2: 'red')
 * 2: bluePickIds (Array<number | null>) - trimmed trailing nulls
 * 3: redPickIds (Array<number | null>) - trimmed trailing nulls
 * 4: blueBanIds (Array<number | null>) - trimmed trailing nulls
 * 5: redBanIds (Array<number | null>) - trimmed trailing nulls
 * 6: draftStep (number)
 * 7: isUltimateBattle? (0 | 1)
 * 8: bluePlanAId? (number | null)
 * 9: bluePlanBId? (number | null)
 * 10: redPlanAId? (number | null)
 * 11: redPlanBId? (number | null)
 */
export type CompactGameTuple = [
  SeriesTeam,
  0 | 1 | 2,
  Array<number | null>,
  Array<number | null>,
  Array<number | null>,
  Array<number | null>,
  number,
  (0 | 1)?,
  (number | null)?,
  (number | null)?,
  (number | null)?,
  (number | null)?
];

interface CompactTournamentPayload {
  k?: 't';
  v: 1;
  fmt: SeriesFormat;
  fl: 0 | 1;
  cur: number;
  t: [string, string];
  games: CompactGameTuple[];
}

interface CompactRankedPayload {
  k: 'r';
  v: 1;
  bc: 3 | 4 | 5;
  step: number;
  bp: Array<number | null>;
  rp: Array<number | null>;
  bb: Array<number | null>;
  rb: Array<number | null>;
  w?: 0 | 1 | 2;
  pa?: number | null;
  pb?: number | null;
  ra?: number | null;
  rb_plan?: number | null;
}

interface CompactPracticeGame {
  s: number;
  bp: number[];
  rp: number[];
  bb: number[];
  rb: number[];
  pl?: [number | null, number | null];
  ai?: [number | null, number | null];
}

interface CompactPracticePayload {
  k: 'p';
  v: 1;
  side: Side;
  fmt: 'tournament' | 'ranked';
  fl: 0 | 1;
  bc?: 3 | 4 | 5;
  asst?: 0 | 1;
  cur: number;
  games: CompactPracticeGame[];
}

/** Encode string to URL-safe base64 */
export function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode string from URL-safe base64 */
export function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

const mapHeroListToIds = (list: Array<Hero | null>): Array<number | null> => {
  const ids = list.map((h) => (h ? h.hero_id : null));
  let lastIndex = ids.length - 1;
  while (lastIndex >= 0 && ids[lastIndex] === null) {
    lastIndex--;
  }
  return ids.slice(0, lastIndex + 1);
};

const mapIdsToHeroList = (
  ids: Array<number | null>,
  catalogMap: Map<number, Hero>,
  targetLength: number
): Array<Hero | null> => {
  const result: Array<Hero | null> = Array(targetLength).fill(null);
  const len = Math.min(ids.length, targetLength);
  for (let i = 0; i < len; i++) {
    const id = ids[i];
    if (typeof id === 'number' && catalogMap.has(id)) {
      result[i] = catalogMap.get(id) || null;
    }
  }
  return result;
};

/**
 * Encodes a complete multi-game tournament state into a compact, URL-safe string.
 */
export function encodeTournamentSeries(options: EncodeSeriesOptions): string {
  const maxGames = options.seriesFormat === 'BO3' ? 3 : options.seriesFormat === 'BO7' ? 7 : 5;
  const games: CompactGameTuple[] = [];

  for (let g = 1; g <= maxGames; g++) {
    const game = options.gamesData[g] || createInitialGameDraft('tournament', 'A', false);
    const winnerCode: 0 | 1 | 2 = game.winner === 'blue' ? 1 : game.winner === 'red' ? 2 : 0;
    
    const bluePicks = mapHeroListToIds(game.bluePicks);
    const redPicks = mapHeroListToIds(game.redPicks);
    const blueBans = mapHeroListToIds(game.blueBans);
    const redBans = mapHeroListToIds(game.redBans);
    const isUlt = game.isUltimateBattle ? 1 : 0;
    const planA = game.bluePlanAId ?? null;
    const planB = game.bluePlanBId ?? null;
    const redPlanA = game.redPlanAId ?? null;
    const redPlanB = game.redPlanBId ?? null;

    const tuple: CompactGameTuple = [
      game.blueTeam,
      winnerCode,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      game.draftStep,
    ];

    if (redPlanB !== null) {
      tuple.push(isUlt, planA, planB, redPlanA, redPlanB);
    } else if (redPlanA !== null) {
      tuple.push(isUlt, planA, planB, redPlanA);
    } else if (planB !== null) {
      tuple.push(isUlt, planA, planB);
    } else if (planA !== null) {
      tuple.push(isUlt, planA);
    } else if (isUlt) {
      tuple.push(isUlt);
    }

    games.push(tuple);
  }

  const payload: CompactTournamentPayload = {
    k: 't',
    v: 1,
    fmt: options.seriesFormat,
    fl: options.fearlessEnabled ? 1 : 0,
    cur: Math.min(Math.max(options.gameNumber, 1), maxGames),
    t: [options.teamAName || 'Tim A', options.teamBName || 'Tim B'],
    games,
  };

  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * Encodes a Ranked single-game draft (with 3, 4, or 5 bans) into a compact URL-safe string.
 */
export function encodeRankedDraft(options: EncodeRankedOptions): string {
  const { rankedBanCount, game } = options;
  const winnerCode: 0 | 1 | 2 = game.winner === 'blue' ? 1 : game.winner === 'red' ? 2 : 0;

  const payload: CompactRankedPayload = {
    k: 'r',
    v: 1,
    bc: rankedBanCount,
    step: game.draftStep,
    bp: mapHeroListToIds(game.bluePicks),
    rp: mapHeroListToIds(game.redPicks),
    bb: mapHeroListToIds(game.blueBans),
    rb: mapHeroListToIds(game.redBans),
    w: winnerCode,
    pa: game.bluePlanAId ?? null,
    pb: game.bluePlanBId ?? null,
    ra: game.redPlanAId ?? null,
    rb_plan: game.redPlanBId ?? null,
  };

  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * Encodes a Practice Draft session vs AI into a compact URL-safe string.
 */
export function encodePracticeSession(session: PracticeSession, assistance: boolean = true): string {
  const games: CompactPracticeGame[] = session.games.map((g) => ({
    s: g.position.step,
    bp: [...g.position.picks.blue],
    rp: [...g.position.picks.red],
    bb: [...g.position.bans.blue],
    rb: [...g.position.bans.red],
    pl: [g.playerPlan.a ?? null, g.playerPlan.b ?? null],
    ai: [g.aiPlan.a ?? null, g.aiPlan.b ?? null],
  }));

  const payload: CompactPracticePayload = {
    k: 'p',
    v: 1,
    side: session.config.playerSide,
    fmt: session.config.format === 'ranked' ? 'ranked' : 'tournament',
    fl: session.config.fearless ? 1 : 0,
    bc: session.config.rankedBanCount,
    asst: assistance ? 1 : 0,
    cur: session.gameIndex,
    games,
  };

  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * Universal decoder: recognizes whether the payload is 'tournament', 'ranked', or 'practice'.
 * Fully backward-compatible with v1 tournament payloads without kind tag.
 */
export function decodeAnyDraftShare(
  shareStr: string,
  heroCatalog: Hero[] | Map<number, Hero>
): DecodedDraftShare | null {
  if (!shareStr || typeof shareStr !== 'string') return null;

  try {
    const jsonStr = decodeBase64Url(shareStr.trim());
    const raw = JSON.parse(jsonStr) as Record<string, any>;
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;

    const catalogMap: Map<number, Hero> =
      heroCatalog instanceof Map
        ? heroCatalog
        : new Map(heroCatalog.map((h) => [h.hero_id, h]));

    // 1. RANKED DRAFT
    if (raw.k === 'r') {
      const bc: 3 | 4 | 5 = raw.bc === 4 || raw.bc === 5 ? raw.bc : 3;
      const winner: 'blue' | 'red' | null =
        raw.w === 1 ? 'blue' : raw.w === 2 ? 'red' : null;

      const game: GameDraftData = {
        blueTeam: 'A',
        winner,
        bluePicks: mapIdsToHeroList(Array.isArray(raw.bp) ? raw.bp : [], catalogMap, 5),
        redPicks: mapIdsToHeroList(Array.isArray(raw.rp) ? raw.rp : [], catalogMap, 5),
        blueBans: mapIdsToHeroList(Array.isArray(raw.bb) ? raw.bb : [], catalogMap, bc),
        redBans: mapIdsToHeroList(Array.isArray(raw.rb) ? raw.rb : [], catalogMap, bc),
        draftStep: typeof raw.step === 'number' ? Math.max(0, raw.step) : 0,
        bluePlanAId: typeof raw.pa === 'number' ? raw.pa : null,
        bluePlanBId: typeof raw.pb === 'number' ? raw.pb : null,
        redPlanAId: typeof raw.ra === 'number' ? raw.ra : null,
        redPlanBId: typeof raw.rb_plan === 'number' ? raw.rb_plan : null,
      };

      return {
        kind: 'ranked',
        version: 1,
        rankedBanCount: bc,
        game,
      };
    }

    // 2. PRACTICE DRAFT VS AI
    if (raw.k === 'p') {
      const playerSide: Side = raw.side === 'red' ? 'red' : 'blue';
      const format: DraftFormat = raw.fmt === 'ranked' ? 'ranked' : 'tournament';
      const fearless = raw.fl !== 0;
      const rankedBanCount: 3 | 4 | 5 = raw.bc === 4 || raw.bc === 5 ? raw.bc : 3;
      const assistance = raw.asst !== 0;
      const gameIndex = typeof raw.cur === 'number' ? Math.max(0, raw.cur) : 0;

      const config: PracticeConfig = {
        playerSide,
        fearless,
        format,
        rankedBanCount: format === 'ranked' ? rankedBanCount : undefined,
      };

      const rawGames = Array.isArray(raw.games) ? raw.games : [];
      const games: PracticeGame[] = rawGames.map((g: any) => ({
        position: {
          step: typeof g.s === 'number' ? g.s : 0,
          picks: {
            blue: Array.isArray(g.bp) ? g.bp.filter((id: any): id is number => typeof id === 'number') : [],
            red: Array.isArray(g.rp) ? g.rp.filter((id: any): id is number => typeof id === 'number') : [],
          },
          bans: {
            blue: Array.isArray(g.bb) ? g.bb.filter((id: any): id is number => typeof id === 'number') : [],
            red: Array.isArray(g.rb) ? g.rb.filter((id: any): id is number => typeof id === 'number') : [],
          },
        },
        actions: [],
        traces: [],
        playerPlan: {
          a: Array.isArray(g.pl) && typeof g.pl[0] === 'number' ? g.pl[0] : null,
          b: Array.isArray(g.pl) && typeof g.pl[1] === 'number' ? g.pl[1] : null,
        },
        aiPlan: {
          a: Array.isArray(g.ai) && typeof g.ai[0] === 'number' ? g.ai[0] : null,
          b: Array.isArray(g.ai) && typeof g.ai[1] === 'number' ? g.ai[1] : null,
        },
      }));

      const session: PracticeSession = {
        sessionId: 'shared-' + Date.now(),
        revision: 0,
        config,
        gameIndex: Math.min(gameIndex, Math.max(0, games.length - 1)),
        games: games.length > 0 ? games : [
          {
            position: { step: 0, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } },
            actions: [],
            traces: [],
            playerPlan: { a: null, b: null },
            aiPlan: { a: null, b: null },
          },
        ],
      };

      return {
        kind: 'practice',
        version: 1,
        playerSide,
        format,
        fearless,
        rankedBanCount,
        assistance,
        session,
      };
    }

    // 3. TOURNAMENT SERIES (k: 't' or legacy v1 payload without k)
    if (raw.k === 't' || !raw.k) {
      if (!Array.isArray(raw.games)) return null;

      const seriesFormat: SeriesFormat =
        raw.fmt === 'BO3' || raw.fmt === 'BO7' ? raw.fmt : 'BO5';
      const maxGames = seriesFormat === 'BO3' ? 3 : seriesFormat === 'BO7' ? 7 : 5;
      const fearlessEnabled = raw.fl !== 0;
      const gameNumber = Math.min(Math.max(Number(raw.cur) || 1, 1), maxGames);
      const teamAName = (Array.isArray(raw.t) && raw.t[0]) ? String(raw.t[0]) : 'Tim A';
      const teamBName = (Array.isArray(raw.t) && raw.t[1]) ? String(raw.t[1]) : 'Tim B';

      const gamesData: Record<number, GameDraftData> = {
        1: createInitialGameDraft('tournament', 'A', false),
        2: createInitialGameDraft('tournament', 'A', false),
        3: createInitialGameDraft('tournament', 'A', false),
        4: createInitialGameDraft('tournament', 'A', false),
        5: createInitialGameDraft('tournament', 'A', false),
        6: createInitialGameDraft('tournament', 'A', false),
        7: createInitialGameDraft('tournament', 'A', false),
      };

      raw.games.forEach((tuple: any, idx: number) => {
        const gNum = idx + 1;
        if (gNum > 7 || !Array.isArray(tuple)) return;

        const [
          blueTeamRaw,
          winnerRaw,
          bluePickIdsRaw,
          redPickIdsRaw,
          blueBanIdsRaw,
          redBanIdsRaw,
          draftStepRaw,
          isUltimateRaw,
          planAIdRaw,
          planBIdRaw,
          redPlanAIdRaw,
          redPlanBIdRaw,
        ] = tuple;

        const blueTeam: SeriesTeam = blueTeamRaw === 'B' ? 'B' : 'A';
        const winner: 'blue' | 'red' | null =
          winnerRaw === 1 ? 'blue' : winnerRaw === 2 ? 'red' : null;
        const isUltimateBattle = Boolean(isUltimateRaw);
        const banCount = isUltimateBattle ? 0 : 4;

        gamesData[gNum] = {
          blueTeam,
          winner,
          bluePicks: mapIdsToHeroList(Array.isArray(bluePickIdsRaw) ? bluePickIdsRaw : [], catalogMap, 5),
          redPicks: mapIdsToHeroList(Array.isArray(redPickIdsRaw) ? redPickIdsRaw : [], catalogMap, 5),
          blueBans: mapIdsToHeroList(Array.isArray(blueBanIdsRaw) ? blueBanIdsRaw : [], catalogMap, banCount),
          redBans: mapIdsToHeroList(Array.isArray(redBanIdsRaw) ? redBanIdsRaw : [], catalogMap, banCount),
          draftStep: typeof draftStepRaw === 'number' ? Math.max(0, draftStepRaw) : 0,
          isUltimateBattle,
          bluePlanAId: typeof planAIdRaw === 'number' ? planAIdRaw : null,
          bluePlanBId: typeof planBIdRaw === 'number' ? planBIdRaw : null,
          redPlanAId: typeof redPlanAIdRaw === 'number' ? redPlanAIdRaw : null,
          redPlanBId: typeof redPlanBIdRaw === 'number' ? redPlanBIdRaw : null,
        };
      });

      return {
        kind: 'tournament',
        version: 1,
        seriesFormat,
        fearlessEnabled,
        gameNumber,
        teamAName,
        teamBName,
        gamesData,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Backward compatibility alias for tournament decoding.
 */
export function decodeTournamentSeries(
  shareStr: string,
  heroCatalog: Hero[] | Map<number, Hero>
): DecodedTournamentSeries | null {
  const result = decodeAnyDraftShare(shareStr, heroCatalog);
  if (result && result.kind === 'tournament') {
    return result;
  }
  return null;
}
