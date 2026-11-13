/**
 * Browser-only screen-capture source for the live draft advisor (READ-ONLY:
 * captures frames from a user-initiated `getDisplayMedia` share; never injects
 * input into the game). Nothing here touches `document`/`navigator` at module
 * import time, so the module is safe to import in Node.
 */

import { toGray } from './geometry';
import type { CaptureFrame } from './types';

export type { CaptureFrame };

/** Options controlling capture throttling and downscaling. */
export interface CaptureOptions { fps?: number; maxWidth?: number }

type FrameSink = (frame: CaptureFrame) => void;

/** Minimal 2D-context union used for drawing + pixel reads (OffscreenCanvas first, DOM canvas fallback). */
type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Screen-capture source around `getDisplayMedia` with throttled frame emission. */
export class CaptureSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: DrawContext | null = null;
  private sink: FrameSink | null = null;
  private state: 'idle' | 'running' | 'error' = 'idle';
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEmit = 0;
  private readonly fps: number;
  private readonly maxWidth: number;

  constructor(options: CaptureOptions = {}) {
    this.fps = options.fps ?? 3;
    this.maxWidth = options.maxWidth ?? 1600;
  }

  /** True when the current environment exposes getDisplayMedia plus a DOM canvas. */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
      && typeof document !== 'undefined';
  }

  /** Current lifecycle status of the source. */
  get status(): 'idle' | 'running' | 'error' {
    return this.state;
  }

  /** Last error message, or null when the source has not failed. */
  get lastError(): string | null {
    return this.error;
  }

  /** Register the frame callback that receives throttled CaptureFrames. */
  onFrame(cb: (frame: CaptureFrame) => void): void {
    this.sink = cb;
  }

  /** Request screen share and begin emitting throttled frames; on failure sets status 'error' + lastError instead of throwing. */
  async start(): Promise<void> {
    if (this.state === 'running') return;
    if (!CaptureSource.isSupported()) {
      this.state = 'error';
      this.error = 'Screen capture is not supported in this environment.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      this.stream = stream;
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.style.position = 'fixed';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.srcObject = stream;
      document.body.appendChild(video);
      await video.play();
      this.video = video;
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => this.stop());
      });
      this.state = 'running';
      this.error = null;
      this.lastEmit = 0;
      this.scheduleNext();
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.release();
    }
  }

  /** Stop capturing and release the shared-screen stream. */
  stop(): void {
    this.release();
    this.state = 'idle';
  }

  private scheduleNext(): void {
    const video = this.video;
    if (!video || this.state !== 'running') return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => {
        if (this.state !== 'running') return;
        this.processFrame();
        this.scheduleNext();
      });
    } else if (this.timer === null) {
      this.timer = setInterval(() => {
        if (this.state !== 'running') return;
        this.processFrame();
      }, this.frameInterval());
    }
  }

  private processFrame(): void {
    if (this.state !== 'running' || !this.video || !this.sink) return;
    const now = Date.now();
    if (now - this.lastEmit < this.frameInterval() - 8) return;
    try {
      const video = this.video;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (sourceWidth < 2 || sourceHeight < 2) return;
      const scale = sourceWidth > this.maxWidth ? this.maxWidth / sourceWidth : 1;
      const width = Math.max(2, Math.round(sourceWidth * scale));
      const height = Math.max(2, Math.round(sourceHeight * scale));
      const ctx = this.ensureContext(width, height);
      if (!ctx) throw new Error('2D canvas context unavailable.');
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      this.lastEmit = now;
      // ONE read, two views: grayscale for the matcher, raw RGBA for the
      // colour cross-check and the lock-badge detector (types.ts CaptureFrame).
      this.sink({ gray: toGray(imageData), rgba: imageData.data, width, height, ts: now });
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.release();
    }
  }

  private ensureContext(width: number, height: number): DrawContext | null {
    if (!this.canvas) {
      if (typeof OffscreenCanvas !== 'undefined') this.canvas = new OffscreenCanvas(width, height);
      else if (typeof document !== 'undefined') this.canvas = document.createElement('canvas');
      else return null;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    if (!this.ctx) {
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      this.ctx = ctx;
    }
    return this.ctx;
  }

  private frameInterval(): number {
    return Math.max(16, Math.round(1000 / this.fps));
  }

  private release(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      const video = this.video;
      video.pause();
      video.srcObject = null;
      video.remove();
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.lastEmit = 0;
  }
}
