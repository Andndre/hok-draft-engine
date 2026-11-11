import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HeaderSortBar } from '../src/components/HeaderSortBar.tsx';
import { HeroRosterToolbar } from '../src/components/HeroRosterToolbar.tsx';
import { HeroCardCompact } from '../src/components/HeroCardCompact.tsx';
import { HeroCardDetailed } from '../src/components/HeroCardDetailed.tsx';
import { DraftSimulator } from '../src/components/DraftSimulator.tsx';
import { PostDraftGamePlanPanel } from '../src/components/PostDraftGamePlanPanel.tsx';
import { TacticalRadarPanel } from '../src/components/TacticalRadarPanel.tsx';
import { HeroWikiDrawer } from '../src/components/HeroWikiDrawer.tsx';
import { PlanSelectionModal } from '../src/components/PlanSelectionModal.tsx';
import { PracticeDraft } from '../src/components/PracticeDraft.tsx';
import { displayCopy } from '../src/components/ui/presentation.ts';
import { buildDefaultLaneAssignments, assignmentToHeroLaneMap, swapAssignedLanes } from '../src/engine/gamePlan.ts';
import { evaluateTacticalScores, computeDraftOutcomeProjection } from '../src/engine/tournamentInference.ts';
import { DropdownSelect } from '../src/components/ui/DropdownSelect.tsx';
import { Layers } from 'lucide-react';
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const dataset = { heroes: read(manifest.artifacts.heroes.file), synergy: read(manifest.artifacts.synergy.file), version: manifest.dataset_version, manifest };

const hero = dataset.heroes.find(hero => hero.is_global_released);
const controls = { selectedLane: 'All', onLaneChange: noop, searchQuery: '', onSearchChange: noop, sortMode: 'ai', onSortChange: noop, viewMode: 'compact', onViewChange: noop };

test('practice removes AI sorting without assistance and locks the Global roster', () => {
  const hidden = render(HeroRosterToolbar, { ...controls, count: 120, hideAiSort: true });
  assert.ok(!hidden.includes('Skor AI'));
  assert.ok(hidden.includes('aria-label="Urutkan hero: Nama A–Z"'));
  assert.ok(render(HeroRosterToolbar, { ...controls, count: 120 }).includes('Skor AI'));
  const header = render(HeaderSortBar, { activeTab: 'draft', onTabChange: noop, engineReady: true, favoriteCount: 0, onlyGlobalReleased: true, onToggleGlobalReleased: noop, globalLocked: true });
  assert.match(header, /<button[^>]*disabled[^>]*aria-pressed="true"/);
});

test('custom dropdown exposes one full trigger and a named list with the current choice', () => {
  const html = render(DropdownSelect, { label: 'Pilih game', value: 2, onChange: noop, icon: Layers, options: [1, 2, 3].map(value => ({ value, label: 'Game ' + value })) });
  const buttons = html.match(/<button\b[\s\S]*?<\/button>/g);
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].includes('role="combobox"'));
  assert.ok(buttons[0].includes('aria-label="Pilih game: Game 2"'));
  assert.ok(buttons[0].includes('aria-expanded="false"'));
  assert.equal((buttons[0].match(/<svg\b/g) ?? []).length, 2);
  assert.match(html, /role="listbox" aria-label="Pilih game"/);
  assert.match(html, /role="option" aria-selected="true"[^>]*>[\s\S]*?<span>Game 2<\/span>/);
  assert.ok(!html.includes('<select'));
  assert.ok(render(DropdownSelect, { label: 'Pilih game', value: 1, onChange: noop, options: [] }).includes('disabled'));
});
test('practice setup renders both sides with Blue, assistance and Fearless enabled by default', () => {
  const html = render(PracticeDraft, { ...controls, dataset, active: true, assistance: true, onAssistanceChange: noop, favorites: new Set(), onToggleFavorite: noop });
  const inputs = html.match(/<input[^>]*>/g);
  assert.ok(inputs.some(input => input.includes('value="blue"') && input.includes('checked')));
  assert.ok(inputs.some(input => input.includes('value="red"') && !input.includes('checked')));
  assert.equal(inputs.filter(input => input.includes('type="checkbox"') && input.includes('checked')).length, 2);
  assert.ok(html.includes('Mulai latihan'));
});

