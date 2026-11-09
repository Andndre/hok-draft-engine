import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { OpponentClient } from '../src/engine/opponentClient.ts';
import { emptyPosition, isLegalHero } from '../src/engine/draftRules.ts';
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const dataset = { heroes: read(manifest.artifacts.heroes.file), synergy: read(manifest.artifacts.synergy.file), version: manifest.dataset_version, manifest };

test('actual worker protocol performs local search while the main event loop runs', async () => {
  const sent = [];
  class BrowserWorkerAdapter {
    constructor() {
      this.worker = new NodeWorker(new URL('./worker-harness.mjs', import.meta.url), { execArgv: ['--import', new URL('./register.mjs', import.meta.url).href] });
      this.worker.on('message', data => this.onmessage?.({ data }));
      this.worker.on('error', error => this.onerror?.(error));
    }
    postMessage(data) { sent.push(data); this.worker.postMessage(data); }
    terminate() { return this.worker.terminate(); }
  }
  globalThis.Worker = BrowserWorkerAdapter;
  const client = new OpponentClient(dataset, 'blue');
  try {
    let heartbeat = false;
    const timer = setTimeout(() => { heartbeat = true; }, 20);
    const settings = { fearless: { blue: [], red: [] }, aiPlan: { a: null, b: null }, playerPlan: { a: 556, b: 156 } };
    const decision = await client.decide(emptyPosition(), settings, { sessionId: 'worker-fixture', revision: 1 }, new AbortController().signal);
    clearTimeout(timer);
    assert.equal(heartbeat, true);
    assert.equal(decision.engineKind, 'search');
    assert.ok(decision.completedDepth >= 1 && decision.completedDepth <= 4);
    assert.ok(decision.elapsedMs < 1750);
    assert.ok(isLegalHero(emptyPosition(), decision.heroId, { heroes: dataset.heroes, onlyGlobal: true, fearless: settings.fearless }));
    assert.equal(sent.filter(message => message.type === 'init').length, 1);
    assert.equal('playerPlan' in sent.find(message => message.type === 'decide'), false);
    const abort = new AbortController();
    const pending = client.decide(emptyPosition(), settings, { sessionId: 'worker-fixture', revision: 2 }, abort.signal);
    abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { client.cancel(); delete globalThis.Worker; }
});
