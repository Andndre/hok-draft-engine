import { Hero, TacticalVector, TacticalDelta } from '../types';

export function computeTacticalDeltas(
  before: TacticalVector,
  after: TacticalVector,
  pickedHero: Hero,
  enemyHeroes: Hero[],
  teammateHeroes: Hero[] = []
): {
  deltas: TacticalDelta[];
  primaryInsight: string;
  bulletReasons: string[];
} {
  const dimensions: Array<{ key: keyof TacticalVector; label: string; desc: string }> = [
    { key: 'draft_advantage', label: 'Keunggulan draft', desc: 'Skor heuristik komposisi draft' },
    { key: 'early_game_pressure', label: 'Early Game Pressure', desc: 'Tekanan dominasi lane & invasi jungle menit awal' },
    { key: 'cc_chain_lockdown', label: 'CC Chain Lockdown', desc: 'Rantai stun, knockup & suppression teamfight' },
    { key: 'frontline_durability', label: 'Frontline Durability', desc: 'Ketahanan badan & penahan burst damage musuh' },
    { key: 'enemy_carry_shutdown', label: 'Carry Shutdown', desc: 'Kemampuan mengunci dan melumpuhkan damage dealer musuh' },
    { key: 'draft_flexibility', label: 'Draft Flexibility', desc: 'Fleksibilitas rotasi lane & penyesuaian strategi' },
  ];

  const deltas: TacticalDelta[] = [];
  const reasons: string[] = [];

  for (const dim of dimensions) {
    const valBefore = Math.max(0.01, before[dim.key]);
    const valAfter = after[dim.key];
    const diff = valAfter - valBefore;
    const deltaPercent = Math.round((diff / valBefore) * 100);

    const direction: 'up' | 'down' | 'neutral' =
      deltaPercent > 2 ? 'up' : deltaPercent < -2 ? 'down' : 'neutral';

    let impact = `${dim.label} stabil`;
    if (direction === 'up') {
      impact = `Meningkatkan ${dim.label} sebesar +${deltaPercent}%`;
    } else if (direction === 'down') {
      impact = `Menurunkan ${dim.label} sebesar ${deltaPercent}%`;
    }

    deltas.push({
      dimension: dim.key,
      label: dim.label,
      deltaPercent,
      direction,
      impactDescription: impact,
    });
  }

  // Check direct counter matches against enemy heroes
  const counteredEnemies: string[] = [];
  for (const enemy of enemyHeroes) {
    const isCounter = pickedHero.counters.some(
      (c) => c.target_id === enemy.hero_id || c.target_name.toLowerCase() === enemy.name.toLowerCase()
    );
    if (isCounter) {
      counteredEnemies.push(enemy.name);
    }
  }

  // Check Pro Tournament chain CC combos
  const hasEnemyDunshan = enemyHeroes.some((e) => e.hero_id === 509 || e.name.toLowerCase() === 'dunshan');
  const hasTeammateKui = teammateHeroes.some((t) => t.hero_id === 175 || t.name.toLowerCase() === 'kui');
  const hasTeammateXiaoQiao = teammateHeroes.some((t) => t.hero_id === 106 || t.name.toLowerCase() === 'xiao qiao');

  let proComboNote = '';
  if ((pickedHero.hero_id === 106 && hasTeammateKui) || (pickedHero.hero_id === 175 && hasTeammateXiaoQiao)) {
    if (hasEnemyDunshan) {
      proComboNote = 'KPL Chain CC Combo: Hook Kui membongkar shield Dunshan, langsung dilanjutkan Knockup S2 Xiao Qiao untuk mengunci hero musuh yang menempel di belakangnya!';
    } else {
      proComboNote = 'KPL Chain CC Combo: Hook Kui di-follow up Knockup Skill 2 Xiao Qiao menghasilkan lockdown multi-target instan (112 Match KPL, 54.5% WR).';
    }
  }

  // Find biggest delta
  const significantPositive = deltas
    .filter((d) => d.dimension !== 'draft_advantage' && d.deltaPercent > 0)
    .sort((a, b) => b.deltaPercent - a.deltaPercent);

  let primaryInsight = '';
  if (proComboNote) {
    primaryInsight = proComboNote;
  } else if (significantPositive.length > 0) {
    const top = significantPositive[0];
    primaryInsight = `Memilih ${pickedHero.name} mendongkrak ${top.label} sebesar +${top.deltaPercent}%`;
    if (counteredEnemies.length > 0) {
      primaryInsight += ` serta mengunci ancaman core musuh (${counteredEnemies.join(', ')}).`;
    } else {
      primaryInsight += ` untuk mengamankan tempo formasi tim.`;
    }
  } else {
    primaryInsight = `Pilihan taktis stabil ${pickedHero.name} untuk menyempurnakan komposisi tim.`;
  }

  if (proComboNote) {
    reasons.push(proComboNote);
  }

  if (counteredEnemies.length > 0) {
    reasons.push(`Direct Counter: Menetralisir efektivitas ${counteredEnemies.join(', ')}.`);
  }

  significantPositive.slice(0, 3).forEach((d) => {
    reasons.push(`${d.label}: +${d.deltaPercent}% gain komposisi.`);
  });

  if (pickedHero.tactical_tips) {
    reasons.push(`Catatan Taktis: ${pickedHero.tactical_tips.slice(0, 110)}...`);
  }

  return {
    deltas,
    primaryInsight,
    bulletReasons: reasons,
  };
}
