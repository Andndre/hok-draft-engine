import { DropdownSelect } from './ui/DropdownSelect';
import React, { useEffect, useMemo, useState } from 'react';
import type { Hero, Lane, SortMode, TournamentDataset, ViewMode } from '../types';
import { DRAFT_SEQUENCE, applyDraftAction, emptyPosition, getDraftTurn, isLegalHero, oppositeSide } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { createPracticeSession, practiceContext, reducePractice } from '../engine/practiceState';
import type { PracticeEvent, PracticeSession } from '../engine/practiceState';
import { OpponentClient } from '../engine/opponentClient';
import { evaluateTacticalScores, runTournamentInference } from '../engine/tournamentInference';
import { loadTournamentDataset } from '../engine/heroDataLoader';
import { AlertTriangle, ArrowRight, BookOpen, ChartColumn, CheckCircle2, ChevronDown, FilterX, Gamepad2, History, Info, Layers, Lightbulb, LoaderCircle, Play, RefreshCw, RotateCcw, SearchX, Settings2, Shield, ShieldCheck, SlidersHorizontal, Swords, Undo2 } from 'lucide-react';
import { HeroRosterToolbar } from './HeroRosterToolbar';
import { TacticalRadarPanel } from './TacticalRadarPanel';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { focusHeroSearch, plainText } from './ui/presentation';
import { DraftSimulator } from './DraftSimulator';
import { HeroCardCompact } from './HeroCardCompact';
import { HeroCardDetailed } from './HeroCardDetailed';
import { HeroWikiDrawer } from './HeroWikiDrawer';
import { PlanSelectionModal } from './PlanSelectionModal';

interface Props {
  dataset: TournamentDataset;
  active: boolean;
  assistance: boolean;
  onAssistanceChange: (enabled: boolean) => void;
  selectedLane: Lane | 'All';
  onLaneChange: (lane: Lane | 'All') => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: SortMode) => void;
  onViewChange: (view: ViewMode) => void;
  searchQuery: string;
  sortMode: SortMode;
  viewMode: ViewMode;
  favorites: Set<number>;
  onToggleFavorite: (id: number) => void;
}
const button = 'ui-button ui-button--quiet';
const axes = [
  ['draft_advantage', 'Keunggulan draft'],
  ['early_game_pressure', 'Tekanan awal'], ['cc_chain_lockdown', 'Kontrol tim'], ['frontline_durability', 'Garis depan'],
  ['enemy_carry_shutdown', 'Menahan carry'], ['draft_flexibility', 'Fleksibilitas'],
] as const;

