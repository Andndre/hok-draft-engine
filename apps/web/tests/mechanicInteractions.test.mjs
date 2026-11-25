import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTag,
  isBasicAttackCarry,
  isProjectileHeavy,
  isHeavyShield,
  isMeleeBruiserOrAoE,
  isPureSpellcaster,
  isSlipperyAssassin,
  evaluateHeroMechanicInteractions,
  evaluateTeamMechanicInteractions,
} from '../src/engine/mechanicInteractions.ts';

function makeMockHero(heroId, name, role, primaryLane, tags = {}) {
  return {
    hero_id: heroId,
    name,
    primary_role: role,
    roles: [role],
    primary_lane: primaryLane,
    lanes: [primaryLane],
    counters: [],
    countered_by: [],
    abilities: [],
    tactical_profile: {
      tags: { ...tags },
    },
  };
}

test('Pilar 1: Terrain Creation vs Immobile Carry and High Mobility Blink', () => {
  const nuwa = makeMockHero(179, 'Nuwa', 'Mage', 'Mid', { terrain_creation: true });
  const luban = makeMockHero(112, 'Luban No.7', 'Marksman', 'Farm', { dive_vulnerable: true });
  const liBai = makeMockHero(131, 'Li Bai', 'Assassin', 'Jungle', { mobility: true, blink: true });

  // Nuwa vs Luban: Nuwa should have advantage terrain vs immobile
  const evalVsLuban = evaluateHeroMechanicInteractions(nuwa, [luban]);
  assert.ok(evalVsLuban.netScore > 0, 'Nuwa should have positive advantage vs Luban');
  const badgeAdv = evalVsLuban.badges.find((b) => b.title === 'Tembok vs Hero Immobile');
  assert.ok(badgeAdv, 'Should have Tembok vs Hero Immobile badge');
  assert.equal(badgeAdv.scoreDelta, 0.25);

  // Nuwa vs Li Bai: Li Bai has blink, can easily bypass wall
  const evalVsLiBai = evaluateHeroMechanicInteractions(nuwa, [liBai]);
  const badgeBypass = evalVsLiBai.badges.find((b) => b.title === 'Tembok Ditembus Blink/Leap');
  assert.ok(badgeBypass, 'Should have Tembok Ditembus Blink/Leap disadvantage badge');
  assert.equal(badgeBypass.scoreDelta, -0.15);
});

test('Pilar 2: Projectile Blocking vs Marksman & Melee AoE Counter', () => {
  const dunshan = makeMockHero(509, 'Dunshan', 'Support', 'Roam', { projectile_blocking: true, frontline: true });
  const consortYu = makeMockHero(110, 'Consort Yu', 'Marksman', 'Farm', { mobility: true });
  const dianWei = makeMockHero(129, 'Dian Wei', 'Fighter', 'Jungle', { frontline: true });

  // Dunshan vs Consort Yu (Marksman) -> Blocks projectile
  const evalDunshanVsYu = evaluateHeroMechanicInteractions(dunshan, [consortYu]);
  assert.ok(evalDunshanVsYu.netScore > 0);
  const projBadge = evalDunshanVsYu.badges.find((b) => b.title === 'Blokir Proyektil Utama');
  assert.ok(projBadge);
  assert.equal(projBadge.scoreDelta, 0.30);

  // Dian Wei (Melee Bruiser) vs Dunshan -> Bypasses projectile shield
  const evalDianWeiVsDunshan = evaluateHeroMechanicInteractions(dianWei, [dunshan]);
  assert.ok(evalDianWeiVsDunshan.netScore > 0);
  const meleeBadge = evalDianWeiVsDunshan.badges.find((b) => b.title === 'Penembus Perisai Proyektil');
  assert.ok(meleeBadge);
  assert.equal(meleeBadge.scoreDelta, 0.20);
});

test('Pilar 3: Disarm vs Basic Attack Carry & Spellcaster Immunity', () => {
  const pangu = makeMockHero(529, 'Pangu', 'Fighter', 'Jungle', { disarm: true, frontline: true });
  const garo = makeMockHero(508, 'Garo', 'Marksman', 'Farm', { shieldbreak: true });
  const ladyZhen = makeMockHero(127, 'Lady Zhen', 'Mage', 'Mid', { cc_freeze: true });

  // Pangu vs Garo (Basic Attack ADC) -> Disarm
  const evalPanguVsGaro = evaluateHeroMechanicInteractions(pangu, [garo]);
  const disarmBadge = evalPanguVsGaro.badges.find((b) => b.title === 'Disarm Lumpuhkan Serangan');
  assert.ok(disarmBadge);
  assert.equal(disarmBadge.scoreDelta, 0.30);

  // Lady Zhen (Spellcaster) vs Pangu -> Immune to Disarm effect
  const evalZhenVsPangu = evaluateHeroMechanicInteractions(ladyZhen, [pangu]);
  const immuneBadge = evalZhenVsPangu.badges.find((b) => b.title === 'Kebal Dampak Disarm');
  assert.ok(immuneBadge);
  assert.equal(immuneBadge.scoreDelta, 0.10);
});

