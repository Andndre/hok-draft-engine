import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ChartColumn,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Scan,
  Shield,
  ShieldBan,
  SlidersHorizontal,
  Swords,
  UserRound,
  XCircle,
} from 'lucide-react';
import type { DraftFormat, Hero } from '../types';
import type { DraftPosition, Side } from '../engine/draftRules';
import { getDraftSequence, getDraftTurn } from '../engine/draftRules';
import type { Rect, VisionSide, VisionSlotKind } from '../vision/types';
import { VisionPipeline, VisionPipelineStatus, scaleRect } from '../vision/pipeline';
import type { LayoutStatus, ObserverResult, VisionRecommendation, SideCrossCheck } from '../vision/pipeline';
import type { DraftObservation, SlotRegion } from '../vision/types';
import { resolveSlotSides } from '../vision/regionMap';
import {
  buildManualRegionProfile,
  defaultManualLayoutConfig,
  loadManualLayoutConfig,
  saveManualLayoutConfig,
  sanitizeManualLayoutConfig,
  type ManualLayoutConfig,
} from '../vision/manualLayout';
import { unidentifiedBansBreakdownMessage } from '../vision/observer';
import { VisionHeroPickerModal } from './VisionHeroPickerModal';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { LaneLabel } from './ui/LaneIcon';
import { TacticalRadarPanel } from './TacticalRadarPanel';
import { evaluateTacticalScores } from '../engine/tournamentInference';
import { PostDraftGamePlanPanel } from './PostDraftGamePlanPanel';
import { buildDefaultLaneAssignments, assignmentToHeroLaneMap } from '../engine/gamePlan';

interface VisionPanelProps {
  heroes: Hero[];
  synergyData: Record<string, any>;
  /** Draft format the advisor follows; tied to the calibrated region profile, not to the simulator mode. */
  advisorFormat?: DraftFormat;
  /** Draft format currently used by the simulator, only used to guard the apply-to-simulator flow. */
  simulatorFormat?: DraftFormat;
  onlyGlobalReleased?: boolean;
  fearlessLocks?: { blue: Set<number>; red: Set<number> };
  bluePlanAId?: number | null;
  bluePlanBId?: number | null;
  redPlanAId?: number | null;
  redPlanBId?: number | null;
  isUltimateBattle?: boolean;
  currentGamePosition?: DraftPosition | null;
  onApplyToSimulator?: (detectedPosition: DraftPosition) => VisionApplyResult;
  onSwitchToSimulator?: () => void;
  onInspectHero?: (hero: Hero) => void;
}

/** Result returned by the apply-to-simulator action so the panel can render confirmation or refusal feedback. */
export type VisionApplyResult =
  | { ok: true; appliedCount: number; newStep: number }
  | { ok: false; reason: string };

/** Refusal message shown when the simulator is not in the advisor's draft format. */
export function visionFormatMismatchReason(advisorFormat: DraftFormat): string {
  const label = advisorFormat === 'ranked' ? 'Ranked' : 'Turnamen';
  return `Simulator harus berada di mode ${label} untuk menerapkan papan live ini. Buka tab Simulator, lalu ubah dropdown "Format draft" ke "${label}".`;
}

/** Compare two positions: true when `current` arrays are a prefix of `detected`. */
export function positionIsPrefix(current: DraftPosition, detected: DraftPosition): boolean {
  if (current.step > detected.step) return false;
  for (const side of ['blue', 'red'] as Side[]) {
    for (const action of ['ban', 'pick'] as const) {
      const field = action === 'pick' ? 'picks' : 'bans';
      const curArr = current[field][side];
      const detArr = detected[field][side];
      if (curArr.length > detArr.length) return false;
      for (let i = 0; i < curArr.length; i += 1) {
        if (curArr[i] !== detArr[i]) return false;
      }
    }
  }
  return true;
}

/** Resolve a hero id to a Hero object. */
function findHero(heroes: Hero[], heroId: number | null): Hero | undefined {
  if (heroId === null) return undefined;
  return heroes.find(hero => hero.hero_id === heroId);
}

/** Format a confidence score as a percentage string. */
function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

const PHASE_LABELS: Record<VisionRecommendation['phase'], string> = {
  BAN1: 'Ban Fase 1',
  PICK1: 'Pick Fase 1',
  BAN2: 'Ban Fase 2',
  PICK2: 'Pick Fase 2',
  COMPLETE: 'Draft Selesai',
  UNKNOWN: 'Tidak Diketahui',
};

/** Indonesian copy for the active layout source. */
export function formatLayoutSourceMessage(source: LayoutStatus['source']): string {
  switch (source) {
    case 'manual':
      return 'Menggunakan tata letak manual';
    case 'none':
      return 'Layar ini bukan draft';
  }
}

/** Human-readable Indonesian warning for a confident side mismatch, or null. */
export function formatSideCheckWarning(check: SideCrossCheck): string | null {
  if (!check.mismatch) return null;
  if (check.detected === 'red') {
    return 'UI menunjukkan sisi merah, tetapi kamu memilih biru — periksa pilihan sisimu';
  }
  return 'UI menunjukkan sisi biru, tetapi kamu memilih merah — periksa pilihan sisimu';
}

/** Label shown on a preview overlay box (pick: "B3"; ban: compact "bR2"). */
export function getSlotOverlayLabel(slot: SlotRegion): string {
  const prefix = slot.side === 'blue' ? 'B' : 'R';
  let num = 0;
  if (slot.kind === 'pick') {
    num = slot.index < 5 ? slot.index + 1 : slot.index - 5 + 1;
  } else {
    num = slot.index < 13 ? slot.index - 10 + 1 : slot.index - 13 + 1;
  }
  return slot.kind === 'ban' ? `b${prefix}${num}` : `${prefix}${num}`;
}

/** True when a solved layout is too uncertain to trust without calibration. */
export function isLowConfidenceLayout(_confidence: number | null, _source: LayoutStatus['source']): boolean {
  return false;
}

export function hasNoContentNotes(notes: string[]): boolean {
  return notes.some(note => {
    const t = note.toLowerCase();
    return (
      (/\blayar\b/.test(t) && /(\bmati\b|\bhitam\b|\btidak aktif\b|\bkosong\b|\bblank\b|\boff\b)/.test(t)) ||
      /tidak ada konten|tidak ada gambar|layar yang dibagikan/.test(t)
    );
  });
}

/** Render plan for an overlay label: text, canvas font size, and where to draw it. */
export interface OverlayLabelPlan {
  /** Compact label text (e.g. "B3" or "bR2"). */
  text: string;
  /** Font size in canvas pixels, before CSS scaling. */
  fontSize: number;
  /** Where to place the label relative to the slot box. */
  placement: 'inside' | 'below' | 'omit';
}

/** Font metrics used to fit a label to a box without measuring the canvas. */
export interface OverlayLabelMetrics {
  /** Label width in canvas pixels when rendered at a 1 px font size. */
  widthPerPx: number;
}

/** Label sizing constants: fraction of the smaller box dimension, readable CSS bounds, and padding. */
const OVERLAY_FONT = {
  /** Label font size is 22% of the smaller box edge, so it grows with the slot. */
  boxFraction: 0.22,
  minCssPx: 9,
  maxCssPx: 24,
  horizontalPadding: 8,
  verticalPadding: 6,
  textPadding: 4,
} as const;

/**
 * Estimate width-per-pixel for a label using a bold sans-serif heuristic.
 * The ratio is intentionally conservative so labels stay inside their boxes.
 */
export function estimateOverlayMetrics(label: string): OverlayLabelMetrics {
  // Mixed alphanumeric labels (e.g. "bR2") measure roughly 0.58× the font size per character.
  return { widthPerPx: label.length * 0.58 };
}

/**
 * Choose the label text, font size, and placement for a slot overlay box.
 *
 * Font size rule:
 *   desiredCanvasPx = min(boxWidth, boxHeight) * 0.22
 * The result is clamped by the readable CSS bounds (9–24 px) converted to canvas
 * pixels via the CSS display scale, and by the box itself. If the label still
 * cannot fit, it is drawn below the box or omitted rather than overlapping art.
 */