test('both hero views keep wiki available while blocking an unavailable draft action', () => {
  for (const Component of [HeroCardCompact, HeroCardDetailed]) {
    const html = render(Component, { hero, onClick: noop, onSelect: noop, isUnavailable: true, action: 'ban' });
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g);
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].includes('Buka wiki ' + hero.name));
    assert.ok(!buttons[0].includes('disabled'));
    assert.ok(buttons[1].includes('Ban ' + hero.name));
    assert.ok(buttons[1].includes('disabled'));
    assert.ok(buttons.every(button => button.includes('<svg')));
    assert.ok(html.includes(hero.portrait_asset));
  }
});

test('completed board exposes both compositions and no active draft target', () => {
  const heroes = dataset.heroes.filter(hero => hero.is_global_released).slice(0, 18);
  const html = render(DraftSimulator, { bluePicks: heroes.slice(0, 5), redPicks: heroes.slice(5, 10), blueBans: heroes.slice(10, 14), redBans: heroes.slice(14, 18), currentTurn: { side: 'red', action: 'pick', stepIndex: 18, isComplete: true }, fearlessEnabled: true, gameNumber: 1, onToggleFearless: noop, onGameNumberChange: noop, onResetDraft: noop, onUndoStep: noop, onInspectHero: noop, playerSide: 'red', hideControls: true });
  assert.ok(html.includes('18/18 aksi selesai'));
  assert.ok(html.includes('Tim Blue') && html.includes('Tim Red'));
  assert.ok(html.includes('Anda') && html.includes('AI'));
  assert.ok(!html.includes('pilih hero sekarang'));
  const images = html.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(images.filter(image => !image.includes('/assets/lanes/')).length, 18);
  assert.equal(images.filter(image => image.includes('/assets/lanes/')).length, 10);
});

test('recommendations use thumbnails and separate detail/action controls without decorative emoji', () => {
  const base = { scores: evaluateTacticalScores([], []), recommendations: [{ hero, proComboTag: '🎯 Amankan pembuka', laneTag: '' }], onSelectCandidate: noop, onInspectHero: noop, activeSide: 'blue', isPickPhase: false };
  const html = render(TacticalRadarPanel, base);
  assert.ok(html.includes('Amankan pembuka'));
  assert.ok(!html.includes('🎯'));
  assert.ok(html.includes('Detail') && html.includes('Ban ' + hero.name));
  assert.ok(html.includes(hero.portrait_asset));
  assert.ok(html.includes('bukan probabilitas kemenangan'));
  assert.ok(html.includes('Komposisi · 7 dimensi') && html.includes('Utilitas tim'));
  const waiting = render(TacticalRadarPanel, { ...base, recommendations: [], isWaiting: true });
  assert.ok(waiting.includes('Giliran AI. Rekomendasi tersedia saat giliran Anda.'));
  assert.ok(!waiting.includes('is-spinning'));
});

test('recommendation panel renders top candidate tabs and outcome projections', () => {
  const altHero = { ...hero, hero_id: 9999, name: 'Alt Hero' };
  const projection = {
    bestCaseScore: 82,
    bestCaseScenario: 'Duet KPL bersama Tank Roam',
    worstCaseScore: 56,
    worstCaseScenario: 'Risiko Counter Lawan di Mid',
    riskLevel: 'SEDANG',
  };
  const base = {
    scores: evaluateTacticalScores([], []),
    recommendations: [
      { hero, proComboTag: 'Prioritas pertama', laneTag: '', projection },
      { hero: altHero, proComboTag: 'Alternatif solid', laneTag: '', projection },
    ],
    onSelectCandidate: noop,
    onInspectHero: noop,
    activeSide: 'blue',
    isPickPhase: true,
  };
  const html = render(TacticalRadarPanel, base);
  assert.ok(html.includes('recommendation-tabs'));
  assert.ok(html.includes('#1') && html.includes('#2'));
  assert.ok(html.includes('Proyeksi Hasil Draft'));
  assert.ok(html.includes('82%') && html.includes('56%'));
  assert.ok(html.includes('Risiko SEDANG'));
  assert.ok(html.includes('Pick ' + hero.name));
});

