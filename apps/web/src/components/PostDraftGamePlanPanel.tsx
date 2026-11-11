import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Compass,
  Crosshair,
  Flame,
  Info,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  Timer,
  TrendingUp,
} from 'lucide-react';
import type { Hero, Lane, LaneAssignmentMap, LaneMatchupEvaluation } from '../types';
import { oppositeSide } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { generatePostDraftGamePlan } from '../engine/gamePlan';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { LaneLabel } from './ui/LaneIcon';
import { plainText } from './ui/presentation';

interface Props {
  blueHeroes: Hero[];
  redHeroes: Hero[];
  synergy?: Record<string, any> | null;
  defaultPerspective?: Side;
  defaultTab?: PlanTab;
  blueAssignment: LaneAssignmentMap;
  redAssignment: LaneAssignmentMap;
  hasCustomAssignments: boolean;
  onSwapLane: (side: Side, laneA: Lane, laneB: Lane) => void;
  onResetLanes: () => void;
  onInspectHero?: (hero: Hero) => void;
}

type PlanTab = 'lanes' | 'winning' | 'jungle';

const VERDICT_LABEL: Record<LaneMatchupEvaluation['verdict'], { text: string; tone: string }> = {
  UNGGUL: { text: 'Unggul', tone: 'good' },
  TERTOLONG_ROAM: { text: 'Tertolong Roam', tone: 'assist' },
  SEIMBANG: { text: 'Seimbang', tone: 'neutral' },
  KALAH: { text: 'Kalah Lane', tone: 'bad' },
  SWAP_BERISIKO: { text: 'Swap Berisiko', tone: 'bad' },
};

const FEASIBILITY_LABEL: Record<LaneMatchupEvaluation['swapFeasibility'], string> = {
  PRIMARY: 'Primer',
  OFFICIAL_FLEX: 'Flex Resmi',
  KPL_PRO_FLEX: 'Flex KPL',
  TACTICAL_SWAP: 'Swap <4m',
};

