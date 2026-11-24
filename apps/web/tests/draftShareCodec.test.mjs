import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeTournamentSeries,
  decodeTournamentSeries,
  encodeBase64Url,
  decodeBase64Url,
} from '../src/engine/draftShareCodec.ts';
import { createInitialGameDraft } from '../src/engine/draftRules.ts';

const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);

test('base64url codec correctly encodes and decodes unicode and special chars', () => {
  const sample = JSON.stringify({ message: 'Talon vs ONIC 🛡️', ids: [106, 519, 556] });
  const encoded = encodeBase64Url(sample);
  assert.ok(!encoded.includes('+') && !encoded.includes('/') && !encoded.includes('='));
  const decoded = decodeBase64Url(encoded);
  assert.equal(decoded, sample);
});

test('empty series roundtrip produces valid initial state with expected format and team names', () => {
  const initialGames = {
    1: createInitialGameDraft('tournament', 'A', false),
    2: createInitialGameDraft('tournament', 'A', false),
    3: createInitialGameDraft('tournament', 'A', false),
    4: createInitialGameDraft('tournament', 'A', false),
    5: createInitialGameDraft('tournament', 'A', false),
    6: createInitialGameDraft('tournament', 'A', false),
    7: createInitialGameDraft('tournament', 'A', false),
  };

  const encoded = encodeTournamentSeries({
    seriesFormat: 'BO5',
    fearlessEnabled: true,
    gameNumber: 1,
    teamAName: 'Team Secret',
    teamBName: 'Talon Esports',
    gamesData: initialGames,
  });

  assert.ok(typeof encoded === 'string');
  assert.ok(encoded.length < 300, `Empty BO5 string should be compact (<300 chars), got ${encoded.length}`);

  const decoded = decodeTournamentSeries(encoded, heroes);
  assert.ok(decoded);
  assert.equal(decoded.seriesFormat, 'BO5');
  assert.equal(decoded.fearlessEnabled, true);
  assert.equal(decoded.gameNumber, 1);
  assert.equal(decoded.teamAName, 'Team Secret');
  assert.equal(decoded.teamBName, 'Talon Esports');
  assert.equal(decoded.gamesData[1].blueTeam, 'A');
  assert.equal(decoded.gamesData[1].draftStep, 0);
  assert.equal(decoded.gamesData[1].winner, null);
});

test('populated BO5 tournament series with switch sides, winners, picks, and bans roundtrips faithfully', () => {
  const heroMap = new Map(heroes.map((h) => [h.hero_id, h]));
  const liang = heroMap.get(106) || null;
  const aoyin = heroMap.get(519) || null;
  const ata = heroMap.get(556) || null;
  const luban = heroMap.get(112) || null;
  const kaizer = heroMap.get(193) || null;

  const angela = heroMap.get(142) || null;
  const daji = heroMap.get(109) || null;
  const houyi = heroMap.get(169) || null;
  const milady = heroMap.get(504) || null;
  const arli = heroMap.get(199) || null;

  const ban1 = heroMap.get(525) || null;
  const ban2 = heroMap.get(508) || null;
  const ban3 = heroMap.get(131) || null;
  const ban4 = heroMap.get(155) || null;

  const initialGames = {
    1: {
      blueTeam: 'A',
      winner: 'blue',
      bluePicks: [liang, aoyin, ata, luban, kaizer],
      redPicks: [angela, daji, houyi, milady, arli],
      blueBans: [ban1, ban2, ban3, ban4],
      redBans: [ban4, ban3, ban2, ban1],
      draftStep: 20,
      isUltimateBattle: false,
      bluePlanAId: 106,
      bluePlanBId: 519,
      redPlanAId: null,
      redPlanBId: null,
    },
    2: {
      blueTeam: 'B', // switched side: Team B is Blue!
      winner: 'red',
      bluePicks: [angela, daji, houyi, milady, arli],
      redPicks: [liang, aoyin, ata, luban, kaizer],
      blueBans: [ban2, ban1, ban4, ban3],
      redBans: [ban3, ban4, ban1, ban2],
      draftStep: 20,
      isUltimateBattle: false,
      bluePlanAId: null,
      bluePlanBId: null,
      redPlanAId: null,
      redPlanBId: null,
    },
    3: {
      blueTeam: 'A',
      winner: null,
      bluePicks: [liang, null, null, null, null],
      redPicks: [angela, null, null, null, null],
      blueBans: [ban1, null, null, null],
      redBans: [ban2, null, null, null],
      draftStep: 3,
      isUltimateBattle: false,
      bluePlanAId: null,
      bluePlanBId: null,
      redPlanAId: null,
      redPlanBId: null,
    },
    4: createInitialGameDraft('tournament', 'B', false),
    5: createInitialGameDraft('tournament', 'A', false),
    6: createInitialGameDraft('tournament', 'A', false),
    7: createInitialGameDraft('tournament', 'A', false),
  };

  const encoded = encodeTournamentSeries({
    seriesFormat: 'BO5',
    fearlessEnabled: true,
    gameNumber: 3,
    teamAName: 'Fnatic ONIC',
    teamBName: 'Blacklist',
    gamesData: initialGames,
  });

  assert.ok(encoded.length < 600, `Populated BO5 string should remain under 600 chars, got ${encoded.length}`);

  const decoded = decodeTournamentSeries(encoded, heroes);
  assert.ok(decoded);
  assert.equal(decoded.seriesFormat, 'BO5');
  assert.equal(decoded.fearlessEnabled, true);
  assert.equal(decoded.gameNumber, 3);
  assert.equal(decoded.teamAName, 'Fnatic ONIC');
  assert.equal(decoded.teamBName, 'Blacklist');

  // Verify Game 1
  const g1 = decoded.gamesData[1];
  assert.equal(g1.blueTeam, 'A');
  assert.equal(g1.winner, 'blue');
  assert.equal(g1.draftStep, 20);
  assert.equal(g1.bluePlanAId, 106);
  assert.equal(g1.bluePlanBId, 519);
  assert.equal(g1.bluePicks[0]?.hero_id, 106);
  assert.equal(g1.bluePicks[1]?.hero_id, 519);
  assert.equal(g1.redPicks[0]?.hero_id, 142);
  assert.equal(g1.blueBans[0]?.hero_id, 525);

  // Verify Game 2 (switched sides)
  const g2 = decoded.gamesData[2];
  assert.equal(g2.blueTeam, 'B');
  assert.equal(g2.winner, 'red');
  assert.equal(g2.bluePicks[0]?.hero_id, 142);

  // Verify Game 3 in-progress
  const g3 = decoded.gamesData[3];
  assert.equal(g3.blueTeam, 'A');
  assert.equal(g3.winner, null);
  assert.equal(g3.draftStep, 3);
  assert.equal(g3.bluePicks[0]?.hero_id, 106);
  assert.equal(g3.bluePicks[1], null);
});

