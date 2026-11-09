import { parentPort } from 'node:worker_threads';
// Execute the browser worker module unchanged, using a small transport bridge.
globalThis.self = { postMessage: value => parentPort.postMessage(value), onmessage: null };
globalThis.fetch = () => { throw new Error('Worker must not fetch remote inference or data'); };
await import('../src/engine/opponent.worker.ts');
parentPort.on('message', data => self.onmessage({ data }));