export function planOverlayLabel(
  slot: SlotRegion,
  boxWidth: number,
  boxHeight: number,
  displayScale: number,
  metrics: OverlayLabelMetrics,
): OverlayLabelPlan {
  const text = getSlotOverlayLabel(slot);
  const scale = displayScale > 0 ? displayScale : 1;
  const { widthPerPx } = metrics;

  const boxMin = Math.min(boxWidth, boxHeight);
  const desiredCanvasPx = boxMin * OVERLAY_FONT.boxFraction;
  const minCanvasPx = OVERLAY_FONT.minCssPx / scale;
  const maxCanvasPx = OVERLAY_FONT.maxCssPx / scale;

  // Try to fit the label inside the box with padding.
  const maxInsideByWidth = (boxWidth - OVERLAY_FONT.horizontalPadding) / widthPerPx;
  const maxInsideByHeight = boxHeight - OVERLAY_FONT.verticalPadding;
  const maxInside = Math.min(maxInsideByWidth, maxInsideByHeight, maxCanvasPx);
  const insideSize = Math.max(minCanvasPx, Math.min(desiredCanvasPx, maxInside));

  if (insideSize <= maxInside && insideSize >= minCanvasPx) {
    return { text, fontSize: insideSize, placement: 'inside' };
  }

  // It will not fit inside; try drawing it just below the box.
  const maxBelowByWidth = boxWidth / widthPerPx;
  const maxBelow = Math.min(maxBelowByWidth, maxCanvasPx);
  const belowSize = Math.max(minCanvasPx, Math.min(desiredCanvasPx, maxBelow));

  if (belowSize <= maxBelow && belowSize >= minCanvasPx) {
    return { text, fontSize: belowSize, placement: 'below' };
  }

  return { text, fontSize: 0, placement: 'omit' };
}

/**
/** Props for the detected-board sub-component. */
interface VisionDetectedBoardProps {
  slotsByTeam: { blue: TeamSlots; red: TeamSlots };
  ownSide: VisionSide;
  advisorIsUltimateBattle: boolean;
  currentTurn?: { side: Side; action: 'ban' | 'pick'; stepIndex: number; isComplete: boolean };
  onInspectHero?: (hero: Hero) => void;
  onSlotClick?: (side: VisionSide, kind: VisionSlotKind, displayIndex: number) => void;
  onSlotDoubleClick?: (side: VisionSide, kind: VisionSlotKind, displayIndex: number) => void;
}

