import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHeroSkillStances } from '../src/engine/skillStanceDetector.ts';

test('detectHeroSkillStances honors curated skill_stances_meta for Yao', () => {
  const yao = {
    hero_id: 522,
    name: 'Yao',
    abilities: [
      { name: 'Gift of the Stars', type: 'Passive', desc: 'Recovers HP...' },
      { name: 'Starlight Slice', type: 'Skill 1', desc: 'Slashes...' },
      { name: 'Star Rush', type: 'Skill 2', desc: 'Moves quickly...' },
      { name: 'Return to Dust', type: 'Ultimate', desc: 'Returns...' },
    ],
    skill_stances_meta: [
      { id: 'normal', label: 'Skill Biasa', badge: 'Normal', description: 'Bentuk dasar...' },
      { id: 'enhanced', label: 'Kilau Bintang (Enhanced)', badge: '3 Bar Energi', description: 'Saat 3 bar...' },
    ],
    hokstats_guide: {
      skills: [
        { name: 'Gift of the Stars', type: 'passive', description: 'Recovers HP...' },
        { name: 'Starlight Slice', type: 'skill1', description: 'Slashes...' },
        { name: 'Star Rush', type: 'skill2', description: 'Moves quickly...' },
        { name: 'Return to Dust', type: 'ultimate', description: 'Returns...' },
        { name: 'Brilliance: Starlight Slice', type: 'Enhanced Skill 1', description: 'Slashes twice...', combo_badge: 'Combo 1-1', stance_id: 'enhanced' },
        { name: 'Brilliance: Star Rush', type: 'Enhanced Skill 2', description: 'Dashes arc...', combo_badge: 'Combo 2-2 · Knock-up', stance_id: 'enhanced' },
        { name: 'Brilliance: Return to Dust', type: 'Enhanced Ultimate', description: 'Time rewind...', combo_badge: 'Combo 3-3 · Time Rewind', stance_id: 'enhanced' },
      ],
    },
  };

  const stances = detectHeroSkillStances(yao);
  assert.equal(stances.length, 2);
  assert.equal(stances[0].id, 'normal');
  assert.equal(stances[0].skills.length, 4);
  assert.equal(stances[1].id, 'enhanced');
  assert.equal(stances[1].skills.length, 3);
  assert.equal(stances[1].skills[1].comboBadge, 'Combo 2-2 · Knock-up');
});

test('detectHeroSkillStances honors recast_skills_meta for Ukyo Tachibana', () => {
  const ukyo = {
    hero_id: 163,
    name: 'Ukyo Tachibana',
    abilities: [
      { name: 'Hazy Blade', type: 'Passive', desc: 'Enhanced attack...' },
      { name: 'Swallow Swipe', type: 'Skill 1', desc: 'Leaps backward... can be used again after 2s.' },
      { name: 'Heavenly Hack', type: 'Skill 2', desc: 'Stuns edge...' },
      { name: 'Snowfall Slash', type: 'Ultimate', desc: '4 slashes...' },
    ],
    recast_skills_meta: [
      { slot: 1, badge: '2 Tahap (Recast Leap)', note: 'Fase 1: Leap mundur...' },
    ],
  };

  const stances = detectHeroSkillStances(ukyo);
  assert.equal(stances.length, 1);
  assert.equal(stances[0].skills[1].comboBadge, '2 Tahap (Recast Leap)');
});

test('detectHeroSkillStances automatically infers multi-mode for heroes with multiple passives (Li Xin pattern)', () => {
  const multiPassiveHero = {
    hero_id: 999,
    name: 'Stance Hero',
    abilities: [
      { name: 'Form 1 Passive', type: 'Passive', desc: 'Passive 1' },
      { name: 'Skill A', type: 'Skill 1', desc: 'Skill A' },
    ],
    hokstats_guide: {
      skills: [
        { name: 'Light Form Passive', type: 'passive', description: 'Light passive' },
        { name: 'Light Slash', type: 'active', description: 'Light slash' },
        { name: 'Dark Form Passive', type: 'passive', description: 'Dark passive' },
        { name: 'Dark Slash', type: 'active', description: 'Dark slash' },
      ],
    },
  };

  const stances = detectHeroSkillStances(multiPassiveHero);
  assert.equal(stances.length, 2);
  assert.equal(stances[0].skills[0].name, 'Light Form Passive');
  assert.equal(stances[1].skills[0].name, 'Dark Form Passive');
});

test('detectHeroSkillStances automatically infers post-ultimate form repetition (Puppet/Beast pattern)', () => {
  const puppetHero = {
    hero_id: 998,
    name: 'Puppet Master',
    abilities: [
      { name: 'Human P', type: 'Passive', desc: 'Human passive' },
      { name: 'Human S1', type: 'Skill 1', desc: 'Human skill 1' },
      { name: 'Human Ult', type: 'Ultimate', desc: 'Human ultimate' },
    ],
    hokstats_guide: {
      skills: [
        { name: 'Human P', type: 'passive', description: 'Human passive' },
        { name: 'Human S1', type: 'skill1', description: 'Human skill 1' },
        { name: 'Human Ult', type: 'ultimate', description: 'Human ultimate' },
        { name: 'Puppet S1', type: 'skill1', description: 'Puppet recall' },
        { name: 'Puppet S2', type: 'skill2', description: 'Puppet swap' },
      ],
    },
  };

  const stances = detectHeroSkillStances(puppetHero);
  assert.equal(stances.length, 2);
  assert.equal(stances[0].skills.length, 3);
  assert.equal(stances[1].skills.length, 2);
  assert.equal(stances[1].skills[0].name, 'Puppet S1');
});

test('detectHeroSkillStances automatically detects recast text in single-stance hero', () => {
  const dun = {
    hero_id: 126,
    name: 'Dun',
    abilities: [
      { name: 'Vigor', type: 'Passive', desc: 'Recovers HP...' },
      { name: 'Wind Slash', type: 'Skill 1', desc: 'Waves energy... Can be used again if it hits a champion.' },
      { name: 'Shield', type: 'Skill 2', desc: 'True damage shield...' },
      { name: 'Blade Rush', type: 'Ultimate', desc: 'Throws blade...' },
    ],
  };

  const stances = detectHeroSkillStances(dun);
  assert.equal(stances.length, 1);
  assert.equal(stances[0].skills[1].comboBadge, '2 Tahap (Recast)');
});