export function PostDraftGamePlanPanel({
  blueHeroes,
  redHeroes,
  synergy,
  defaultPerspective = 'blue',
  defaultTab = 'lanes',
  blueAssignment,
  redAssignment,
  hasCustomAssignments,
  onSwapLane,
  onResetLanes,
  onInspectHero,
}: Props) {
  const [perspective, setPerspective] = useState<Side>(defaultPerspective);
  const [activeTab, setActiveTab] = useState<PlanTab>(defaultTab);
  const [swapTargetSide, setSwapTargetSide] = useState<'our' | 'enemy'>('our');
  const [pendingSwapLane, setPendingSwapLane] = useState<Lane | null>(null);

  const ourHeroes = perspective === 'blue' ? blueHeroes : redHeroes;
  const enemyHeroes = perspective === 'blue' ? redHeroes : blueHeroes;
  const ourAssignment = perspective === 'blue' ? blueAssignment : redAssignment;
  const enemyAssignment = perspective === 'blue' ? redAssignment : blueAssignment;

  const plan = useMemo(
    () =>
      generatePostDraftGamePlan({
        ourSide: perspective,
        ourHeroes,
        enemyHeroes,
        synergy,
        ourAssignmentOverride: ourAssignment,
        enemyAssignmentOverride: enemyAssignment,
      }),
    [perspective, ourHeroes, enemyHeroes, synergy, ourAssignment, enemyAssignment]
  );

  const handleLaneSwapClick = (lane: Lane) => {
    const targetSide: Side = swapTargetSide === 'our' ? perspective : oppositeSide(perspective);
    if (!pendingSwapLane) {
      setPendingSwapLane(lane);
      return;
    }
    if (pendingSwapLane === lane) {
      setPendingSwapLane(null);
      return;
    }
    onSwapLane(targetSide, pendingSwapLane, lane);
    setPendingSwapLane(null);
  };

  const handleSwitchPerspective = (nextSide: Side) => {
    setPerspective(nextSide);
    setPendingSwapLane(null);
  };

  const sideName = (side: Side) => (side === 'blue' ? 'Tim Blue' : 'Tim Red');
  const activeReswapLanes = plan.laneMatchups.filter(
    (m): m is LaneMatchupEvaluation & { ourHero: Hero; reswapAdvice: string } =>
      Boolean(m.ourHero && m.reswapAdvice),
  );
  const hasRoleMismatchReswap = activeReswapLanes.some(
    (m) => m.lane === 'Jungle' || m.lane === 'Roam' || m.ourHero.primary_lane === 'Roam',
  );

  return (
    <section className="game-plan-panel surface-panel" aria-label="Game plan dan simulator swap pasca-draft">
      <div className="game-plan-panel__header">
        <div className="section-heading">
          <span className="section-heading__icon">
            <Compass aria-hidden="true" />
          </span>
          <div>
            <h2>Game Plan &amp; Winning Condition ({sideName(perspective)})</h2>
            <p>
              {plan.winningCondition.archetype.label} · Strongside {plan.junglePlan.strongSide} · Objektif 04:00:{' '}
              {plan.junglePlan.objectiveFocusAt4Min.primaryObjective}
            </p>
          </div>
        </div>
        <div className="game-plan-panel__controls">
          <div className="perspective-switch" role="group" aria-label="Perspektif tim analisis">
            {(['blue', 'red'] as Side[]).map((side) => (
              <button
                key={side}
                type="button"
                className={'perspective-btn' + (perspective === side ? ' is-active' : '')}
                aria-pressed={perspective === side}
                onClick={() => handleSwitchPerspective(side)}
              >
                {side === 'blue' ? 'Blue' : 'Red'}
              </button>
            ))}
          </div>
          {hasCustomAssignments && (
            <button type="button" className="ui-button ui-button--quiet ui-button--small" onClick={() => { onResetLanes(); setPendingSwapLane(null); }}>
              <RotateCcw aria-hidden="true" />
              Reset Lane
            </button>
          )}
        </div>
      </div>

      <div className="game-plan-tabs" role="tablist" aria-label="Bagian analisis pasca-draft">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'lanes'}
          className={'game-plan-tab' + (activeTab === 'lanes' ? ' is-active' : '')}
          onClick={() => setActiveTab('lanes')}
        >
          <ArrowLeftRight aria-hidden="true" />
          <span>Peta Lane &amp; Swap 5v5</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'winning'}
          className={'game-plan-tab' + (activeTab === 'winning' ? ' is-active' : '')}
          onClick={() => setActiveTab('winning')}
        >
          <TrendingUp aria-hidden="true" />
          <span>Winning Condition &amp; Tempo</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'jungle'}
          className={'game-plan-tab' + (activeTab === 'jungle' ? ' is-active' : '')}
          onClick={() => setActiveTab('jungle')}
        >
          <Crosshair aria-hidden="true" />
          <span>Pola Jungle, Gank &amp; Item</span>
        </button>
      </div>

      {activeTab === 'lanes' && (
        <div className="game-plan-section" role="tabpanel" aria-label="Peta lane dan simulator swap">
          <div className="swap-toolbar">
            <div className="swap-toolbar__target">
              <span className="muted-copy">Simulasi tukar lane:</span>
              <button
                type="button"
                className={'chip-toggle' + (swapTargetSide === 'our' ? ' is-active' : '')}
                aria-pressed={swapTargetSide === 'our'}
                onClick={() => { setSwapTargetSide('our'); setPendingSwapLane(null); }}
              >
                {sideName(perspective)} (Kita)
              </button>
              <button
                type="button"
                className={'chip-toggle' + (swapTargetSide === 'enemy' ? ' is-active' : '')}
                aria-pressed={swapTargetSide === 'enemy'}
                onClick={() => { setSwapTargetSide('enemy'); setPendingSwapLane(null); }}
              >
                {sideName(oppositeSide(perspective))} (Lawan)
              </button>
            </div>
            <p className="swap-toolbar__hint">
              {pendingSwapLane
                ? `Pilih lane tujuan untuk ditukar dengan ${pendingSwapLane}…`
                : 'Pilih 2 lane di bawah untuk menguji tukar lane awal (00:00–04:00) atau flex.'}
            </p>
          </div>

          {plan.swapSuggestions.length > 0 ? (
            <div className="swap-suggestions">
              {plan.swapSuggestions.map((sug) => (
                <div key={`${sug.laneA}-${sug.laneB}`} className="swap-suggestion-card">
                  <div className="swap-suggestion-card__copy">
                    <strong>
                      <Sparkles aria-hidden="true" />
                      Rekomendasi: {sug.title}
                    </strong>
                    <p>{plainText(sug.rationale)}</p>
                    {sug.reswapAdvice && <small>{plainText(sug.reswapAdvice)}</small>}
                  </div>
                  <button
                    type="button"
                    className="ui-button ui-button--primary ui-button--small"
                    onClick={() => {
                      onSwapLane(perspective, sug.laneA, sug.laneB);
                      setPendingSwapLane(null);
                    }}
                  >
                    <ArrowLeftRight aria-hidden="true" />
                    Terapkan Swap
                  </button>
                </div>
              ))}
            </div>
          ) : activeReswapLanes.length === 0 ? (
            <div className="swap-clean-note">
              <CheckCircle2 aria-hidden="true" />
              <span>
                Penempatan 5 lane {sideName(perspective)} sudah solid. Anda tetap bebas menguji swap manual pada kartu di bawah.
              </span>
            </div>
          ) : null}

          {activeReswapLanes.length > 0 && (
            <div className="reswap-alert" role="note">
              <div className="reswap-alert__header">
                <Timer aria-hidden="true" />
                <div className="reswap-alert__title-wrap">
                  <strong>Rencana Re-Swap Menit 04:00 Aktif</strong>
                  <p className="reswap-alert__summary">
                    {hasRoleMismatchReswap
                      ? 'Terdapat penempatan luar peran (Jungle/Roam) atau swap taktis. Kembalikan formasi berikut agar tempo tim tidak rusak.'
                      : 'Pertahankan tukar lane ini selama fase 00:00–04:00 untuk menghindari counter, lalu kembalikan ke lane asal setelah shield turret turun.'}
                  </p>
                </div>
              </div>
              <ul className="reswap-alert__list">
                {activeReswapLanes.map((row) => {
                  const isRoleWarning =
                    row.lane === 'Jungle' || row.lane === 'Roam' || row.ourHero.primary_lane === 'Roam';
                  return (
                    <li key={row.lane} className="reswap-alert__item">
                      <HeroThumbnail hero={row.ourHero} />
                      <div className="reswap-alert__item-copy">
                        <span className="reswap-alert__item-head">
                          <strong>{row.ourHero.name}</strong>
                          <span className="reswap-alert__lane-tag">di {row.lane}</span>
                        </span>
                        <small>
                          {isRoleWarning
                            ? plainText(row.reswapAdvice)
                            : `Asal ${row.ourHero.primary_lane} → balik ${row.ourHero.primary_lane} di 04:00`}
                        </small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="lane-matchup-grid">
            {plan.laneMatchups.map((row) => {
              const badge = VERDICT_LABEL[row.verdict];
              const isSelectedForSwap = pendingSwapLane === row.lane;
              return (
                <article key={row.lane} className={'lane-matchup-row lane-matchup-row--' + badge.tone}>
                  <div className="lane-matchup-row__header">
                    <div className="lane-matchup-row__lane">
                      <LaneLabel lane={row.lane} />
                      <span className={'feasibility-pill feasibility-pill--' + row.swapFeasibility.toLowerCase()}>
                        {FEASIBILITY_LABEL[row.swapFeasibility]}
                      </span>
                    </div>
                    <div className="lane-matchup-row__status">
                      <span className={'verdict-pill verdict-pill--' + badge.tone}>{badge.text}</span>
                      <button
                        type="button"
                        className={'ui-button ui-button--small ' + (isSelectedForSwap ? 'ui-button--primary' : 'ui-button--quiet')}
                        onClick={() => handleLaneSwapClick(row.lane)}
                      >
                        <ArrowLeftRight aria-hidden="true" />
                        {isSelectedForSwap ? 'Dipilih' : pendingSwapLane ? 'Tukar ke sini' : 'Swap'}
                      </button>
                    </div>
                  </div>

                  <div className="lane-matchup-row__duel">
                    <button
                      type="button"
                      className="lane-hero-chip"
                      disabled={!row.ourHero || !onInspectHero}
                      onClick={() => row.ourHero && onInspectHero?.(row.ourHero)}
                    >
                      {row.ourHero && <HeroThumbnail hero={row.ourHero} />}
                      <span>
                        <small>{sideName(perspective)}</small>
                        <strong>{row.ourHero?.name ?? '-'}</strong>
                      </span>
                    </button>

                    <span className="lane-vs-divider" aria-hidden="true">
                      vs
                    </span>

                    <button
                      type="button"
                      className="lane-hero-chip lane-hero-chip--enemy"
                      disabled={!row.enemyHero || !onInspectHero}
                      onClick={() => row.enemyHero && onInspectHero?.(row.enemyHero)}
                    >
                      {row.enemyHero && <HeroThumbnail hero={row.enemyHero} />}
                      <span>
                        <small>{sideName(oppositeSide(perspective))}</small>
                        <strong>{row.enemyHero?.name ?? '-'}</strong>
                      </span>
                    </button>
                  </div>

                  <div className="lane-matchup-row__notes">
                    {row.reasons[0] && <p>{plainText(row.reasons[0])}</p>}
                    {row.roamContextNote && <p className="note-roam">{plainText(row.roamContextNote)}</p>}
                    {row.macroSwapNote && (
                      <p className={row.macroCost >= 0.4 ? 'note-macro-warn' : 'note-macro-ok'}>
                        {plainText(row.macroSwapNote)}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'winning' && (
        <div className="game-plan-section" role="tabpanel" aria-label="Winning condition dan kurva tempo">
          <div className="archetype-banner">
            <div>
              <span className="archetype-banner__eyebrow">Arketipe {sideName(perspective)}</span>
              <h3>{plan.winningCondition.archetype.label}</h3>
              <p>{plainText(plan.winningCondition.archetype.summary)}</p>
            </div>
            <div className="archetype-banner__meta">
              <span>Lawan: {plan.winningCondition.enemyArchetype.label}</span>
              <small>
                Data tempo: {plan.tempo.ours.kplSampleCount}/5 hero dari histori KPL ·{' '}
                {plan.tempo.ours.profileEstimatedCount}/5 Estimasi Profil
              </small>
            </div>
          </div>

          <div className="tempo-card">
            <div className="tempo-card__head">
              <h4>Perbandingan Kurva Tempo Menang (Early · Mid · Late)</h4>
              <p>{plainText(plan.tempo.windowVerdict)}</p>
            </div>
            <div className="tempo-bars">
              {[
                { label: 'Early (<15m)', share: plan.tempo.relativeShares.early },
                { label: 'Mid (15–19m)', share: plan.tempo.relativeShares.mid },
                { label: 'Late (>=19m)', share: plan.tempo.relativeShares.late },
              ].map((window) => {
                const { oursShare, enemyShare, ourAvgPct, enemyAvgPct } = window.share;
                const diff = oursShare - enemyShare;
                const enemySideLabel = sideName(oppositeSide(perspective));
                return (
                  <div key={window.label} className="tempo-bar-row">
                    <div className="tempo-bar-row__label">
                      <span>{window.label}</span>
                      <strong className={diff >= 2 ? 'is-ahead' : diff <= -2 ? 'is-behind' : ''}>
                        {oursShare}% vs {enemyShare}%
                      </strong>
                    </div>
                    <div className="tempo-bar-track" aria-hidden="true">
                      <span className="tempo-bar-split">
                        <span className="tempo-bar-fill tempo-bar-fill--ours" style={{ width: `${oursShare}%` }} />
                        <span className="tempo-bar-fill tempo-bar-fill--enemy" style={{ width: `${enemyShare}%` }} />
                      </span>
                    </div>
                    <small className="tempo-bar-row__raw">
                      Rata-rata WR fase hero: {ourAvgPct.toFixed(1)}% ({sideName(perspective)}) ·{' '}
                      {enemyAvgPct.toFixed(1)}% ({enemySideLabel})
                    </small>
                  </div>
                );
              })}
            </div>
            <small className="tempo-card__note">
              Pangsa indeks tempo relatif selalu berjumlah 100% (normalisasi langsung tanpa pembulatan ganda). Skor ini bersifat heuristik, bukan probabilitas kemenangan terkalibrasi.
            </small>
            <div className="tempo-hero-badges">
              {plan.tempo.ours.heroes.map((entry) => (
                <button
                  key={entry.hero.hero_id}
                  type="button"
                  className="tempo-hero-chip"
                  onClick={() => onInspectHero?.(entry.hero)}
                  disabled={!onInspectHero}
                >
                  <HeroThumbnail hero={entry.hero} />
                  <span>
                    <strong>{entry.hero.name}</strong>
                    <small>
                      {entry.sourceKind === 'kpl_empirical'
                        ? `Spike ${entry.profile.toUpperCase()} (${entry.totalGames}g KPL)`
                        : 'Estimasi Profil (KPL minim)'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="conditions-grid">
            <div className="condition-box condition-box--win">
              <h4>
                <Flame aria-hidden="true" />
                Winning Conditions ({sideName(perspective)})
              </h4>
              <ul>
                {plan.winningCondition.winConditions.map((item, idx) => (
                  <li key={idx}>{plainText(item)}</li>
                ))}
              </ul>
            </div>
            <div className="condition-box condition-box--lose">
              <h4>
                <ShieldAlert aria-hidden="true" />
                Syarat Kalah &amp; Celah Kritis
              </h4>
              <ul>
                {plan.winningCondition.loseConditions.map((item, idx) => (
                  <li key={idx}>{plainText(item)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'jungle' && (
        <div className="game-plan-section" role="tabpanel" aria-label="Pola jungle, target gank, dan item counter">
          <div className="jungle-route-cards">
            <div className="jungle-card jungle-card--primary">
              <div className="jungle-card__eyebrow">
                <Compass aria-hidden="true" />
                <span>Pola Start &amp; Postur (00:30–02:00)</span>
              </div>
              <h4>{plan.junglePlan.startQuadrant}</h4>
              <p>{plainText(plan.junglePlan.openingSummary)}</p>
              {plan.junglePlan.invadeRiskReasons.length > 0 && (
                <div className="jungle-risk-list">
                  <AlertTriangle aria-hidden="true" />
                  <span>Faktor Awal Lawan: {plainText(plan.junglePlan.invadeRiskReasons.join(' · '))}</span>
                </div>
              )}
            </div>

            <div className="jungle-card jungle-card--sides">
              <div className="jungle-card__eyebrow">
                <Swords aria-hidden="true" />
                <span>Pembagian Sisi &amp; Pra-04:00 Gold Sharing</span>
              </div>
              <div className="side-split-badges">
                <span className="side-pill side-pill--strong">Strongside: {plan.junglePlan.strongSide}</span>
                <span className="side-pill side-pill--weak">Weakside: {plan.junglePlan.weakSide} (Aman di turret &lt;4m)</span>
              </div>
              <p className="trio-tax-note">{plainText(plan.junglePlan.trioGoldSharingPlan)}</p>
              <div className="objective-4m-box">
                <Info aria-hidden="true" />
                <span>
                  <strong>Objektif 04:00 ({plan.junglePlan.objectiveFocusAt4Min.primaryObjective}):</strong>{' '}
                  {plainText(plan.junglePlan.objectiveFocusAt4Min.reason)}
                </span>
              </div>
            </div>
          </div>

          <div className="gank-priority-section">
            <h4>Urutan Target Gank Awal</h4>
            <div className="gank-priority-grid">
              {plan.junglePlan.gankPriorities.map((target) => (
                <div key={target.lane} className="gank-card">
                  <div className="gank-card__top">
                    <LaneLabel lane={target.lane} />
                    <span className={'gank-rank-pill gank-rank-pill--' + (target.priorityLabel === 'PRIORITAS #1' ? 'top' : 'sub')}>
                      {target.priorityLabel}
                    </span>
                  </div>
                  <div className="gank-card__target">
                    <HeroThumbnail hero={target.targetEnemy} />
                    <div>
                      <strong>Target: {target.targetEnemy.name}</strong>
                      <small>{plainText(target.setupSummary)}</small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="counter-checklist-section">
            <h4>
              <ShieldCheck aria-hidden="true" />
              Checklist Item &amp; Fokus Counter Lawan
            </h4>
            <div className="counter-checklist-grid">
              {plan.winningCondition.counterChecklist.map((entry) => (
                <div key={entry.enemy.hero_id} className="counter-check-card">
                  <button
                    type="button"
                    className="counter-check-card__head"
                    onClick={() => onInspectHero?.(entry.enemy)}
                    disabled={!onInspectHero}
                  >
                    <HeroThumbnail hero={entry.enemy} />
                    <span>
                      <strong>{entry.enemy.name}</strong>
                      <small>{plainText(entry.risk)}</small>
                    </span>
                  </button>
                  <p>{plainText(entry.counterAction)}</p>
                  {entry.recommendedItems.length > 0 && (
                    <div className="counter-items-pills">
                      {entry.recommendedItems.map((item) => (
                        <span key={item.name} className="counter-item-pill" title={item.description}>
                          {item.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