export function PracticeDraft(props: Props) {
  const { active, assistance, onAssistanceChange } = props;
  const [snapshot, setSnapshot] = useState(props.dataset);
  const [setupSide, setSetupSide] = useState<Side>('blue');
  const [setupFearless, setSetupFearless] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [wikiHero, setWikiHero] = useState<Hero | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const playerSide = session?.config.playerSide ?? setupSide;
  const client = useMemo(() => new OpponentClient(snapshot, oppositeSide(playerSide)), [snapshot, playerSide, session?.sessionId]);
  useEffect(() => () => client.cancel(), [client]);
  const game = session?.games[session.gameIndex];
  const position = game?.position ?? emptyPosition();
  const turn = getDraftTurn(position.step);
  const latest = !!session && session.gameIndex === session.games.length - 1;
  const context = useMemo(() => session ? practiceContext(session, snapshot) : { heroes: snapshot.heroes, onlyGlobal: true, fearless: { blue: [], red: [] } }, [session, snapshot]);
  const canAct = !!session && latest && active && !turn.isComplete && turn.side === playerSide;
  const byId = useMemo(() => new Map(snapshot.heroes.map(h => [h.hero_id, h])), [snapshot]);
  const heroList = (ids: number[]) => ids.map(id => byId.get(id)!).filter(Boolean);
  const playerHeroes = heroList(position.picks[playerSide]);
  const enemyHeroes = heroList(position.picks[oppositeSide(playerSide)]);
  const hints = useMemo(() => game ? runTournamentInference(
    position.picks[playerSide], position.picks[oppositeSide(playerSide)], [...position.bans.blue, ...position.bans.red],
    context.fearless[playerSide], turn.action === 'pick', playerSide === 'blue', snapshot.heroes, position.step,
    game.playerPlan.a, game.playerPlan.b, true, snapshot.synergy, context.fearless[oppositeSide(playerSide)],
  ) : null, [game, playerSide, context, snapshot]);
  const recommendations = assistance && canAct ? hints?.recommendations ?? [] : [];
  const send = (event: PracticeEvent) => {
    client.cancel(); setError(''); setNotice(''); setThinking(false);
    setSession(previous => previous ? reducePractice(previous, event, snapshot) : previous);
  };

  useEffect(() => {
    if (!active || !session || !game || !latest || turn.isComplete || turn.side === playerSide) { setThinking(false); return; }
    const controller = new AbortController();
    const tag = { sessionId: session.sessionId, revision: session.revision };
    setThinking(true); setError('');
    // Build an explicit public-state request: playerPlan is deliberately excluded.
    void client.decide(game.position, { fearless: context.fearless, aiPlan: game.aiPlan }, tag, controller.signal).then(decision => {
      if (controller.signal.aborted) return;
      setThinking(false);
      if (decision.heroId === null) { setError('AI tidak menemukan aksi legal. Coba lagi atau reset game ini.'); return; }
      const action = { ...getDraftTurn(game.position.step), heroId: decision.heroId };
      if (applyDraftAction(game.position, action, context) === game.position) { setError('Pilihan AI sudah tidak tersedia. Coba lagi.'); return; }
      setNotice(decision.fallbackReason ?? `AI memilih ${byId.get(decision.heroId)?.name ?? 'hero'}.`);
      setSession(previous => previous ? reducePractice(previous, { type: 'commit', tag, actor: 'ai', heroId: decision.heroId! }, snapshot) : previous);
    }).catch(reason => {
      if (!controller.signal.aborted && reason?.name !== 'AbortError') { setThinking(false); setError('Keputusan AI belum tersedia. Coba lagi.'); }
    });
    return () => controller.abort();
  }, [active, session, game, latest, playerSide, client, context, snapshot, byId]);

  const start = async () => {
    client.cancel(); setStarting(true); setError('');
    try {
      const fresh = await loadTournamentDataset();
      setSnapshot(fresh);
      setSession(createPracticeSession(crypto.randomUUID(), { playerSide: setupSide, fearless: setupFearless }, fresh));
      setNotice('Seri dimulai. Data hero dipertahankan sampai seri selesai.');
    } catch { setError('Data latihan belum dapat dimuat. Coba mulai lagi.'); }
    finally { setStarting(false); }
  };
  const choose = (hero: Hero) => {
    if (!canAct || !session || !isLegalHero(position, hero.hero_id, context)) return;
    send({ type: 'commit', tag: { sessionId: session.sessionId, revision: session.revision }, actor: 'human', heroId: hero.hero_id });
    setWikiHero(null);
  };
  const filtered = useMemo(() => {
    const query = props.searchQuery.trim().toLowerCase();
    const rank = new Map((assistance && canAct ? hints?.recommendations ?? [] : []).map((r, index) => [r.hero.hero_id, index]));
    const rows = snapshot.heroes.filter(h => h.is_global_released === true && h.hero_id !== 511)
      .filter(h => props.selectedLane === 'All' || h.primary_lane === props.selectedLane || h.lanes.includes(props.selectedLane))
      .filter(h => !query || `${h.name} ${h.primary_role} ${h.primary_lane}`.toLowerCase().includes(query));
    return rows.sort((a, b) => {
      if (props.sortMode === 'ai' && assistance && canAct) return (rank.get(a.hero_id) ?? 999) - (rank.get(b.hero_id) ?? 999) || a.name.localeCompare(b.name);
      if (props.sortMode === 'win') return b.win_rate - a.win_rate;
      if (props.sortMode === 'pick') return b.pick_rate - a.pick_rate;
      return a.name.localeCompare(b.name);
    });
  }, [snapshot, props.searchQuery, props.selectedLane, props.sortMode, assistance, canAct, hints]);

  const assistanceControl = <label className="assistance-toggle"><Lightbulb aria-hidden="true" /><span>Bantuan taktis<small>{assistance ? 'Rekomendasi dan komposisi ditampilkan' : 'Uji keputusan tanpa rekomendasi AI'}</small></span><input type="checkbox" checked={assistance} onChange={event => onAssistanceChange(event.target.checked)} /></label>;
  if (!session || !game) return <section aria-label="Pengaturan latihan" className="practice-setup surface-panel">
    <div className="practice-setup__intro"><span className="practice-setup__icon"><Gamepad2 aria-hidden="true" /></span><h2>Latihan draft melawan AI</h2><p>Pimpin ban dan pick timmu. Pilih sisi dan bantuan yang kamu perlukan; AI mengendalikan tim lawan.</p><div className="practice-setup__heroes">{snapshot.heroes.filter(hero => hero.is_global_released).slice(0, 5).map(hero => <HeroThumbnail key={hero.hero_id} hero={hero} />)}<span>{snapshot.heroes.filter(hero => hero.is_global_released).length} hero Global</span></div></div>
    <div className="practice-setup__form"><fieldset><legend>Pilih sisi timmu</legend><div className="setup-side-options">{(['blue', 'red'] as Side[]).map(side => <label key={side} className={setupSide === side ? 'is-selected' : ''}><input type="radio" name="practice-side" value={side} checked={setupSide === side} onChange={() => setSetupSide(side)} />{side === 'blue' ? <Shield aria-hidden="true" /> : <Swords aria-hidden="true" />}<span><strong>{side === 'blue' ? 'Blue side' : 'Red side'}</strong><small>{side === 'blue' ? 'Amankan first pick' : 'Respons & last counter-pick'}</small></span></label>)}</div></fieldset>
      <div className="setup-options">{assistanceControl}<label className="assistance-toggle"><ShieldCheck aria-hidden="true" /><span>Seri Fearless<small>Hero terpakai terkunci per tim, hingga 5 game</small></span><input type="checkbox" checked={setupFearless} onChange={event => setSetupFearless(event.target.checked)} /></label></div>
      {error && <p role="alert" className="inline-feedback inline-feedback--error"><AlertTriangle aria-hidden="true" />{error}</p>}
      <button type="button" className="ui-button ui-button--primary" onClick={() => void start()} disabled={starting}>{starting ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Play aria-hidden="true" />}{starting ? 'Memuat data…' : 'Mulai latihan'}<ArrowRight aria-hidden="true" /></button>
    </div>
  </section>;

  const padded = (ids: number[], count: number) => [...heroList(ids), ...Array(Math.max(0, count - ids.length)).fill(null)];
  const canUndo = latest && game.actions.some(action => action.side === playerSide);
  const playerRadar = evaluateTacticalScores(playerHeroes, enemyHeroes);
  const enemyRadar = evaluateTacticalScores(enemyHeroes, playerHeroes);
  const unavailablePlans = new Set([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red, ...context.fearless[playerSide]]);
  const previewStep = DRAFT_SEQUENCE.findIndex((step, index) => index >= position.step && step.side === playerSide);
  const previewPosition = canAct ? position : { ...position, step: previewStep < 0 ? 18 : previewStep };
  const rosterAction = getDraftTurn(previewPosition.step).action;
  return <section aria-label="Latihan draft aktif" className="practice-session">
    <div className="practice-session__controls surface-panel"><div className="practice-session__heading"><div className="section-heading"><span className="section-heading__icon"><Gamepad2 aria-hidden="true" /></span><div><h2>Anda: {playerSide === 'blue' ? 'Blue' : 'Red'} · AI: {playerSide === 'blue' ? 'Red' : 'Blue'}</h2><p>Game {session.gameIndex + 1} · {session.config.fearless ? 'Seri Fearless' : 'Draft biasa'}</p></div></div>{assistanceControl}</div>
      <div className="practice-session__actions"><DropdownSelect label="Pilih game latihan" icon={History} value={session.gameIndex} onChange={index => send({ type: 'view', index })} options={session.games.map((_, index) => ({ value: index, label: `Game ${index + 1}${index < session.games.length - 1 ? ' · ulasan' : ''}` }))} />
        <button type="button" className={button} onClick={() => send({ type: 'undo' })} disabled={!canUndo}><Undo2 aria-hidden="true" />Urungkan</button>
        <button type="button" className={button} onClick={() => send({ type: 'reset' })} disabled={!latest}><RotateCcw aria-hidden="true" />Reset game</button>
        <button type="button" className={button} onClick={() => { client.cancel(); setSession(null); setNotice(''); setError(''); }}><Settings2 aria-hidden="true" />Seri baru</button>
        {!turn.isComplete && latest && <button type="button" className={button} onClick={() => setPlanOpen(true)}><SlidersHorizontal aria-hidden="true" />Plan A/B</button>}
      </div>
      <div aria-live="polite" role="status" className="practice-status">{thinking ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : turn.isComplete ? <CheckCircle2 aria-hidden="true" /> : <Info aria-hidden="true" />}<span>{!latest ? 'Ulasan game terdahulu. Kembali ke game terbaru untuk melanjutkan.' : turn.isComplete ? 'Draft selesai. Evaluasi komposisi tersedia di bawah.' : thinking ? 'AI sedang memilih… Kamu tetap bisa membaca wiki hero.' : canAct ? 'Giliran Anda: ' + (turn.action === 'ban' ? 'ban' : 'pick') + ' hero.' : 'Menyiapkan giliran AI…'}</span></div>
      {notice && !thinking && <p className="practice-notice">{notice}</p>}
      {error && <div role="alert" className="inline-feedback inline-feedback--error"><AlertTriangle aria-hidden="true" /><p>{error}</p><button type="button" className={button} onClick={() => send({ type: 'retry' })}><RefreshCw aria-hidden="true" />Coba lagi</button></div>}
    </div>
    <DraftSimulator bluePicks={padded(position.picks.blue, 5)} redPicks={padded(position.picks.red, 5)} blueBans={padded(position.bans.blue, 4)} redBans={padded(position.bans.red, 4)} currentTurn={turn} fearlessEnabled={session.config.fearless} gameNumber={session.gameIndex + 1} onToggleFearless={() => {}} onGameNumberChange={() => {}} onResetDraft={() => {}} onUndoStep={() => {}} blueFearlessUsedHeroes={heroList(context.fearless.blue)} redFearlessUsedHeroes={heroList(context.fearless.red)} hideControls playerSide={playerSide} onInspectHero={setWikiHero} onRequestHero={canAct ? focusHeroSearch : undefined} />
    {turn.isComplete && <section aria-label="Evaluasi draft heuristik" className="practice-review surface-panel"><div className="section-heading"><span className="section-heading__icon"><ChartColumn aria-hidden="true" /></span><div><h2>Evaluasi draft heuristik</h2><p>Komposisi dan alternatif taktis, tanpa menetapkan pemenang pertandingan.</p></div></div>
      <div className="practice-review__teams">{[{ title: 'Tim Anda', radar: playerRadar }, { title: 'Tim AI', radar: enemyRadar }].map(({ title, radar }) => <div key={title}><h3>{title}</h3><dl>{axes.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Math.round(radar[key] * 100)}/100{radar[key] < 0.48 && <span>Perlu perhatian</span>}</dd></div>)}</dl></div>)}</div>
      <details className="panel-disclosure"><summary><History aria-hidden="true" /><span>Tinjau {game.traces.length} keputusan Anda</span><ChevronDown aria-hidden="true" /></summary><ol className="decision-review">{game.traces.map(trace => <li key={trace.actionIndex}><div><span className="count-badge">{trace.actionIndex + 1}</span>{byId.get(trace.heroId) && <HeroThumbnail hero={byId.get(trace.heroId)!} />}<strong>{game.actions[trace.actionIndex].action === 'ban' ? 'Ban ' : 'Pick '}{byId.get(trace.heroId)?.name}</strong></div><p>Alternatif pada posisi saat itu:</p><ul>{trace.alternatives.map(alternative => <li key={alternative.heroId}><button type="button" onClick={() => setWikiHero(byId.get(alternative.heroId) ?? null)}>{byId.get(alternative.heroId) && <HeroThumbnail hero={byId.get(alternative.heroId)!} />}<span>{byId.get(alternative.heroId)?.name}</span><BookOpen aria-hidden="true" /></button><p>{plainText(alternative.reason)}</p></li>)}</ul></li>)}</ol></details>
      {latest && session.games.length < 5 && <button type="button" className="ui-button ui-button--primary" onClick={() => send({ type: 'next' })}><Layers aria-hidden="true" />Lanjut game {session.games.length + 1}<ArrowRight aria-hidden="true" /></button>}
    </section>}
    <div className={assistance && !turn.isComplete && latest ? 'draft-workspace' : ''}>
      <section className="hero-roster" aria-label="Roster latihan Global"><HeroRosterToolbar title="Roster Global" count={filtered.length} searchQuery={props.searchQuery} onSearchChange={props.onSearchChange} selectedLane={props.selectedLane} onLaneChange={props.onLaneChange} sortMode={props.sortMode} onSortChange={props.onSortChange} viewMode={props.viewMode} onViewChange={props.onViewChange} hideAiSort={!assistance} active={active} />
        {!filtered.length ? <div className="empty-state"><SearchX aria-hidden="true" /><h3>Hero tidak ditemukan</h3><p>Ubah pencarian atau bersihkan filter lane yang aktif.</p><button type="button" className={button} onClick={() => { props.onSearchChange(''); props.onLaneChange('All'); }}><FilterX aria-hidden="true" />Bersihkan filter</button></div> : <div className={'hero-grid' + (props.viewMode === 'detailed' ? ' hero-grid--detailed' : '')}>{filtered.map(hero => {
          const legal = isLegalHero(previewPosition, hero.hero_id, context);
          const rank = recommendations.findIndex(rec => rec.hero.hero_id === hero.hero_id) + 1;
          const shared = { hero, onClick: setWikiHero, onSelect: choose, isUnavailable: !legal && !turn.isComplete, selectionDisabled: !canAct, action: rosterAction };
          return props.viewMode === 'compact' ? <HeroCardCompact key={hero.hero_id} {...shared} quickBadge={rank > 0 && rank <= 5 ? 'AI #' + rank : undefined} /> : <HeroCardDetailed key={hero.hero_id} {...shared} aiRank={rank > 0 ? rank : undefined} />;
        })}</div>}
      </section>
      {assistance && !turn.isComplete && latest && hints && <aside className="analysis-sidebar"><TacticalRadarPanel scores={playerRadar} phaseStrategy={hints.phaseStrategy} recommendations={recommendations} isWaiting={!canAct} onSelectCandidate={choose} onInspectHero={setWikiHero} activeSide={playerSide} isPickPhase={turn.action === 'pick'} onOpenPlanModal={() => setPlanOpen(true)} onSelectQuickPlanA={heroId => send({ type: 'plan', plan: 'a', heroId })} /></aside>}
    </div>
    <HeroWikiDrawer hero={wikiHero} onClose={() => setWikiHero(null)} isFavorite={!!wikiHero && props.favorites.has(wikiHero.hero_id)} onToggleFavorite={props.onToggleFavorite} onPickForDraft={canAct && wikiHero && isLegalHero(position, wikiHero.hero_id, context) ? choose : undefined} draftActionLabel={turn.action === 'ban' ? 'Ban hero ini' : 'Pick hero ini'} allHeroes={snapshot.heroes} onSelectRelatedHero={setWikiHero} />
    <PlanSelectionModal isOpen={planOpen && latest} onClose={() => setPlanOpen(false)} heroes={snapshot.heroes} currentPlanAId={game.playerPlan.a} currentPlanBId={game.playerPlan.b} onSelectPlanA={heroId => send({ type: 'plan', plan: 'a', heroId })} onSelectPlanB={heroId => send({ type: 'plan', plan: 'b', heroId })} activeSide={playerSide} unavailableHeroIds={unavailablePlans} recommendedOpeners={assistance ? hints?.phaseStrategy.candidateOpeners ?? [] : []} onlyGlobalReleased />
  </section>;
}
