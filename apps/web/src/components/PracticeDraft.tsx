import { DropdownSelect } from './ui/DropdownSelect';
import React, { useEffect, useMemo, useState } from 'react';
import type { DraftFormat, DuetPackageOption, Hero, Lane, LaneAssignmentMap, SortMode, TournamentDataset, ViewMode } from '../types';
import { DRAFT_SEQUENCE, applyDraftAction, emptyPosition, getDraftSequence, getDraftTurn, isLegalHero, oppositeSide } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { createPracticeSession, practiceContext, reducePractice } from '../engine/practiceState';
import type { DecisionTrace, PracticeEvent, PracticeSession } from '../engine/practiceState';
import { OpponentClient } from '../engine/opponentClient';
import { evaluateTacticalScores, runTournamentInference } from '../engine/tournamentInference';
import { assignmentToHeroLaneMap, buildDefaultLaneAssignments, swapAssignedLanes } from '../engine/gamePlan';
import { loadTournamentDataset } from '../engine/heroDataLoader';
import { AlertTriangle, ArrowRight, BookOpen, ChartColumn, CheckCircle2, ChevronDown, FilterX, Gamepad2, History, Info, Layers, Lightbulb, LoaderCircle, Play, RefreshCw, RotateCcw, SearchX, Settings2, Shield, ShieldCheck, SlidersHorizontal, Swords, Undo2 } from 'lucide-react';
import { HeroRosterToolbar } from './HeroRosterToolbar';
import { TacticalRadarPanel } from './TacticalRadarPanel';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { focusHeroSearch, plainText } from './ui/presentation';
import { DraftSimulator } from './DraftSimulator';
import { PostDraftGamePlanPanel } from './PostDraftGamePlanPanel';
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
  onlyGlobalReleased?: boolean;
}
const button = 'ui-button ui-button--quiet';
const axes = [
  ['draft_advantage', 'Keunggulan draft'],
  ['early_game_pressure', 'Tekanan awal'], ['cc_chain_lockdown', 'Kontrol tim'], ['frontline_durability', 'Garis depan'],
  ['enemy_carry_shutdown', 'Menahan carry'], ['draft_flexibility', 'Fleksibilitas'], ['team_utility', 'Utilitas tim'],
] as const;