test('Pilar 4: True Sight vs Stealth Infiltration', () => {
  const fang = makeMockHero(173, 'Fang', 'Marksman', 'Farm', { true_sight: true });
  const gaoChanggong = makeMockHero(153, 'Gao Changgong', 'Assassin', 'Jungle', { stealth: true });

  // Fang vs Gao Changgong -> True sight reveals stealth
  const evalFangVsGao = evaluateHeroMechanicInteractions(fang, [gaoChanggong]);
  const sightBadge = evalFangVsGao.badges.find((b) => b.title === 'True Sight Bongkar Stealth');
  assert.ok(sightBadge);
  assert.equal(sightBadge.scoreDelta, 0.30);

  // Gao Changgong vs Fang -> Disadvantage
  const evalGaoVsFang = evaluateHeroMechanicInteractions(gaoChanggong, [fang]);
  const detectedBadge = evalGaoVsFang.badges.find((b) => b.title === 'Stealth Terdeteksi');
  assert.ok(detectedBadge);
  assert.equal(detectedBadge.scoreDelta, -0.30);
});

test('Pilar 5: Shieldbreaker vs Heavy Shield & Displacement vs Tether', () => {
  const garo = makeMockHero(508, 'Garo', 'Marksman', 'Farm', { shieldbreak: true });
  const yaria = makeMockHero(505, 'Yaria', 'Support', 'Roam', { tether_dependent: true, ally_shield: true });
  const kui = makeMockHero(117, 'Kui', 'Support', 'Roam', { cc_pull: true });
  const dyadia = makeMockHero(577, 'Dyadia', 'Support', 'Roam', { tether_dependent: true });

  // Garo vs Yaria (Heavy Shield) -> Shieldbreaker advantage
  const evalGaroVsYaria = evaluateHeroMechanicInteractions(garo, [yaria]);
  const shieldBadge = evalGaroVsYaria.badges.find((b) => b.title === 'Penghancur Perisai');
  assert.ok(shieldBadge);
  assert.equal(shieldBadge.scoreDelta, 0.30);

  // Kui (Hook/Pull) vs Dyadia (Tether dependent) -> Disrupts tether pair
  const evalKuiVsDyadia = evaluateHeroMechanicInteractions(kui, [dyadia]);
  const hookBadge = evalKuiVsDyadia.badges.find((b) => b.title === 'Pemutus Formasi Tether');
  assert.ok(hookBadge);
  assert.equal(hookBadge.scoreDelta, 0.25);
});

test('Diminishing Return Cap: Multiple advantages capped smoothly at <= +0.55', () => {
  // Hero with multiple synergistic mechanic advantages
  const hero = makeMockHero(999, 'SuperHero', 'Fighter', 'Clash', {
    disarm: true,
    projectile_blocking: true,
    true_sight: true,
    anti_dive_zone: true,
  });

  const enemyTeam = [
    makeMockHero(110, 'Consort Yu', 'Marksman', 'Farm', { mobility: true }),
    makeMockHero(153, 'Gao Changgong', 'Assassin', 'Jungle', { stealth: true }),
    makeMockHero(112, 'Luban No.7', 'Marksman', 'Farm', { dive_vulnerable: true }),
  ];

  const evalResult = evaluateHeroMechanicInteractions(hero, enemyTeam);
  assert.ok(evalResult.badges.length >= 3, 'Should trigger multiple badges');
  assert.ok(evalResult.netScore <= 0.55, `Score ${evalResult.netScore} should not exceed +0.55`);
  assert.ok(evalResult.netScore >= 0.45, `Score ${evalResult.netScore} should be near the cap with multiple advantages`);
});

test('Ban Phase Perspective: candidate evaluated as enemy pick threatening our team', () => {
  // Scenario from user: Blue (our team) has Dunshan, Nuwa, Ukyo. Red has Liang, Lian Po, Flowborn.
  const dunshan = makeMockHero(509, 'Dunshan', 'Support', 'Roam', { projectile_blocking: true, anti_dive_zone: true });
  const nuwa = makeMockHero(179, 'Nuwa', 'Mage', 'Mid', { terrain_creation: true, dive_vulnerable: true });
  const ukyo = makeMockHero(163, 'Ukyo Tachibana', 'Assassin', 'Jungle', { mobility: true });
  const ourHeroes = [dunshan, nuwa, ukyo];

  const gaoChanggong = makeMockHero(153, 'Gao Changgong', 'Assassin', 'Jungle', { stealth: true });

  // In Ban Phase, Gao Changgong is evaluated against ourHeroes (Blue)
  const evalAgainstUs = evaluateHeroMechanicInteractions(gaoChanggong, ourHeroes);

  // Gao Changgong has flank stealth because Blue has no True Sight
  const stealthBadge = evalAgainstUs.badges.find((b) => b.title === 'Kebebasan Flank Stealth');
  assert.ok(stealthBadge, 'Gao Changgong should exploit lack of True Sight on Blue team');

  // Nuwa is dive_vulnerable, but Dunshan has anti_dive_zone
  const antiDiveBadge = evalAgainstUs.badges.find((b) => b.title === 'Terhalang Zona Anti-Dive');
  assert.ok(antiDiveBadge, 'Dunshan should trigger anti-dive against Gao Changgong');
  assert.equal(antiDiveBadge.targetHeroName, 'Dunshan');
});
