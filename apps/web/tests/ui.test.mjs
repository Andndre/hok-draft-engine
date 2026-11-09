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
import { TacticalRadarPanel } from '../src/components/TacticalRadarPanel.tsx';
import { HeroWikiDrawer } from '../src/components/HeroWikiDrawer.tsx';
import { PlanSelectionModal } from '../src/components/PlanSelectionModal.tsx';
import { PracticeDraft } from '../src/components/PracticeDraft.tsx';
import { displayCopy } from '../src/components/ui/presentation.ts';
import { evaluateTacticalScores } from '../src/engine/tournamentInference.ts';
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
  assert.equal((html.match(/<img\b/g) ?? []).length, 18);
});

test('recommendations use thumbnails and separate detail/action controls without decorative emoji', () => {
  const base = { scores: evaluateTacticalScores([], []), recommendations: [{ hero, proComboTag: '🎯 Amankan pembuka', laneTag: '' }], onSelectCandidate: noop, onInspectHero: noop, activeSide: 'blue', isPickPhase: false };
  const html = render(TacticalRadarPanel, base);
  assert.ok(html.includes('Amankan pembuka'));
  assert.ok(!html.includes('🎯'));
  assert.ok(html.includes('Detail') && html.includes('Ban ' + hero.name));
  assert.ok(html.includes(hero.portrait_asset));
  assert.ok(html.includes('bukan probabilitas kemenangan'));
  const waiting = render(TacticalRadarPanel, { ...base, recommendations: [], isWaiting: true });
  assert.ok(waiting.includes('Giliran AI. Rekomendasi tersedia saat giliran Anda.'));
  assert.ok(!waiting.includes('is-spinning'));
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

test('presentation cleanup preserves canonical tactical source data and image paths', () => {
  const source = { reason: '🎯 Target utama', nested: ['🛡️ Lindungi tim'], portrait_asset: '/assets/heroes/112.webp' };
  const copy = displayCopy(source);
  assert.equal(copy.reason, 'Target utama');
  assert.equal(copy.nested[0], 'Lindungi tim');
  assert.equal(copy.portrait_asset, source.portrait_asset);
  assert.equal(source.reason, '🎯 Target utama');
  assert.equal(source.nested[0], '🛡️ Lindungi tim');
});
