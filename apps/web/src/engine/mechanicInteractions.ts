/**
 * @file mechanicInteractions.ts
 * @description Dynamic Mechanic Interaction Engine for Honor of Kings (HoK Global).
 *
 * Menggantikan asumsi matriks statis pairwise 14.400 sel dengan evaluasi interaksi mekanik
 * dinamis berbasis 5 Pilar Primitif Taktis:
 * 1. Spasial & Kontrol Medan Tempur (Terrain vs Immobile/Dash, Anti-Dive Zone)
 * 2. Penolakan Proyektil & Jarak (Projectile Shield vs Poke/ADC, Melee AoE bypass)
 * 3. Disarm & Invalidation Serangan Dasar (Disarm vs ADC, Spellcaster immunity)
 * 4. True Sight & Infiltrasi Stealth (True Sight vs Invisibility, Flank freedom)
 * 5. Hukuman Tether & Perisai (Shieldbreak vs Shields, Displacement/Bounce vs Tether pairs)
 */

import type { Hero, TacticalTag, MechanicInteractionBadge, HeroMechanicEvaluation } from '../types';
import { isHeavyDiver, isLowEscapeHero } from './scaleDimensionTactics';

// =============================================================================
// HERO PREDICATES & TAXONOMY
// =============================================================================

export function hasTag(hero: Hero, tag: TacticalTag): boolean {
  if (hero.tactical_profile?.tags?.[tag] === true) return true;
  // Fallback ke in-game ability tags jika profile belum dimuat
  const tagLower = tag.toLowerCase().replace(/_/g, ' ');
  for (const ab of hero.abilities || []) {
    for (const t of ab.tags || []) {
      if (t.toLowerCase() === tagLower) return true;
    }
  }
  return false;
}

export function isBasicAttackCarry(hero: Hero): boolean {
  if (hero.primary_role === 'Marksman') return true;
  // Hero Fighter/Assassin yang mengandalkan basic attack burst/sustained
  const id = hero.hero_id;
  return [199, 508, 169, 111, 132, 112, 133, 110, 192, 524, 196, 545, 547, 130, 517, 150].includes(id);
}

export function isProjectileHeavy(hero: Hero): boolean {
  if (isBasicAttackCarry(hero)) return true;
  // Mage dengan proyektil skill jarak jauh
  const id = hero.hero_id;
  return [110, 524, 312, 196, 108, 142, 152, 182].includes(id);
}

export function isHeavyShield(hero: Hero): boolean {
  const id = hero.hero_id;
  if ([149, 171, 505, 527, 186, 126, 166, 193, 135].includes(id)) return true;
  return hasTag(hero, 'ally_shield');
}

export function isMeleeBruiserOrAoE(hero: Hero): boolean {
  const id = hero.hero_id;
  if ([129, 139, 154, 123, 166, 120, 140, 105, 126, 135, 529, 556].includes(id)) return true;
  return (hero.primary_role === 'Tank' || hero.primary_role === 'Fighter') && !isProjectileHeavy(hero);
}

export function isPureSpellcaster(hero: Hero): boolean {
  const id = hero.hero_id;
  if ([127, 142, 157, 182, 141, 179, 124, 156, 187, 118, 184, 136, 197].includes(id)) return true;
  return hero.primary_role === 'Mage' && !isBasicAttackCarry(hero);
}

export function isSlipperyAssassin(hero: Hero): boolean {
  const id = hero.hero_id;
  if ([531, 131, 162, 150, 116, 528, 137, 153, 517, 199].includes(id)) return true;
  return (hero.primary_role === 'Assassin' || hero.primary_role === 'Fighter') && (hasTag(hero, 'blink') || hasTag(hero, 'leap'));
}

export function hasDisplacementBurstOrHook(hero: Hero): boolean {
  const id = hero.hero_id;
  if ([117, 187, 156, 525, 139].includes(id)) return true;
  return hasTag(hero, 'cc_pull') || hasTag(hero, 'suppress');
}

export function hasBounceOrChainCC(hero: Hero): boolean {
  const id = hero.hero_id;
  return [127, 184, 118, 577].includes(id);
}

// =============================================================================
// INTERACTION EVALUATION
// =============================================================================

