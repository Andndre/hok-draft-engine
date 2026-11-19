import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSource } from '../src/vision/capture.ts';

test('pausing freezes emitted frames and resuming keeps the same screen share', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let callback;
  let stopped = 0;
  let shares = 0;
  const track = { addEventListener() {}, stop() { stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const video = {
    style: {}, videoWidth: 2, videoHeight: 2,
    setAttribute() {}, play: async () => {}, pause() {}, remove() {},
    requestVideoFrameCallback(fn) { callback = fn; },
  };
  const context = { drawImage() {}, getImageData: () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) }) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getDisplayMedia: async () => { shares++; return stream; } } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: { appendChild() {} }, createElement: tag => tag === 'video' ? video : { getContext: () => context } } });
  try {
    const capture = new CaptureSource();
    let frames = 0;
    capture.onFrame(() => { frames++; });
    await capture.start();
    callback();
    assert.equal(frames, 1);
    assert.equal(capture.setPaused(true), true);
    callback();
    assert.equal(frames, 1);
    assert.equal(stopped, 0);
    assert.equal(capture.setPaused(false), true);
    callback();
    assert.equal(frames, 2);
    assert.equal(shares, 1);
    capture.stop();
    assert.equal(stopped, 1);
    assert.equal(capture.setPaused(false), false);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
});