test('full BO7 series with 7 games roundtrips faithfully under 1000 chars', () => {
  const heroMap = new Map(heroes.map((h) => [h.hero_id, h]));
  const p1 = heroMap.get(106) || null;
  const p2 = heroMap.get(519) || null;
  const p3 = heroMap.get(556) || null;
  const p4 = heroMap.get(112) || null;
  const p5 = heroMap.get(193) || null;

  const sampleGame = (side, winner, step = 20) => ({
    blueTeam: side,
    winner,
    bluePicks: [p1, p2, p3, p4, p5],
    redPicks: [p5, p4, p3, p2, p1],
    blueBans: [p1, p2, p3, p4],
    redBans: [p4, p3, p2, p1],
    draftStep: step,
    isUltimateBattle: false,
    bluePlanAId: null,
    bluePlanBId: null,
    redPlanAId: null,
    redPlanBId: null,
  });

  const gamesData = {
    1: sampleGame('A', 'blue'),
    2: sampleGame('B', 'red'),
    3: sampleGame('A', 'blue'),
    4: sampleGame('B', 'red'),
    5: sampleGame('A', 'blue'),
    6: sampleGame('B', 'red'),
    7: { ...sampleGame('A', null, 10), isUltimateBattle: true },
  };

  const encoded = encodeTournamentSeries({
    seriesFormat: 'BO7',
    fearlessEnabled: true,
    gameNumber: 7,
    teamAName: 'Team A Long Name',
    teamBName: 'Team B Long Name',
    gamesData,
  });

  assert.ok(encoded.length < 1000, `Full BO7 series should remain under 1000 chars, got ${encoded.length}`);

  const decoded = decodeTournamentSeries(encoded, heroes);
  assert.ok(decoded);
  assert.equal(decoded.seriesFormat, 'BO7');
  assert.equal(decoded.gameNumber, 7);
  assert.equal(decoded.gamesData[7].isUltimateBattle, true);
  assert.equal(decoded.gamesData[7].bluePicks[0]?.hero_id, 106);
});

test('corrupted or invalid share string returns null safely without throwing', () => {
  assert.equal(decodeTournamentSeries('', heroes), null);
  assert.equal(decodeTournamentSeries('!!!invalid-base64@@@', heroes), null);
  assert.equal(decodeTournamentSeries(encodeBase64Url(JSON.stringify({ v: 99 })), heroes), null);
  assert.equal(decodeTournamentSeries(encodeBase64Url('not json at all'), heroes), null);
});
