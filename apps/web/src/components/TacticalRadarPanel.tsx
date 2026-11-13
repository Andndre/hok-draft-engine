import { LaneLabel } from './ui/LaneIcon';
import React, { useState, useEffect } from 'react';
import { ArrowRight, BookOpen, ChartColumn, CheckCircle2, ChevronDown, Crosshair, Info, LoaderCircle, ShieldAlert, ShieldBan, ShieldCheck, SlidersHorizontal, Sparkles, Swords, Target, TrendingUp } from 'lucide-react';
import type { Hero, TacticalVector, TacticalDelta, DuetPackageOption } from '../types';
import type { TournamentPhaseStrategy, TournamentPredictionResult } from '../engine/tournamentInference';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { plainText } from './ui/presentation';

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

export function TacticalRadarPanel({ scores, deltas = [], primaryInsight, phaseStrategy, onOpenPlanModal, onSelectQuickPlanA, recommendations, onSelectCandidate, onInspectHero, activeSide, isPickPhase, isComplete = false, isWaiting = false, duetPackages = [], onSelectDuetPackage }: Props) {
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

  function SingleRankBadge({ heroId, recs }: { heroId: number; recs: Props['recommendations'] }) {
    const idx = recs.findIndex(r => r.hero.hero_id === heroId);
    const rank = idx >= 0 ? idx + 1 : null;
    return (
      <span
        role="status"
        aria-label={rank ? `Peringkat rekomendasi tunggal #${rank}` : 'Tidak ada di rekomendasi tunggal'}
        title={rank ? `Peringkat rekomendasi tunggal #${rank}` : 'Tidak ada di rekomendasi tunggal'}
        style={{ marginLeft: 'auto', background: 'rgba(255, 255, 255, 0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, color: rank ? '#c8f542' : '#94a3b8', whiteSpace: 'nowrap' }}
      >
        {rank ? `#${rank}` : '—'}
      </span>
    );
  }

  return <section className="tactical-panel surface-panel" aria-label="Rekomendasi dan evaluasi draft">
    <div className="tactical-panel__header"><div className="section-heading"><span className="section-heading__icon"><Sparkles aria-hidden="true" /></span><div><h2>{isComplete ? 'Evaluasi draft' : 'Rekomendasi giliran'}</h2><p>{isComplete ? 'Komposisi kedua tim sudah lengkap' : 'Prioritas taktis untuk tim aktif'}</p></div></div><span className="side-badge" data-side={activeSide}>{activeSide === 'blue' ? 'Blue' : 'Red'} · {isPickPhase ? 'Pick' : 'Ban'}</span></div>

    {activeDuet && !isComplete && !isWaiting && (
      <div className="duet-package-card" style={{ marginBottom: '1rem', padding: '0.875rem', background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#eab308', whiteSpace: 'nowrap' }}>
            💡 PAKET DUET
          </span>
          {duetPackages.length > 1 && (
            <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0, marginLeft: 'auto' }}>
              {duetPackages.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedDuetIdx(idx)}
                  className={`ui-button ui-button--small ${selectedDuetIdx === idx ? 'ui-button--primary' : 'ui-button--quiet'}`}
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', minHeight: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}
                  aria-label={`Paket #${idx + 1}`}
                  title={`Paket #${idx + 1}`}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: 1, background: 'rgba(0, 0, 0, 0.2)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
            <HeroThumbnail hero={activeDuet.primaryHero} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeDuet.primaryHero.name}</strong>
              <small><LaneLabel lane={activeDuet.primaryLane} /></small>
            </div>
            <SingleRankBadge heroId={activeDuet.primaryHero.hero_id} recs={recommendations} />
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#eab308' }}>+</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: 1, background: 'rgba(0, 0, 0, 0.2)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
            <HeroThumbnail hero={activeDuet.secondaryHero} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeDuet.secondaryHero.name}</strong>
              <small><LaneLabel lane={activeDuet.secondaryLane} /></small>
            </div>
            <SingleRankBadge heroId={activeDuet.secondaryHero.hero_id} recs={recommendations} />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', fontSize: '0.75rem', margin: '0.5rem 0' }}>
          <span style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
            {activeDuet.archetypeBadge}
          </span>
          {activeDuet.kplSynergyLabel && (
            <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
              {activeDuet.kplSynergyLabel}
            </span>
          )}
          {activeDuet.enemyExploitBadge && (
            <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
              {activeDuet.enemyExploitBadge}
            </span>
          )}
        </div>

        {onSelectDuetPackage && (
          <button
            type="button"
            className="ui-button ui-button--primary"
            style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}
            onClick={() => onSelectDuetPackage(activeDuet)}
          >
            <Swords aria-hidden="true" />
            Pick Paket Ini ({activeDuet.primaryHero.name} + {activeDuet.secondaryHero.name})
          </button>
        )}
      </div>
    )}

    {recommendations.length > 1 && !isComplete && !isWaiting && (
      <div className="recommendation-tabs" role="tablist" aria-label="Pilihan prioritas rekomendasi AI">
        {recommendations.slice(0, 5).map((rec, index) => {
          const isSelected = index === activeIndex;
          return (
            <button
              key={rec.hero.hero_id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={'rec-tab' + (isSelected ? ' is-active' : '')}
              onClick={() => setSelectedIndex(index)}
              title={`Rekomendasi #${index + 1}: ${rec.hero.name}`}
              aria-label={`Rekomendasi #${index + 1}: ${rec.hero.name}`}
            >
              <span className="rec-tab__rank">#{index + 1}</span>
              <span className="rec-tab__name">{rec.hero.name}</span>
            </button>
          );
        })}
      </div>
    )}

    {currentRec && <div className="primary-recommendation">
      <div className="primary-recommendation__identity">
        <HeroThumbnail hero={currentRec.hero} />
        <div>
          <span className="eyebrow">Rekomendasi #{activeIndex + 1}</span>
          <h3>{currentRec.hero.name}</h3>
          <p><LaneLabel lane={currentRec.hero.primary_lane} /> · Tier {currentRec.hero.tier}</p>
        </div>
      </div>

      <p className="recommendation-reason">
        <Crosshair aria-hidden="true" />
        <span>{plainText(currentRec.proComboTag || currentRec.laneTag || 'Melengkapi komposisi dan merespons pilihan lawan.')}</span>
      </p>

      {currentRec.projection && (
        <div className="outcome-projection" aria-label="Proyeksi hasil akhir draft">
          <div className="outcome-projection__header">
            <span className="outcome-projection__title">Proyeksi Hasil Draft</span>
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
        </div>
      )}

      <div className="primary-recommendation__actions">
        {onInspectHero && <button type="button" className="ui-button ui-button--quiet" onClick={() => onInspectHero(currentRec.hero)}><BookOpen aria-hidden="true" />Detail</button>}
        {onSelectCandidate && <button type="button" className={'ui-button ' + (isPickPhase ? 'ui-button--primary' : 'ui-button--ban')} onClick={() => onSelectCandidate(currentRec.hero)}><ActionIcon aria-hidden="true" />{isPickPhase ? 'Pick ' : 'Ban '}{currentRec.hero.name}<ArrowRight aria-hidden="true" /></button>}
      </div>
    </div>}

    {!currentRec && <div className="recommendation-empty">{isComplete ? <CheckCircle2 aria-hidden="true" /> : isWaiting ? <Info aria-hidden="true" /> : <LoaderCircle className="is-spinning" aria-hidden="true" />}<p>{isComplete ? 'Draft selesai. Buka evaluasi komposisi di bawah.' : isWaiting ? 'Giliran AI. Rekomendasi tersedia saat giliran Anda.' : 'Menyiapkan rekomendasi untuk giliran ini…'}</p></div>}

    {phaseStrategy && !isComplete && <div className="plan-overview"><div className="plan-overview__heading"><h3>Rencana pembuka</h3>{onOpenPlanModal && <button type="button" className="ui-button ui-button--text" onClick={onOpenPlanModal}><SlidersHorizontal aria-hidden="true" />Atur Plan A/B</button>}</div><div className="plan-overview__cards">{[{ label: 'Plan A', hero: phaseStrategy.planAHero, banned: phaseStrategy.isPlanABanned }, { label: 'Plan B', hero: phaseStrategy.planBHero, banned: phaseStrategy.isPlanBBanned }].map(plan => <button type="button" key={plan.label} className={'plan-preview' + (phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id ? ' is-active' : '')} onClick={onOpenPlanModal} disabled={!onOpenPlanModal}>{plan.hero ? <HeroThumbnail hero={plan.hero} /> : <Target aria-hidden="true" />}<span><small>{plan.label}{plan.banned ? ' · Terban' : ''}</small><strong>{plan.hero?.name ?? 'Pilih target'}</strong></span>{phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id && <CheckCircle2 aria-label="Rencana aktif" />}</button>)}</div></div>}
    {phaseStrategy && !isComplete && <details className="panel-disclosure"><summary><Target aria-hidden="true" /><span>Tujuan dan target pembuka</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><p>{plainText(phaseStrategy.phaseObjective)}</p>{onSelectQuickPlanA && <div className="opener-shortlist">{phaseStrategy.candidateOpeners.slice(0, 6).map(hero => <button type="button" key={hero.hero_id} onClick={() => onSelectQuickPlanA(hero.hero_id)}><HeroThumbnail hero={hero} /><span>{hero.name}</span></button>)}</div>}</div></details>}
    <details className="panel-disclosure" open={isComplete}><summary><ChartColumn aria-hidden="true" /><span>Komposisi · 7 dimensi</span><span className="metric-summary">{Math.round(scores.draft_advantage * 100)}/100</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><div className="tactical-metrics">{axes.map(({ key, label }) => <div key={key}><div><span>{label}</span><strong>{Math.round(scores[key] * 100)}</strong></div><progress aria-label={label} value={Math.round(scores[key] * 100)} max={100} /></div>)}</div><p className="metric-caption">Indeks heuristik komposisi, bukan probabilitas kemenangan.</p>{primaryInsight && <p className="metric-insight">{plainText(primaryInsight)}</p>}{deltas.length > 0 && <ul className="tactical-deltas">{deltas.map(delta => <li key={delta.dimension}><span>{delta.label}</span><strong>{delta.deltaPercent > 0 ? '+' : ''}{delta.deltaPercent}%</strong></li>)}</ul>}</div></details>
  </section>;
}