/** Render the mirrored detected draft board using the compact simulator layout while preserving committed/pre-selected/ban-estimate distinctions. */
export function VisionDetectedBoard({ slotsByTeam, ownSide, advisorIsUltimateBattle, currentTurn, onInspectHero, onSlotClick, onSlotDoubleClick }: VisionDetectedBoardProps) {
  const orderedSides: VisionSide[] = ownSide === 'red' ? ['red', 'blue'] : ['blue', 'red'];
  const teams = orderedSides.map(side => ({
    side,
    label: side === 'blue' ? 'Blue' : 'Red',
    data: side === 'blue' ? slotsByTeam.blue : slotsByTeam.red,
  }));
  const TurnIcon = currentTurn?.isComplete ? CheckCircle2 : currentTurn?.action === 'ban' ? ShieldBan : Swords;
  const turnLabel = currentTurn
    ? currentTurn.isComplete
      ? 'Draft selesai'
      : `${currentTurn.side === 'blue' ? 'Blue' : 'Red'} · ${currentTurn.action === 'ban' ? 'Ban hero' : 'Pick hero'}`
    : null;
  return (
    <div className="vision-detected-board">
      {currentTurn && turnLabel && (
        <div className="draft-turn" data-side={currentTurn.side} role="status" aria-live="polite">
          <span>
            <TurnIcon aria-hidden="true" />
            <strong>{turnLabel}</strong>
            {!currentTurn.isComplete && (
              <span className="muted-copy">{currentTurn.side === ownSide ? 'Giliran Anda' : 'Giliran Lawan'}</span>
            )}
          </span>
        </div>
      )}
      <div className="draft-teams vision-detected-teams">
        {teams.map(team => {
          const activeSide = Boolean(currentTurn && !currentTurn.isComplete && currentTurn.side === team.side);
          const nextEmptyBanIdx = team.data.bans.findIndex(s => s.empty && !s.abstained && !s.hero);
          const nextEmptyPickIdx = team.data.picks.findIndex(s => s.empty && !s.abstained && !s.hero);
          return (
            <section key={team.side} className="draft-team" data-side={team.side} aria-label={`Tim ${team.label}`}>
              <div className="draft-team__header">
                <div>
                  <h3>
                    <span className="team-dot" />
                    {team.label} · {team.side === ownSide ? 'Sisi Anda' : 'Lawan'}
                  </h3>
                  <p>{team.side === ownSide ? 'Tim Anda' : 'Tim Lawan'}</p>
                </div>
                {!advisorIsUltimateBattle && (
                  <div
                    className="ban-slots"
                    style={{ ['--ban-count' as string]: team.data.bans.length }}
                    aria-label={`Ban tim ${team.label}`}
                  >
                    {team.data.bans.map((slot, index) => {
                      const active = activeSide && currentTurn?.action === 'ban' && index === nextEmptyBanIdx;
                      return (
                        <button
                          key={index}
                          type="button"
                          className={`ban-slot${active ? ' is-active' : ''}${slot.abstained ? ' is-ban-unverified' : ''}${slot.hero ? ' is-estimated' : ''}`}
                          disabled={!slot.hero || (!onSlotClick && !onInspectHero)}
                          onClick={() => { if (slot.hero && onSlotClick) onSlotClick(team.side, 'ban', index); else if (slot.hero) onInspectHero?.(slot.hero); }}
                          onDoubleClick={() => { if (slot.hero && onSlotDoubleClick) onSlotDoubleClick(team.side, 'ban', index); }}
                          title={slot.hero ? `${slot.hero.name} (perkiraan, bisa salah)` : slot.abstained ? 'Terisi (identitas tidak terverifikasi)' : `Ban ${index + 1}${active ? ' (giliran saat ini)' : ''}`}
                          aria-label={slot.hero ? `Ban ${index + 1}: ${slot.hero.name} (perkiraan, bisa salah)` : slot.abstained ? `Ban ${index + 1}: terisi, identitas tidak terverifikasi` : `Ban ${index + 1}: kosong${active ? ', giliran saat ini' : ''}`}
                        >
                          {slot.hero ? (
                            <HeroThumbnail hero={slot.hero} />
                          ) : slot.abstained ? (
                            <HelpCircle aria-hidden="true" />
                          ) : (
                            <>
                              <ShieldBan aria-hidden="true" />
                              <span>{index + 1}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="team-picks" aria-label={`Pick tim ${team.label}`}>
                {team.data.picks.map((slot, index) => {
                  const slotCode = (team.side === 'blue' ? 'B' : 'R') + (index + 1);
                  const isCommitted = slot.locked === true;
                  const isPreselected = Boolean(slot.hero && !isCommitted);
                  const active = activeSide && currentTurn?.action === 'pick' && index === nextEmptyPickIdx;
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`pick-slot${slot.hero && isCommitted ? ' is-filled' : ''}${isPreselected ? ' is-preselected' : ''}${slot.abstained ? ' is-unrecognized' : ''}${active ? ' is-active' : ''}`}
                      disabled={!slot.hero || (!onSlotClick && !onInspectHero)}
                      onClick={() => { if (slot.hero && onSlotClick) onSlotClick(team.side, 'pick', index); else if (slot.hero) onInspectHero?.(slot.hero); }}
                      onDoubleClick={() => { if (slot.hero && onSlotDoubleClick) onSlotDoubleClick(team.side, 'pick', index); }}
                      title={slot.hero ? `${slot.hero.name}${isPreselected ? ' (pra-pilih, bisa berubah)' : ` (${slot.hero.primary_lane})`}` : active ? `${slotCode}: giliran pick saat ini` : undefined}
                      aria-label={slot.hero ? (isCommitted ? `Pick ${index + 1}: ${slot.hero.name}` : `Pick ${index + 1}: ${slot.hero.name} — pra-pilih, belum terkunci, masih bisa berubah`) : slot.abstained ? `Pick ${index + 1}: tidak dikenali` : `Pick ${index + 1}: kosong${active ? ', giliran saat ini' : ''}`}
                    >
                      <span className="pick-slot__portrait">
                        {slot.hero ? (
                          <HeroThumbnail hero={slot.hero} />
                        ) : slot.abstained ? (
                          <AlertTriangle aria-hidden="true" />
                        ) : active ? (
                          <ArrowDown className="pick-slot__next" aria-hidden="true" />
                        ) : (
                          <UserRound aria-hidden="true" />
                        )}
                      </span>
                      <span className="pick-slot__badges">
                        <span className="slot-code">{slotCode}</span>
                        {isPreselected ? (
                          <span className="slot-flex-tag vision-tag-preselect">Pilih Dulu</span>
                        ) : slot.hero ? (
                          <span className="slot-flex-tag vision-tag-score">{formatConfidence(slot.score)}</span>
                        ) : null}
                      </span>
                      <span className="pick-slot__info">
                        <strong>{slot.hero ? slot.hero.name : slot.abstained ? 'Tidak dikenali' : active ? 'Pilih hero' : 'Kosong'}</strong>
                        <small>
                          {slot.hero ? (
                            isPreselected ? 'bisa berubah' : slot.hero.primary_lane ? <LaneLabel lane={slot.hero.primary_lane} /> : 'Terkunci'
                          ) : slot.abstained ? (
                            'Tidak terbaca'
                          ) : active ? (
                            'Giliran kini'
                          ) : (
                            'Menunggu'
                          )}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Operator-facing surface for the Live Draft Advisor with preview overlay and verification affordances. */
export function VisionPanel({
  heroes,
  synergyData,
  advisorFormat = 'ranked',
  simulatorFormat,
  onlyGlobalReleased = true,
  fearlessLocks = { blue: new Set(), red: new Set() },
  bluePlanAId,
  bluePlanBId,
  redPlanAId,
  redPlanBId,
  isUltimateBattle = false,
  currentGamePosition,
  onApplyToSimulator,
  onSwitchToSimulator,
  onInspectHero,
}: VisionPanelProps) {
  const [status, setStatus] = useState<VisionPipelineStatus>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<VisionSide>('blue');
  const [lastObservation, setLastObservation] = useState<DraftObservation | null>(null);
  const [lastResult, setLastResult] = useState<ObserverResult | null>(null);
  const [recommendation, setRecommendation] = useState<VisionRecommendation | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<LayoutStatus | null>(null);
  const [sideCheck, setSideCheck] = useState<SideCrossCheck | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [interactionMode, setInteractionMode] = useState<'detect' | 'edit'>('detect');
  const [manualState, setManualState] = useState<{
    pickActions: Array<{ slotIndex: number; side: VisionSide; heroId: number; score: number; locked: boolean; at: number }>;
    preSelections: Array<{ slotIndex: number; side: VisionSide; heroId: number; score: number; at: number }>;
    banEstimates: Array<{ slotIndex: number; side: VisionSide; heroId: number; score: number; at: number }>;
    lastPickActionSlot: number | null;
  }>({ pickActions: [], preSelections: [], banEstimates: [], lastPickActionSlot: null });
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [manualConfig, setManualConfig] = useState<ManualLayoutConfig>(() =>
    loadManualLayoutConfig(advisorFormat === 'ranked' ? 3 : 5)
  );
  const PRESETS_KEY = 'hok_vision_manual_layout_presets_v1';
  const loadPresets = (): { name: string; config: ManualLayoutConfig }[] => {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((p: any) => p && typeof p.name === 'string' && p.config).map((p: any) => ({ name: p.name, config: sanitizeManualLayoutConfig(p.config) }));
    } catch {
      return [];
    }
  };
  const [presets, setPresets] = useState<{ name: string; config: ManualLayoutConfig }[]>(loadPresets);
  const [presetInput, setPresetInput] = useState('');
  const persistPresets = (next: { name: string; config: ManualLayoutConfig }[]) => {
    setPresets(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };
  const handleSavePreset = () => {
    const name = presetInput.trim() || `Preset ${presets.length + 1}`;
    const next = [...presets.filter(p => p.name !== name), { name, config: manualConfig }];
    persistPresets(next);
    setPresetInput('');
  };
  const handleLoadPreset = (name: string) => {
    const p = presets.find(x => x.name === name);
    if (p) setManualConfig(sanitizeManualLayoutConfig(p.config));
  };
  const handleDeletePreset = (name: string) => {
    persistPresets(presets.filter(p => p.name !== name));
  };
  const dragOccurredRef = useRef(false);
  const dragRef = useRef<{
    target: 'pick-top-left' | 'pick-bottom-left' | 'pick-top-right' | 'ban-first-left' | 'ban-last-left' | 'ban-first-right' | 'resize-pick' | 'resize-ban';
    startX: number;
    startY: number;
    startConfig: ManualLayoutConfig;
  } | null>(null);
  const dragLiveConfigRef = useRef<ManualLayoutConfig | null>(null);
  const baseFrameRef = useRef<{ rgba: Uint8ClampedArray; width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingConfigRef = useRef<ManualLayoutConfig | null>(null);
  const [applyFeedback, setApplyFeedback] = useState<
    | { type: 'success'; appliedCount: number; newStep: number; detectedStep: number }
    | { type: 'error'; reason: string }
    | null
  >(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  // Ultimate Battle is a simulator-only (tournament) mode; the ranked advisor must never interpret its 10-step sequence.
  const advisorIsUltimateBattle = advisorFormat !== 'ranked' && isUltimateBattle;

  const callbacksRef = useRef({
    onStatus: setStatus,
    onReferenceProgress: (done: number, total: number) => setProgress({ done, total }),
    onObservation: (observation: DraftObservation, result: ObserverResult) => {
      setLastObservation(observation);
      setLastResult(result);
    },
    onRecommendation: setRecommendation,
    onError: (message: string) => setError(message),
    onPermission: (granted: boolean) => setPermissionGranted(granted),
    onLayout: setLayoutStatus,
    onSideCheck: setSideCheck,
  });

  useEffect(() => {
    callbacksRef.current = {
      onStatus: setStatus,
      onReferenceProgress: (done, total) => setProgress({ done, total }),
      onObservation: (observation, result) => {
        setLastObservation(observation);
        setLastResult(result);
      },
      onRecommendation: setRecommendation,
      onError: (message) => setError(message),
      onPermission: (granted) => setPermissionGranted(granted),
      onLayout: setLayoutStatus,
      onSideCheck: setSideCheck,
    };
  });

  const pipelineRef = useRef<VisionPipeline | null>(null);

  useEffect(() => {
    const pipeline = new VisionPipeline(
      {
        heroes,
        side,
        format: advisorFormat,
        onlyGlobal: onlyGlobalReleased,
        fearless: { blue: [...fearlessLocks.blue], red: [...fearlessLocks.red] },
        planAId: side === 'blue' ? bluePlanAId : redPlanAId,
        planBId: side === 'blue' ? bluePlanBId : redPlanBId,
        isUltimateBattle: advisorIsUltimateBattle,
        synergyDb: synergyData,
        manualLayout: manualConfig,
      },
      {
        onStatus: s => callbacksRef.current.onStatus(s),
        onReferenceProgress: (done, total) => callbacksRef.current.onReferenceProgress(done, total),
        onObservation: (observation, result) => callbacksRef.current.onObservation(observation, result),
        onRecommendation: rec => callbacksRef.current.onRecommendation(rec),
        onError: message => callbacksRef.current.onError(message),
        onPermission: granted => callbacksRef.current.onPermission(granted),
        onLayout: layout => callbacksRef.current.onLayout(layout),
        onSideCheck: check => callbacksRef.current.onSideCheck(check),
      }
    );
    pipelineRef.current = pipeline;
    setManualState(pipeline.getManualState());
    return () => {
      pipeline.stop();
      pipelineRef.current = null;
    };
  }, []);

  useEffect(() => { pipelineRef.current?.setHeroes(heroes); }, [heroes]);
  useEffect(() => { pipelineRef.current?.setSide(side); }, [side]);
  useEffect(() => { pipelineRef.current?.setFormat(advisorFormat); }, [advisorFormat]);
  useEffect(() => { pipelineRef.current?.setOnlyGlobal(onlyGlobalReleased); }, [onlyGlobalReleased]);
  useEffect(() => { pipelineRef.current?.setFearless({ blue: [...fearlessLocks.blue], red: [...fearlessLocks.red] }); }, [fearlessLocks.blue, fearlessLocks.red]);
  useEffect(() => { pipelineRef.current?.setPlanA(side === 'blue' ? (bluePlanAId ?? null) : (redPlanAId ?? null)); }, [side, bluePlanAId, redPlanAId]);
  useEffect(() => { pipelineRef.current?.setPlanB(side === 'blue' ? (bluePlanBId ?? null) : (redPlanBId ?? null)); }, [side, bluePlanBId, redPlanBId]);
  useEffect(() => { pipelineRef.current?.setUltimateBattle(advisorIsUltimateBattle); }, [advisorIsUltimateBattle]);
  // The advisor is MANUAL-ONLY: the operator positions the grid on the shared
  // frame and that grid is the only geometry source — no content-rect or
  // solver auto-detection runs in production.
  useEffect(() => {
    saveManualLayoutConfig(manualConfig);
    const timer = setTimeout(() => {
      pipelineRef.current?.setManualLayout(manualConfig);
    }, 80);
    return () => clearTimeout(timer);
  }, [manualConfig]);

  const handleStart = useCallback(async () => {
    setError(null);
    setPermissionGranted(null);
    setShowOverlay(true);
    await pipelineRef.current?.start();
  }, []);

  const handleStop = useCallback(() => {
    pipelineRef.current?.stop();
  }, []);

  const isSupported = VisionPipeline.isSupported();

  const applyState = useMemo(() => {
    if (simulatorFormat !== undefined && simulatorFormat !== advisorFormat) {
      return { disabled: true, reason: visionFormatMismatchReason(advisorFormat) };
    }
    if (!lastResult || !currentGamePosition) {
      return { disabled: true, reason: 'Belum ada papan terdeteksi.' };
    }
    if (lastResult.truncated) {
      return { disabled: true, reason: 'Papan terdeteksi tidak lengkap. Periksa slot yang tidak dikenali.' };
    }
    if (lastResult.step === 0) {
      return { disabled: true, reason: 'Belum ada aksi yang terdeteksi.' };
    }
    if (currentGamePosition.step > lastResult.step) {
      return { disabled: true, reason: 'Simulator sudah melewati posisi terdeteksi. Reset simulator terlebih dahulu.' };
    }
    if (currentGamePosition.step === lastResult.step && positionIsPrefix(currentGamePosition, lastResult.position)) {
      return { disabled: true, reason: 'Sudah sinkron dengan simulator.' };
    }
    if (!positionIsPrefix(currentGamePosition, lastResult.position)) {
      return { disabled: true, reason: 'Posisi simulator berbeda dengan layar. Reset simulator untuk menimpa.' };
    }
    return { disabled: false, reason: undefined };
  }, [lastResult, currentGamePosition, simulatorFormat, advisorFormat]);

  const handleApply = useCallback(() => {
    if (applyState.disabled || !lastResult) {
      if (applyState.reason) {
        setApplyFeedback({ type: 'error', reason: applyState.reason });
      }
      return;
    }
    const result = onApplyToSimulator?.(lastResult.position);
    if (!result) {
      setApplyFeedback({ type: 'error', reason: 'Gagal menerapkan ke simulator.' });
      return;
    }
    if (result.ok) {
      setApplyFeedback({
        type: 'success',
        appliedCount: result.appliedCount,
        newStep: result.newStep,
        detectedStep: lastResult.step,
      });
    } else {
      setApplyFeedback({ type: 'error', reason: result.reason });
    }
  }, [applyState, lastResult, onApplyToSimulator]);

  // Clear a stale success confirmation when the live board advances past what was applied.
  useEffect(() => {
    if (applyFeedback?.type === 'success' && lastResult && lastResult.step > applyFeedback.detectedStep) {
      setApplyFeedback(null);
    }
  }, [lastResult?.step, applyFeedback]);

  // Re-measure label font sizes when the preview container is resized, because
  // the canvas is CSS-scaled and the drawn size must compensate.
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setOverlayRevision(r => r + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw the captured frame and slot overlay onto the preview canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const frame = pipeline.getLastFrame();
    if (!frame) return;

    if (dragRef.current) return;

    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = new ImageData(frame.width, frame.height);
    imageData.data.set(frame.rgba);
    ctx.putImageData(imageData, 0, 0);
    baseFrameRef.current = { rgba: new Uint8ClampedArray(frame.rgba), width: frame.width, height: frame.height };

    if (showOverlay) {
      const manualSurfaceSlots = resolveSlotSides(buildManualRegionProfile(manualConfig, frame.width, frame.height), side).map(slot => ({
        index: slot.index,
        side: slot.side,
        kind: slot.kind,
        rect: slot.rect,
      }));
      if (manualSurfaceSlots.length > 0) {
        // The manual grid is built directly in the shared surface coordinate
        // space, so the rects are drawn as-is.
        for (const slot of manualSurfaceSlots) {
          drawSlotOverlay(ctx, slot.rect, slot, 'manual');
        }
        if (interactionMode === 'detect') {
          ctx.save();
          const turn = lastResult ? getDraftTurn(lastResult.step, advisorFormat, advisorIsUltimateBattle) : undefined;
          const expectedSide = turn?.side;
          const expectedKind = turn?.action === 'ban' ? 'ban' : 'pick';
          for (const slot of manualSurfaceSlots) {
            if (slot.side !== expectedSide || slot.kind !== expectedKind) continue;
            const filled = slot.kind === 'pick'
              ? (manualState.pickActions.some(a => a.slotIndex === slot.index) || manualState.preSelections.some(p => p.slotIndex === slot.index))
              : manualState.banEstimates.some(b => b.slotIndex === slot.index);
            if (filled) continue;
            ctx.strokeStyle = slot.side === 'blue' ? '#60a5fa' : '#f87171';
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(slot.rect.x - 1, slot.rect.y - 1, slot.rect.w + 2, slot.rect.h + 2);
          }
          if (manualState.lastPickActionSlot !== null) {
            const slot = manualSurfaceSlots.find(s => s.index === manualState.lastPickActionSlot);
            if (slot) {
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.setLineDash([6, 4]);
              ctx.strokeRect(slot.rect.x - 1, slot.rect.y - 1, slot.rect.w + 2, slot.rect.h + 2);
            }
          }
          for (const pre of manualState.preSelections) {
            const slot = manualSurfaceSlots.find(s => s.index === pre.slotIndex);
            if (slot) {
              ctx.strokeStyle = 'rgba(255,255,255,0.5)';
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.strokeRect(slot.rect.x - 1, slot.rect.y - 1, slot.rect.w + 2, slot.rect.h + 2);
            }
          }
          ctx.restore();
        }
        if (interactionMode === 'edit') {
          const anchorSlots = [
            { slot: manualSurfaceSlots.find(s => s.kind === 'pick' && s.index === 0), label: 'Geser P1' },
            { slot: manualSurfaceSlots.find(s => s.kind === 'pick' && s.index === 5), label: 'Geser Pusat Pick Kanan' },
            { slot: manualSurfaceSlots.find(s => s.kind === 'pick' && s.index === 4), label: 'Geser Y P5' },
            { slot: manualSurfaceSlots.find(s => s.kind === 'ban' && s.index === 10), label: 'Ban 1' },
            { slot: manualSurfaceSlots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide - 1), label: 'Jarak Ban' },
            { slot: manualSurfaceSlots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide), label: 'Geser Pusat Ban Kanan' },
          ];
          ctx.save();
          for (const item of anchorSlots) {
            if (!item.slot) continue;
            const { x, y, w, h } = item.slot.rect;
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h / 2, Math.max(6, Math.min(9, w * 0.12)), 0, Math.PI * 2);
            ctx.fill();
          }
          // Resize handles (bottom-right corner of representative slots).
          for (const s of [manualSurfaceSlots.find(s => s.kind === 'pick' && s.index === 0), manualSurfaceSlots.find(s => s.kind === 'ban' && s.index === 10)]) {
            if (!s) continue;
            const { x, y, w, h } = s.rect;
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(x + w - 8, y + h - 8, 8, 8);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + w - 8, y + h - 8, 8, 8);
          }
          ctx.restore();
        }
      }
    }
  }, [lastObservation, layoutStatus, showOverlay, side, overlayRevision, manualConfig, interactionMode, manualState, lastResult, advisorFormat, advisorIsUltimateBattle]);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    if (interactionMode !== 'edit') return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const slots = buildManualRegionProfile(manualConfig, canvas.width, canvas.height).slots;
    const hit = (s: { rect: Rect } | undefined, pad = 20) =>
      s && px >= s.rect.x - pad && px <= s.rect.x + s.rect.w + pad && py >= s.rect.y - pad && py <= s.rect.y + s.rect.h + pad;

    const p1 = slots.find(s => s.kind === 'pick' && s.index === 0);
    const p1Right = slots.find(s => s.kind === 'pick' && s.index === 5);
    const p5 = slots.find(s => s.kind === 'pick' && s.index === 4);
    const b1 = slots.find(s => s.kind === 'ban' && s.index === 10);
    const bLast = slots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide - 1);
    const b1Right = slots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide);

    let target: NonNullable<typeof dragRef.current>['target'] | null = null;
    // Resize handles: bottom-right corner of a representative slot.
    const cornerHit = (s: { rect: Rect } | undefined, pad = 14) =>
      !!s && px >= s.rect.x + s.rect.w - pad && px <= s.rect.x + s.rect.w + pad && py >= s.rect.y + s.rect.h - pad && py <= s.rect.y + s.rect.h + pad;
    if (cornerHit(p1)) target = 'resize-pick';
    else if (cornerHit(b1)) target = 'resize-ban';
    else if (hit(p1)) target = 'pick-top-left';
    else if (hit(p1Right)) target = 'pick-top-right';
    else if (hit(p5)) target = 'pick-bottom-left';
    else if (hit(b1)) target = 'ban-first-left';
    else if (hit(bLast)) target = 'ban-last-left';
    else if (hit(b1Right)) target = 'ban-first-right';
    if (!target) return;

    canvas.setPointerCapture(e.pointerId);
    dragRef.current = {
      target,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      startConfig: manualConfig,
    };
    dragLiveConfigRef.current = manualConfig;
  }, [manualConfig]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (interactionMode === 'detect') {
      const slots = buildManualRegionProfile(manualConfig, canvas.width, canvas.height).slots;
      const slot = slots.find(s => px >= s.rect.x && px <= s.rect.x + s.rect.w && py >= s.rect.y && py <= s.rect.y + s.rect.h) ?? null;
      setHoveredSlotIndex(slot ? slot.index : null);
      return;
    }

    if (drag) {
      const dx = (e.clientX - rect.left) / rect.width - drag.startX;
      const dy = (e.clientY - rect.top) / rect.height - drag.startY;
      const st = drag.startConfig;
      let next: ManualLayoutConfig;
      if (drag.target === 'pick-top-left') {
        next = sanitizeManualLayoutConfig({ ...st, pick: { ...st.pick, leftX: st.pick.leftX + dx, topY: st.pick.topY + dy } });
      } else if (drag.target === 'pick-bottom-left') {
        next = sanitizeManualLayoutConfig({ ...st, pick: { ...st.pick, bottomY: st.pick.bottomY + dy } });
      } else if (drag.target === 'pick-top-right') {
        const prevCenter = st.pick.centerX ?? st.centerX ?? 0.5;
        next = sanitizeManualLayoutConfig({ ...st, pick: { ...st.pick, centerX: prevCenter + dx / 2 } });
      } else if (drag.target === 'ban-first-right') {
        const prevCenter = st.ban.centerX ?? st.centerX ?? 0.5;
        next = sanitizeManualLayoutConfig({ ...st, ban: { ...st.ban, centerX: prevCenter + dx / 2 } });
      } else if (drag.target === 'ban-first-left') {
        next = sanitizeManualLayoutConfig({ ...st, ban: { ...st.ban, leftX: st.ban.leftX + dx, y: st.ban.y + dy } });
      } else if (drag.target === 'resize-pick') {
        next = sanitizeManualLayoutConfig({ ...st, pick: { ...st.pick, size: Math.max(0.04, Math.min(0.22, st.pick.size + dy)) } });
      } else if (drag.target === 'resize-ban') {
        next = sanitizeManualLayoutConfig({ ...st, ban: { ...st.ban, size: Math.max(0.02, Math.min(0.14, st.ban.size + dy)) } });
      } else {
        const steps = Math.max(1, st.ban.countPerSide - 1);
        next = sanitizeManualLayoutConfig({ ...st, ban: { ...st.ban, stepX: st.ban.stepX + dx / steps } });
      }
      pendingConfigRef.current = next;
      dragLiveConfigRef.current = next;
      // Draw overlay directly without React re-render.
      const canvasEl = canvasRef.current;
      if (canvasEl && baseFrameRef.current) {
        const ctx = canvasEl.getContext('2d');
        if (ctx) {
          const bf = baseFrameRef.current;
          const id = new ImageData(bf.width, bf.height);
          id.data.set(bf.rgba);
          ctx.putImageData(id, 0, 0);
          if (showOverlay) {
            const slots = resolveSlotSides(buildManualRegionProfile(next, bf.width, bf.height), side);
            for (const slot of slots) {
              drawSlotOverlay(ctx, slot.rect, slot, 'manual');
            }
            // resize handles
            const p1s = slots.find(s => s.kind === 'pick' && s.index === 0);
            const b1s = slots.find(s => s.kind === 'ban' && s.index === 10);
            for (const s of [p1s, b1s]) {
              if (!s) continue;
              ctx.fillStyle = '#22c55e';
              ctx.fillRect(s.rect.x + s.rect.w - 8, s.rect.y + s.rect.h - 8, 8, 8);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1;
              ctx.strokeRect(s.rect.x + s.rect.w - 8, s.rect.y + s.rect.h - 8, 8, 8);
            }
          }
        }
      }
      return;
    }
    // Hover detection when not dragging.
    const slots = buildManualRegionProfile(manualConfig, canvas.width, canvas.height).slots;
    const hit = (s: { rect: Rect } | undefined, pad = 14) =>
      !!s && px >= s.rect.x - pad && px <= s.rect.x + s.rect.w + pad && py >= s.rect.y - pad && py <= s.rect.y + s.rect.h + pad;
    const p1 = slots.find(s => s.kind === 'pick' && s.index === 0);
    const p1Right = slots.find(s => s.kind === 'pick' && s.index === 5);
    const p5 = slots.find(s => s.kind === 'pick' && s.index === 4);
    const b1 = slots.find(s => s.kind === 'ban' && s.index === 10);
    const bLast = slots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide - 1);
    const b1Right = slots.find(s => s.kind === 'ban' && s.index === 10 + manualConfig.ban.countPerSide);
    let target: string | null = null;
    const cornerHit = (s: { rect: Rect } | undefined, pad = 14) =>
      !!s && px >= s.rect.x + s.rect.w - pad && px <= s.rect.x + s.rect.w + pad && py >= s.rect.y + s.rect.h - pad && py <= s.rect.y + s.rect.h + pad;
    if (cornerHit(p1)) target = 'resize-pick';
    else if (cornerHit(b1)) target = 'resize-ban';
    else if (hit(p1)) target = 'pick-top-left';
    else if (hit(p1Right)) target = 'pick-top-right';
    else if (hit(p5)) target = 'pick-bottom-left';
    else if (hit(b1)) target = 'ban-first-left';
    else if (hit(bLast)) target = 'ban-last-left';
    else if (hit(b1Right)) target = 'ban-first-right';
    setHoveredTarget(target);
  }, [manualConfig, interactionMode]);

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragOccurredRef.current = true;
      setTimeout(() => { dragOccurredRef.current = false; }, 0);
      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId);
      }
      const cfg = dragLiveConfigRef.current;
      if (cfg) setManualConfig(cfg);
      dragRef.current = null;
      dragLiveConfigRef.current = null;
    }
    setHoveredTarget(null);
  }, []);

  const findManualSlotAt = useCallback((px: number, py: number) => {
    const slots = buildManualRegionProfile(manualConfig, canvasRef.current?.width ?? 0, canvasRef.current?.height ?? 0).slots;
    return slots.find(slot => px >= slot.rect.x && px <= slot.rect.x + slot.rect.w && py >= slot.rect.y && py <= slot.rect.y + slot.rect.h) ?? null;
  }, [manualConfig]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (interactionMode !== 'detect') return;
    if (dragOccurredRef.current) return;
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;
    if (e.detail !== 1) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const slot = findManualSlotAt(px, py);
    if (!slot) return;
    if (!pipeline.isSlotFilled(slot.index)) return;
    void (async () => {
      await pipeline.clickSlot(slot.index);
      setManualState(pipeline.getManualState());
    })();
  }, [findManualSlotAt, interactionMode]);

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (interactionMode !== 'detect') return;
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const slot = findManualSlotAt(px, py);
    if (!slot) return;
    const ownPickEmpty = slot.kind === 'pick' && slot.side === side && !pipeline.isSlotFilled(slot.index);
    if (!pipeline.isSlotFilled(slot.index) && !ownPickEmpty) return;
    setPickerSlot(slot.index);
    setPickerOpen(true);
  }, [findManualSlotAt, interactionMode, side]);

  const handleBoardSlotClick = useCallback((slotSide: VisionSide, kind: VisionSlotKind, displayIndex: number, double = false) => {
    if (interactionMode !== 'detect') return;
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const banCount = manualConfig.ban.countPerSide;
    const slotIndex = kind === 'pick'
      ? (slotSide === 'red' ? displayIndex : 5 + displayIndex)
      : (slotSide === 'red' ? 10 + displayIndex : 10 + banCount + displayIndex);
    const ownPickEmpty = kind === 'pick' && slotSide === side && !pipeline.isSlotFilled(slotIndex);
    if (!pipeline.isSlotFilled(slotIndex) && !ownPickEmpty) return;
    if (double) {
      if (ownPickEmpty || pipeline.isSlotFilled(slotIndex)) {
        setPickerSlot(slotIndex);
        setPickerOpen(true);
      }
      return;
    }
    void (async () => {
      await pipeline.clickSlot(slotIndex);
      setManualState(pipeline.getManualState());
    })();
  }, [manualConfig]);

  const handlePickerSelect = useCallback((heroId: number) => {
    const pipeline = pipelineRef.current;
    if (!pipeline || pickerSlot === null) return;
    pipeline.updateSlotFromModal(pickerSlot, heroId);
    setManualState(pipeline.getManualState());
    setPickerOpen(false);
    setPickerSlot(null);
  }, [pickerSlot]);

  const detectedSlotsByTeam = useMemo(
    () => mapObservationToTeamSlots(lastObservation, heroes, advisorFormat, manualConfig.ban.countPerSide),
    [lastObservation, heroes, advisorFormat, manualConfig.ban.countPerSide]
  );

  const currentTurn = useMemo(
    () => (lastResult ? getDraftTurn(lastResult.step, advisorFormat, advisorIsUltimateBattle) : undefined),
    [lastResult, advisorFormat, advisorIsUltimateBattle]
  );

  const sideOptions: { value: VisionSide; label: string }[] = [
    { value: 'blue', label: 'Blue' },
    { value: 'red', label: 'Red' },
  ];

  const renderBoard = () => (
    <VisionDetectedBoard
      slotsByTeam={detectedSlotsByTeam}
      ownSide={side}
      advisorIsUltimateBattle={advisorIsUltimateBattle}
      currentTurn={currentTurn}
      onInspectHero={onInspectHero}
        onSlotClick={(s, k, i) => handleBoardSlotClick(s, k, i, false)}
        onSlotDoubleClick={(s, k, i) => handleBoardSlotClick(s, k, i, true)}
    />
  );

  const renderRecommendation = () => {
    if (!recommendation) return null;
    if (currentTurn?.isComplete) return null;
    if (!recommendation.isUserTurn) {
      return (
        <div className="vision-recommendation vision-recommendation--waiting">
          <Info aria-hidden="true" />
          <div>
            <strong>Giliran {recommendation.actingSide === 'blue' ? 'Blue' : 'Red'}</strong>
            <p>Rekomendasi pick muncul saat giliran Anda.</p>
          </div>
        </div>
      );
    }
    if (!recommendation.isPickPhase) {
      return (
        <div className="vision-recommendation vision-recommendation--waiting">
          <Shield aria-hidden="true" />
          <div>
            <strong>Fase {PHASE_LABELS[recommendation.phase]}</strong>
            <p>Saat ini adalah fase ban. Rekomendasi pick akan muncul di giliran pick Anda.</p>
          </div>
        </div>
      );
    }
    if (recommendation.heroSuggestions.length === 0) {
      return (
        <div className="vision-recommendation vision-recommendation--waiting">
          <Info aria-hidden="true" />
          <div>
            <strong>Belum ada rekomendasi</strong>
            <p>Posisi atau filter saat ini menghasilkan daftar rekomendasi kosong.</p>
          </div>
        </div>
      );
    }
    if (recommendation.recommendations && recommendation.recommendations.length > 0 && recommendation.tacticalScores) {
      return (
        <TacticalRadarPanel
          scores={recommendation.tacticalScores}
          phaseStrategy={recommendation.phaseStrategy}
          recommendations={recommendation.recommendations}
          duetPackages={recommendation.duetPackages}
          onInspectHero={onInspectHero}
          activeSide={side}
          isPickPhase={true}
        />
      );
    }
    const top = recommendation.heroSuggestions[0];
    return (
      <div className="vision-recommendation">
        <div className="vision-recommendation__header">
          <span className="section-heading__icon"><Swords aria-hidden="true" /></span>
          <div>
            <h4>Rekomendasi Pick</h4>
            <p>{PHASE_LABELS[recommendation.phase]} · Langkah {recommendation.step + 1}</p>
          </div>
        </div>
        <div className="vision-recommendation__primary">
          {top && <HeroThumbnail hero={top} />}
          <div>
            <strong>{top?.name}</strong>
            <span>{top?.primary_role} · {top?.primary_lane}</span>
          </div>
        </div>
        {recommendation.heroSuggestions.length > 1 && (
          <div className="vision-recommendation__alternatives">
            {recommendation.heroSuggestions.slice(1, 4).map((hero, index) => (
              <button key={hero.hero_id} type="button" className="vision-rec-alt" onClick={() => onInspectHero?.(hero)}>
                <HeroThumbnail hero={hero} />
                <span>#{index + 2} {hero.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };


  const sideWarning = sideCheck ? formatSideCheckWarning(sideCheck) : null;
  const showPreview = status === 'running' || status === 'not-calibrated';

  return (
    <section className="vision-panel surface-panel" aria-label="Live draft advisor">
      <div className="vision-panel__header">
        <div className="section-heading">
          <span className="section-heading__icon"><Monitor aria-hidden="true" /></span>
          <div>
            <h2>Live Draft Advisor</h2>
            <p>Advisor mengikuti format layar live (Ranked: blind ban 3–5 + 10 pick) dan terpisah dari mode simulator. Simulator tidak diubah otomatis.</p>
          </div>
        </div>
        <div className="vision-panel__controls">
          <div className="vision-side-toggle" role="radiogroup" aria-label="Sisi tim Anda">
            {sideOptions.map(option => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={side === option.value}
                aria-label={`Sisi ${option.label}`}
                className={side === option.value ? 'is-selected' : ''}
                onClick={() => setSide(option.value)}
              >
                {side === option.value ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                {option.label}
              </button>
            ))}
          </div>
          {showPreview && (
            <button
              type="button"
              className={`ui-button ui-button--quiet ${settingsOpen ? 'is-selected' : ''}`}
              onClick={() => setSettingsOpen(v => !v)}
              aria-pressed={settingsOpen}
            >
              <SlidersHorizontal aria-hidden="true" />Pengaturan
            </button>
          )}
          {status === 'running' || status === 'not-calibrated' ? (
            <button type="button" className="ui-button ui-button--quiet" onClick={handleStop}>
              <XCircle aria-hidden="true" />Berhenti
            </button>
          ) : (
            <button type="button" className="ui-button ui-button--primary" onClick={() => void handleStart()} disabled={!isSupported || status === 'requesting-permission'}>
              {status === 'requesting-permission' ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Scan aria-hidden="true" />}
              {status === 'requesting-permission' ? 'Meminta izin…' : 'Mulai Pantau Layar'}
            </button>
          )}
        </div>
      </div>

      <div className="vision-notice" role="note">
        <Info aria-hidden="true" />
        <span>Fitur ini hanya MEMBACA layar. Tidak mengirim input ke game HoK.</span>
      </div>

      {sideWarning && (
        <div className="vision-side-warning" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>{sideWarning}</span>
        </div>
      )}

      {status === 'idle' && permissionGranted !== true && (
        <div className="vision-empty">
          {!isSupported ? (
            <>
              <AlertTriangle aria-hidden="true" />
              <h3>Browser tidak mendukung tangkapan layar</h3>
              <p>Gunakan HTTPS atau localhost, dan pastikan browser mendukung getDisplayMedia.</p>
            </>
          ) : (
            <>
              <Scan aria-hidden="true" />
              <h3>Mulai pantau layar Ban&amp;Pick</h3>
              <p>Pilih tab/jendela HoK saat browser meminta. Advisor akan mengenali hero di setiap slot dan menampilkan rekomendasi.</p>
            </>
          )}
        </div>
      )}

      {status === 'requesting-permission' && (
        <div className="vision-state vision-state--pending">
          <LoaderCircle className="is-spinning" aria-hidden="true" />
          <div>
            <strong>Menunggu izin berbagi layar</strong>
            <p>Pilih tab atau jendela game di dialog browser.</p>
          </div>
        </div>
      )}

      {status === 'loading-references' && (
        <div className="vision-state vision-state--pending">
          <LoaderCircle className="is-spinning" aria-hidden="true" />
          <div className="vision-progress">
            <strong>Memuat referensi hero…</strong>
            <div className="vision-progress__bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <div style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p>{progress.done}/{progress.total} portrait</p>
          </div>
        </div>
      )}

      {status === 'not-calibrated' && (
        <div className="vision-state vision-state--info">
          <Info aria-hidden="true" />
          <div>
            <strong>Resolusi layar belum dikalibrasi</strong>
            <p>Tata letak slot untuk resolusi ini belum tersedia. Advisor aktif, tapi belum bisa mengenali hero sampai kalibrasi ditambahkan.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="vision-state vision-state--error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Tangkapan layar terhenti</strong>
            <p>{error === 'Permission denied' || error.toLowerCase().includes('permission')
              ? 'Izin berbagi layar ditolak. Klik Mulai Pantau Layar dan pilih tab/jendela game.'
              : error}</p>
          </div>
          <button type="button" className="ui-button ui-button--quiet" onClick={() => void handleStart()}>
            <RefreshCw aria-hidden="true" />Coba lagi
          </button>
        </div>
      )}

      {showPreview && (
        <>
          <div className="vision-status-bar">
            <span className="vision-status-bar__pulse" aria-hidden="true" />
            <span>{status === 'running' ? 'Mengamati layar…' : 'Menunggu kalibrasi resolusi…'}</span>
            {lastResult && (
              <span className="vision-status-bar__phase">
                {PHASE_LABELS[lastResult.phase]} · {lastResult.step}/{getDraftSequence(advisorFormat, advisorIsUltimateBattle).length} aksi
                {lastResult.truncated && <span className="vision-truncated"><AlertTriangle aria-hidden="true" />Tidak lengkap</span>}
              </span>
            )}
          </div>

          <div className={`vision-workspace${settingsOpen ? ' has-settings' : ''}`}>
            <div className="vision-preview" ref={previewContainerRef}>
              <div className="vision-preview__header">
                <span className="vision-preview__title"><Scan aria-hidden="true" />Pratinjau layar &amp; overlay slot</span>
                <div className="vision-preview__header-actions">
                  <select
                    aria-label="Pilih preset layout"
                    value=""
                    onChange={(e) => { if (e.target.value) handleLoadPreset(e.target.value); }}
                    className="vision-settings__input"
                  >
                    <option value="">Preset…</option>
                    {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                  <div className="vision-mode-toggle" role="tablist" aria-label="Mode interaksi">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={interactionMode === 'detect'}
                      className={interactionMode === 'detect' ? 'is-selected' : ''}
                      onClick={() => setInteractionMode('detect')}
                    >
                      Deteksi Slot
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={interactionMode === 'edit'}
                      className={interactionMode === 'edit' ? 'is-selected' : ''}
                      onClick={() => setInteractionMode('edit')}
                    >
                      Edit Kotak
                    </button>
                  </div>
                  <label className="vision-preview__toggle">
                    <input
                      type="checkbox"
                      checked={showOverlay}
                      onChange={(e) => setShowOverlay(e.target.checked)}
                      aria-label="Tampilkan overlay slot"
                    />
                    <span>{showOverlay ? 'Overlay aktif' : 'Overlay nonaktif'}</span>
                  </label>
                </div>
              </div>
              <div className="vision-preview__canvas-wrap">
                <canvas
                  ref={canvasRef}
                  className="vision-preview__canvas"
                  style={{ cursor: interactionMode === 'detect' ? (hoveredSlotIndex !== null ? 'pointer' : 'default') : (dragRef.current ? (dragRef.current.target.startsWith('resize') ? 'nwse-resize' : 'grabbing') : (hoveredTarget?.startsWith('resize') ? 'nwse-resize' : hoveredTarget ? 'grab' : 'default')), touchAction: 'none' }}
                  onClick={handleCanvasClick}
                   onDoubleClick={handleCanvasDoubleClick}
                   onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  onPointerCancel={handleCanvasPointerUp}
                  onPointerLeave={() => { setHoveredTarget(null); setHoveredSlotIndex(null); }}
                  aria-label="Pratinjau layar dengan overlay slot draft"
                />
              </div>
              <p className="vision-preview__hint">
                Seret titik kuning pada slot untuk menggeser atau ubah ukuran grid. Semua kotak 1:1 dan dicerminkan kiri-kanan.
              </p>
            </div>

            {settingsOpen && (
              <aside className="vision-settings-panel" aria-label="Pengaturan slot">
                <div className="vision-settings__head">
                  <h3><SlidersHorizontal aria-hidden="true" />Pengaturan Slot</h3>
                  <button
                    type="button"
                    className={`ui-button ui-button--small ui-button--quiet ${interactionMode === 'edit' ? 'is-selected' : ''}`}
                    onClick={() => setInteractionMode(mode => mode === 'edit' ? 'detect' : 'edit')}
                  >
                    {interactionMode === 'edit' ? 'Selesai Edit' : 'Edit Kotak'}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--small ui-button--quiet"
                    onClick={() => setManualConfig(defaultManualLayoutConfig(advisorFormat === 'ranked' ? 3 : 5))}
                  >
                    Reset Posisi
                  </button>
                </div>

                <div className="vision-settings__row">
                  <span className="vision-settings__label">Ban per tim</span>
                  <div className="vision-settings__pills">
                    {([3, 4, 5] as const).map(count => (
                      <button
                        key={count}
                        type="button"
                        className={`ui-button ui-button--small ui-button--quiet ${manualConfig.ban.countPerSide === count ? 'is-selected' : ''}`}
                        onClick={() => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, mirrorX: true, countPerSide: count },
                        }))}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vision-settings__presets">
                  <select
                    aria-label="Pilih preset layout"
                    value=""
                    onChange={(e) => { if (e.target.value) handleLoadPreset(e.target.value); }}
                    className="vision-settings__input"
                  >
                    <option value="">Pilih preset…</option>
                    {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                  <div className="vision-settings__preset-actions">
                    <input
                      type="text"
                      placeholder="Nama preset"
                      value={presetInput}
                      onChange={(e) => setPresetInput(e.target.value)}
                      className="vision-settings__input"
                    />
                    <button type="button" className="ui-button ui-button--small ui-button--quiet" onClick={handleSavePreset}>Simpan</button>
                    {presets.length > 0 && (
                      <button type="button" className="ui-button ui-button--small ui-button--quiet" onClick={() => handleDeletePreset(presets[presets.length - 1].name)}>Hapus</button>
                    )}
                  </div>
                </div>

                <div className="vision-slider-group">
                  <div className="vision-slider-group__title is-pick">Slot Pick</div>
                  <div className="vision-slider-grid">
                    <label className="vision-slider">
                      <span>Pick X <strong>{Math.round(manualConfig.pick.leftX * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0}
                        max={0.35}
                        step={0.001}
                        value={manualConfig.pick.leftX}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          pick: { ...prev.pick, mirrorX: true, leftX: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Pusat Pick X <strong>{Math.round((manualConfig.pick.centerX ?? manualConfig.centerX ?? 0.5) * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.42}
                        max={0.58}
                        step={0.001}
                        value={manualConfig.pick.centerX ?? manualConfig.centerX ?? 0.5}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          pick: { ...prev.pick, centerX: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Pick Atas Y <strong>{Math.round(manualConfig.pick.topY * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.55}
                        step={0.001}
                        value={manualConfig.pick.topY}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          pick: { ...prev.pick, mirrorX: true, topY: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Pick Bawah Y <strong>{Math.round(manualConfig.pick.bottomY * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.25}
                        max={0.9}
                        step={0.001}
                        value={manualConfig.pick.bottomY}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          pick: { ...prev.pick, mirrorX: true, bottomY: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Ukuran Pick <strong>{Math.round(manualConfig.pick.size * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.2}
                        step={0.001}
                        value={manualConfig.pick.size}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          pick: { ...prev.pick, mirrorX: true, size: Number(e.target.value) },
                        }))}
                      />
                    </label>
                  </div>
                </div>

                <div className="vision-slider-group">
                  <div className="vision-slider-group__title is-ban">Slot Ban</div>
                  <div className="vision-slider-grid">
                    <label className="vision-slider">
                      <span>Ban X <strong>{Math.round(manualConfig.ban.leftX * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0}
                        max={0.35}
                        step={0.001}
                        value={manualConfig.ban.leftX}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, mirrorX: true, leftX: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Pusat Ban X <strong>{Math.round((manualConfig.ban.centerX ?? manualConfig.centerX ?? 0.5) * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.42}
                        max={0.58}
                        step={0.001}
                        value={manualConfig.ban.centerX ?? manualConfig.centerX ?? 0.5}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, centerX: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Ban Y <strong>{Math.round(manualConfig.ban.y * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0}
                        max={0.4}
                        step={0.001}
                        value={manualConfig.ban.y}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, mirrorX: true, y: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Jarak Ban <strong>{Math.round(manualConfig.ban.stepX * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.015}
                        max={0.08}
                        step={0.001}
                        value={manualConfig.ban.stepX}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, mirrorX: true, stepX: Number(e.target.value) },
                        }))}
                      />
                    </label>
                    <label className="vision-slider">
                      <span>Ukuran Ban <strong>{Math.round(manualConfig.ban.size * 1000) / 10}%</strong></span>
                      <input
                        type="range"
                        min={0.025}
                        max={0.12}
                        step={0.001}
                        value={manualConfig.ban.size}
                        onChange={(e) => setManualConfig(prev => sanitizeManualLayoutConfig({
                          ...prev,
                          ban: { ...prev.ban, mirrorX: true, size: Number(e.target.value) },
                        }))}
                      />
                    </label>
                  </div>
                </div>
              </aside>
            )}
          </div>

          {lastObservation && (
            <>
              {renderBoard()}

              {lastResult && lastResult.unidentifiedBans > 0 && (
                <div className="vision-unidentified-bans" role="status">
                  <Info aria-hidden="true" />
                  <span>{unidentifiedBansBreakdownMessage(lastResult)}</span>
                </div>
              )}

              {lastResult?.truncated && lastResult.error && (
                <div className="vision-truncation-alert" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <strong>Papan tidak terbaca sepenuhnya</strong>
                    <p>{lastResult.error}</p>
                  </div>
                </div>
              )}

              {lastResult && currentTurn?.isComplete && (() => {
                const heroById = new Map(heroes.map(h => [h.hero_id, h]));
                const ownIds = lastResult.position.picks[side];
                const enemyIds = lastResult.position.picks[side === 'blue' ? 'red' : 'blue'];
                const ownHeroes = ownIds.map(id => heroById.get(id)).filter((h): h is Hero => Boolean(h));
                const enemyHeroes = enemyIds.map(id => heroById.get(id)).filter((h): h is Hero => Boolean(h));
                if (ownHeroes.length === 0 && enemyHeroes.length === 0) return null;
                const ownRadar = evaluateTacticalScores(ownHeroes, enemyHeroes);
                const enemyRadar = evaluateTacticalScores(enemyHeroes, ownHeroes);
                const axes = [
                  ['draft_advantage', 'Keunggulan draft'],
                  ['early_game_pressure', 'Tekanan awal'],
                  ['cc_chain_lockdown', 'Kontrol tim'],
                  ['frontline_durability', 'Garis depan'],
                  ['enemy_carry_shutdown', 'Menahan carry'],
                  ['draft_flexibility', 'Fleksibilitas'],
                  ['team_utility', 'Utilitas tim'],
                ] as const;
                return (
                  <section aria-label="Evaluasi draft heuristik" className="practice-review surface-panel">
                    <div className="section-heading">
                      <span className="section-heading__icon"><ChartColumn aria-hidden="true" /></span>
                      <div>
                        <h2>Evaluasi draft heuristik</h2>
                        <p>Nilai komposisi 7 dimensi kedua tim berdasarkan draft yang terdeteksi.</p>
                      </div>
                    </div>
                    <div className="practice-review__teams">
                      {[{ title: 'Tim Anda', radar: ownRadar }, { title: 'Lawan', radar: enemyRadar }].map(({ title, radar }) => (
                        <div key={title}>
                          <h3>{title}</h3>
                          <dl>
                            {axes.map(([key, label]) => (
                              <div key={key}>
                                <dt>{label}</dt>
                                <dd>
                                  {Math.round(radar[key] * 100)}/100
                                  {radar[key] < 0.48 && <span>Perlu perhatian</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {lastResult && currentTurn?.isComplete && (() => {
                const heroById = new Map(heroes.map(h => [h.hero_id, h]));
                const blueHeroes = lastResult.position.picks.blue.map(id => heroById.get(id)).filter((h): h is Hero => Boolean(h));
                const redHeroes = lastResult.position.picks.red.map(id => heroById.get(id)).filter((h): h is Hero => Boolean(h));
                if (blueHeroes.length === 0 && redHeroes.length === 0) return null;
                const kplLaneRates = (synergyData as any)?.hero_lane_rates;
                const defaultBlueAssignment = buildDefaultLaneAssignments(blueHeroes, kplLaneRates);
                const defaultRedAssignment = buildDefaultLaneAssignments(redHeroes, kplLaneRates);
                return (
                  <PostDraftGamePlanPanel
                    blueHeroes={blueHeroes}
                    redHeroes={redHeroes}
                    synergy={synergyData ?? {}}
                    defaultPerspective={side === 'blue' ? 'blue' : 'red'}
                    blueAssignment={defaultBlueAssignment}
                    redAssignment={defaultRedAssignment}
                    hasCustomAssignments={false}
                    onSwapLane={() => {}}
                    onResetLanes={() => {}}
                    onInspectHero={() => {}}
                  />
                );
              })()}

              <div className="vision-actions">
                {renderRecommendation()}
              </div>
            </>
          )}

          {!lastObservation && status === 'running' && (
            <div className="vision-state vision-state--pending">
              <Scan aria-hidden="true" />
              <div>
                <strong>Deteksi manual siap</strong>
                <p>Klik slot di pratinjau atau papan untuk mendeteksi hero. Klik slot terakhir untuk undo, double-click untuk ganti hero.</p>
              </div>
            </div>
          )}
        </>
      )}

      {status === 'running' && lastResult && lastResult.step > 0 && lastResult.step === getDraftSequence(advisorFormat, advisorIsUltimateBattle).length && (
        <div className="vision-complete">
          <CheckCircle2 aria-hidden="true" />
          <span>Draft selesai terdeteksi.</span>
        </div>
      )}

      <VisionHeroPickerModal
        isOpen={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerSlot(null); }}
        heroes={heroes}
        onlyGlobalReleased={onlyGlobalReleased}
        unavailableHeroIds={new Set(manualState.pickActions.map(a => a.heroId).concat(manualState.banEstimates.map(b => b.heroId)))}
        onSelect={handlePickerSelect}
        title={pickerSlot !== null && pickerSlot < 10 ? 'Pilih hero untuk slot pick' : 'Pilih hero untuk slot ban'}
      />
    </section>
  );
}

/** Display shape for one team in the detected board. */
export interface TeamSlots {
  bans: Array<{ hero?: Hero; score: number; abstained: boolean; empty: boolean; estimated?: boolean }>;
  picks: Array<{ hero?: Hero; score: number; abstained: boolean; empty: boolean; locked?: boolean }>;
}

/** Defensive extension for ban-estimate markers landing in a parallel vision change. */
type AugmentedSlotObservation = DraftObservation['slots'][0] & { estimated?: boolean };

/** Map a raw observation into the per-team display structure used by the board. */
export function mapObservationToTeamSlots(
  observation: DraftObservation | null,
  heroes: Hero[],
  advisorFormat: DraftFormat,
  banCountPerSide?: number,
): { blue: TeamSlots; red: TeamSlots } {
  let observedBanCount = 0;
  if (observation) {
    let blueBans = 0;
    let redBans = 0;
    for (const slot of observation.slots) {
      if (slot.kind === 'ban') {
        if (slot.side === 'blue') blueBans += 1;
        else redBans += 1;
      }
    }
    observedBanCount = Math.max(blueBans, redBans);
  }
  const banSlotsCount = Math.max(banCountPerSide ?? (advisorFormat === 'ranked' ? 3 : 4), observedBanCount);
  const empty: TeamSlots = {
    bans: Array<{ hero?: Hero; score: number; abstained: boolean; empty: boolean; estimated?: boolean }>(banSlotsCount).fill({ score: 0, abstained: false, empty: true }),
    picks: Array<{ hero?: Hero; score: number; abstained: boolean; empty: boolean; locked?: boolean }>(5).fill({ score: 0, abstained: false, empty: true }),
  };
  if (!observation) return { blue: empty, red: empty };
  const teams: { blue: TeamSlots; red: TeamSlots } = { blue: { bans: empty.bans.slice(), picks: empty.picks.slice() }, red: { bans: empty.bans.slice(), picks: empty.picks.slice() } };
  // Observation slot.index values are region-profile identifiers (picks 0-9,
  // bans 10-15). Map them to the display order for each (side, kind) group
  // by sorting the matching slots and taking their rank.
  const displayIndexBySlot = new Map<DraftObservation['slots'][0], number>();
  const groups = new Map<string, DraftObservation['slots'][0][]>();
  for (const slot of observation.slots) {
    const key = `${slot.side}:${slot.kind}`;
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.index - b.index);
    list.forEach((slot, rank) => displayIndexBySlot.set(slot, rank));
  }
  for (const slot of observation.slots) {
    const team = teams[slot.side];
    const arr = slot.kind === 'ban' ? team.bans : team.picks;
    const displayIndex = displayIndexBySlot.get(slot) ?? -1;
    if (displayIndex < 0 || displayIndex >= arr.length) continue;
    const hasHero = slot.heroId !== null;
    // A pick is only treated as committed when the lock marker is explicitly true;
    // undefined or false means the portrait is a pre-selection and can still change.
    const locked = slot.kind === 'pick' ? (slot.locked === true) : undefined;
    // Ban identities are estimates by default; an explicit estimated=false marker
    // can override this when the vision layer becomes confident enough.
    const estimated = slot.kind === 'ban' && hasHero ? ((slot as AugmentedSlotObservation).estimated !== false) : undefined;
    arr[displayIndex] = {
      hero: hasHero ? findHero(heroes, slot.heroId) : undefined,
      score: slot.score,
      abstained: slot.abstained,
      empty: !hasHero && !slot.abstained,
      locked,
      estimated,
    };
  }
  return teams;
}

/** Measure the width-per-pixel ratio of a label using the active canvas font. */
function measureOverlayMetrics(ctx: CanvasRenderingContext2D, label: string): OverlayLabelMetrics {
  ctx.save();
  ctx.font = 'bold 10px "Plus Jakarta Sans", system-ui, sans-serif';
  const width = ctx.measureText(label).width;
  ctx.restore();
  if (width <= 0) return estimateOverlayMetrics(label);
  return { widthPerPx: width / 10 };
}

/** Draw one slot rectangle and its label onto the preview canvas. */
function drawSlotOverlay(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  slot: SlotRegion,
  source: LayoutStatus['source'],
): void {
  const isBan = slot.kind === 'ban';
  const isBlue = slot.side === 'blue';
  const stroke = isBlue ? '#3B82F6' : '#EF4444';
  const fill = isBlue ? 'rgba(59, 130, 246, 0.12)' : 'rgba(239, 68, 68, 0.12)';

  ctx.save();
  if (source !== 'manual') {
    ctx.globalAlpha = 0.85;
  }

  ctx.strokeStyle = stroke;
  ctx.lineWidth = isBan ? 2 : 3;
  ctx.setLineDash(isBan ? [6, 4] : []);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  const canvas = ctx.canvas;
  const displayScale = canvas.clientWidth > 0 && canvas.width > 0 ? canvas.clientWidth / canvas.width : 1;
  const metrics = measureOverlayMetrics(ctx, getSlotOverlayLabel(slot));
  const plan = planOverlayLabel(slot, rect.w, rect.h, displayScale, metrics);

  if (plan.placement !== 'omit') {
    ctx.font = `bold ${plan.fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';

    const x = rect.x + OVERLAY_FONT.textPadding;
    let y = rect.y + OVERLAY_FONT.textPadding;
    if (plan.placement === 'below') {
      y = rect.y + rect.h + OVERLAY_FONT.textPadding;
      // Do not let a below-label spill past the canvas bottom edge.
      if (y + plan.fontSize > canvas.height) {
        ctx.restore();
        return;
      }
    }

    ctx.fillText(plan.text, x, y);
  }

  ctx.restore();
}
