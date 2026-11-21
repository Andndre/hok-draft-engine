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
import { displayCopy, focusHeroSearch } from '../src/components/ui/presentation.ts';
import { buildDefaultLaneAssignments, assignmentToHeroLaneMap, swapAssignedLanes } from '../src/engine/gamePlan.ts';
import { evaluateTacticalScores, computeDraftOutcomeProjection } from '../src/engine/tournamentInference.ts';
import { DropdownSelect } from '../src/components/ui/DropdownSelect.tsx';
import { HeroThumbnail } from '../src/components/ui/AssetThumbnail.tsx';
import { VisionPanel } from '../src/components/VisionPanel.tsx';
import { VisionHeroPickerModal } from '../src/components/VisionHeroPickerModal.tsx';
import { shouldNotifyDialogClose } from '../src/components/ui/useNativeModalDialog.ts';
import { searchHeroes } from '../src/heroSearch.ts';
import { APP_NAVIGATION } from '../src/components/ui/navigation.ts';
import { WikiHub } from '../src/components/WikiHub.tsx';
import { Layers } from 'lucide-react';
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const dataset = { heroes: read(manifest.artifacts.heroes.file), synergy: read(manifest.artifacts.synergy.file), version: manifest.dataset_version, manifest };

const hero = dataset.heroes.find(hero => hero.is_global_released);
const controls = { selectedLane: 'All', onLaneChange: noop, searchQuery: '', onSearchChange: noop, sortMode: 'ai', onSortChange: noop, viewMode: 'compact', onViewChange: noop };

