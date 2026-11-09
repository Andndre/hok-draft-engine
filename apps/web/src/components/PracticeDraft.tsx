import React, { useEffect, useMemo, useState } from 'react';
import type { Hero, Lane, SortMode, TournamentDataset, ViewMode } from '../types';
import { applyDraftAction, emptyPosition, getDraftTurn, isLegalHero, oppositeSide } from '../engine/draftRules';
import type { Side } from '../engine/draftRules';
import { createPracticeSession, practiceContext, reducePractice } from '../engine/practiceState';
import type { PracticeEvent, PracticeSession } from '../engine/practiceState';
import { OpponentClient } from '../engine/opponentClient';
import { evaluateTacticalScores, runTournamentInference } from '../engine/tournamentInference';
import { loadTournamentDataset } from '../engine/heroDataLoader';
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
  searchQuery: string;
  sortMode: SortMode;
  viewMode: ViewMode;
  favorites: Set<number>;
  onToggleFavorite: (id: number) => void;
}
const button = 'min-h-11 rounded-lg border border-[#334155] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#232A38] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8FF01] disabled:cursor-not-allowed disabled:opacity-40';
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

  const assistanceControl = <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={assistance} onChange={e => onAssistanceChange(e.target.checked)} className="h-5 w-5 accent-[#B8FF01]" />Tampilkan bantuan taktis</label>;
  if (!session || !game) return <section aria-label="Pengaturan latihan" className="rounded-2xl border border-[#232A38] bg-[#12161F] p-6 space-y-5">
    <div><h2 className="text-xl font-bold">Latihan draft melawan AI</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Pimpin ban dan pick timmu. AI mengendalikan tim lawan langsung di browser. Pilihan sisi berlaku untuk seluruh seri.</p></div>
    <fieldset className="space-y-3"><legend className="mb-3 text-sm font-semibold">Pilih sisi timmu</legend><div className="flex flex-wrap gap-3">{(['blue', 'red'] as Side[]).map(side => <label key={side} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${setupSide === side ? 'border-[#B8FF01] bg-[#1A2410]' : 'border-[#334155]'}`}><input type="radio" name="practice-side" value={side} checked={setupSide === side} onChange={() => setSetupSide(side)} className="accent-[#B8FF01]" />{side === 'blue' ? 'Blue · first pick' : 'Red · respons & last pick'}</label>)}</div></fieldset>
    <div className="space-y-2">{assistanceControl}<label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={setupFearless} onChange={e => setSetupFearless(e.target.checked)} className="h-5 w-5 accent-[#B8FF01]" />Seri Fearless · hero terpakai terkunci per tim</label></div>
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    <button className={`${button} bg-[#B8FF01] text-black! hover:bg-[#d1ff55]`} onClick={() => void start()} disabled={starting}>{starting ? 'Memuat data…' : 'Mulai latihan'}</button>
  </section>;

  const padded = (ids: number[], count: number) => [...heroList(ids), ...Array(Math.max(0, count - ids.length)).fill(null)];
  const canUndo = latest && game.actions.some(a => a.side === playerSide);
  const playerRadar = evaluateTacticalScores(playerHeroes, enemyHeroes);
  const enemyRadar = evaluateTacticalScores(enemyHeroes, playerHeroes);
  const unavailablePlans = new Set([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red, ...context.fearless[playerSide]]);
  return <section aria-label="Latihan draft aktif" className="space-y-5">
    <div className="rounded-2xl border border-[#232A38] bg-[#12161F] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-bold">Latihan vs AI · Game {session.gameIndex + 1}</h2><p className="mt-1 text-sm text-slate-400">Anda: {playerSide.toUpperCase()} · AI: {oppositeSide(playerSide).toUpperCase()} · {session.config.fearless ? 'Fearless aktif' : 'Draft biasa'}</p></div>{assistanceControl}</div>
      <div className="flex flex-wrap gap-2">{session.games.map((_, index) => <button key={index} className={button} aria-current={index === session.gameIndex ? 'step' : undefined} onClick={() => send({ type: 'view', index })}>Game {index + 1}{index < session.games.length - 1 ? ' · ulasan' : ''}</button>)}
        <button className={button} onClick={() => send({ type: 'undo' })} disabled={!canUndo}>Urungkan keputusan</button>
        <button className={button} onClick={() => send({ type: 'reset' })} disabled={!latest}>Reset game</button>
        <button className={button} onClick={() => { client.cancel(); setSession(null); setNotice(''); setError(''); }}>Atur seri baru</button>
      </div>
      <div aria-live="polite" role="status" className="min-h-6 text-sm text-slate-300">{!latest ? 'Ulasan game terdahulu. Kembali ke game terbaru untuk melanjutkan.' : turn.isComplete ? 'Draft selesai. Evaluasi komposisi tersedia di bawah.' : thinking ? 'AI sedang memilih…' : canAct ? `Giliran Anda: ${turn.action === 'ban' ? 'ban' : 'pick'} hero.` : 'Menyiapkan giliran AI…'}</div>
      {notice && <p className="text-sm text-slate-400">{notice}</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-amber-300"><p>{error}</p><button className={button} onClick={() => send({ type: 'retry' })}>Coba lagi</button></div>}
    </div>
    <DraftSimulator bluePicks={padded(position.picks.blue, 5)} redPicks={padded(position.picks.red, 5)} blueBans={padded(position.bans.blue, 4)} redBans={padded(position.bans.red, 4)} currentTurn={turn}
      fearlessEnabled={session.config.fearless} gameNumber={session.gameIndex + 1} onToggleFearless={() => {}} onGameNumberChange={() => {}} onResetDraft={() => {}} onUndoStep={() => {}} onSelectSlot={() => {}}
      blueFearlessUsedHeroes={heroList(context.fearless.blue)} redFearlessUsedHeroes={heroList(context.fearless.red)} hideControls playerSide={playerSide} />

    {!turn.isComplete && latest && <div className="flex flex-wrap items-center gap-3"><button className={button} onClick={() => setPlanOpen(true)}>Atur Plan A/B</button><p className="text-sm text-slate-400">Rencana timmu disimpan terpisah dari AI lawan.</p></div>}
    {assistance && !turn.isComplete && <aside aria-label="Bantuan taktis" className="rounded-2xl border border-[#232A38] bg-[#12161F] p-4 space-y-4">
      <h3 className="font-bold">Komposisi tim Anda</h3><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{axes.map(([key, label]) => <div key={key}><span className="text-sm text-slate-400">{label}</span><p className="font-mono text-sm">{Math.round(playerRadar[key] * 100)}/100</p></div>)}</div>
      {canAct && <><h3 className="font-bold">Rekomendasi {turn.action}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{recommendations.slice(0, 5).map((rec, index) => <button key={rec.hero.hero_id} className={`${button} text-left`} onClick={() => choose(rec.hero)}><span className="block">#{index + 1} {rec.hero.name}</span><span className="mt-1 block text-sm font-normal text-slate-400">{rec.proComboTag || rec.laneTag || 'Prioritas taktis'}</span></button>)}</div></>}
    </aside>}

    {turn.isComplete && <section aria-label="Evaluasi draft heuristik" className="rounded-2xl border border-[#232A38] bg-[#12161F] p-4 space-y-5">
      <div><h3 className="text-lg font-bold">Evaluasi draft heuristik</h3><p className="mt-2 text-sm text-slate-400">Penilaian komposisi dan alternatif taktis. Hasil pertandingan tetap bergantung pada permainan kedua tim.</p></div>
      <div className="grid gap-4 md:grid-cols-2">{[{ title: 'Tim Anda', radar: playerRadar }, { title: 'Tim AI', radar: enemyRadar }].map(({ title, radar }) => <div key={title} className="rounded-xl border border-[#334155] p-4"><h4 className="mb-3 font-semibold">{title}</h4><dl className="space-y-2">{axes.map(([key, label]) => <div key={key} className="flex justify-between gap-3 text-sm"><dt>{label}</dt><dd className="font-mono">{Math.round(radar[key] * 100)}/100{radar[key] < 0.48 ? ' · perlu perhatian' : ''}</dd></div>)}</dl></div>)}</div>
      <details><summary className="min-h-11 cursor-pointer py-3 font-semibold">Tinjau {game.traces.length} keputusan Anda</summary><ol className="space-y-4">{game.traces.map(trace => <li key={trace.actionIndex} className="rounded-xl border border-[#334155] p-4 text-sm"><p className="font-semibold">Langkah {trace.actionIndex + 1}: {game.actions[trace.actionIndex].action} {byId.get(trace.heroId)?.name}</p><p className="mt-2 text-slate-400">Alternatif pada posisi saat itu:</p><ul className="mt-2 space-y-2">{trace.alternatives.map(alt => <li key={alt.heroId}><button className="min-h-11 text-left underline decoration-slate-600 underline-offset-4" onClick={() => setWikiHero(byId.get(alt.heroId) ?? null)}>{byId.get(alt.heroId)?.name}</button><span className="text-slate-400"> · {alt.reason}</span></li>)}</ul></li>)}</ol></details>
      {latest && session.games.length < 5 && <button className={`${button} bg-[#B8FF01] text-black!`} onClick={() => send({ type: 'next' })}>Lanjut game {session.games.length + 1}</button>}
    </section>}

    <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Roster Global · {filtered.length} hero</h3><span className="text-sm text-slate-400">Klik kartu untuk membaca wiki.</span></div>
      {!filtered.length ? <p className="rounded-xl border border-[#334155] p-6 text-sm text-slate-400">Tidak ada hero yang cocok. Ubah pencarian atau filter lane di bawah.</p> : <div className={`grid gap-3 ${props.viewMode === 'compact' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6'}`}>{filtered.map(hero => {
        const legal = isLegalHero(position, hero.hero_id, context);
        const index = recommendations.findIndex(r => r.hero.hero_id === hero.hero_id);
        return <div key={hero.hero_id} className="space-y-2">{props.viewMode === 'compact' ? <HeroCardCompact hero={hero} onClick={setWikiHero} quickBadge={index >= 0 ? `AI #${index + 1}` : undefined} /> : <HeroCardDetailed hero={hero} onClick={setWikiHero} aiRank={index >= 0 ? index + 1 : undefined} />}
          <button className={`${button} w-full`} onClick={() => choose(hero)} disabled={!canAct || !legal}>{!legal && !turn.isComplete ? 'Tidak tersedia' : `${turn.action === 'ban' ? 'Ban' : 'Pick'} ${hero.name}`}</button></div>;
      })}</div>}
    </div>
    <HeroWikiDrawer hero={wikiHero} onClose={() => setWikiHero(null)} isFavorite={!!wikiHero && props.favorites.has(wikiHero.hero_id)} onToggleFavorite={props.onToggleFavorite} onPickForDraft={canAct && wikiHero && isLegalHero(position, wikiHero.hero_id, context) ? choose : undefined} draftActionLabel={turn.action === 'ban' ? 'Ban hero ini' : 'Pick hero ini'} allHeroes={snapshot.heroes} onSelectRelatedHero={setWikiHero} />
    <PlanSelectionModal isOpen={planOpen && latest} onClose={() => setPlanOpen(false)} heroes={snapshot.heroes} currentPlanAId={game.playerPlan.a} currentPlanBId={game.playerPlan.b}
      onSelectPlanA={heroId => send({ type: 'plan', plan: 'a', heroId })} onSelectPlanB={heroId => send({ type: 'plan', plan: 'b', heroId })} activeSide={playerSide} unavailableHeroIds={unavailablePlans} recommendedOpeners={assistance ? hints?.phaseStrategy.candidateOpeners ?? [] : []} onlyGlobalReleased />
  </section>;
}