test('hero card exposes tactical reason and draft outcome projection on recommendation hovercard', () => {
  const projection = {
    bestCaseScore: 85,
    bestCaseScenario: 'Kombo Sinergi B1',
    worstCaseScore: 60,
    worstCaseScenario: 'Risiko Dive Musuh',
    riskLevel: 'RENDAH',
  };
  const compactHtml = render(HeroCardCompact, {
    hero,
    onClick: noop,
    onSelect: noop,
    quickBadge: 'AI #2',
    aiRank: 2,
    recommendationReason: 'Counter Pick Fase 2',
    projection,
  });
  assert.ok(compactHtml.includes('AI #2'));
  assert.ok(compactHtml.includes('Counter Pick Fase 2'));
  assert.ok(compactHtml.includes('85%') && compactHtml.includes('60%'));

  const detailedHtml = render(HeroCardDetailed, {
    hero,
    onClick: noop,
    onSelect: noop,
    aiRank: 2,
    recommendationReason: 'Counter Pick Fase 2',
    projection,
  });
  assert.ok(detailedHtml.includes('#2'));
  assert.ok(detailedHtml.includes('Counter Pick Fase 2'));
  assert.ok(detailedHtml.includes('85%') && detailedHtml.includes('60%'));
});

test('computeDraftOutcomeProjection produces specific hero names and lanes in Ban and Pick phases', () => {
  const testHero = dataset.heroes.find(h => h.name.toLowerCase() === 'jing' || h.hero_id === 507) || hero;
  const aoyin = dataset.heroes.find(h => h.hero_id === 519) || hero;
  const haya = dataset.heroes.find(h => h.name.toLowerCase() === 'haya' || h.hero_id === 521);
  const luban = dataset.heroes.find(h => h.name.includes('Luban') || h.hero_id === 112) || hero;
  const consort = dataset.heroes.find(h => h.name === 'Consort Yu');

  const available = dataset.heroes.filter(h => h.is_global_released);
  const banProj = computeDraftOutcomeProjection(
    testHero,
    false,
    [],
    [],
    available,
    new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
    new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
    dataset.synergy?.pairs || {},
    evaluateTacticalScores([], [])
  );
  assert.ok(banProj.worstCaseScenario.includes('Pivot Lawan') || banProj.worstCaseScenario.includes('Lane Terkunci'));
  assert.ok(!banProj.worstCaseScenario.includes('alternatif tier cadangan'));
  assert.ok(banProj.bestCaseScenario.length > 10);

  // Blue Ban Phase 1 tidak boleh menyebut "first-pick lawan" karena Blue pemegang First Pick
  if (haya) {
    const augran = dataset.heroes.find(h => h.hero_id === 517);
    const blueBanHayaProj = computeDraftOutcomeProjection(
      haya,
      false,
      [],
      [],
      available,
      new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
      new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
      dataset.synergy?.pairs || {},
      evaluateTacticalScores([], []),
      false,
      augran || null,
      true,
      2,
      [],
      dataset.synergy?.b1_openers || {}
    );
    assert.ok(!blueBanHayaProj.bestCaseScenario.includes('first-pick lawan'));
    assert.ok(blueBanHayaProj.bestCaseScenario.includes('Pre-Ban KPL') || blueBanHayaProj.bestCaseScenario.includes('First-Pick B1'));

    const blueBanNoPlan = computeDraftOutcomeProjection(
      haya,
      false,
      [],
      [],
      available,
      new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
      new Set(['Jungle', 'Roam', 'Mid', 'Clash', 'Farm']),
      dataset.synergy?.pairs || {},
      evaluateTacticalScores([], []),
      false,
      null,
      true,
      2,
      [],
      dataset.synergy?.b1_openers || {}
    );
    assert.ok(blueBanNoPlan.bestCaseScenario.includes('respon R1+R2 lawan'));
  }

  // Early pick B1 dengan pre-ban counter (Haya di-ban) menghasilkan risiko RENDAH, bukan TINGGI
  if (haya) {
    const aoyinProj = computeDraftOutcomeProjection(
      aoyin,
      true,
      [],
      [],
      available,
      new Set(['Farm', 'Clash', 'Jungle', 'Mid', 'Roam']),
      new Set(['Farm', 'Clash', 'Jungle', 'Mid', 'Roam']),
      dataset.synergy?.pairs || {},
      evaluateTacticalScores([], []),
      false,
      null,
      true,
      4,
      [haya.hero_id],
      dataset.synergy?.b1_openers || {}
    );
    assert.strictEqual(aoyinProj.riskLevel, 'RENDAH');
    assert.ok(aoyinProj.worstCaseScenario.includes('Haya'));
    assert.ok(aoyinProj.worstCaseScore >= 45);
  }

  // Blind pick hero carry statis tanpa escape di B1 wajib menghasilkan risiko TINGGI
  const lubanProj = computeDraftOutcomeProjection(
    luban,
    true,
    [],
    [],
    available,
    new Set(['Farm', 'Clash', 'Jungle', 'Mid', 'Roam']),
    new Set(['Farm', 'Clash', 'Jungle', 'Mid', 'Roam']),
    dataset.synergy?.pairs || {},
    evaluateTacticalScores([], []),
    true,
    null,
    true,
    4,
    [],
    dataset.synergy?.b1_openers || {}
  );
  assert.strictEqual(lubanProj.riskLevel, 'TINGGI');
  assert.ok(lubanProj.worstCaseScenario.includes('Dive') || lubanProj.worstCaseScenario.includes('assassin'));

  // Hero yang langsung di-counter oleh musuh yang SUDAH di board menghasilkan risiko TINGGI
  if (consort) {
    const counteredProj = computeDraftOutcomeProjection(
      aoyin,
      true,
      [],
      [consort],
      available,
      new Set(['Farm', 'Clash', 'Jungle', 'Mid', 'Roam']),
      new Set(['Clash', 'Jungle', 'Mid', 'Roam']),
      dataset.synergy?.pairs || {},
      evaluateTacticalScores([], []),
      false,
      null,
      false,
      5,
      [],
      dataset.synergy?.b1_openers || {}
    );
    assert.strictEqual(counteredProj.riskLevel, 'TINGGI');
    assert.ok(counteredProj.worstCaseScenario.includes('Consort Yu'));
  }
});