/**
 * Mengevaluasi seluruh interaksi mekanik mikro antara hero kandidat terhadap formasi musuh.
 * Menghasilkan netScore yang dibatasi diminishing return [-0.55, +0.55] serta kumpulan badge interaktif.
 */
export function evaluateHeroMechanicInteractions(
  hero: Hero,
  enemyTeam: Hero[],
  alliedTeam: Hero[] = []
): HeroMechanicEvaluation {
  if (enemyTeam.length === 0) {
    return { netScore: 0, badges: [], narratives: [] };
  }

  const badges: MechanicInteractionBadge[] = [];
  const narratives: string[] = [];
  let rawAdvantage = 0;
  let rawDisadvantage = 0;

  function addBadge(badge: MechanicInteractionBadge) {
    badges.push(badge);
    if (badge.scoreDelta > 0) {
      rawAdvantage += badge.scoreDelta;
    } else {
      rawDisadvantage += Math.abs(badge.scoreDelta);
    }
    narratives.push(`[${badge.icon} ${badge.title}] ${badge.description}`);
  }

  // Cek apakah musuh memiliki detektor True Sight
  const enemyHasTrueSight = enemyTeam.some((e) => hasTag(e, 'true_sight'));

  for (const enemy of enemyTeam) {
    // -------------------------------------------------------------------------
    // PILAR 1: SPASIAL & KONTROL MEDAN TEMPUR
    // -------------------------------------------------------------------------

    // Rule 1: Terrain Creation vs Hero Immobile
    if (hasTag(hero, 'terrain_creation') && (isLowEscapeHero(enemy) || !hasTag(enemy, 'mobility') || !hasTag(enemy, 'dash'))) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🧱',
        title: 'Tembok vs Hero Immobile',
        description: `Dinding rintangan medan perang mengurung ${enemy.name} yang tidak memiliki mobilitas/escape memadai.`,
        scoreDelta: 0.25,
      });
    } else if (hasTag(enemy, 'terrain_creation') && (isLowEscapeHero(hero) || !hasTag(hero, 'mobility') || !hasTag(hero, 'dash'))) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🧱',
        title: 'Terkurung Tembok Medan',
        description: `Rentan terkurung tembok buatan ${enemy.name} karena minimnya skill dash/escape mandiri.`,
        scoreDelta: -0.25,
      });
    }

    // Rule 2: Terrain Creation vs High Blink/Leap
    if (hasTag(hero, 'terrain_creation') && (hasTag(enemy, 'blink') || hasTag(enemy, 'leap'))) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '💨',
        title: 'Tembok Ditembus Blink/Leap',
        description: `${enemy.name} memiliki mobilitas instan (blink/leap) yang dapat melompati rintangan dinding.`,
        scoreDelta: -0.15,
      });
    }

    // Rule 3: Anti-Dive Zone vs Heavy Divers
    if (hasTag(hero, 'anti_dive_zone') && (isHeavyDiver(enemy) || hasTag(enemy, 'engage'))) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '⛔',
        title: 'Zona Anti-Dive',
        description: `Zona pertahanan/suppress efektif mematahkan inisiasi dive dan serbuan agresif ${enemy.name}.`,
        scoreDelta: 0.25,
      });
    } else if (isHeavyDiver(hero) && hasTag(enemy, 'anti_dive_zone')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '⛔',
        title: 'Terhalang Zona Anti-Dive',
        description: `Inisiasi dive rentan digagalkan oleh benteng pertahanan atau suppress instan ${enemy.name}.`,
        scoreDelta: -0.25,
      });
    }

    // -------------------------------------------------------------------------
    // PILAR 2: PENOLAKAN PROYEKTIL & JARAK
    // -------------------------------------------------------------------------

    // Rule 4: Projectile Blocking vs Projectile-Heavy Heroes
    if (hasTag(hero, 'projectile_blocking') && isProjectileHeavy(enemy)) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🛡️',
        title: 'Blokir Proyektil Utama',
        description: `Dapat memblokir, menyerap, atau menetralkan proyektil serangan utama ${enemy.name}.`,
        scoreDelta: 0.30,
      });
    } else if (isProjectileHeavy(hero) && hasTag(enemy, 'projectile_blocking')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🛡️',
        title: 'Proyektil Tertahan Perisai',
        description: `Output damage/poke proyektil dapat dinetralkan sepenuhnya oleh perisai ${enemy.name}.`,
        scoreDelta: -0.30,
      });
    }

    // Rule 5: Melee Bruiser/AoE vs Projectile Shield
    if (isMeleeBruiserOrAoE(hero) && hasTag(enemy, 'projectile_blocking')) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '⚔️',
        title: 'Penembus Perisai Proyektil',
        description: `Serangan melee AoE jarak dekat mengabaikan perisai proyektil ${enemy.name}.`,
        scoreDelta: 0.20,
      });
    }

    // -------------------------------------------------------------------------
    // PILAR 3: DISARM & ATTACK INVALIDATION
    // -------------------------------------------------------------------------

    // Rule 6: Disarm vs Basic Attack Carry
    if (hasTag(hero, 'disarm') && isBasicAttackCarry(enemy)) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🗡️',
        title: 'Disarm Lumpuhkan Serangan',
        description: `Melucuti basic attack ${enemy.name} sehingga kehilangan sumber damage utamanya dalam teamfight.`,
        scoreDelta: 0.30,
      });
    } else if (isBasicAttackCarry(hero) && hasTag(enemy, 'disarm')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🗡️',
        title: 'Rentan Terkena Disarm',
        description: `Sangat rentan dilucuti oleh ${enemy.name}, menonaktifkan basic attack selama teamfight krusial.`,
        scoreDelta: -0.30,
      });
    }

    // Rule 7: Pure Spellcaster vs Disarm
    if (isPureSpellcaster(hero) && hasTag(enemy, 'disarm')) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '✨',
        title: 'Kebal Dampak Disarm',
        description: `Damage berbasis skill/spell sama sekali tidak terpengaruh oleh efek disarm ${enemy.name}.`,
        scoreDelta: 0.10,
      });
    }

    // -------------------------------------------------------------------------
    // PILAR 4: TRUE SIGHT & STEALTH INVALIDATION
    // -------------------------------------------------------------------------

    // Rule 8: True Sight vs Stealth
    if (hasTag(hero, 'true_sight') && hasTag(enemy, 'stealth')) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '👁️',
        title: 'True Sight Bongkar Stealth',
        description: `Mendeteksi dan membuka visi posisi stealth/kamuflase ${enemy.name}.`,
        scoreDelta: 0.30,
      });
    } else if (hasTag(hero, 'stealth') && hasTag(enemy, 'true_sight')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '👁️',
        title: 'Stealth Terdeteksi',
        description: `Posisi infiltrasi dan flank rentan terbongkar oleh deteksi true sight ${enemy.name}.`,
        scoreDelta: -0.30,
      });
    }

    // -------------------------------------------------------------------------
    // PILAR 5: TETHER & SHIELD PUNISHMENT
    // -------------------------------------------------------------------------

    // Rule 10: Shieldbreaker vs Heavy Shield
    if (hasTag(hero, 'shieldbreak') && isHeavyShield(enemy)) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '💔',
        title: 'Penghancur Perisai',
        description: `Memberikan bonus damage masif dan melipatgandakan penghancuran shield tebal ${enemy.name}.`,
        scoreDelta: 0.30,
      });
    } else if (isHeavyShield(hero) && hasTag(enemy, 'shieldbreak')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '💔',
        title: 'Shield Rentan Rontok',
        description: `Pertahanan shield tebal dirontokkan dengan mudah oleh serangan penembus perisai ${enemy.name}.`,
        scoreDelta: -0.30,
      });
    }

    // Rule 11: Displacement/Hook/Suppress vs Tether-Dependent Hero
    if (hasDisplacementBurstOrHook(hero) && hasTag(enemy, 'tether_dependent')) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🪝',
        title: 'Pemutus Formasi Tether',
        description: `Dapat menarik, memisahkan, atau mengunci host ${enemy.name} secara instan saat tether aktif.`,
        scoreDelta: 0.25,
      });
    } else if (hasTag(hero, 'tether_dependent') && hasDisplacementBurstOrHook(enemy)) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🪝',
        title: 'Target Empuk Hook/Lock',
        description: `Formasi menempel atau tether berdekatan rentan ditarik atau di-lockdown instan oleh ${enemy.name}.`,
        scoreDelta: -0.25,
      });
    }

    // Rule 12: Bounce CC vs Tether Pairs
    if (hasBounceOrChainCC(hero) && hasTag(enemy, 'tether_dependent')) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '⚡',
        title: 'Pantulan CC Formasi Rapat',
        description: `Skill pantulan (bounce CC) memantul berulang kali di antara formasi dua hero bertaut ${enemy.name}.`,
        scoreDelta: 0.20,
      });
    }

    // Rule 14: Absolute Suppress vs Slippery Assassin
    if (hasTag(hero, 'suppress') && isSlipperyAssassin(enemy)) {
      addBadge({
        type: 'advantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🔒',
        title: 'Suppress Kunci Assassin',
        description: `Suppression mutlak tidak dapat di-cleanse dan langsung mengunci mobilitas lincah ${enemy.name}.`,
        scoreDelta: 0.30,
      });
    } else if (isSlipperyAssassin(hero) && hasTag(enemy, 'suppress')) {
      addBadge({
        type: 'disadvantage',
        targetHeroId: enemy.hero_id,
        targetHeroName: enemy.name,
        icon: '🔒',
        title: 'Terancam Hard Suppress',
        description: `Kelincahan dive terancam dimatikan instan oleh suppression mutlak tak terelakkan ${enemy.name}.`,
        scoreDelta: -0.30,
      });
    }
  }

  // Rule 9: Stealth vs No Enemy True Sight
  if (hasTag(hero, 'stealth') && !enemyHasTrueSight) {
    addBadge({
      type: 'advantage',
      targetHeroId: 0,
      targetHeroName: 'Enemy Team',
      icon: '🥷',
      title: 'Kebebasan Flank Stealth',
      description: 'Formasi musuh tidak memiliki True Sight, memberikan kebebasan posisi flank dan infiltrasi tinggi.',
      scoreDelta: 0.15,
    });
  }

  // Rule 13: Cleanse / CC Immunity vs Heavy CC Team
  const heavyCcCount = enemyTeam.filter(
    (e) => hasTag(e, 'cc_stun') || hasTag(e, 'cc_knockup') || hasTag(e, 'cc_root')
  ).length;
  if ((hasTag(hero, 'ally_cleanse') || hasTag(hero, 'ally_cc_immunity')) && heavyCcCount >= 2) {
    addBadge({
      type: 'advantage',
      targetHeroId: 0,
      targetHeroName: 'Enemy Team',
      icon: '🕊️',
      title: 'Pembersih CC Berantai',
      description: 'Cleanse atau imunitas CC mematahkan rangkaian combo crowd control berat formasi lawan.',
      scoreDelta: 0.20,
    });
  }

  // ---------------------------------------------------------------------------
  // DIMINISHING RETURN COMPOSITE SCORING
  // Formula: Plafon eksponensial halus dengan batas absolut [-0.55, +0.55]
  // ---------------------------------------------------------------------------
  const posScore = 0.55 * (1 - Math.exp(-rawAdvantage / 0.45));
  const negScore = 0.55 * (1 - Math.exp(-rawDisadvantage / 0.45));
  const netScore = Math.max(-0.55, Math.min(0.55, Math.round((posScore - negScore) * 1000) / 1000));

  return {
    netScore,
    badges,
    narratives,
  };
}

/**
 * Menghitung keuntungan interaksi mekanik mikro seluruh tim kita terhadap formasi musuh.
 * Dipakai oleh Minimax solver leaf evaluation.
 */
export function evaluateTeamMechanicInteractions(ourTeam: Hero[], enemyTeam: Hero[]): number {
  if (ourTeam.length === 0 || enemyTeam.length === 0) return 0;
  let totalScore = 0;
  for (const ourHero of ourTeam) {
    const evalResult = evaluateHeroMechanicInteractions(ourHero, enemyTeam, ourTeam);
    totalScore += evalResult.netScore;
  }
  return totalScore;
}