export function PracticeDraft(props: Props) {
  const { active, assistance, onAssistanceChange } = props;
  const [snapshot, setSnapshot] = useState(props.dataset);
  const [setupSide, setSetupSide] = useState<Side>('blue');
  const [setupFormat, setSetupFormat] = useState<DraftFormat>('tournament');
  const [setupFearless, setSetupFearless] = useState(true);
  const [setupBanCount, setSetupBanCount] = useState<3 | 4 | 5>(3);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [wikiHero, setWikiHero] = useState<Hero | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [laneOverridesByKey, setLaneOverridesByKey] = useState<Record<string, { blue?: LaneAssignmentMap | null; red?: LaneAssignmentMap | null }>>({});
  const playerSide = session?.config.playerSide ?? setupSide;
  const gameKey = session ? `${session.sessionId}-${session.gameIndex}` : '';
  const client = useMemo(() => new OpponentClient(snapshot, oppositeSide(playerSide)), [snapshot, playerSide, session?.sessionId]);
  useEffect(() => () => client.cancel(), [client]);
  const onlyGlobal = props.onlyGlobalReleased ?? true;
  const game = session?.games[session.gameIndex];
  const position = game?.position ?? emptyPosition();
  const format = session?.config.format ?? setupFormat;
  const turn = getDraftTurn(position.step, format);
  const latest = !!session && session.gameIndex === session.games.length - 1;
  const context = useMemo(() => session ? practiceContext(session, snapshot) : { heroes: snapshot.heroes, onlyGlobal, fearless: { blue: [], red: [] }, format: setupFormat }, [session, snapshot, onlyGlobal, setupFormat]);
  const canAct = !!session && latest && active && !turn.isComplete && turn.side === playerSide;
  const byId = useMemo(() => new Map(snapshot.heroes.map(h => [h.hero_id, h])), [snapshot]);
  const heroList = (ids: number[]) => ids.map(id => byId.get(id)!).filter(Boolean);
  const blueHeroesList = useMemo(() => position.picks.blue.map(id => byId.get(id)!).filter(Boolean), [position.picks.blue, byId]);
  const redHeroesList = useMemo(() => position.picks.red.map(id => byId.get(id)!).filter(Boolean), [position.picks.red, byId]);
  const kplLaneRates = snapshot.synergy?.hero_lane_rates;
  const defaultBlueAssignment = useMemo(() => buildDefaultLaneAssignments(blueHeroesList, kplLaneRates), [blueHeroesList, kplLaneRates]);
  const defaultRedAssignment = useMemo(() => buildDefaultLaneAssignments(redHeroesList, kplLaneRates), [redHeroesList, kplLaneRates]);
  const gameLaneOverrides = gameKey ? laneOverridesByKey[gameKey] : undefined;
  const activeBlueAssignment = gameLaneOverrides?.blue ?? defaultBlueAssignment;
  const activeRedAssignment = gameLaneOverrides?.red ?? defaultRedAssignment;
  const showAssignedLanes = turn.isComplete || assistance;
  const blueAssignedLanes = useMemo(
    () => (showAssignedLanes ? assignmentToHeroLaneMap(activeBlueAssignment) : undefined),
    [showAssignedLanes, activeBlueAssignment]
  );
  const redAssignedLanes = useMemo(
    () => (showAssignedLanes ? assignmentToHeroLaneMap(activeRedAssignment) : undefined),
    [showAssignedLanes, activeRedAssignment]
  );
  const playerHeroes = heroList(position.picks[playerSide]);
  const enemyHeroes = heroList(position.picks[oppositeSide(playerSide)]);
  const activeBans = (format === 'ranked' && turn.action === 'ban')
    ? position.bans[playerSide]
    : [...position.bans.blue, ...position.bans.red];
  const hints = useMemo(() => game ? runTournamentInference(
    position.picks[playerSide], position.picks[oppositeSide(playerSide)], activeBans,
    context.fearless[playerSide], turn.action === 'pick', playerSide === 'blue', snapshot.heroes, position.step,
    game.playerPlan.a, game.playerPlan.b, true, snapshot.synergy, context.fearless[oppositeSide(playerSide)],
    format
  ) : null, [game, playerSide, context, snapshot, format, turn.action, activeBans]);
  const recommendations = assistance && canAct ? hints?.recommendations ?? [] : [];
  const duetPackages = assistance && canAct ? hints?.duetPackages ?? [] : [];
  const send = (event: PracticeEvent) => {
    client.cancel(); setError(''); setNotice(''); setThinking(false);
    if (gameKey && (event.type === 'undo' || event.type === 'reset')) {
      setLaneOverridesByKey(prev => {
        if (!prev[gameKey]) return prev;
        const next = { ...prev };
        delete next[gameKey];
        return next;
      });
    }
    setSession(previous => previous ? reducePractice(previous, event, snapshot) : previous);
  };

  useEffect(() => {
    if (!active || !session || !game || !latest || turn.isComplete || turn.side === playerSide) { setThinking(false); return; }
    const controller = new AbortController();
    const tag = { sessionId: session.sessionId, revision: session.revision };
    setThinking(true); setError('');
    // Build an explicit public-state request: playerPlan is deliberately excluded.
    void client.decide(game.position, { fearless: context.fearless, aiPlan: game.aiPlan, format }, tag, controller.signal).then(decision => {
      if (controller.signal.aborted) return;
      setThinking(false);
      if (decision.heroId === null) { setError('AI tidak menemukan aksi legal. Coba lagi atau reset game ini.'); return; }
      const action = { ...getDraftTurn(game.position.step, format), heroId: decision.heroId };
      if (applyDraftAction(game.position, action, context, format) === game.position) { setError('Pilihan AI sudah tidak tersedia. Coba lagi.'); return; }
      setNotice(decision.fallbackReason ?? `AI memilih ${byId.get(decision.heroId)?.name ?? 'hero'}.`);
      setSession(previous => previous ? reducePractice(previous, { type: 'commit', tag, actor: 'ai', heroId: decision.heroId! }, snapshot) : previous);
    }).catch(reason => {
      if (!controller.signal.aborted && reason?.name !== 'AbortError') { setThinking(false); setError('Keputusan AI belum tersedia. Coba lagi.'); }
    });
    return () => controller.abort();
  }, [active, session, game, latest, playerSide, client, context, snapshot, byId, format, turn.isComplete, turn.side]);

  const start = async () => {
    client.cancel(); setStarting(true); setError('');
    try {
      const fresh = await loadTournamentDataset();
      setSnapshot(fresh);
      setLaneOverridesByKey({});
      setSession(createPracticeSession(crypto.randomUUID(), { playerSide: setupSide, fearless: setupFormat === 'ranked' ? false : setupFearless, format: setupFormat, onlyGlobal, rankedBanCount: setupFormat === 'ranked' ? setupBanCount : undefined }, fresh));
      setNotice('Sesi dimulai. Data hero dipertahankan sampai sesi selesai.');
    } catch { setError('Data latihan belum dapat dimuat. Coba mulai lagi.'); }
    finally { setStarting(false); }
  };
  const choose = (hero: Hero) => {
    if (!canAct || !session || !isLegalHero(position, hero.hero_id, context, format)) return;
    send({ type: 'commit', tag: { sessionId: session.sessionId, revision: session.revision }, actor: 'human', heroId: hero.hero_id });
    setWikiHero(null);
  };
  const handleSelectDuetPackage = (duet: DuetPackageOption) => {
    if (!canAct || !session) return;
    send({ type: 'commit-duet', tag: { sessionId: session.sessionId, revision: session.revision }, actor: 'human', heroIds: [duet.primaryHero.hero_id, duet.secondaryHero.hero_id] });
  };
  const filtered = useMemo(() => {
    const query = props.searchQuery.trim().toLowerCase();
    const rank = new Map((assistance && canAct ? hints?.recommendations ?? [] : []).map((r, index) => [r.hero.hero_id, index]));
    const rows = snapshot.heroes.filter(h => (!onlyGlobal || h.is_global_released === true) && h.hero_id !== 511)
      .filter(h => props.selectedLane === 'All' || h.primary_lane === props.selectedLane || h.lanes.includes(props.selectedLane))
      .filter(h => !query || `${h.name} ${h.primary_role} ${h.primary_lane}`.toLowerCase().includes(query));
    return rows.sort((a, b) => {
      if (props.sortMode === 'ai' && assistance && canAct) return (rank.get(a.hero_id) ?? 999) - (rank.get(b.hero_id) ?? 999) || a.name.localeCompare(b.name);
      if (props.sortMode === 'win') return b.win_rate - a.win_rate;
      if (props.sortMode === 'pick') return b.pick_rate - a.pick_rate;
      return a.name.localeCompare(b.name);
    });
  }, [snapshot, onlyGlobal, props.searchQuery, props.selectedLane, props.sortMode, assistance, canAct, hints]);

  const assistanceControl = <label className="assistance-toggle"><Lightbulb aria-hidden="true" /><span>Bantuan taktis<small>{assistance ? 'Rekomendasi dan komposisi ditampilkan' : 'Uji keputusan tanpa rekomendasi AI'}</small></span><input type="checkbox" checked={assistance} onChange={event => onAssistanceChange(event.target.checked)} /></label>;
  if (!session || !game) return <section aria-label="Pengaturan latihan" className="practice-setup surface-panel">
    <div className="practice-setup__intro"><span className="practice-setup__icon"><Gamepad2 aria-hidden="true" /></span><h2>Latihan draft melawan AI</h2><p>Pimpin ban dan pick timmu. Pilih sisi dan bantuan yang kamu perlukan; AI mengendalikan tim lawan.</p><div className="practice-setup__heroes">{snapshot.heroes.filter(hero => hero.is_global_released).slice(0, 5).map(hero => <HeroThumbnail key={hero.hero_id} hero={hero} />)}<span>{snapshot.heroes.filter(hero => hero.is_global_released).length} hero Global</span></div></div>
    <div className="practice-setup__form">
      <fieldset><legend>Format draft</legend>
        <div className="setup-side-options">
          <label className={setupFormat === 'tournament' ? 'is-selected' : ''}><input type="radio" name="practice-format" value="tournament" checked={setupFormat === 'tournament'} onChange={() => setSetupFormat('tournament')} /><Swords aria-hidden="true" /><span><strong>Turnamen</strong><small>4 fase (Ban 2-2, Pick 3-3, Ban 2-2, Pick 2-2)</small></span></label>
          <label className={setupFormat === 'ranked' ? 'is-selected' : ''}><input type="radio" name="practice-format" value="ranked" checked={setupFormat === 'ranked'} onChange={() => setSetupFormat('ranked')} /><ShieldCheck aria-hidden="true" /><span><strong>Ranked</strong><small>Blind ban 3 simultan + pick standar</small></span></label>
        </div>
      </fieldset>
      <fieldset><legend>Pilih sisi timmu</legend><div className="setup-side-options">{(['blue', 'red'] as Side[]).map(side => <label key={side} className={setupSide === side ? 'is-selected' : ''}><input type="radio" name="practice-side" value={side} checked={setupSide === side} onChange={() => setSetupSide(side)} />{side === 'blue' ? <Shield aria-hidden="true" /> : <Swords aria-hidden="true" />}<span><strong>{side === 'blue' ? 'Blue side' : 'Red side'}</strong><small>{side === 'blue' ? 'Amankan first pick' : 'Respons & last counter-pick'}</small></span></label>)}</div></fieldset>
      {setupFormat === 'ranked' && <fieldset><legend>Jumlah ban per tim</legend><div className="setup-side-options">{([3, 4, 5] as const).map(n => <label key={n} className={setupBanCount === n ? 'is-selected' : ''}><input type="radio" name="practice-bancount" value={n} checked={setupBanCount === n} onChange={() => setSetupBanCount(n)} /><span><strong>{n}</strong><small>{n} ban</small></span></label>)}</div></fieldset>}
      <div className="setup-options">
        {assistanceControl}
        {setupFormat !== 'ranked' && <label className="assistance-toggle"><ShieldCheck aria-hidden="true" /><span>Seri Fearless<small>Hero terpakai terkunci per tim, hingga 5 game</small></span><input type="checkbox" checked={setupFearless} onChange={event => setSetupFearless(event.target.checked)} /></label>}
      </div>
      {error && <p role="alert" className="inline-feedback inline-feedback--error"><AlertTriangle aria-hidden="true" />{error}</p>}
      <button type="button" className="ui-button ui-button--primary" onClick={() => void start()} disabled={starting}>{starting ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Play aria-hidden="true" />}{starting ? 'Memuat data…' : 'Mulai latihan'}<ArrowRight aria-hidden="true" /></button>
    </div>
  </section>;

  const handleSwapPracticeLane = (side: Side, laneA: Lane, laneB: Lane) => {
    if (!gameKey) return;
    setLaneOverridesByKey(prev => {
      const cur = prev[gameKey] ?? {};
      const base = side === 'blue' ? (cur.blue ?? defaultBlueAssignment) : (cur.red ?? defaultRedAssignment);
      return {
        ...prev,
        [gameKey]: {
          ...cur,
          [side]: swapAssignedLanes(base, laneA, laneB),
        },
      };
    });
  };
  const handleResetPracticeLanes = () => {
    if (!gameKey) return;
    setLaneOverridesByKey(prev => {
      if (!prev[gameKey]) return prev;
      const next = { ...prev };
      delete next[gameKey];
      return next;
    });
  };
  const renderTrace = (trace: DecisionTrace) => {
    const hero = byId.get(trace.heroId);
    const partner = trace.partnerHeroId === undefined ? undefined : byId.get(trace.partnerHeroId);
    return <li key={trace.actionIndex}>
      <div>
        <span className="count-badge">{trace.actionIndex + 1}</span>
        {hero && <HeroThumbnail hero={hero} />}
        {partner && <HeroThumbnail hero={partner} />}
        <strong>{game.actions[trace.actionIndex]?.action === 'ban' ? 'Ban ' : 'Pick '}{hero?.name}{partner ? ` + ${partner.name}` : ''}</strong>
      </div>
      <p>Alternatif pada posisi saat itu:</p>
      <ul>{trace.alternatives.map(alternative => <li key={alternative.heroId}><button type="button" onClick={() => setWikiHero(byId.get(alternative.heroId) ?? null)}>{byId.get(alternative.heroId) && <HeroThumbnail hero={byId.get(alternative.heroId)!} />}<span>{byId.get(alternative.heroId)?.name}</span><BookOpen aria-hidden="true" /></button><p>{plainText(alternative.reason)}</p></li>)}</ul>
    </li>;
  };
  const rankedBanCount = session.config.rankedBanCount ?? 3;
  const banSlotsCount = session.config.format === 'ranked' ? rankedBanCount : 4;
  const maxSteps = session.config.format === 'ranked' ? 2 * rankedBanCount + 10 : 18;
  const padded = (ids: number[], count: number) => [...heroList(ids), ...Array(Math.max(0, count - ids.length)).fill(null)];
  const canUndo = latest && game.actions.some(action => action.side === playerSide);
  const playerRadar = evaluateTacticalScores(playerHeroes, enemyHeroes);
  const enemyRadar = evaluateTacticalScores(enemyHeroes, playerHeroes);
  const unavailablePlans = new Set([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red, ...context.fearless[playerSide]]);
  const draftSeq = getDraftSequence(session.config.format);
  const previewStep = draftSeq.findIndex((step, index) => index >= position.step && step.side === playerSide);
  const previewPosition = canAct ? position : { ...position, step: previewStep < 0 ? maxSteps : previewStep };
  const rosterAction = getDraftTurn(previewPosition.step, session.config.format).action;
  return <section aria-label="Latihan draft aktif" className="practice-session">
    <div className="practice-session__controls surface-panel"><div className="practice-session__heading"><div className="section-heading"><span className="section-heading__icon"><Gamepad2 aria-hidden="true" /></span><div><h2>Anda: {playerSide === 'blue' ? 'Blue' : 'Red'} · AI: {playerSide === 'blue' ? 'Red' : 'Blue'}</h2><p>{session.config.format === 'ranked' ? 'Pertandingan Ranked' : `Game ${session.gameIndex + 1} · ${session.config.fearless ? 'Seri Fearless' : 'Draft biasa'}`}</p></div></div>{assistanceControl}</div>
      <div className="practice-session__actions">{session.config.format !== 'ranked' && <DropdownSelect label="Pilih game latihan" icon={History} value={session.gameIndex} onChange={index => send({ type: 'view', index })} options={session.games.map((_, index) => ({ value: index, label: `Game ${index + 1}${index < session.games.length - 1 ? ' · ulasan' : ''}` }))} />}
        <button type="button" className={button} onClick={() => send({ type: 'undo' })} disabled={!canUndo}><Undo2 aria-hidden="true" />Urungkan</button>
        <button type="button" className={button} onClick={() => send({ type: 'reset' })} disabled={!latest}><RotateCcw aria-hidden="true" />Reset game</button>
        <button type="button" className={button} onClick={() => { client.cancel(); setSession(null); setLaneOverridesByKey({}); setNotice(''); setError(''); }}><Settings2 aria-hidden="true" />Sesi baru</button>
        {!turn.isComplete && latest && <button type="button" className={button} onClick={() => setPlanOpen(true)}><SlidersHorizontal aria-hidden="true" />Plan A/B</button>}
      </div>
      <div aria-live="polite" role="status" className="practice-status">{thinking ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : turn.isComplete ? <CheckCircle2 aria-hidden="true" /> : <Info aria-hidden="true" />}<span>{!latest ? 'Ulasan game terdahulu. Kembali ke game terbaru untuk melanjutkan.' : turn.isComplete ? 'Draft selesai. Evaluasi komposisi tersedia di bawah.' : thinking ? 'AI sedang memilih… Kamu tetap bisa membaca wiki hero.' : canAct ? 'Giliran Anda: ' + (turn.action === 'ban' ? 'ban' : 'pick') + ' hero.' : 'Menyiapkan giliran AI…'}</span></div>
      {notice && !thinking && <p className="practice-notice">{notice}</p>}
      {error && <div role="alert" className="inline-feedback inline-feedback--error"><AlertTriangle aria-hidden="true" /><p>{error}</p><button type="button" className={button} onClick={() => send({ type: 'retry' })}><RefreshCw aria-hidden="true" />Coba lagi</button></div>}
    </div>
    <DraftSimulator format={session.config.format ?? 'tournament'} bluePicks={padded(position.picks.blue, 5)} redPicks={padded(position.picks.red, 5)} blueBans={padded(position.bans.blue, banSlotsCount)} redBans={padded(position.bans.red, banSlotsCount)} blueAssignedLanes={blueAssignedLanes} redAssignedLanes={redAssignedLanes} currentTurn={turn} fearlessEnabled={session.config.fearless} gameNumber={session.gameIndex + 1} onToggleFearless={() => {}} onGameNumberChange={() => {}} onResetDraft={() => {}} onUndoStep={() => {}} blueFearlessUsedHeroes={heroList(context.fearless.blue)} redFearlessUsedHeroes={heroList(context.fearless.red)} hideControls playerSide={playerSide} onInspectHero={setWikiHero} onRequestHero={canAct ? focusHeroSearch : undefined} />
    {turn.isComplete && blueHeroesList.length === 5 && redHeroesList.length === 5 && (
      <PostDraftGamePlanPanel
        key={gameKey}
        blueHeroes={blueHeroesList}
        redHeroes={redHeroesList}
        synergy={snapshot.synergy}
        defaultPerspective={playerSide}
        blueAssignment={activeBlueAssignment}
        redAssignment={activeRedAssignment}
        hasCustomAssignments={Boolean(gameLaneOverrides?.blue || gameLaneOverrides?.red)}
        onSwapLane={handleSwapPracticeLane}
        onResetLanes={handleResetPracticeLanes}
        onInspectHero={setWikiHero}
      />
    )}
    {turn.isComplete && <section aria-label="Evaluasi draft heuristik" className="practice-review surface-panel"><div className="section-heading"><span className="section-heading__icon"><ChartColumn aria-hidden="true" /></span><div><h2>Evaluasi draft heuristik</h2><p>Komposisi dan alternatif taktis, tanpa menetapkan pemenang pertandingan.</p></div></div>
      <div className="practice-review__teams">{[{ title: 'Tim Anda', radar: playerRadar }, { title: 'Tim AI', radar: enemyRadar }].map(({ title, radar }) => <div key={title}><h3>{title}</h3><dl>{axes.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Math.round(radar[key] * 100)}/100{radar[key] < 0.48 && <span>Perlu perhatian</span>}</dd></div>)}</dl></div>)}</div>
      <details className="panel-disclosure"><summary><History aria-hidden="true" /><span>Tinjau {game.traces.length} keputusan Anda</span><ChevronDown aria-hidden="true" /></summary><ol className="decision-review">{game.traces.map(renderTrace)}</ol></details>
      {latest && session.games.length < 5 && <button type="button" className="ui-button ui-button--primary" onClick={() => send({ type: 'next' })}><Layers aria-hidden="true" />Lanjut game {session.games.length + 1}<ArrowRight aria-hidden="true" /></button>}
    </section>}
    <div className={assistance && !turn.isComplete && latest ? 'draft-workspace' : ''}>
      <section className="hero-roster" aria-label={onlyGlobal ? 'Roster latihan Global' : 'Roster latihan Global & CN'}><HeroRosterToolbar title={onlyGlobal ? 'Roster Global' : 'Roster Global + CN'} count={filtered.length} searchQuery={props.searchQuery} onSearchChange={props.onSearchChange} selectedLane={props.selectedLane} onLaneChange={props.onLaneChange} sortMode={props.sortMode} onSortChange={props.onSortChange} viewMode={props.viewMode} onViewChange={props.onViewChange} hideAiSort={!assistance} active={active} />
        {!filtered.length ? <div className="empty-state"><SearchX aria-hidden="true" /><h3>Hero tidak ditemukan</h3><p>Ubah pencarian atau bersihkan filter lane yang aktif.</p><button type="button" className={button} onClick={() => { props.onSearchChange(''); props.onLaneChange('All'); }}><FilterX aria-hidden="true" />Bersihkan filter</button></div> : <div className={'hero-grid' + (props.viewMode === 'detailed' ? ' hero-grid--detailed' : '')}>{filtered.map(hero => {
          const legal = isLegalHero(previewPosition, hero.hero_id, context, format);
          const rec = recommendations.find(r => r.hero.hero_id === hero.hero_id);
          const rank = rec ? recommendations.indexOf(rec) + 1 : 0;
          const isUnavailable = !legal && !turn.isComplete;
          let unavailableLabel: string | undefined = undefined;
          if (isUnavailable) {
            if (position.picks.blue.includes(hero.hero_id) || position.picks.red.includes(hero.hero_id)) {
              unavailableLabel = 'Terpilih';
            } else if (format === 'ranked' && rosterAction === 'ban') {
              if (position.bans[playerSide].includes(hero.hero_id)) unavailableLabel = 'Terban';
            } else if (position.bans.blue.includes(hero.hero_id) || position.bans.red.includes(hero.hero_id)) {
              unavailableLabel = 'Terban';
            } else if (session?.config.fearless && context.fearless[playerSide].includes(hero.hero_id)) {
              unavailableLabel = 'Terkunci';
            } else {
              unavailableLabel = rosterAction === 'ban' ? 'Terban' : 'Terpilih';
            }
          }
          const shared = {
            hero,
            onClick: setWikiHero,
            onSelect: choose,
            isUnavailable,
            unavailableLabel,
            selectionDisabled: !canAct,
            action: rosterAction,
            aiRank: rank > 0 ? rank : undefined,
            recommendationReason: rec?.proComboTag || rec?.laneTag,
            projection: rec?.projection,
          };
          return props.viewMode === 'compact' ? <HeroCardCompact key={hero.hero_id} {...shared} quickBadge={rank > 0 && rank <= 5 ? 'AI #' + rank : undefined} /> : <HeroCardDetailed key={hero.hero_id} {...shared} aiRank={rank > 0 ? rank : undefined} />;
        })}</div>}
      </section>
      {assistance && !turn.isComplete && latest && hints && <aside className="analysis-sidebar"><TacticalRadarPanel scores={playerRadar} phaseStrategy={hints.phaseStrategy} recommendations={recommendations} duetPackages={duetPackages} onSelectDuetPackage={handleSelectDuetPackage} isWaiting={!canAct} onSelectCandidate={choose} onInspectHero={setWikiHero} activeSide={playerSide} isPickPhase={turn.action === 'pick'} onOpenPlanModal={() => setPlanOpen(true)} onSelectQuickPlanA={heroId => send({ type: 'plan', plan: 'a', heroId })} /></aside>}
    </div>
    <HeroWikiDrawer hero={wikiHero} onClose={() => setWikiHero(null)} isFavorite={!!wikiHero && props.favorites.has(wikiHero.hero_id)} onToggleFavorite={props.onToggleFavorite} onPickForDraft={canAct && wikiHero && isLegalHero(position, wikiHero.hero_id, context, format) ? choose : undefined} draftActionLabel={turn.action === 'ban' ? 'Ban hero ini' : 'Pick hero ini'} allHeroes={snapshot.heroes} onSelectRelatedHero={setWikiHero} itemCatalog={snapshot.items} spellCatalog={snapshot.spells} />
    <PlanSelectionModal isOpen={planOpen && latest} onClose={() => setPlanOpen(false)} heroes={snapshot.heroes} currentPlanAId={game.playerPlan.a} currentPlanBId={game.playerPlan.b} onSelectPlanA={heroId => send({ type: 'plan', plan: 'a', heroId })} onSelectPlanB={heroId => send({ type: 'plan', plan: 'b', heroId })} activeSide={playerSide} unavailableHeroIds={unavailablePlans} recommendedOpeners={assistance ? hints?.phaseStrategy.candidateOpeners ?? [] : []} onlyGlobalReleased={onlyGlobal} />
  </section>;
}