test('plan and wiki dialogs expose names, native controls and counter-first navigation', () => {
  const plan = render(PlanSelectionModal, { isOpen: true, onClose: noop, heroes: [hero], currentPlanAId: hero.hero_id, currentPlanBId: null, onSelectPlanA: noop, onSelectPlanB: noop, activeSide: 'blue', unavailableHeroIds: new Set(), recommendedOpeners: [] });
  assert.match(plan, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.ok(plan.includes('Hapus Plan A') && plan.includes('Hapus Plan B'));
  assert.ok(!/<button\b(?:(?!<\/button>)[\s\S])*<button\b/.test(plan));
  const wiki = render(HeroWikiDrawer, { hero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'counters' });
  assert.match(wiki, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.ok(wiki.includes('Tutup wiki hero'));
  assert.match(wiki, /<button aria-pressed="true"[^>]*>[\s\S]*?<span>Counter<\/span>/);
  assert.ok(!/\p{Extended_Pictographic}/u.test(wiki.replace(/<[^>]+>/g, '')));
});

test('wiki exposes HoKStats build alternatives and source-attributed item, spell, skill and matchup details', () => {
  const source = { source: 'HoKStats', url: 'https://hokstats.gg/heroes/annette/', fetched_at: '2026-11-09T00:00:00Z', patch_version: '1.10', review_status: 'pending', source_hash: 'fixture' };
  const enriched = {
    ...hero,
    hokfire_guide: { full_build: [], core_items: [], situational_items: [], arcana: [], spell: 'Flash', skill_priority: '', pros: [], cons: [], gameplay_tips: '' },
    hokstats_guide: { source, skills: [{ name: 'Whirlwind', description: 'Pushes enemies back.' }], pick_when: ['Your team needs peel.'], avoid_when: [], power_spikes: [], common_mistakes: [], pros: [], cons: [], matchups: [{ relation: 'strong_against', hero_id: 126, hero_name: 'Dun', evidence: 'Stops engage.', source }], partners: [], build_variants: [{ id: 'peel', name: 'Peel build', use_case: 'Against dive', items: ['Guardian Armor'] }] },
  };
  const catalogSource = { ...source, source: 'HoKStats' };
  const itemCatalog = [{ id: 1127, name: 'Guardian Armor', type: 'Defense', desc: 'HOKFIRE item description', icon: '/assets/items/1127.png', sources: { hokfire: { description: 'HOKFIRE item description', source: { source: 'HOKFIRE', url: 'https://www.hokfire.com/' } }, hokstats: { stats: { Defense: '+240' }, passive: 'Reduces damage.', build_path: ['Iron Sword'], source: catalogSource } } }];
  const spellCatalog = [{ id: 'flash', name: 'Flash', effect: 'Move a short distance.', icon: '/assets/skills/flash.png', sources: { hokfire: { effect: 'Reposition quickly.', source: { source: 'HOKFIRE', url: 'https://www.hokfire.com/' } }, hokstats: { effect: 'Blink in a direction.', cooldown: '120s', best_for: ['disengage'], source: catalogSource } } }];
  const build = render(HeroWikiDrawer, { hero: enriched, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, itemCatalog, spellCatalog });
  assert.ok(build.includes('HoKStats · Peel build'));
  assert.ok(build.includes('Guardian Armor'));
  assert.ok(build.includes('HOKFIRE item description') && build.includes('Reduces damage.'));
  assert.ok(build.includes('120s') && build.includes('Reposition quickly.'));
  const abilities = render(HeroWikiDrawer, { hero: enriched, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, itemCatalog, spellCatalog, initialTab: 'abilities' });
  assert.ok(abilities.includes('Whirlwind') && abilities.includes('Pushes enemies back.'));
  const counters = render(HeroWikiDrawer, { hero: enriched, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'counters' });
  assert.ok(counters.includes('Kuat melawan') && counters.includes('Dun') && counters.includes('HoKStats'));
  assert.ok(!counters.includes('Pending review') && !counters.includes('DITINJAU'));
});

test('presentation cleanup preserves canonical tactical source data and image paths', () => {
  const source = { reason: '🎯 Target utama', nested: ['🛡️ Lindungi tim'], portrait_asset: '/assets/heroes/112.webp' };
  const copy = displayCopy(source);
  assert.equal(copy.reason, 'Target utama');
  assert.equal(copy.nested[0], 'Lindungi tim');
  assert.equal(copy.portrait_asset, source.portrait_asset);
  assert.equal(source.reason, '🎯 Target utama');
  assert.equal(source.nested[0], '🛡️ Lindungi tim');
});

test('DraftSimulator swap badges keep exact 10 lane icons and PostDraftGamePlanPanel renders SSR without emoji or nested buttons', () => {
  const pickByLane = (lane, skipIds = new Set()) =>
    dataset.heroes.find(h => h.is_global_released && h.hero_id !== 511 && h.primary_lane === lane && !skipIds.has(h.hero_id));
  const used = new Set();
  const pickTeam = () =>
    ['Clash', 'Jungle', 'Mid', 'Farm', 'Roam'].map(lane => {
      const h = pickByLane(lane, used);
      used.add(h.hero_id);
      return h;
    });
  const blueTeam = pickTeam();
  const redTeam = pickTeam();
  const bans = dataset.heroes.filter(h => h.is_global_released && !used.has(h.hero_id)).slice(0, 8);

  const defaultBlue = buildDefaultLaneAssignments(blueTeam, dataset.synergy?.hero_lane_rates);
  const swappedBlue = swapAssignedLanes(defaultBlue, 'Mid', 'Farm');
  const blueAssignedLanes = assignmentToHeroLaneMap(swappedBlue);
  const redAssignedLanes = assignmentToHeroLaneMap(buildDefaultLaneAssignments(redTeam, dataset.synergy?.hero_lane_rates));

  const boardHtml = render(DraftSimulator, {
    bluePicks: blueTeam,
    redPicks: redTeam,
    blueBans: bans.slice(0, 4),
    redBans: bans.slice(4, 8),
    blueAssignedLanes,
    redAssignedLanes,
    currentTurn: { side: 'red', action: 'pick', stepIndex: 18, isComplete: true },
    fearlessEnabled: true,
    gameNumber: 1,
    onToggleFearless: noop,
    onGameNumberChange: noop,
    onResetDraft: noop,
    onUndoStep: noop,
    onInspectHero: noop,
  });
  assert.ok(boardHtml.includes('Swap'));
  const boardImages = boardHtml.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(boardImages.filter(image => !image.includes('/assets/lanes/')).length, 18);
  assert.equal(boardImages.filter(image => image.includes('/assets/lanes/')).length, 10);

  const planHtml = render(PostDraftGamePlanPanel, {
    blueHeroes: blueTeam,
    redHeroes: redTeam,
    synergy: dataset.synergy,
    defaultPerspective: 'blue',
    blueAssignment: swappedBlue,
    redAssignment: buildDefaultLaneAssignments(redTeam, dataset.synergy?.hero_lane_rates),
    hasCustomAssignments: true,
    onSwapLane: noop,
    onResetLanes: noop,
    onInspectHero: noop,
  });
  assert.ok(planHtml.includes('Game Plan &amp; Winning Condition'));
  assert.ok(planHtml.includes('Peta Lane &amp; Swap 5v5'));
  assert.ok(planHtml.includes('Winning Condition &amp; Tempo'));
  assert.ok(planHtml.includes('Pola Jungle, Gank &amp; Item'));
  assert.ok(planHtml.includes('Reset Lane'));
  assert.ok(planHtml.includes('Rencana Re-Swap Menit 04:00 Aktif:'));
  assert.ok(!/<button\b(?:(?!<\/button>)[\s\S])*<button\b/.test(planHtml), 'No nested interactive buttons');
  assert.ok(!/\p{Extended_Pictographic}/u.test(planHtml.replace(/<[^>]+>/g, '')), 'No decorative emoji rendered');

  const winningTabHtml = render(PostDraftGamePlanPanel, {
    blueHeroes: blueTeam,
    redHeroes: redTeam,
    synergy: dataset.synergy,
    defaultPerspective: 'blue',
    defaultTab: 'winning',
    blueAssignment: swappedBlue,
    redAssignment: buildDefaultLaneAssignments(redTeam, dataset.synergy?.hero_lane_rates),
    hasCustomAssignments: true,
    onSwapLane: noop,
    onResetLanes: noop,
    onInspectHero: noop,
  });
  const winningPlainText = winningTabHtml.replace(/<[^>]+>/g, '');
  assert.ok(winningPlainText.includes('Perbandingan Kurva Tempo Menang'));
  assert.ok(winningPlainText.includes('bukan probabilitas kemenangan terkalibrasi'));
  const pctPairs = [...winningTabHtml.matchAll(/<strong[^>]*>(\d+)% vs (\d+)%<\/strong>/g)];
  assert.equal(pctPairs.length, 3, 'Expected Early/Mid/Late relative share percentages');
  for (const [, oursPct, enemyPct] of pctPairs) {
    assert.equal(Number(oursPct) + Number(enemyPct), 100, `Tempo pair ${oursPct}% vs ${enemyPct}% must sum to 100%`);
  }
  assert.ok(!/\p{Extended_Pictographic}/u.test(winningPlainText), 'No decorative emoji rendered on winning tab');
});
