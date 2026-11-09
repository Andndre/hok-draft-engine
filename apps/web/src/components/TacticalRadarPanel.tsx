import { LaneLabel } from './ui/LaneIcon';
import React from 'react';
import { ArrowRight, BookOpen, ChartColumn, CheckCircle2, ChevronDown, Crosshair, Info, LoaderCircle, ShieldBan, SlidersHorizontal, Sparkles, Swords, Target } from 'lucide-react';
import type { Hero, TacticalVector, TacticalDelta } from '../types';
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
  onSelectCandidate: (hero: Hero) => void;
  onInspectHero?: (hero: Hero) => void;
  activeSide: 'blue' | 'red';
  isPickPhase: boolean;
  isComplete?: boolean;
  isWaiting?: boolean;
}
const axes: Array<{ key: keyof TacticalVector; label: string }> = [
  { key: 'draft_advantage', label: 'Keunggulan draft' }, { key: 'early_game_pressure', label: 'Tekanan awal' },
  { key: 'cc_chain_lockdown', label: 'Kontrol tim' }, { key: 'frontline_durability', label: 'Garis depan' },
  { key: 'enemy_carry_shutdown', label: 'Menahan carry' }, { key: 'draft_flexibility', label: 'Fleksibilitas' },
  { key: 'team_utility', label: 'Utilitas tim' },
];
export function TacticalRadarPanel({ scores, deltas = [], primaryInsight, phaseStrategy, onOpenPlanModal, onSelectQuickPlanA, recommendations, onSelectCandidate, onInspectHero, activeSide, isPickPhase, isComplete = false, isWaiting = false }: Props) {
  const ActionIcon = isPickPhase ? Swords : ShieldBan;
  const best = recommendations[0];
  return <section className="tactical-panel surface-panel" aria-label="Rekomendasi dan evaluasi draft">
    <div className="tactical-panel__header"><div className="section-heading"><span className="section-heading__icon"><Sparkles aria-hidden="true" /></span><div><h2>{isComplete ? 'Evaluasi draft' : 'Rekomendasi giliran'}</h2><p>{isComplete ? 'Komposisi kedua tim sudah lengkap' : 'Prioritas taktis untuk tim aktif'}</p></div></div><span className="side-badge" data-side={activeSide}>{activeSide === 'blue' ? 'Blue' : 'Red'} · {isPickPhase ? 'Pick' : 'Ban'}</span></div>
    {best && <div className="primary-recommendation"><div className="primary-recommendation__identity"><HeroThumbnail hero={best.hero} /><div><span className="eyebrow">Prioritas pertama</span><h3>{best.hero.name}</h3><p><LaneLabel lane={best.hero.primary_lane} /> · Tier {best.hero.tier}</p></div><span className="recommendation-rank">#1</span></div>
      <p className="recommendation-reason"><Crosshair aria-hidden="true" /><span>{plainText(best.proComboTag || best.laneTag || 'Melengkapi komposisi dan merespons pilihan lawan.')}</span></p>
      <div className="primary-recommendation__actions">{onInspectHero && <button type="button" className="ui-button ui-button--quiet" onClick={() => onInspectHero(best.hero)}><BookOpen aria-hidden="true" />Detail</button>}<button type="button" className={'ui-button ' + (isPickPhase ? 'ui-button--primary' : 'ui-button--ban')} onClick={() => onSelectCandidate(best.hero)}><ActionIcon aria-hidden="true" />{isPickPhase ? 'Pick ' : 'Ban '}{best.hero.name}<ArrowRight aria-hidden="true" /></button></div>
    </div>}
    {!best && <div className="recommendation-empty">{isComplete ? <CheckCircle2 aria-hidden="true" /> : isWaiting ? <Info aria-hidden="true" /> : <LoaderCircle className="is-spinning" aria-hidden="true" />}<p>{isComplete ? 'Draft selesai. Buka evaluasi komposisi di bawah.' : isWaiting ? 'Giliran AI. Rekomendasi tersedia saat giliran Anda.' : 'Menyiapkan rekomendasi untuk giliran ini…'}</p></div>}
    {recommendations.length > 1 && <details className="panel-disclosure"><summary><Swords aria-hidden="true" /><span>{recommendations.slice(1, 5).length} pilihan alternatif</span><ChevronDown aria-hidden="true" /></summary><div className="alternative-recommendations">{recommendations.slice(1, 5).map((rec, index) => <div key={rec.hero.hero_id}><button type="button" className="alternative-recommendation__profile" onClick={() => onInspectHero?.(rec.hero)} disabled={!onInspectHero}><span className="muted-copy">#{index + 2}</span><HeroThumbnail hero={rec.hero} /><span><strong>{rec.hero.name}</strong><small><LaneLabel lane={rec.hero.primary_lane} /></small></span></button><button type="button" className={'ui-button ui-button--small ' + (isPickPhase ? 'ui-button--quiet' : 'ui-button--ban')} aria-label={(isPickPhase ? 'Pick ' : 'Ban ') + rec.hero.name} onClick={() => onSelectCandidate(rec.hero)}><ActionIcon aria-hidden="true" />{isPickPhase ? 'Pick' : 'Ban'}</button></div>)}</div></details>}
    {phaseStrategy && !isComplete && <div className="plan-overview"><div className="plan-overview__heading"><h3>Rencana pembuka</h3>{onOpenPlanModal && <button type="button" className="ui-button ui-button--text" onClick={onOpenPlanModal}><SlidersHorizontal aria-hidden="true" />Atur Plan A/B</button>}</div><div className="plan-overview__cards">{[{ label: 'Plan A', hero: phaseStrategy.planAHero, banned: phaseStrategy.isPlanABanned }, { label: 'Plan B', hero: phaseStrategy.planBHero, banned: phaseStrategy.isPlanBBanned }].map(plan => <button type="button" key={plan.label} className={'plan-preview' + (phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id ? ' is-active' : '')} onClick={onOpenPlanModal} disabled={!onOpenPlanModal}>{plan.hero ? <HeroThumbnail hero={plan.hero} /> : <Target aria-hidden="true" />}<span><small>{plan.label}{plan.banned ? ' · Terban' : ''}</small><strong>{plan.hero?.name ?? 'Pilih target'}</strong></span>{phaseStrategy.plannedOpener?.hero_id === plan.hero?.hero_id && <CheckCircle2 aria-label="Rencana aktif" />}</button>)}</div></div>}
    {phaseStrategy && !isComplete && <details className="panel-disclosure"><summary><Target aria-hidden="true" /><span>Tujuan dan target pembuka</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><p>{plainText(phaseStrategy.phaseObjective)}</p>{onSelectQuickPlanA && <div className="opener-shortlist">{phaseStrategy.candidateOpeners.slice(0, 6).map(hero => <button type="button" key={hero.hero_id} onClick={() => onSelectQuickPlanA(hero.hero_id)}><HeroThumbnail hero={hero} /><span>{hero.name}</span></button>)}</div>}</div></details>}
    <details className="panel-disclosure" open={isComplete}><summary><ChartColumn aria-hidden="true" /><span>Komposisi · 7 dimensi</span><span className="metric-summary">{Math.round(scores.draft_advantage * 100)}/100</span><ChevronDown aria-hidden="true" /></summary><div className="disclosure-content"><div className="tactical-metrics">{axes.map(({ key, label }) => <div key={key}><div><span>{label}</span><strong>{Math.round(scores[key] * 100)}</strong></div><progress aria-label={label} value={Math.round(scores[key] * 100)} max={100} /></div>)}</div><p className="metric-caption">Indeks heuristik komposisi, bukan probabilitas kemenangan.</p>{primaryInsight && <p className="metric-insight">{plainText(primaryInsight)}</p>}{deltas.length > 0 && <ul className="tactical-deltas">{deltas.map(delta => <li key={delta.dimension}><span>{delta.label}</span><strong>{delta.deltaPercent > 0 ? '+' : ''}{delta.deltaPercent}%</strong></li>)}</ul>}</div></details>
  </section>;
}
