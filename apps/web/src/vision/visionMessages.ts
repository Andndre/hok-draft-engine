import type { DraftFormat } from '../types';

/** Result returned by the apply-to-simulator action so the panel can render confirmation or refusal feedback. */
export type VisionApplyResult =
  | { ok: true; appliedCount: number; newStep: number }
  | { ok: false; reason: string };

/** Refusal message shown when the simulator is not in the advisor's draft format. */
export function visionFormatMismatchReason(advisorFormat: DraftFormat): string {
  const label = advisorFormat === 'ranked' ? 'Ranked' : 'Turnamen';
  return `Simulator harus berada di mode ${label} untuk menerapkan papan live ini. Buka tab Simulator, lalu ubah dropdown "Format draft" ke "${label}".`;
}
