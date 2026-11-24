import type { GameDraftData, Hero, SeriesFormat, SeriesTeam } from '../types';
import { createInitialGameDraft } from './draftRules';

export interface DecodedTournamentSeries {
  version: number;
  seriesFormat: SeriesFormat;
  fearlessEnabled: boolean;
  gameNumber: number;
  teamAName: string;
  teamBName: string;
  gamesData: Record<number, GameDraftData>;
}

export interface EncodeSeriesOptions {
  seriesFormat: SeriesFormat;
  fearlessEnabled: boolean;
  gameNumber: number;
  teamAName: string;
  teamBName: string;
  gamesData: Record<number, GameDraftData>;
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

interface CompactSeriesPayload {
  v: number;
  fmt: SeriesFormat;
  fl: 0 | 1;
  cur: number;
  t: [string, string];
  games: CompactGameTuple[];
}

/** Encode string to URL-safe base64 (without padding, safe in query params and hashes) */
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
  // Trim trailing nulls to minimize payload size
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

    // Build base tuple
    const tuple: CompactGameTuple = [
      game.blueTeam,
      winnerCode,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      game.draftStep,
    ];

    // Only include optional trailing parameters if any of them are set
    if (isUlt || planA !== null || planB !== null || redPlanA !== null || redPlanB !== null) {
      tuple.push(isUlt, planA, planB, redPlanA, redPlanB);
    }

    games.push(tuple);
  }

  const payload: CompactSeriesPayload = {
    v: 1,
    fmt: options.seriesFormat,
    fl: options.fearlessEnabled ? 1 : 0,
    cur: Math.min(Math.max(options.gameNumber, 1), maxGames),
    t: [options.teamAName || 'Tim A', options.teamBName || 'Tim B'],
    games,
  };

  const jsonStr = JSON.stringify(payload);
  return encodeBase64Url(jsonStr);
}

/**
 * Decodes a compact URL-safe string back into a complete multi-game tournament state.
 * Returns null if the string is corrupt or invalid.
 */
export function decodeTournamentSeries(
  shareStr: string,
  heroCatalog: Hero[] | Map<number, Hero>
): DecodedTournamentSeries | null {
  if (!shareStr || typeof shareStr !== 'string') return null;

  try {
    const jsonStr = decodeBase64Url(shareStr.trim());
    const payload = JSON.parse(jsonStr) as Partial<CompactSeriesPayload>;

    if (!payload || payload.v !== 1 || !Array.isArray(payload.games)) {
      return null;
    }

    const seriesFormat: SeriesFormat =
      payload.fmt === 'BO3' || payload.fmt === 'BO7' ? payload.fmt : 'BO5';
    const maxGames = seriesFormat === 'BO3' ? 3 : seriesFormat === 'BO7' ? 7 : 5;
    const fearlessEnabled = payload.fl !== 0;
    const gameNumber = Math.min(Math.max(Number(payload.cur) || 1, 1), maxGames);
    const teamAName = (Array.isArray(payload.t) && payload.t[0]) ? String(payload.t[0]) : 'Tim A';
    const teamBName = (Array.isArray(payload.t) && payload.t[1]) ? String(payload.t[1]) : 'Tim B';

    const catalogMap: Map<number, Hero> =
      heroCatalog instanceof Map
        ? heroCatalog
        : new Map(heroCatalog.map((h) => [h.hero_id, h]));

    const gamesData: Record<number, GameDraftData> = {
      1: createInitialGameDraft('tournament', 'A', false),
      2: createInitialGameDraft('tournament', 'A', false),
      3: createInitialGameDraft('tournament', 'A', false),
      4: createInitialGameDraft('tournament', 'A', false),
      5: createInitialGameDraft('tournament', 'A', false),
      6: createInitialGameDraft('tournament', 'A', false),
      7: createInitialGameDraft('tournament', 'A', false),
    };

    payload.games.forEach((tuple, idx) => {
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

      const bluePickIds = Array.isArray(bluePickIdsRaw) ? bluePickIdsRaw : [];
      const redPickIds = Array.isArray(redPickIdsRaw) ? redPickIdsRaw : [];
      const blueBanIds = Array.isArray(blueBanIdsRaw) ? blueBanIdsRaw : [];
      const redBanIds = Array.isArray(redBanIdsRaw) ? redBanIdsRaw : [];

      gamesData[gNum] = {
        blueTeam,
        winner,
        bluePicks: mapIdsToHeroList(bluePickIds, catalogMap, 5),
        redPicks: mapIdsToHeroList(redPickIds, catalogMap, 5),
        blueBans: mapIdsToHeroList(blueBanIds, catalogMap, banCount),
        redBans: mapIdsToHeroList(redBanIds, catalogMap, banCount),
        draftStep: typeof draftStepRaw === 'number' ? Math.max(0, draftStepRaw) : 0,
        isUltimateBattle,
        bluePlanAId: typeof planAIdRaw === 'number' ? planAIdRaw : null,
        bluePlanBId: typeof planBIdRaw === 'number' ? planBIdRaw : null,
        redPlanAId: typeof redPlanAIdRaw === 'number' ? redPlanAIdRaw : null,
        redPlanBId: typeof redPlanBIdRaw === 'number' ? redPlanBIdRaw : null,
      };
    });

    return {
      version: 1,
      seriesFormat,
      fearlessEnabled,
      gameNumber,
      teamAName,
      teamBName,
      gamesData,
    };
  } catch {
    return null;
  }
}
