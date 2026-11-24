import { LaneLabel } from './ui/LaneIcon';
import React, { useId, useRef, useState, useEffect, useMemo } from 'react';
import { ArrowRight, BookOpen, ChartColumn, CheckCircle2, ChevronDown, Crosshair, Info, LoaderCircle, ShieldAlert, ShieldBan, ShieldCheck, SlidersHorizontal, Sparkles, Swords, Target, TrendingUp } from 'lucide-react';
import type { Hero, TacticalVector, TacticalDelta, DuetPackageOption } from '../types';
import type { TournamentPhaseStrategy, TournamentPredictionResult } from '../engine/tournamentInference';
import type { SolverStatus } from '../engine/advisorRanking';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { plainText } from './ui/presentation';
import { useFocusgroup } from './ui/useFocusgroup';

interface Props {
  scores: TacticalVector;
  deltas?: TacticalDelta[];
  primaryInsight?: string;
  phaseStrategy?: TournamentPhaseStrategy;
  planAId?: number | null;
  planBId?: number | null;
  onOpenPlanModal?: () => void;
  onSelectQuickPlanA?: (heroId: number | null) => void;
  recommendations: TournamentPredictionResult['recommendations'];
  /** Status solver: "mesin sedang menghitung" → siap / tidak tersedia. */
  solverStatus?: SolverStatus;
  onSelectCandidate?: (hero: Hero) => void;
  onInspectHero?: (hero: Hero) => void;
  activeSide: 'blue' | 'red';
  isPickPhase: boolean;
  isComplete?: boolean;
  isWaiting?: boolean;
  duetPackages?: DuetPackageOption[];
  onSelectDuetPackage?: (duet: DuetPackageOption) => void;
}
const axes: Array<{ key: keyof TacticalVector; label: string }> = [
  { key: 'draft_advantage', label: 'Keunggulan draft' }, { key: 'early_game_pressure', label: 'Tekanan awal' },
  { key: 'cc_chain_lockdown', label: 'Kontrol tim' }, { key: 'frontline_durability', label: 'Garis depan' },
  { key: 'enemy_carry_shutdown', label: 'Menahan carry' }, { key: 'draft_flexibility', label: 'Fleksibilitas' },
  { key: 'team_utility', label: 'Utilitas tim' },
];