test('practice removes AI sorting without assistance and allows toggling Global roster', () => {
  const hidden = render(HeroRosterToolbar, { ...controls, count: 120, hideAiSort: true });
  assert.ok(!hidden.includes('Skor AI'));
  assert.ok(hidden.includes('aria-label="Urutkan hero: Nama A–Z"'));
  assert.ok(render(HeroRosterToolbar, { ...controls, count: 120 }).includes('Skor AI'));
  const header = render(HeaderSortBar, { activeTab: 'draft', onTabChange: noop, engineReady: true, favoriteCount: 0, onlyGlobalReleased: true, onToggleGlobalReleased: noop, globalLocked: false });
  assert.ok(!header.includes('disabled'));
  assert.match(header, /<button[^>]*aria-pressed="true"/);
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

test('duet package card renders only when the radar panel receives packages', () => {
  const [primary, secondary] = dataset.heroes.filter(hero => hero.is_global_released).slice(0, 2);
  assert.notEqual(primary.hero_id, secondary.hero_id);
  const pkg = {
    primaryHero: primary,
    secondaryHero: secondary,
    combinedScore: 87.5,
    duetWinRate: 0.58,
    kplMatches: 24,
    synergyLift: 0.04,
    archetypeBadge: 'Frontline Anchor + Core Carry',
    kplSynergyLabel: 'Sinergi KPL: 58% WR (24 match)',
    enemyExploitBadge: 'Menahan dive musuh',
    primaryLane: primary.primary_lane,
    secondaryLane: secondary.primary_lane,
  };
  const base = {
    scores: evaluateTacticalScores([], []),
    recommendations: [{ hero, proComboTag: 'Prioritas pertama', laneTag: '' }],
    onSelectCandidate: noop,
    onInspectHero: noop,
    activeSide: 'red',
    isPickPhase: true,
    duetPackages: [pkg],
    onSelectDuetPackage: noop,
  };
  const html = render(TacticalRadarPanel, base);
  assert.ok(html.includes('💡 PAKET DUET'), 'Compact single-line duet header title');
  assert.ok(!html.includes('Paket Duet Giliran Ganda'), 'Legacy two-line header wording must be gone');
  assert.ok(html.includes('Pick Paket Ini'));
  assert.ok(html.includes(primary.name) && html.includes(secondary.name));
  assert.ok(html.includes('Frontline Anchor + Core Carry'));
  assert.ok(html.includes('Sinergi KPL: 58% WR (24 match)'));
  assert.ok(html.includes('Menahan dive musuh'));
  assert.ok(html.includes(primary.portrait_asset) && html.includes(secondary.portrait_asset));
  assert.ok(html.includes(`Pick Paket Ini (${primary.name} + ${secondary.name})`));

  const withoutPackages = render(TacticalRadarPanel, { ...base, duetPackages: undefined, onSelectDuetPackage: undefined });
  assert.ok(!withoutPackages.includes('PAKET DUET'));
  assert.ok(!withoutPackages.includes('Pick Paket Ini'));

  // 1. LABEL SEPARATION (compact contract): duet tabs show bare "#N" as visible text — the word
  //    "Paket" lives only in aria-label/title. The card header is the compact "💡 PAKET DUET".
  //    Single-pick tabs show rank "#N" + hero name visibly; "Rekomendasi #N: <Hero>" lives only
  //    in aria-label/title. Two packages are needed for the duet tab strip to render.
  const [third, fourth] = dataset.heroes.filter(h => h.is_global_released).slice(2, 4);
  const pkg2 = { ...pkg, primaryHero: third, secondaryHero: fourth, primaryLane: third.primary_lane, secondaryLane: fourth.primary_lane };
  const rankedRecs = [
    { hero: primary, proComboTag: 'Prioritas pertama', laneTag: '' },
    { hero: secondary, proComboTag: 'Alternatif solid', laneTag: '' },
  ];
  const dualHtml = render(TacticalRadarPanel, { ...base, recommendations: rankedRecs, duetPackages: [pkg, pkg2] });
  const duetCardStart = dualHtml.indexOf('duet-package-card');
  const duetCardEnd = dualHtml.indexOf('recommendation-tabs');
  assert.ok(duetCardStart >= 0 && duetCardEnd > duetCardStart, 'Fixture sanity: duet card and recommendation tabs both render');
  const duetSlice = dualHtml.slice(duetCardStart, duetCardEnd);
  assert.ok(duetSlice.includes('💡 PAKET DUET'), 'Duet card header shows the compact PAKET DUET title');
  assert.ok(!duetSlice.includes('Paket Duet Giliran Ganda'), 'Legacy wrapped header wording must be gone');
  assert.match(duetSlice, /class="duet-package-card__title"[^>]*>💡 PAKET DUET<\/span>/, 'PAKET DUET header keeps its dedicated class');
  const draftCss = readFileSync(new URL('../src/styles/draft.css', import.meta.url), 'utf8');
  assert.match(draftCss, /\.duet-package-card__title\s*\{[^}]*white-space:\s*nowrap/, 'PAKET DUET header must stay nowrap in CSS');
  const duetButtons = [...duetSlice.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(m => ({ attrs: m[1], text: m[2] }));
  assert.deepEqual(duetButtons.map(b => b.text), ['#1', '#2'], 'Duet tab visible labels must be the bare "#N", never "Paket #N"');
  assert.ok(
    duetButtons[0].attrs.includes('aria-label="Paket #1"') && duetButtons[0].attrs.includes('title="Paket #1"'),
    'First duet tab keeps the accessible name "Paket #1"'
  );
  assert.ok(
    duetButtons[1].attrs.includes('aria-label="Paket #2"') && duetButtons[1].attrs.includes('title="Paket #2"'),
    'Second duet tab keeps the accessible name "Paket #2"'
  );
  assert.ok(
    !duetButtons.map(b => b.text).join(' ').includes('Paket'),
    'The word "Paket" must not appear in visible duet tab text'
  );

  // Single-pick tabs: visible rank span "#N" + hero name; the word "Rekomendasi" survives only in
  // aria-label/title ("Rekomendasi #N: <HeroName>") — regression guard for the horizontal scroll.
  const tabbedHtml = render(TacticalRadarPanel, { ...base, recommendations: rankedRecs });
  const tabsStart = tabbedHtml.indexOf('recommendation-tabs');
  assert.ok(tabsStart >= 0, 'Fixture sanity: recommendation tabs render');
  const tabsSlice = tabbedHtml.slice(tabsStart, tabbedHtml.indexOf('primary-recommendation', tabsStart));
  assert.ok(
    tabsSlice.includes('class="rec-tab__rank">#1<') && tabsSlice.includes('class="rec-tab__rank">#2<'),
    'Tabs render compact rank spans #1/#2'
  );
  const attrEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  for (const [rank, tabHero] of [[1, primary], [2, secondary]]) {
    const accessibleName = `Rekomendasi #${rank}: ${attrEscape(tabHero.name)}`;
    assert.ok(
      tabsSlice.includes(`aria-label="${accessibleName}"`) && tabsSlice.includes(`title="${accessibleName}"`),
      `Tab #${rank} keeps the accessible name "Rekomendasi #${rank}: ${tabHero.name}"`
    );
  }
  const visibleTabText = tabsSlice.replace(/<[^>]+>/g, '');
  assert.ok(
    !visibleTabText.includes('Rekomendasi'),
    'The word "Rekomendasi" must not appear in visible tab text (repeated-label scroll regression guard)'
  );
  assert.ok(visibleTabText.includes('#1') && visibleTabText.includes('#2'), 'Visible tab text shows the bare ranks');

  // 2. RANK BADGE: package members render their single-pick rank (#1/#2) when present
  //    in `recommendations`, and the neutral "—" badge when absent.
  const rankedBadgesHtml = render(TacticalRadarPanel, { ...base, recommendations: rankedRecs });
  assert.ok(rankedBadgesHtml.includes('Peringkat rekomendasi tunggal #1'), 'Primary member shows its single-pick rank #1');
  assert.ok(rankedBadgesHtml.includes('Peringkat rekomendasi tunggal #2'), 'Secondary member shows its single-pick rank #2');
  const outsider = dataset.heroes.filter(h => h.is_global_released)[2];
  const neutralBadgesHtml = render(TacticalRadarPanel, { ...base, recommendations: [{ hero: outsider, proComboTag: '', laneTag: '' }] });
  assert.equal(
    (neutralBadgesHtml.match(/<span class="sr-only">Tidak ada di rekomendasi tunggal<\/span>/g) ?? []).length,
    2,
    'Both package members outside the single-pick recommendations render the neutral badge'
  );
  assert.ok(!neutralBadgesHtml.includes('role="status"'), 'Static rank badges avoid spurious live regions');

  // NOTE (stale-tab reset): the SSR harness (renderToStaticMarkup) never runs useEffect,
  // and every render() call mounts a fresh instance, so the duet-tab reset on a changing
  // package-list signature cannot be observed here. Not asserted in this harness.
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

  // Pada Last Pick (misal Step 17 / R5, lawan sudah lengkap 5 hero walau ada vacant lane akibat komposisi musuh)
  // AI TIDAK BOLEH memproyeksikan respon pick counter musuh!
  const dummyEnemyFive = [
    dataset.heroes[0],
    dataset.heroes[1],
    dataset.heroes[2],
    dataset.heroes[3],
    dataset.heroes[4],
  ];
  const lastPickProj = computeDraftOutcomeProjection(
    luban,
    true,
    [dataset.heroes[5], dataset.heroes[6], dataset.heroes[7], dataset.heroes[8]],
    dummyEnemyFive,
    available,
    new Set(['Farm']),
    new Set(['Mid']), // Ceritanya musuh pick 2 farm laner dan 0 mid laner
    dataset.synergy?.pairs || {},
    evaluateTacticalScores([], []),
    false,
    null,
    false, // Red side
    17,    // Step 17 = R5 Last Pick
    [],
    dataset.synergy?.b1_openers || {},
    'tournament'
  );
  assert.strictEqual(lastPickProj.riskLevel, 'RENDAH');
  assert.ok(lastPickProj.worstCaseScenario.includes('Counter Terakhir') || lastPickProj.worstCaseScenario.includes('tidak memiliki giliran pick balasan'));
  assert.ok(!lastPickProj.worstCaseScenario.includes('Musuh bisa respon'));
  assert.ok(!lastPickProj.worstCaseScenario.includes('diproyeksikan mengunci'));
});

test('plan and wiki dialogs expose names, native controls and counter-first navigation', () => {
  const plan = render(PlanSelectionModal, { isOpen: true, onClose: noop, heroes: [hero], currentPlanAId: hero.hero_id, currentPlanBId: null, onSelectPlanA: noop, onSelectPlanB: noop, activeSide: 'blue', unavailableHeroIds: new Set(), recommendedOpeners: [] });
  assert.match(plan, /<dialog[^>]*aria-labelledby=/);
  assert.match(plan, /<dialog[^>]*closedby="any"/);
  assert.ok(plan.includes('Hapus Plan A') && plan.includes('Hapus Plan B'));
  assert.ok(!/<button\b(?:(?!<\/button>)[\s\S])*<button\b/.test(plan));
  const wiki = render(HeroWikiDrawer, { hero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'counters' });
  assert.match(wiki, /<dialog[^>]*aria-labelledby=/);
  assert.match(wiki, /<dialog[^>]*closedby="any"/);
  assert.ok(wiki.includes('Tutup wiki hero'));
  assert.match(wiki, /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*?<span>Counter<\/span>/);
  assert.ok(!/\p{Extended_Pictographic}/u.test(wiki.replace(/<[^>]+>/g, '')));
});

test('wiki exposes HoKStats build alternatives and source-attributed item, spell, skill and matchup details', () => {
  const source = { source: 'HoKStats', url: 'https://hokstats.gg/heroes/annette/', fetched_at: '2026-11-09T00:00:00Z', patch_version: '1.10', review_status: 'pending', source_hash: 'fixture' };
  const enriched = {
    ...hero,
    abilities: [],
    official_build: undefined,
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
  const taggedHero = {
    ...hero,
    tactical_profile: {
      source_hash: 'fixture',
      model: 'Skill-Evidence-Audit-v2',
      reviewed_by: 'Tester',
      tags: { cc_slow: true, ally_heal: true, cc_taunt: true, engage: true, dive_vulnerable: true, weak_early: true },
    },
  };
  const factualWiki = render(HeroWikiDrawer, { hero: taggedHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'abilities' });
  assert.ok(factualWiki.includes('Mekanik Skill Terverifikasi'));
  assert.ok(factualWiki.includes('Slow') && factualWiki.includes('Heal Sekutu') && factualWiki.includes('Taunt'));
  assert.ok(!factualWiki.includes('title="Memperlambat'), 'Factual tags use native toggletips instead of title attributes');
  assert.match(factualWiki, /role="tooltip" popover="hint"[^>]*>Memperlambat kecepatan gerak \(movement speed\) lawan\.<\/span>/);
  assert.match(factualWiki, /role="tooltip" popover="hint"[^>]*>Memulihkan sejumlah HP untuk rekan satu tim\.<\/span>/);
  assert.match(factualWiki, /role="tooltip" popover="hint"[^>]*>Memaksa lawan menyerang hero ini dan mengunci penggunaan skill selama durasi\.<\/span>/);
  assert.ok(!factualWiki.includes('Dive Vulnerable') && !factualWiki.includes('Weak Early') && !factualWiki.includes('engage'));
  const tacticsWiki = render(HeroWikiDrawer, { hero: taggedHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'tactics' });
  assert.ok(tacticsWiki.includes('Peran Taktis'));
  assert.ok(tacticsWiki.includes('Inisiator (Engage)'));
  assert.ok(tacticsWiki.includes('Rentan Dive') && tacticsWiki.includes('Lemah Early Game'));
  assert.ok(!tacticsWiki.includes('title="Sangat rentan'), 'Tactical tags use native toggletips instead of title attributes');
  assert.match(tacticsWiki, /role="tooltip" popover="hint"[^>]*>Sangat rentan disergap \(dive\) oleh assassin karena minim mobilitas atau pertahanan mandiri\.<\/span>/);
  const counters = render(HeroWikiDrawer, { hero: enriched, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'counters' });
  assert.ok(counters.includes('Kuat melawan') && counters.includes('Dun') && counters.includes('HoKStats'));
  assert.ok(!counters.includes('Pending review') && !counters.includes('DITINJAU'));

  // Test opening wiki for CN hero (no hokfire_guide or hokstats_guide)
  const cnHero = {
    hero_id: 525,
    name: 'Master Luban',
    chinese_name: '鲁班大师',
    slug: 'master-luban',
    title: 'Divine Craftsman',
    primary_role: 'Support',
    primary_lane: 'Roamer',
    lanes: ['Roamer'],
    win_rate: 0.52,
    win_rate_source: 'kpl',
    kpl_matches: 450,
    kpl_winrate: 0.52,
    kpl_pick_rate: 0.12,
    kpl_ban_rate: 0.25,
    counters: [],
    countered_by: [],
    counter_items: [],
    tactical_tips: 'Bantu inisiasi dan tarik rekan tim.',
    portrait_asset: '/assets/portraits/525.png',
    kpl_id: 525,
    is_global_exclusive: false,
    is_global_released: false,
    abilities: [
      {
        skill_id: 52500,
        type: 'Passive',
        name: 'Tech Mastery',
        desc: 'Hits generate shields.',
        cd: 0,
        cost: 0,
      },
    ],
    official_build: {
      build_1: {
        name: 'Support Tank',
        items: ['Shadow Blade', 'Boots of Speed'],
        tips: 'Build fokus durability.',
      },
      build_2: {
        name: 'Full Roamer',
        items: ['Boots of Tranquility', 'Glacial Buckler'],
      },
      arcana: [
        {
          id: '1504',
          name: 'Fate',
          color: 'red',
          attr: 'Max HP +33.7',
          count: 10,
        },
      ],
      spell: 'Flicker',
      core_items: ['Shadow Blade'],
      situational_items: [],
    },
  };

  const cnBuild = render(HeroWikiDrawer, { hero: cnHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'build' });
  assert.ok(cnBuild.includes('Preset Resmi #1 (Standar)'));
  assert.ok(cnBuild.includes('Shadow Blade'));
  assert.ok(cnBuild.includes('Fate'));

  const cnAbilities = render(HeroWikiDrawer, { hero: cnHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'abilities' });
  assert.ok(cnAbilities.includes('Tech Mastery'));

  const cnTactics = render(HeroWikiDrawer, { hero: cnHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'tactics' });
  assert.ok(cnTactics.includes('Cara Melawan di Pertandingan'));

  const cnCounters = render(HeroWikiDrawer, { hero: cnHero, onClose: noop, isFavorite: false, onToggleFavorite: noop, allHeroes: dataset.heroes, onSelectRelatedHero: noop, initialTab: 'counters' });
  assert.ok(cnCounters.includes('Master Luban'));
});

test('focusHeroSearch hands the roster query back for re-typing and skips hidden fields', () => {
  const el = {
    value: 'liang',
    focused: 0,
    selected: 0,
    scrolled: [],
    rect: { width: 240, height: 48, top: 520, bottom: 568 },
    getBoundingClientRect() { return this.rect; },
    scrollIntoView(options) { this.scrolled.push(options); },
    focus() { this.focused += 1; },
    select() { this.selected += 1; },
  };
  const previous = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia };
  globalThis.document = { getElementById: id => (id === 'hero-search' ? el : null) };
  globalThis.window = { innerHeight: 800 };
  globalThis.matchMedia = () => ({ matches: false });
  try {
    assert.equal(focusHeroSearch({ select: true }), true);
    assert.equal(el.focused, 1);
    assert.equal(el.selected, 1, 'Tapping a search result must highlight the query so the next keystroke replaces it');
    assert.deepEqual(el.scrolled, [], 'A visible search field is never scrolled away from the list');
    assert.equal(focusHeroSearch(), true);
    assert.equal(el.selected, 1, 'Plain focus keeps the caret instead of re-selecting');
    el.rect = { width: 240, height: 48, top: 1200, bottom: 1248 };
    assert.equal(focusHeroSearch({ select: true }), true);
    assert.deepEqual(el.scrolled, [{ block: 'center', behavior: 'smooth' }], 'Off-screen field is brought back into view');
    el.rect = { width: 0, height: 0, top: 0, bottom: 0 };
    assert.equal(focusHeroSearch({ select: true }), false, 'The hidden toolbar of an inactive mode/tab is never focused');
    assert.equal(el.focused, 3);
    globalThis.document = { getElementById: () => null };
    assert.equal(focusHeroSearch(), false);
  } finally {
    for (const key of ['document', 'window', 'matchMedia']) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  }
});

test('roster search field is ready for mobile hero typing', () => {
  const input = (render(HeroRosterToolbar, { ...controls, count: 120 }).match(/<input[^>]*>/) ?? [''])[0];
  assert.ok(input.includes('id="hero-search"'));
  assert.match(input, /enterkeyhint="search"/i);
  assert.match(input, /autocapitalize="off"|autocapitalize="none"/i);
  assert.match(input, /autocorrect="off"/i);
  assert.match(input, /spellcheck="false"/i);
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
  assert.ok(planHtml.includes('Rencana Re-Swap Menit 04:00 Aktif'));
  assert.ok(planHtml.includes('reswap-alert__list'));
  assert.ok(!planHtml.includes('Fase 00:00–04:00:'), 'Must not render duplicated colon-heavy boilerplate in reswap items');
  assert.ok(!planHtml.includes('swap-clean-note'), 'Must not contradict active tactical re-swap alert with solid-lane banner');
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

test('modern web guidance regressions: non-nested card buttons, search landmark, viewport, native controls and priority images', () => {
  const projection = {
    bestCaseScore: 84,
    bestCaseScenario: 'Kombo kuat early',
    worstCaseScore: 52,
    worstCaseScenario: 'Risiko counter pick',
    riskLevel: 'SEDANG',
  };
  const detailedHtml = render(HeroCardDetailed, {
    hero,
    onClick: noop,
    onSelect: noop,
    aiRank: 1,
    recommendationReason: 'Opener meta prioritas',
    projection,
  });
  assert.ok(!/<button\b(?:(?!<\/button>)[\s\S])*<button\b/.test(detailedHtml), 'HeroCardDetailed must not nest interactive buttons');
  assert.match(detailedHtml, /popover="hint"/);
  assert.match(detailedHtml, /interestfor="/);

  const toolbarHtml = render(HeroRosterToolbar, { ...controls, count: 120 });
  assert.match(toolbarHtml, /<search\b[^>]*class="roster-toolbar"[\s\S]*<\/search>$/);

  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!indexHtml.includes('maximum-scale') && !indexHtml.includes('user-scalable=no'), 'Viewport must allow pinch-to-zoom');
  assert.ok(indexHtml.includes('<meta name="color-scheme" content="dark" />'));

  const visionHtml = render(VisionPanel, { heroes: dataset.heroes.slice(0, 5), synergyData: {} });
  assert.match(visionHtml, /class="vision-side-indicator"/);
  assert.ok(visionHtml.includes('Sisi:'));
  assert.ok(visionHtml.includes('(Otomatis)'));

  const pickerHtml = render(VisionHeroPickerModal, { isOpen: true, onClose: noop, heroes: [hero], onSelect: noop });
  assert.match(pickerHtml, /<dialog[^>]*closedby="any"/);

  const highImgHtml = render(HeroThumbnail, { hero, priority: 'high' });
  assert.ok(highImgHtml.includes('width="96"') && highImgHtml.includes('height="96"'));
  assert.ok(highImgHtml.includes('loading="eager"'));
  assert.match(highImgHtml, /fetchpriority="high"/i);

  const rosterCss = readFileSync(new URL('../src/styles/roster.css', import.meta.url), 'utf8');
  assert.ok(rosterCss.includes('.hero-card__cover-btn > .tier-label'));
  assert.ok(!rosterCss.includes('.hero-card__cover .tier-label'));

  const draftCss = readFileSync(new URL('../src/styles/draft.css', import.meta.url), 'utf8');
  assert.ok(!draftCss.includes('.hero-card--detailed .hero-card__ai-group'));

  assert.equal(shouldNotifyDialogClose(true, { open: true }), false, 'Stale async close events while dialog is re-opened in StrictMode must be ignored');
  assert.equal(shouldNotifyDialogClose(false, { open: false }), false, 'Cleanup close events must not notify onClose');
  assert.equal(shouldNotifyDialogClose(true, { open: false }), true, 'User-initiated dialog close while active must notify onClose');

  const polyfillsTs = readFileSync(new URL('../src/platform/polyfills.ts', import.meta.url), 'utf8');
  assert.ok(!polyfillsTs.includes('polyfillBodyAndObserve'), 'Must not attach global body MutationObserver for focusgroup');

  const useFocusgroupTs = readFileSync(new URL('../src/components/ui/useFocusgroup.ts', import.meta.url), 'utf8');
  assert.ok(useFocusgroupTs.includes('@microsoft/focusgroup-polyfill/shadowless'), 'Scoped focusgroup helper uses lightweight shadowless build');

  const baseCss = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8');
  assert.ok(baseCss.includes('--interest-delay-start:'), 'Configures snappy hover delay for interest invokers');

  const sampleHeroes = dataset.heroes.filter(h => h.is_global_released);
  const firstRun = searchHeroes(sampleHeroes, 'liang');
  const secondRun = searchHeroes(sampleHeroes, 'liang');
  assert.deepEqual(firstRun.map(h => h.hero_id), secondRun.map(h => h.hero_id), 'WeakMap-cached hero search index preserves deterministic order');
});

test('unified wiki hub merges redundant counter tab and provides hero, item, arcana, and spell encyclopedias', () => {
  // 1. Navigation has exactly 3 unified tabs: draft, wiki, favorites
  assert.deepEqual(APP_NAVIGATION.map(n => n.id), ['draft', 'wiki', 'favorites']);

  // 2. Header renders the 3 unified navigation items
  const headerHtml = render(HeaderSortBar, { activeTab: 'wiki', onTabChange: noop, engineReady: true, favoriteCount: 2, onlyGlobalReleased: true, onToggleGlobalReleased: noop });
  assert.ok(headerHtml.includes('Wiki'));
  assert.ok(headerHtml.includes('Draft'));
  assert.ok(headerHtml.includes('Favorit'));
  assert.ok(!headerHtml.includes('<span>Counter</span>'));

  // 3. WikiHub renders all sub-tabs: Hero & Counter, Item Equipment, Arcana Level 5, Battle Spell
  const items = read(manifest.artifacts.items.file);
  const spells = read(manifest.artifacts.spells.file);
  const wikiHeroHtml = render(WikiHub, { heroes: dataset.heroes, items, spells, onInspectHero: noop, onlyGlobalReleased: true, initialSubTab: 'hero' });
  assert.ok(wikiHeroHtml.includes('Hero &amp; Counter') || wikiHeroHtml.includes('Hero & Counter'));
  assert.ok(wikiHeroHtml.includes('Item Equipment'));
  assert.ok(wikiHeroHtml.includes('Arcana Level 5'));
  assert.ok(wikiHeroHtml.includes('Battle Spell'));

  // 4. WikiHub renders item catalog with category filter and price
  const wikiItemHtml = render(WikiHub, { heroes: dataset.heroes, items, spells, onInspectHero: noop, onlyGlobalReleased: true, initialSubTab: 'item' });
  assert.ok(wikiItemHtml.includes('Serangan'));
  assert.ok(wikiItemHtml.includes('Sihir'));
  assert.ok(wikiItemHtml.includes('Pertahanan'));
  assert.ok(wikiItemHtml.includes('Gold'));

  // 5. WikiHub renders arcana catalog with all 30 Level 5 arcana colors
  const wikiArcanaHtml = render(WikiHub, { heroes: dataset.heroes, items, spells, onInspectHero: noop, onlyGlobalReleased: true, initialSubTab: 'arcana' });
  assert.ok(wikiArcanaHtml.includes('Semua Arcana (30)'));
  assert.ok(wikiArcanaHtml.includes('Merah (Serangan &amp; Pierce)') || wikiArcanaHtml.includes('Merah (Serangan & Pierce)'));
  assert.ok(wikiArcanaHtml.includes('Biru (Mobilitas &amp; Sustain)') || wikiArcanaHtml.includes('Biru (Mobilitas & Sustain)'));
  assert.ok(wikiArcanaHtml.includes('Hijau (Defense &amp; CDR)') || wikiArcanaHtml.includes('Hijau (Defense & CDR)'));

  // 6. WikiHub renders spell catalog with cooldowns
  const wikiSpellHtml = render(WikiHub, { heroes: dataset.heroes, items, spells, onInspectHero: noop, onlyGlobalReleased: true, initialSubTab: 'spell' });
  assert.ok(wikiSpellHtml.includes('Flash'));
  assert.ok(wikiSpellHtml.includes('Smite'));
  assert.ok(wikiSpellHtml.includes('Purify'));

  // 7. Counter matrix mode renders direct threat and target relations
  const liang = dataset.heroes.find(h => h.name === 'Liang');
  const wikiCounterHtml = render(WikiHub, { heroes: dataset.heroes, items, spells, onInspectHero: noop, onlyGlobalReleased: true, initialSubTab: 'hero', initialTargetHeroId: liang.hero_id });
  assert.ok(wikiCounterHtml.includes('Kuat Melawan (Target Empuk)'));
  assert.ok(wikiCounterHtml.includes('Lemah Melawan (Ancaman Alami)'));
});
