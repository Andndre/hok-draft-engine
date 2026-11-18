import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAMER_VECTORS,
  evaluateRoamArchetypeAdvantage,
  evaluateRoamJungleCoherence,
} from '../src/engine/roamJungleTactics.ts';

test('roamer vectors are normalized to 1.0', () => {
  for (const [id, vec] of Object.entries(ROAMER_VECTORS)) {
    const sum = vec.engage + vec.disengage + vec.poke + vec.enchanter + vec.tempo;
    assert.ok(
      Math.abs(sum - 1.0) < 0.001,
      `Roamer ${id} vector sum is ${sum}, expected 1.0`
    );
  }
});

test('archetype counter cycle adheres to game theory', () => {
  // 1. Disengage (Zhuangzi 113) beats Engage (Guiguzi 189)
  const zhuangziVsGuiguzi = evaluateRoamArchetypeAdvantage(113, 189);
  assert.ok(zhuangziVsGuiguzi.delta > 0.3, `Zhuangzi should counter Guiguzi, got ${zhuangziVsGuiguzi.delta}`);

  // 2. Engage (Guiguzi 189) is disadvantaged vs Disengage (Zhuangzi 113)
  const guiguziVsZhuangzi = evaluateRoamArchetypeAdvantage(189, 113);
  assert.ok(guiguziVsZhuangzi.delta < -0.3, `Guiguzi should be disadvantaged vs Zhuangzi, got ${guiguziVsZhuangzi.delta}`);

  // 3. Poke (Mozi 108) vs Pure Disengage (Zhuangzi 113) -> Strong poke pressure
  const moziVsZhuangzi = evaluateRoamArchetypeAdvantage(108, 113);
  assert.ok(moziVsZhuangzi.delta > 0.20, `Mozi poke should pressure pure disengage Zhuangzi, got ${moziVsZhuangzi.delta}`);

  // 3b. Poke (Mozi 108) vs Hybrid Disengage/Engage (Zhang Fei 171) -> Mild advantage (Zhang Fei's engage ult cushions poke)
  const moziVsZhangFei = evaluateRoamArchetypeAdvantage(108, 171);
  assert.ok(moziVsZhangFei.delta > 0.04, `Mozi poke has mild net edge vs hybrid Zhang Fei, got ${moziVsZhangFei.delta}`);

  // 4. Enchanter (Cai Yan 184) sustains against Poke (Mozi 108)
  const caiYanVsMozi = evaluateRoamArchetypeAdvantage(184, 108);
  assert.ok(caiYanVsMozi.delta > 0.25, `Cai Yan should sustain against Mozi, got ${caiYanVsMozi.delta}`);

  // 5. Tempo (Da Qiao 191) out-rotates Enchanter (Cai Yan 184)
  const daQiaoVsCaiYan = evaluateRoamArchetypeAdvantage(191, 184);
  assert.ok(daQiaoVsCaiYan.delta > 0.25, `Da Qiao should out-tempo Cai Yan, got ${daQiaoVsCaiYan.delta}`);

  // 6. Engage (Guiguzi 189) catches fragile Tempo (Da Qiao 191)
  const guiguziVsDaQiao = evaluateRoamArchetypeAdvantage(189, 191);
  assert.ok(guiguziVsDaQiao.delta > 0.25, `Guiguzi should catch Da Qiao, got ${guiguziVsDaQiao.delta}`);
});

test('golden synergies trigger correctly with bonus delta', () => {
  // Pei (502) + Da Qiao (191)
  const peiDaQiao = evaluateRoamJungleCoherence(191, 502);
  assert.equal(peiDaQiao.delta, 0.40);
  assert.equal(peiDaQiao.isGolden, true);

  // Lam (528) + Yaria (505)
  const lamYaria = evaluateRoamJungleCoherence(505, 528);
  assert.equal(lamYaria.delta, 0.45);
  assert.equal(lamYaria.isGolden, true);

  // Zilong (107) + Dolia (159)
  const zilongDolia = evaluateRoamJungleCoherence(159, 107);
  assert.equal(zilongDolia.delta, 0.40);
  assert.equal(zilongDolia.isGolden, true);
});

test('forbidden mismatches penalize anti-synergy combos', () => {
  // Guiguzi (189) + Luna (146) -> Early roam aggression + Level 4 farm jungle
  const guiguziLuna = evaluateRoamJungleCoherence(189, 146);
  assert.equal(guiguziLuna.delta, -0.50);
  assert.equal(guiguziLuna.isMismatch, true);

  // Ming (501) + Han Xin (150) -> Walking tether + Cross-terrain mobility
  const mingHanXin = evaluateRoamJungleCoherence(501, 150);
  assert.equal(mingHanXin.delta, -0.55);
  assert.equal(mingHanXin.isMismatch, true);

  // Sun Bin (118) + Pei (502) -> Passive level 1 roam + Early snowball jungle
  const sunBinPei = evaluateRoamJungleCoherence(118, 502);
  assert.equal(sunBinPei.delta, -0.45);
  assert.equal(sunBinPei.isMismatch, true);
});
