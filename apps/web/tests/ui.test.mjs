import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HeaderSortBar } from '../src/components/HeaderSortBar.tsx';
import { PracticeDraft } from '../src/components/PracticeDraft.tsx';
const noop = () => {};
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const dataset = { heroes: read(manifest.artifacts.heroes.file), synergy: read(manifest.artifacts.synergy.file), version: manifest.dataset_version, manifest };

test('practice header removes AI sort when assistance is disabled and locks Global roster', () => {
  const props = { sortMode: 'az', onSortChange: noop, viewMode: 'compact', onViewChange: noop, engineReady: true, engineLatency: 1, totalFiltered: 120, onlyGlobalReleased: true, onToggleGlobalReleased: noop };
  const hidden = renderToStaticMarkup(React.createElement(HeaderSortBar, { ...props, hideAiSort: true, globalLocked: true }));
  assert.equal(hidden.includes('AI Score'), false);
  assert.ok(/<button[^>]*disabled/.test(hidden));
  assert.ok(renderToStaticMarkup(React.createElement(HeaderSortBar, { ...props, hideAiSort: false })).includes('AI Score'));
});
test('practice setup renders both sides with Blue, assistance and Fearless enabled by default', () => {
  const html = renderToStaticMarkup(React.createElement(PracticeDraft, { dataset, active: true, assistance: true, onAssistanceChange: noop, selectedLane: 'All', searchQuery: '', sortMode: 'ai', viewMode: 'compact', favorites: new Set(), onToggleFavorite: noop }));
  const inputs = html.match(/<input[^>]*>/g);
  assert.ok(inputs.some(input => input.includes('value="blue"') && input.includes('checked')));
  assert.ok(inputs.some(input => input.includes('value="red"') && !input.includes('checked')));
  assert.equal(inputs.filter(input => input.includes('type="checkbox"') && input.includes('checked')).length, 2);
  assert.ok(html.includes('Mulai latihan'));
});
