import { LaneLabel } from './ui/LaneIcon';
import { DropdownSelect } from './ui/DropdownSelect';
import React from 'react';
import { ArrowDown, Check, CheckCircle2, ChevronDown, History, Layers, LockKeyhole, RotateCcw, ShieldBan, ShieldCheck, Swords, Undo2, UserRound } from 'lucide-react';
import type { Hero, Lane } from '../types';
import { TOURNAMENT_PHASES } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { HeroThumbnail } from './ui/AssetThumbnail';

interface DraftSimulatorProps {
  hideControls?: boolean;
  playerSide?: Side;
  bluePicks: Array<Hero | null>;
  redPicks: Array<Hero | null>;
  blueBans: Array<Hero | null>;
  redBans: Array<Hero | null>;
  blueAssignedLanes?: Map<number, Lane>;
  redAssignedLanes?: Map<number, Lane>;
  currentTurn: { side: Side; action: 'ban' | 'pick'; stepIndex: number; isComplete: boolean };
  fearlessEnabled: boolean;
  onToggleFearless: (value: boolean) => void;
  gameNumber: number;
  onGameNumberChange: (game: number) => void;
  onResetDraft: () => void;
  onUndoStep: () => void;
  onSelectSlot?: (side: Side, action: 'ban' | 'pick', index: number) => void;
  blueFearlessUsedHeroes?: Hero[];
  redFearlessUsedHeroes?: Hero[];
  onInspectHero?: (hero: Hero) => void;
  onRequestHero?: () => void;
}
export function DraftSimulator({ hideControls = false, playerSide, bluePicks, redPicks, blueBans, redBans, blueAssignedLanes, redAssignedLanes, currentTurn, fearlessEnabled, onToggleFearless, gameNumber, onGameNumberChange, onResetDraft, onUndoStep, onSelectSlot, blueFearlessUsedHeroes = [], redFearlessUsedHeroes = [], onInspectHero, onRequestHero }: DraftSimulatorProps) {
  const turnLabel = currentTurn.isComplete ? 'Draft selesai' : (currentTurn.side === 'blue' ? 'Blue' : 'Red') + ' · ' + (currentTurn.action === 'ban' ? 'Ban hero' : 'Pick hero');
  const TurnIcon = currentTurn.isComplete ? CheckCircle2 : currentTurn.action === 'ban' ? ShieldBan : Swords;
  const teams = [
    { side: 'blue' as Side, picks: bluePicks, bans: blueBans, history: blueFearlessUsedHeroes, label: 'Blue', caption: 'First pick' },
    { side: 'red' as Side, picks: redPicks, bans: redBans, history: redFearlessUsedHeroes, label: 'Red', caption: 'Last counter-pick' },
  ];
  return <section className="draft-board surface-panel" aria-label={playerSide ? 'Papan latihan draft' : 'Papan simulator draft'}>
    <div className="draft-board__header"><div className="section-heading"><span className="section-heading__icon"><Swords aria-hidden="true" /></span><div><h2>{playerSide ? 'Latihan draft' : 'Simulator draft'}</h2><p>Game {gameNumber} · {Math.min(currentTurn.stepIndex, 18)}/18 aksi selesai</p></div></div>
      {!hideControls && <div className="draft-controls">
        <button type="button" className="ui-button ui-button--quiet" aria-pressed={fearlessEnabled} onClick={() => onToggleFearless(!fearlessEnabled)}><ShieldCheck aria-hidden="true" />Fearless<span className="control-state">{fearlessEnabled ? 'Aktif' : 'Mati'}</span></button>
        {fearlessEnabled && <DropdownSelect label="Pilih game" icon={Layers} value={gameNumber} onChange={onGameNumberChange} options={[1, 2, 3, 4, 5].map(game => ({ value: game, label: `Game ${game}` }))} />}
        <button type="button" className="ui-icon-button" disabled={currentTurn.stepIndex === 0} aria-label="Urungkan aksi terakhir" title="Urungkan aksi terakhir" onClick={onUndoStep}><Undo2 aria-hidden="true" /></button>
        <button type="button" className="ui-icon-button ui-icon-button--danger" aria-label="Reset draft game ini" title="Reset game ini" onClick={onResetDraft}><RotateCcw aria-hidden="true" /></button>
      </div>}
    </div>
    <ol className="draft-phases" aria-label="Fase draft">{TOURNAMENT_PHASES.map(phase => {
      const active = !currentTurn.isComplete && currentTurn.stepIndex >= phase.start && currentTurn.stepIndex <= phase.end;
      const done = currentTurn.stepIndex > phase.end;
      const Icon = done ? Check : phase.isBan ? ShieldBan : Swords;
      return <li key={phase.id} className={(active ? 'is-current ' : '') + (done ? 'is-done' : '')} aria-current={active ? 'step' : undefined}><Icon aria-hidden="true" /><span>{phase.label}</span><span className="draft-phases__description">{phase.sub}</span></li>;
    })}</ol>
    <div className="draft-turn" data-side={currentTurn.side} role="status" aria-live="polite"><span><TurnIcon aria-hidden="true" /><strong>{turnLabel}</strong>{playerSide && !currentTurn.isComplete && <span className="muted-copy">{currentTurn.side === playerSide ? 'Giliran Anda' : 'Giliran AI'}</span>}</span>{!currentTurn.isComplete && onRequestHero && <button type="button" className="ui-button ui-button--small ui-button--quiet" onClick={onRequestHero}><ArrowDown aria-hidden="true" />Cari hero</button>}</div>
    <div className="draft-teams">{teams.map(team => {
      const activeSide = currentTurn.side === team.side && !currentTurn.isComplete;
      return <section key={team.side} className="draft-team" data-side={team.side} aria-label={'Tim ' + team.label}>
        <div className="draft-team__header"><div><h3><span className="team-dot" />{team.label}{playerSide && <span className="team-owner">{playerSide === team.side ? 'Anda' : 'AI'}</span>}</h3><p>{team.caption}</p></div>
          <div className="ban-slots" aria-label={'Ban tim ' + team.label}>{team.bans.map((hero, index) => {
            const active = activeSide && currentTurn.action === 'ban' && index === team.bans.findIndex(value => value === null);
            return <button type="button" key={index} className={'ban-slot' + (active ? ' is-active' : '')} aria-label={hero ? 'Lihat hero terban ' + hero.name : team.label + ' ban ' + (index + 1) + (active ? ', giliran saat ini' : '')} title={hero ? hero.name : 'Ban ' + (index + 1)} disabled={hero ? !onInspectHero : !active || !onRequestHero} onClick={() => hero ? onInspectHero?.(hero) : onRequestHero?.()}>{hero ? <HeroThumbnail hero={hero} /> : <><ShieldBan aria-hidden="true" /><span>{index + 1}</span></>}</button>;
          })}</div>
        </div>
        <div className="team-picks">{team.picks.map((hero, index) => {
          const active = activeSide && currentTurn.action === 'pick' && index === team.picks.findIndex(value => value === null);
          const slotName = (team.side === 'blue' ? 'B' : 'R') + (index + 1);
          const laneMap = team.side === 'blue' ? blueAssignedLanes : redAssignedLanes;
          const assignedLane = hero ? laneMap?.get(hero.hero_id) : undefined;
          const displayLane = assignedLane ?? hero?.primary_lane;
          const isFlexShifted = Boolean(hero && assignedLane && assignedLane !== hero.primary_lane);
          return <button type="button" key={index} className={'pick-slot' + (hero ? ' is-filled' : '') + (active ? ' is-active' : '')} disabled={hero ? !onInspectHero : !active || !onRequestHero} aria-label={hero ? 'Lihat ' + slotName + ': ' + hero.name + ' (' + displayLane + ')' : slotName + (active ? ': pilih hero sekarang' : ': menunggu giliran')} onClick={() => { if (hero) onInspectHero?.(hero); else { onSelectSlot?.(team.side, 'pick', index); onRequestHero?.(); } }}>
            <span className="pick-slot__portrait">{hero ? <HeroThumbnail hero={hero} /> : <UserRound aria-hidden="true" />}<span className="slot-code">{slotName}</span></span>
            <span className="pick-slot__info"><strong>{hero?.name ?? (active ? 'Pilih hero' : slotName)}</strong><small>{hero ? <><LaneLabel lane={displayLane!} />{isFlexShifted && <span className="slot-flex-tag"> · Swap</span>}</> : active ? 'Giliran saat ini' : 'Menunggu'}</small></span>{active && <ArrowDown className="pick-slot__next" aria-hidden="true" />}
          </button>;
        })}</div>
        {fearlessEnabled && team.history.length > 0 && <details className="fearless-history"><summary><LockKeyhole aria-hidden="true" /><span>{team.history.length} hero terkunci</span><ChevronDown aria-hidden="true" /></summary><div>{team.history.map(hero => <button type="button" key={hero.hero_id} aria-label={'Lihat ' + hero.name + ', terkunci Fearless'} title={hero.name} onClick={() => onInspectHero?.(hero)} disabled={!onInspectHero}><HeroThumbnail hero={hero} /></button>)}</div></details>}
      </section>;
    })}</div>
    {currentTurn.isComplete && <p className="board-complete"><CheckCircle2 aria-hidden="true" />Kedua tim lengkap. Tinjau komposisi dan matchup sebelum game berikutnya.</p>}
  </section>;
}
