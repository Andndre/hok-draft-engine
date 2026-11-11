import { LaneLabel } from './ui/LaneIcon';
import { DropdownSelect } from './ui/DropdownSelect';
import React from 'react';
import { ArrowDown, Check, CheckCircle2, ChevronDown, History, Layers, LockKeyhole, RotateCcw, ShieldBan, ShieldCheck, Swords, Undo2, UserRound } from 'lucide-react';
import type { DraftFormat, Hero, Lane } from '../types';
import { getDraftPhases } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { HeroThumbnail } from './ui/AssetThumbnail';

interface DraftSimulatorProps {
  format?: DraftFormat;
  onFormatChange?: (format: DraftFormat) => void;
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
  seriesFormat?: 'BO3' | 'BO5' | 'BO7';
  onSeriesFormatChange?: (sf: 'BO3' | 'BO5' | 'BO7') => void;
  blueTeamName?: string;
  redTeamName?: string;
  onSwapSides?: () => void;
  onRecordWinner?: (side: 'blue' | 'red') => void;
  currentGameWinner?: 'blue' | 'red' | null;
  seriesScore?: { teamA: number; teamB: number };
  teamAName?: string;
  teamBName?: string;
  isUltimateBattle?: boolean;
  fearlessConflicts?: Array<{ game: number; side: Side; heroId: number; heroName?: string }>;
}
export function DraftSimulator({
  format = 'tournament',
  onFormatChange,
  hideControls = false,
  playerSide,
  bluePicks,
  redPicks,
  blueBans,
  redBans,
  blueAssignedLanes,
  redAssignedLanes,
  currentTurn,
  fearlessEnabled,
  onToggleFearless,
  gameNumber,
  onGameNumberChange,
  onResetDraft,
  onUndoStep,
  onSelectSlot,
  blueFearlessUsedHeroes = [],
  redFearlessUsedHeroes = [],
  onInspectHero,
  onRequestHero,
  seriesFormat = 'BO5',
  onSeriesFormatChange,
  blueTeamName = 'Tim A',
  redTeamName = 'Tim B',
  onSwapSides,
  onRecordWinner,
  currentGameWinner,
  seriesScore = { teamA: 0, teamB: 0 },
  teamAName = 'Tim A',
  teamBName = 'Tim B',
  isUltimateBattle = false,
  fearlessConflicts = [],
}: DraftSimulatorProps) {
  const maxSteps = isUltimateBattle ? 10 : (format === 'ranked' ? 16 : 18);
  const turnLabel = currentTurn.isComplete
    ? 'Draft selesai'
    : (currentTurn.side === 'blue' ? 'Blue' : 'Red') + ' · ' + (currentTurn.action === 'ban' ? 'Ban hero' : 'Pick hero');
  const TurnIcon = currentTurn.isComplete ? CheckCircle2 : currentTurn.action === 'ban' ? ShieldBan : Swords;
  const teams = [
    { side: 'blue' as Side, picks: bluePicks, bans: blueBans, history: blueFearlessUsedHeroes, label: 'Blue', teamName: blueTeamName, caption: isUltimateBattle ? 'Blind pick' : 'First pick' },
    { side: 'red' as Side, picks: redPicks, bans: redBans, history: redFearlessUsedHeroes, label: 'Red', teamName: redTeamName, caption: isUltimateBattle ? 'Blind pick' : 'Last counter-pick' },
  ];
  const phases = getDraftPhases(format, isUltimateBattle);
  const maxGames = seriesFormat === 'BO3' ? 3 : seriesFormat === 'BO7' ? 7 : 5;
  const gameOptions = Array.from({ length: maxGames }, (_, i) => ({
    value: i + 1,
    label: (i + 1 === 7 && seriesFormat === 'BO7') ? 'Game 7 (Ultimate)' : `Game ${i + 1}`
  }));

  return (
    <section className="draft-board surface-panel" aria-label={playerSide ? 'Papan latihan draft' : 'Papan simulator draft'}>
      {fearlessConflicts.length > 0 && (
        <div className="surface-banner surface-banner--warning" role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px' }}>
          <strong>⚠️ Konflik Fearless Terdeteksi:</strong> Terdapat hero yang pernah dipick oleh tim yang sama di game lampau:{' '}
          {fearlessConflicts.map((c) => `${c.heroName ?? c.heroId} (Game ${c.game} ${c.side.toUpperCase()})`).join(', ')}.
        </div>
      )}
      <div className="draft-board__header">
        <div className="section-heading">
          <span className="section-heading__icon"><Swords aria-hidden="true" /></span>
          <div>
            <h2>{playerSide ? 'Latihan draft' : 'Simulator draft'}</h2>
            <p>
              {(isUltimateBattle ? 'Game 7 · Ultimate Battle' : format === 'ranked' ? 'Ranked Match' : `Game ${gameNumber}`) +
                ' · ' +
                Math.min(currentTurn.stepIndex, maxSteps) +
                '/' +
                maxSteps +
                ' aksi selesai'}
              {format !== 'ranked' && (
                <span className="muted-copy" style={{ marginLeft: '0.75rem', fontWeight: 600 }}>
                  ({teamAName} {seriesScore.teamA} - {seriesScore.teamB} {teamBName})
                </span>
              )}
            </p>
          </div>
        </div>
        {!hideControls && (
          <div className="draft-controls">
            {onFormatChange && (
              <DropdownSelect
                label="Format draft"
                icon={Swords}
                value={format}
                onChange={onFormatChange}
                options={[
                  { value: 'tournament', label: 'Turnamen' },
                  { value: 'ranked', label: 'Ranked' },
                ]}
              />
            )}
            {format !== 'ranked' && onSeriesFormatChange && (
              <DropdownSelect
                label="Format seri"
                icon={Layers}
                value={seriesFormat}
                onChange={(val) => onSeriesFormatChange(val as 'BO3' | 'BO5' | 'BO7')}
                options={[
                  { value: 'BO3', label: 'BO3' },
                  { value: 'BO5', label: 'BO5' },
                  { value: 'BO7', label: 'BO7' },
                ]}
              />
            )}
            {format !== 'ranked' && (
              <button
                type="button"
                className="ui-button ui-button--quiet"
                aria-pressed={fearlessEnabled}
                onClick={() => onToggleFearless(!fearlessEnabled)}
              >
                <ShieldCheck aria-hidden="true" />Fearless
                <span className="control-state">{fearlessEnabled ? 'Aktif' : 'Mati'}</span>
              </button>
            )}
            {format !== 'ranked' && onSwapSides && (
              <button
                type="button"
                className="ui-button ui-button--quiet"
                disabled={currentTurn.stepIndex > 0}
                title={currentTurn.stepIndex > 0 ? 'Tukar sisi hanya dapat dilakukan sebelum draft dimulai' : 'Tukar sisi tim (Blue / Red)'}
                onClick={onSwapSides}
              >
                ⇄ Tukar Sisi
              </button>
            )}
            {format !== 'ranked' && fearlessEnabled && (
              <DropdownSelect
                label="Pilih game"
                icon={Layers}
                value={gameNumber}
                onChange={onGameNumberChange}
                options={gameOptions}
              />
            )}
            <button
              type="button"
              className="ui-icon-button"
              disabled={currentTurn.stepIndex === 0}
              aria-label="Urungkan aksi terakhir"
              title="Urungkan aksi terakhir"
              onClick={onUndoStep}
            >
              <Undo2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ui-icon-button ui-icon-button--danger"
              aria-label="Reset draft game ini"
              title="Reset game ini"
              onClick={onResetDraft}
            >
              <RotateCcw aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    <ol className="draft-phases" aria-label="Fase draft">{phases.map(phase => {
      const active = !currentTurn.isComplete && currentTurn.stepIndex >= phase.start && currentTurn.stepIndex <= phase.end;
      const done = currentTurn.stepIndex > phase.end;
      const Icon = done ? Check : phase.isBan ? ShieldBan : Swords;
      return <li key={phase.id} className={(active ? 'is-current ' : '') + (done ? 'is-done' : '')} aria-current={active ? 'step' : undefined}><Icon aria-hidden="true" /><span>{phase.label}</span><span className="draft-phases__description">{phase.sub}</span></li>;
    })}</ol>
    <div className="draft-turn" data-side={currentTurn.side} role="status" aria-live="polite"><span><TurnIcon aria-hidden="true" /><strong>{turnLabel}</strong>{playerSide && !currentTurn.isComplete && <span className="muted-copy">{currentTurn.side === playerSide ? 'Giliran Anda' : 'Giliran AI'}</span>}</span>{!currentTurn.isComplete && onRequestHero && <button type="button" className="ui-button ui-button--small ui-button--quiet" onClick={onRequestHero}><ArrowDown aria-hidden="true" />Cari hero</button>}</div>
    <div className="draft-teams">{teams.map(team => {
      const activeSide = currentTurn.side === team.side && !currentTurn.isComplete;
      return <section key={team.side} className="draft-team" data-side={team.side} aria-label={'Tim ' + team.label}>
        <div className="draft-team__header">
          <div>
            <h3>
              <span className="team-dot" />
              {team.label} · {team.teamName}
              {playerSide && <span className="team-owner">{playerSide === team.side ? ' (Anda)' : ' (AI)'}</span>}
            </h3>
            <p>{team.caption}</p>
          </div>
          {!isUltimateBattle && (
            <div className="ban-slots" aria-label={'Ban tim ' + team.label}>{team.bans.map((hero, index) => {
              const active = activeSide && currentTurn.action === 'ban' && index === team.bans.findIndex(value => value === null);
              const isAiBlindBan = format === 'ranked' && currentTurn.stepIndex < 6 && Boolean(playerSide) && playerSide !== team.side;
              return <button type="button" key={index} className={'ban-slot' + (active ? ' is-active' : '')} aria-label={isAiBlindBan ? 'Ban ' + (index + 1) + ' tim lawan (tersembunyi)' : hero ? 'Lihat hero terban ' + hero.name : team.label + ' ban ' + (index + 1) + (active ? ', giliran saat ini' : '')} title={isAiBlindBan ? 'Ban rahasia AI' : hero ? hero.name : 'Ban ' + (index + 1)} disabled={isAiBlindBan ? true : hero ? !onInspectHero : !active || !onRequestHero} onClick={() => { if (isAiBlindBan) return; if (hero) onInspectHero?.(hero); else onRequestHero?.(); }}>{isAiBlindBan ? <><LockKeyhole aria-hidden="true" /><span>?</span></> : hero ? <HeroThumbnail hero={hero} /> : <><ShieldBan aria-hidden="true" /><span>{index + 1}</span></>}</button>;
            })}</div>
          )}
        </div>
        <div className="team-picks">{team.picks.map((hero, index) => {
          const active = activeSide && currentTurn.action === 'pick' && index === team.picks.findIndex(value => value === null);
          const slotName = (team.side === 'blue' ? 'B' : 'R') + (index + 1);
          const laneMap = team.side === 'blue' ? blueAssignedLanes : redAssignedLanes;
          const assignedLane = hero ? laneMap?.get(hero.hero_id) : undefined;
          const displayLane = assignedLane ?? hero?.primary_lane;
          const isFlexShifted = Boolean(hero && assignedLane && assignedLane !== hero.primary_lane);
          return <button type="button" key={index} className={'pick-slot' + (hero ? ' is-filled' : '') + (active ? ' is-active' : '')} disabled={hero ? !onInspectHero : !active || !onRequestHero} title={hero ? hero.name + ' (' + displayLane + (isFlexShifted ? ' · Swap' : '') + ')' : undefined} aria-label={hero ? 'Lihat ' + slotName + ': ' + hero.name + ' (' + displayLane + (isFlexShifted ? ', Swap' : '') + ')' : slotName + (active ? ': pilih hero sekarang' : ': menunggu giliran')} onClick={() => { if (hero) onInspectHero?.(hero); else { onSelectSlot?.(team.side, 'pick', index); onRequestHero?.(); } }}>
            <span className="pick-slot__portrait">{hero ? <HeroThumbnail hero={hero} /> : active ? <ArrowDown className="pick-slot__next" aria-hidden="true" /> : <UserRound aria-hidden="true" />}</span>
            <span className="pick-slot__badges"><span className="slot-code">{slotName}</span>{isFlexShifted && <span className="slot-flex-tag">Swap</span>}</span>
            <span className="pick-slot__info"><strong>{hero?.name ?? (active ? 'Pilih hero' : 'Menunggu')}</strong><small>{hero ? <LaneLabel lane={displayLane!} /> : active ? 'Giliran ini' : 'Kosong'}</small></span>
          </button>;
        })}</div>
        {fearlessEnabled && team.history.length > 0 && <details className="fearless-history"><summary><LockKeyhole aria-hidden="true" /><span>{team.history.length} hero terkunci</span><ChevronDown aria-hidden="true" /></summary><div>{team.history.map(hero => <button type="button" key={hero.hero_id} aria-label={'Lihat ' + hero.name + ', terkunci Fearless'} title={hero.name} onClick={() => onInspectHero?.(hero)} disabled={!onInspectHero}><HeroThumbnail hero={hero} /></button>)}</div></details>}
      </section>;
    })}</div>
    {currentTurn.isComplete && (
      <div className="board-complete-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
        <p className="board-complete" style={{ margin: 0 }}>
          <CheckCircle2 aria-hidden="true" />Kedua tim lengkap. Tinjau komposisi dan matchup sebelum game berikutnya.
        </p>
        {format !== 'ranked' && onRecordWinner && (
          <div className="winner-selection-bar" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Hasil Game {gameNumber}:</span>
            <button
              type="button"
              className={`ui-button ui-button--small ${currentGameWinner === 'blue' ? 'ui-button--primary' : 'ui-button--quiet'}`}
              onClick={() => onRecordWinner('blue')}
            >
              🏆 {blueTeamName} (Blue) Menang
            </button>
            <button
              type="button"
              className={`ui-button ui-button--small ${currentGameWinner === 'red' ? 'ui-button--primary' : 'ui-button--quiet'}`}
              onClick={() => onRecordWinner('red')}
            >
              🏆 {redTeamName} (Red) Menang
            </button>
            {currentGameWinner && (
              <span className="muted-copy" style={{ fontSize: '0.8125rem' }}>
                (Pemenang tercatat: {currentGameWinner === 'blue' ? blueTeamName : redTeamName})
              </span>
            )}
          </div>
        )}
      </div>
    )}
    </section>
  );
}