export function TacticalRadarPanel({ scores, deltas = [], primaryInsight, phaseStrategy, planAId, planBId, onOpenPlanModal, onSelectQuickPlanA, recommendations, solverStatus, onSelectCandidate, onInspectHero, activeSide, isPickPhase, isComplete = false, isWaiting = false, duetPackages = [], onSelectDuetPackage }: Props) {
  const ActionIcon = isPickPhase ? Swords : ShieldBan;
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [selectedDuetIdx, setSelectedDuetIdx] = useState<number>(0);

  const firstHeroId = recommendations[0]?.hero.hero_id;
  const duetSignature = duetPackages.map(p => `${p.primaryHero.hero_id}:${p.secondaryHero.hero_id}`).join('|');
  useEffect(() => {
    setSelectedIndex(0);
  }, [firstHeroId]);
  useEffect(() => {
    setSelectedDuetIdx(0);
  }, [duetSignature]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, recommendations.length - 1));
  const currentRec = recommendations[activeIndex] || recommendations[0];
  const clampedDuetIdx = Math.min(selectedDuetIdx, Math.max(0, duetPackages.length - 1));
  const activeDuet = duetPackages.length > 0 ? duetPackages[clampedDuetIdx] : null;

  // Kartu yang dipilih solver (bisa berbeda dari kartu #1 bila Plan A/B dikunci).
  const solverPickIndex = solverStatus?.state === 'ready' && solverStatus.heroId != null
    ? recommendations.findIndex((rec) => rec.hero.hero_id === solverStatus.heroId)
    : -1;
  const solverPickRec = solverPickIndex >= 0 ? recommendations[solverPickIndex] : null;
  const currentIsSolverPick = solverPickIndex >= 0 && solverPickIndex === activeIndex;

  // Alternatif solver terdekat (runner-up berikutnya yang dinilai terbaik oleh Minimax)
  const solverRunnerUp = useMemo(() => {
    if (!solverStatus?.rootValues || solverStatus.rootValues.length < 2) return null;
    const sorted = [...solverStatus.rootValues].sort((a, b) => b.value - a.value);
    const runnerEntry = sorted.find((e) => e.heroId !== solverStatus.heroId);
    if (!runnerEntry) return null;
    const idx = recommendations.findIndex((r) => r.hero.hero_id === runnerEntry.heroId);
    if (idx < 0) return null;
    return {
      rec: recommendations[idx],
      index: idx,
      value: runnerEntry.value,
    };
  }, [solverStatus?.rootValues, solverStatus?.heroId, recommendations]);
  // Plan A/B yang dikunci user: selalu di posisi pertama pada fase PICK, apa pun jawaban solver.
  const lockedPlanId = isPickPhase ? (planAId ?? planBId ?? solverStatus?.lockedPlanHeroId ?? null) : null;
  const lockedPlanHoldsTop = lockedPlanId !== null && recommendations[0]?.hero.hero_id === lockedPlanId;
  const recTabsId = useId();
  const projTitleId = useId();
  const recTabsRef = useRef<HTMLDivElement>(null);
  const hasRecTabs = recommendations.length > 1 && !isComplete && !isWaiting;
  useFocusgroup(recTabsRef, hasRecTabs);

  function SingleRankBadge({ heroId, recs }: { heroId: number; recs: Props['recommendations'] }) {
    const idx = recs.findIndex(r => r.hero.hero_id === heroId);
    const rank = idx >= 0 ? idx + 1 : null;
    return (
      <span className={`duet-rank-badge${rank ? ' is-ranked' : ''}`}>
        <span aria-hidden="true">{rank ? `#${rank}` : '—'}</span>
        <span className="sr-only">
          {rank ? `Peringkat rekomendasi tunggal #${rank}` : 'Tidak ada di rekomendasi tunggal'}
        </span>
      </span>
    );
  }

  const solverStatusChip = (() => {
    if (!solverStatus || solverStatus.state === 'idle') return null;
    if (solverStatus.state === 'calculating') {
      return (
        <span className="solver-status solver-status--calculating" role="status" aria-live="polite">
          <LoaderCircle className="is-spinning" aria-hidden="true" />
          <span>Mesin sedang menghitung…</span>
        </span>
      );
    }
    if (solverStatus.state === 'fallback') {
      return (
        <span className="solver-status solver-status--fallback" role="status" aria-live="polite">
          <Info aria-hidden="true" />
          <span>Solver tidak tersedia — urutan cepat dipakai</span>
        </span>
      );
    }
    const seconds = (solverStatus.elapsedMs ?? 0) / 1000;
    return (
      <span className="solver-status solver-status--ready" role="status" aria-live="polite">
        <Sparkles aria-hidden="true" />
        <span>
          Solver selesai · {solverStatus.depth ?? 0} ply · {seconds.toFixed(1)} dtk
        </span>
      </span>
    );
  })();

  return <section className="tactical-panel surface-panel" aria-label="Rekomendasi dan evaluasi draft">
    <div className="tactical-panel__header"><div className="section-heading"><span className="section-heading__icon"><Sparkles aria-hidden="true" /></span><div><h2>{isComplete ? 'Evaluasi draft' : 'Rekomendasi giliran'}</h2><p>{isComplete ? 'Komposisi kedua tim sudah lengkap' : 'Prioritas taktis untuk tim aktif'}</p></div></div><span className="side-badge" data-side={activeSide}>{activeSide === 'blue' ? 'Blue' : 'Red'} · {isPickPhase ? 'Pick' : 'Ban'}</span></div>
    {solverStatusChip && <div className="solver-status-row">{solverStatusChip}</div>}

    {activeDuet && !isComplete && !isWaiting && (
      <div className="duet-package-card">
        <div className="duet-package-card__head">
          <div className="duet-package-card__title-group">
            <span className="duet-package-card__title">
              💡 PAKET DUET
            </span>
            {activeDuet.windowLabel && (
              <span className="duet-package-card__window" data-side={activeSide}>
                {activeDuet.windowLabel}
              </span>
            )}
          </div>
          {duetPackages.length > 1 && (
            <div className="duet-package-card__tabs">
              {duetPackages.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedDuetIdx(idx)}
                  className={`ui-button ui-button--small duet-package-card__tab ${selectedDuetIdx === idx ? 'ui-button--primary' : 'ui-button--quiet'}`}
                  aria-label={`Paket #${idx + 1}`}
                  title={`Paket #${idx + 1}`}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="duet-package-card__pair">
          <div className="duet-package-card__hero">
            <HeroThumbnail hero={activeDuet.primaryHero} />
            <div className="duet-package-card__hero-meta">
              <strong>{activeDuet.primaryHero.name}</strong>
              <small><LaneLabel lane={activeDuet.primaryLane} /></small>
            </div>
            <SingleRankBadge heroId={activeDuet.primaryHero.hero_id} recs={recommendations} />
          </div>
          <span className="duet-package-card__plus" aria-hidden="true">+</span>
          <div className="duet-package-card__hero">
            <HeroThumbnail hero={activeDuet.secondaryHero} />
            <div className="duet-package-card__hero-meta">
              <strong>{activeDuet.secondaryHero.name}</strong>
              <small><LaneLabel lane={activeDuet.secondaryLane} /></small>
            </div>
            <SingleRankBadge heroId={activeDuet.secondaryHero.hero_id} recs={recommendations} />
          </div>
        </div>

        <div className="duet-package-card__badges">
          <span className="duet-badge">
            {activeDuet.archetypeBadge}
          </span>
          {activeDuet.kplSynergyLabel && (
            <span className="duet-badge duet-badge--synergy">
              {activeDuet.kplSynergyLabel}
            </span>
          )}
          {activeDuet.enemyExploitBadge && (
            <span className="duet-badge duet-badge--exploit">
              {activeDuet.enemyExploitBadge}
            </span>
          )}
        </div>

        {onSelectDuetPackage && (
          <button
            type="button"
            className="ui-button ui-button--primary duet-package-card__cta"
            onClick={() => onSelectDuetPackage(activeDuet)}
          >
            <Swords aria-hidden="true" />
            Pick Paket Ini ({activeDuet.primaryHero.name} + {activeDuet.secondaryHero.name})
          </button>
        )}
      </div>
    )}

    {hasRecTabs && (
      <div
        ref={recTabsRef}
        className="recommendation-tabs"
        role="tablist"
        aria-label="Pilihan prioritas rekomendasi AI"
        {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
      >
        {recommendations.slice(0, 5).map((rec, index) => {
          const isSelected = index === activeIndex;
          const isSolverPick = index === solverPickIndex;
          return (
            <button
              key={rec.hero.hero_id}
              id={`${recTabsId}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${recTabsId}-panel`}
              {...({ ...(isSelected ? { focusgroupstart: '' } : {}) } as Record<string, string>)}
              className={'rec-tab' + (isSelected ? ' is-active' : '') + (isSolverPick ? ' is-solver-pick' : '')}
              onClick={() => setSelectedIndex(index)}
              onFocus={() => setSelectedIndex(index)}
              title={`Rekomendasi #${index + 1}: ${rec.hero.name}${isSolverPick ? ' — pilihan solver' : ''}`}
              aria-label={`Rekomendasi #${index + 1}: ${rec.hero.name}${isSolverPick ? ' — pilihan solver' : ''}`}
            >
              <span className="rec-tab__rank">#{index + 1}</span>
              <span className="rec-tab__name">{rec.hero.name}</span>
              {isSolverPick && <span className="rec-tab__solver" aria-hidden="true">◆</span>}
            </button>
          );
        })}
      </div>
    )}

    {currentRec && <div
      className="primary-recommendation"
      {...(hasRecTabs ? { role: 'tabpanel', id: `${recTabsId}-panel`, 'aria-labelledby': `${recTabsId}-tab-${activeIndex}` } : {})}
    >
      <div className="primary-recommendation__identity">
        <HeroThumbnail hero={currentRec.hero} priority="high" />
        <div>
          <span className="eyebrow">Rekomendasi #{activeIndex + 1}</span>
          <h3>{currentRec.hero.name}</h3>
          <p><LaneLabel lane={currentRec.hero.primary_lane} /> · Pop {currentRec.hero.popularity_band ?? '—'}</p>
        </div>
        {currentIsSolverPick && (
          <span className="solver-pick-badge" title="Hero ini dipilih solver Minimax (game theory)">
            <Sparkles aria-hidden="true" />
            <span>Pilihan solver</span>
          </span>
        )}
      </div>

      {solverPickRec && !currentIsSolverPick && (
        <p className="solver-pick-note">
          <Sparkles aria-hidden="true" />
          <span>
            Pilihan solver: <strong>{solverPickRec.hero.name}</strong> (#{solverPickIndex + 1})
            {lockedPlanHoldsTop ? ' — Plan yang dikunci tetap di posisi pertama' : ''}
          </span>
          <button type="button" className="ui-button ui-button--text" onClick={() => setSelectedIndex(solverPickIndex)}>
            Lihat
          </button>
        </p>
      )}

      {currentIsSolverPick && solverRunnerUp && (
        <p className="solver-pick-note">
          <Sparkles aria-hidden="true" />
          <span>
            Alternatif solver terdekat: <strong>{solverRunnerUp.rec.hero.name}</strong> (#{solverRunnerUp.index + 1})
          </span>
          <button type="button" className="ui-button ui-button--text" onClick={() => setSelectedIndex(solverRunnerUp.index)}>
            Bandingkan
          </button>
        </p>
      )}

      <p className="recommendation-reason">
        <Crosshair aria-hidden="true" />
        <span>{plainText(currentRec.proComboTag || currentRec.laneTag || 'Melengkapi komposisi dan merespons pilihan lawan.')}</span>
      </p>

      {currentRec.projection && (
        <section className="outcome-projection" aria-labelledby={projTitleId}>
          <div className="outcome-projection__header">
            <span id={projTitleId} className="outcome-projection__title">Proyeksi Hasil Draft</span>
            <span className={'risk-badge risk-badge--' + currentRec.projection.riskLevel.toLowerCase()}>
              {currentRec.projection.riskLevel === 'RENDAH' ? <ShieldCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
              Risiko {currentRec.projection.riskLevel}
            </span>
          </div>
          <div className="outcome-projection__grid">
            <div className="projection-box projection-box--best">
              <div className="projection-box__heading">
                <TrendingUp aria-hidden="true" />
                <span>Skenario Terbaik</span>
                <strong className="projection-box__score">{currentRec.projection.bestCaseScore}%</strong>
              </div>
              <p>{plainText(currentRec.projection.bestCaseScenario)}</p>
            </div>
            <div className="projection-box projection-box--worst">
              <div className="projection-box__heading">
                <ShieldAlert aria-hidden="true" />
                <span>Skenario Terburuk</span>
                <strong className="projection-box__score">{currentRec.projection.worstCaseScore}%</strong>
              </div>
              <p>{plainText(currentRec.projection.worstCaseScenario)}</p>
            </div>
          </div>
        </section>
      )}

      <div className="primary-recommendation__actions">
        {onInspectHero && <button type="button" className="ui-button ui-button--quiet" onClick={() => onInspectHero(currentRec.hero)}><BookOpen aria-hidden="true" />Detail</button>}
        {onSelectCandidate && <button type="button" className={'ui-button ' + (isPickPhase ? 'ui-button--primary' : 'ui-button--ban')} onClick={() => onSelectCandidate(currentRec.hero)}><ActionIcon aria-hidden="true" />{isPickPhase ? 'Pick ' : 'Ban '}{currentRec.hero.name}<ArrowRight aria-hidden="true" /></button>}
      </div>
    </div>}

    {!currentRec && <div className="recommendation-empty">{isComplete ? <CheckCircle2 aria-hidden="true" /> : isWaiting ? <Info aria-hidden="true" /> : <LoaderCircle className="is-spinning" aria-hidden="true" />}<p>{isComplete ? 'Draft selesai. Buka evaluasi komposisi di bawah.' : isWaiting ? 'Giliran AI. Rekomendasi tersedia saat giliran Anda.' : 'Menyiapkan rekomendasi untuk giliran ini…'}</p></div>}

    {phaseStrategy && !isComplete && (
      <div className="plan-overview">
        <div className="plan-overview__heading">
          <h3>{activeSide === 'blue' ? 'Rencana Pembuka B1 (Plan A/B)' : 'Strategi Red (Kontra B1 & Sinergi)'}</h3>
          {onOpenPlanModal && (
            <button type="button" className="ui-button ui-button--text" onClick={onOpenPlanModal}>
              <SlidersHorizontal aria-hidden="true" />
              {activeSide === 'blue' ? 'Atur Plan A/B' : 'Atur Target Red'}
            </button>
          )}
        </div>
        <div className="plan-overview__cards">
          {[
            {
              label: activeSide === 'blue' ? 'Plan A (B1)' : 'Target R1 (Kontra B1)',
              hero: phaseStrategy.planAHero,
              banned: phaseStrategy.isPlanABanned,
            },
            {
              label: activeSide === 'blue' ? 'Plan B (Cadangan)' : 'Target R2 (Sinergi/R5)',
              hero: phaseStrategy.planBHero,
              banned: phaseStrategy.isPlanBBanned,
            },
          ].map((plan) => (
            <button
              type="button"
              key={plan.label}
              className={
                'plan-preview' +
                (phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id ? ' is-active' : '')
              }
              onClick={onOpenPlanModal}
              disabled={!onOpenPlanModal}
            >
              {plan.hero ? <HeroThumbnail hero={plan.hero} /> : <Target aria-hidden="true" />}
              <span>
                <small>
                  {plan.label}
                  {plan.banned ? ' · Terban' : ''}
                </small>
                <strong>{plan.hero?.name ?? 'Pilih target'}</strong>
              </span>
              {phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id && (
                <CheckCircle2 aria-label="Rencana aktif" />
              )}
            </button>
          ))}
        </div>
      </div>
    )}
    {phaseStrategy && !isComplete && <details className="panel-disclosure"><summary><Target aria-hidden="true" /><span>Tujuan dan target pembuka</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><p>{plainText(phaseStrategy.phaseObjective)}</p>{onSelectQuickPlanA && <div className="opener-shortlist">{phaseStrategy.candidateOpeners.slice(0, 6).map(hero => <button type="button" key={hero.hero_id} onClick={() => onSelectQuickPlanA(hero.hero_id)}><HeroThumbnail hero={hero} /><span>{hero.name}</span></button>)}</div>}</div></details>}
    <details className="panel-disclosure" open={isComplete}><summary><ChartColumn aria-hidden="true" /><span>Komposisi · 7 dimensi</span><span className="metric-summary">{Math.round(scores.draft_advantage * 100)}/100</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><div className="tactical-metrics">{axes.map(({ key, label }) => <div key={key}><div><span>{label}</span><strong>{Math.round(scores[key] * 100)}</strong></div><progress aria-label={label} value={Math.round(scores[key] * 100)} max={100} /></div>)}</div><p className="metric-caption">Indeks heuristik komposisi, bukan probabilitas kemenangan.</p>{primaryInsight && <p className="metric-insight">{plainText(primaryInsight)}</p>}{deltas.length > 0 && <ul className="tactical-deltas">{deltas.map(delta => <li key={delta.dimension}><span>{delta.label}</span><strong>{delta.deltaPercent > 0 ? '+' : ''}{delta.deltaPercent}%</strong></li>)}</ul>}</div></details>
  </section>;
}
