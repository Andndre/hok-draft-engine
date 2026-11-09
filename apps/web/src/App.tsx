import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Hero, Lane, ActiveTab, SortMode, ViewMode, TacticalVector, TacticalDelta, GameDraftData } from './types';
import { loadHeroMetadata } from './engine/r2ModelLoader';
import { runJevInference, JevPredictionResult, TournamentPhaseStrategy } from './engine/jevInference';
import { computeTacticalDeltas } from './engine/deltaExplainer';
import { HeaderSortBar } from './components/HeaderSortBar';
import { HeroCardCompact } from './components/HeroCardCompact';
import { HeroCardDetailed } from './components/HeroCardDetailed';
import { BottomCommandDock } from './components/BottomCommandDock';
import { DraftSimulator } from './components/DraftSimulator';
import { TacticalRadarPanel } from './components/TacticalRadarPanel';
import { HeroWikiDrawer } from './components/HeroWikiDrawer';
import { PlanSelectionModal } from './components/PlanSelectionModal';

// Standard 20-step competitive ban/pick sequence
const DRAFT_SEQUENCE: Array<{ side: 'blue' | 'red'; action: 'ban' | 'pick' }> = [
  // Ban Phase 1 (4 bans)
  { side: 'blue', action: 'ban' },
  { side: 'red', action: 'ban' },
  { side: 'blue', action: 'ban' },
  { side: 'red', action: 'ban' },
  // Pick Phase 1 (6 picks)
  { side: 'blue', action: 'pick' },
  { side: 'red', action: 'pick' },
  { side: 'red', action: 'pick' },
  { side: 'blue', action: 'pick' },
  { side: 'blue', action: 'pick' },
  { side: 'red', action: 'pick' },
  // Ban Phase 2 (4 bans)
  { side: 'red', action: 'ban' },
  { side: 'blue', action: 'ban' },
  { side: 'red', action: 'ban' },
  { side: 'blue', action: 'ban' },
  // Pick Phase 2 (4 picks)
  { side: 'red', action: 'pick' },
  { side: 'blue', action: 'pick' },
  { side: 'blue', action: 'pick' },
  { side: 'red', action: 'pick' },
];

export const App: React.FC = () => {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<ActiveTab>('draft');
  const [selectedLane, setSelectedLane] = useState<Lane | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('ai');
  const [viewMode, setViewMode] = useState<ViewMode>('compact');

  // Favorites (persisted in localStorage)
  const [favorites, setFavorites] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('hok_fav_heroes');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Drawer modal & Strategic Plan Modal
  const [wikiHero, setWikiHero] = useState<Hero | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  // Fearless Draft (Global BP) State & Multi-Game Match Storage
  const [fearlessEnabled, setFearlessEnabled] = useState(true);
  const [gameNumber, setGameNumber] = useState(1);

  const createInitialGameDraft = (): GameDraftData => ({
    bluePicks: [null, null, null, null, null],
    redPicks: [null, null, null, null, null],
    blueBans: [null, null, null, null],
    redBans: [null, null, null, null],
    draftStep: 0,
    bluePlanAId: null,
    bluePlanBId: null,
    redPlanAId: null,
    redPlanBId: null,
  });

  const [gamesData, setGamesData] = useState<Record<number, GameDraftData>>({
    1: createInitialGameDraft(),
    2: createInitialGameDraft(),
    3: createInitialGameDraft(),
    4: createInitialGameDraft(),
    5: createInitialGameDraft(),
  });

  const currentGame = gamesData[gameNumber] || createInitialGameDraft();
  const { bluePicks, redPicks, blueBans, redBans, draftStep, bluePlanAId, bluePlanBId, redPlanAId, redPlanBId } = currentGame;

  // Jev AI State
  const [modelReady, setModelReady] = useState(false);
  const [modelLatency, setModelLatency] = useState<number | null>(null);
  const [tacticalScores, setTacticalScores] = useState<TacticalVector>({
    win_probability: 0.50,
    early_game_pressure: 0.50,
    cc_chain_lockdown: 0.50,
    frontline_durability: 0.50,
    enemy_carry_shutdown: 0.50,
    draft_flexibility: 0.50,
  });
  const [previousScores, setPreviousScores] = useState<TacticalVector | null>(null);
  const [deltas, setDeltas] = useState<TacticalDelta[]>([]);
  const [primaryInsight, setPrimaryInsight] = useState<string>('');
  const [recommendations, setRecommendations] = useState<JevPredictionResult['recommendations']>([]);
  const [phaseStrategy, setPhaseStrategy] = useState<TournamentPhaseStrategy | undefined>(undefined);

  // 1. Load Hero Metadata on mount
  useEffect(() => {
    loadHeroMetadata().then((data) => {
      setHeroes(data);
      setLoading(false);
    });
  }, []);

  // Save favorites to localStorage
  const handleToggleFavorite = (id: number) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('hok_fav_heroes', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // Determine current turn in sequence
  const currentTurn = useMemo(() => {
    if (draftStep >= DRAFT_SEQUENCE.length) {
      return { side: 'blue' as const, action: 'pick' as const, stepIndex: draftStep, isComplete: true };
    }
    const step = DRAFT_SEQUENCE[draftStep];
    return { ...step, stepIndex: draftStep, isComplete: false };
  }, [draftStep]);

  // Fearless Draft: Accumulate heroes picked by each team in prior games (Game < gameNumber)
  const blueFearlessUnavailableIds = useMemo(() => {
    if (!fearlessEnabled) return new Set<number>();
    const set = new Set<number>();
    for (let g = 1; g < gameNumber; g++) {
      const pastGame = gamesData[g];
      if (pastGame) {
        pastGame.bluePicks.forEach((h) => h && set.add(h.hero_id));
      }
    }
    return set;
  }, [gamesData, gameNumber, fearlessEnabled]);

  const redFearlessUnavailableIds = useMemo(() => {
    if (!fearlessEnabled) return new Set<number>();
    const set = new Set<number>();
    for (let g = 1; g < gameNumber; g++) {
      const pastGame = gamesData[g];
      if (pastGame) {
        pastGame.redPicks.forEach((h) => h && set.add(h.hero_id));
      }
    }
    return set;
  }, [gamesData, gameNumber, fearlessEnabled]);

  const blueFearlessUsedHeroes = useMemo(() => {
    return heroes.filter((h) => blueFearlessUnavailableIds.has(h.hero_id));
  }, [heroes, blueFearlessUnavailableIds]);

  const redFearlessUsedHeroes = useMemo(() => {
    return heroes.filter((h) => redFearlessUnavailableIds.has(h.hero_id));
  }, [heroes, redFearlessUnavailableIds]);

  // Unavailable heroes in current draft for the ACTIVE TEAM:
  // - Already picked or banned in current match
  // - PLUS heroes that the ACTIVE side already picked in previous games of this Fearless series!
  const currentDraftUnavailableIds = useMemo(() => {
    const ids = new Set<number>();
    bluePicks.forEach((h) => h && ids.add(h.hero_id));
    redPicks.forEach((h) => h && ids.add(h.hero_id));
    blueBans.forEach((h) => h && ids.add(h.hero_id));
    redBans.forEach((h) => h && ids.add(h.hero_id));

    if (fearlessEnabled && currentTurn.action === 'pick') {
      const teamFearlessSet = currentTurn.side === 'blue' ? blueFearlessUnavailableIds : redFearlessUnavailableIds;
      teamFearlessSet.forEach((id) => ids.add(id));
    }
    return ids;
  }, [bluePicks, redPicks, blueBans, redBans, fearlessEnabled, currentTurn, blueFearlessUnavailableIds, redFearlessUnavailableIds]);

  // Active plan IDs for the side whose turn it is
  const activeSidePlanAId = currentTurn.side === 'blue' ? bluePlanAId : redPlanAId;
  const activeSidePlanBId = currentTurn.side === 'blue' ? bluePlanBId : redPlanBId;

  // 2. Trigger Jev AI Model Inference on draft updates
  const updateAiPredictions = useCallback(
    async (
      bPicks: Array<Hero | null>,
      rPicks: Array<Hero | null>,
      bBans: Array<Hero | null>,
      rBans: Array<Hero | null>,
      turn: typeof currentTurn,
      allH: Hero[],
      planAId: number | null,
      planBId: number | null,
      blueFearlessSet: Set<number>,
      redFearlessSet: Set<number>
    ) => {
      if (allH.length === 0) return;

      const ourPicks = turn.side === 'blue' ? bPicks : rPicks;
      const enemyPicks = turn.side === 'blue' ? rPicks : bPicks;
      const ourHeroIds = ourPicks.filter(Boolean).map((h) => h!.hero_id);
      const enemyHeroIds = enemyPicks.filter(Boolean).map((h) => h!.hero_id);
      const bannedIds = [...bBans, ...rBans].filter(Boolean).map((h) => h!.hero_id);
      const teamFearlessIds = turn.side === 'blue' ? Array.from(blueFearlessSet) : Array.from(redFearlessSet);

      try {
        const result = await runJevInference(
          ourHeroIds,
          enemyHeroIds,
          bannedIds,
          teamFearlessIds,
          turn.action === 'pick',
          turn.side === 'blue',
          allH,
          turn.stepIndex,
          planAId,
          planBId
        );

        setModelReady(true);
        setModelLatency(result.latencyMs);
        setTacticalScores(result.tacticalScores);
        setRecommendations(result.recommendations);
        setPhaseStrategy(result.phaseStrategy);

        // Compute deltas if we have a previous baseline
        if (previousScores && ourHeroIds.length > 0 && turn.action === 'pick') {
          const lastPickedHero = ourPicks.filter(Boolean).slice(-1)[0];
          const activeEnemies = enemyPicks.filter(Boolean) as Hero[];
          if (lastPickedHero) {
            const explained = computeTacticalDeltas(
              previousScores,
              result.tacticalScores,
              lastPickedHero,
              activeEnemies,
              ourPicks.filter(Boolean) as Hero[]
            );
            setDeltas(explained.deltas);
            setPrimaryInsight(explained.primaryInsight);
          }
        } else {
          const topRec = result.recommendations[0];
          if (topRec) {
            setPrimaryInsight(
              `Rekomendasi #1 (${turn.side.toUpperCase()} ${turn.action.toUpperCase()}): ${topRec.hero.name} — ${
                topRec.proComboTag || topRec.laneTag || 'Prioritas Taktis Tertinggi'
              }`
            );
          }
        }
      } catch (err) {
        console.error('[JevInference] Error during inference:', err);
      }
    },
    [previousScores]
  );

  useEffect(() => {
    if (heroes.length > 0) {
      updateAiPredictions(
        bluePicks,
        redPicks,
        blueBans,
        redBans,
        currentTurn,
        heroes,
        activeSidePlanAId,
        activeSidePlanBId,
        blueFearlessUnavailableIds,
        redFearlessUnavailableIds
      );
    }
  }, [
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    currentTurn,
    heroes,
    activeSidePlanAId,
    activeSidePlanBId,
    blueFearlessUnavailableIds,
    redFearlessUnavailableIds,
    updateAiPredictions,
  ]);

  // Helper to mutate current game draft
  const updateCurrentDraft = useCallback(
    (updater: (prev: GameDraftData) => GameDraftData) => {
      setGamesData((prev) => ({
        ...prev,
        [gameNumber]: updater(prev[gameNumber] || createInitialGameDraft()),
      }));
    },
    [gameNumber]
  );

  // Handle hero pick / ban selection
  const handleSelectHero = (hero: Hero) => {
    if (currentDraftUnavailableIds.has(hero.hero_id)) return;

    setPreviousScores(tacticalScores);

    updateCurrentDraft((prev) => {
      const { side, action } = currentTurn;
      const next = { ...prev };

      if (action === 'ban') {
        if (side === 'blue') {
          const bans = [...next.blueBans];
          const emptyIdx = bans.findIndex((b) => b === null);
          if (emptyIdx !== -1) bans[emptyIdx] = hero;
          next.blueBans = bans;
        } else {
          const bans = [...next.redBans];
          const emptyIdx = bans.findIndex((b) => b === null);
          if (emptyIdx !== -1) bans[emptyIdx] = hero;
          next.redBans = bans;
        }
      } else {
        if (side === 'blue') {
          const picks = [...next.bluePicks];
          const emptyIdx = picks.findIndex((p) => p === null);
          if (emptyIdx !== -1) picks[emptyIdx] = hero;
          next.bluePicks = picks;
        } else {
          const picks = [...next.redPicks];
          const emptyIdx = picks.findIndex((p) => p === null);
          if (emptyIdx !== -1) picks[emptyIdx] = hero;
          next.redPicks = picks;
        }
      }

      next.draftStep = Math.min(DRAFT_SEQUENCE.length, next.draftStep + 1);
      return next;
    });
  };

  // Reset Current Game Draft ONLY (preserves other games!)
  const handleResetDraft = () => {
    updateCurrentDraft(() => createInitialGameDraft());
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(`Draft Game ${gameNumber} di-reset. Giliran Blue Side BAN Fase 1.`);
  };

  // Undo Step in Current Game
  const handleUndoStep = () => {
    if (draftStep === 0) return;
    const prevStepIndex = draftStep - 1;
    const prevTurn = DRAFT_SEQUENCE[prevStepIndex];

    const findLastOccupied = (arr: Array<Hero | null>) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null) return i;
      }
      return -1;
    };

    updateCurrentDraft((prev) => {
      const next = { ...prev };
      if (prevTurn.action === 'ban') {
        if (prevTurn.side === 'blue') {
          const bans = [...next.blueBans];
          const lastIdx = findLastOccupied(bans);
          if (lastIdx !== -1) bans[lastIdx] = null;
          next.blueBans = bans;
        } else {
          const bans = [...next.redBans];
          const lastIdx = findLastOccupied(bans);
          if (lastIdx !== -1) bans[lastIdx] = null;
          next.redBans = bans;
        }
      } else {
        if (prevTurn.side === 'blue') {
          const picks = [...next.bluePicks];
          const lastIdx = findLastOccupied(picks);
          if (lastIdx !== -1) picks[lastIdx] = null;
          next.bluePicks = picks;
        } else {
          const picks = [...next.redPicks];
          const lastIdx = findLastOccupied(picks);
          if (lastIdx !== -1) picks[lastIdx] = null;
          next.redPicks = picks;
        }
      }
      next.draftStep = prevStepIndex;
      return next;
    });
  };

  // Switch Game in Fearless Mode: Just switch active gameNumber without resetting data!
  const handleGameChange = (game: number) => {
    setGameNumber(game);
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(`Beralih ke Game ${game} dalam Seri Fearless Draft.`);
  };

  // Update Plan A and Plan B for the active side
  const handleSetPlanA = (heroId: number | null) => {
    updateCurrentDraft((prev) => {
      if (currentTurn.side === 'blue') {
        return { ...prev, bluePlanAId: heroId };
      } else {
        return { ...prev, redPlanAId: heroId };
      }
    });
  };

  const handleSetPlanB = (heroId: number | null) => {
    updateCurrentDraft((prev) => {
      if (currentTurn.side === 'blue') {
        return { ...prev, bluePlanBId: heroId };
      } else {
        return { ...prev, redPlanBId: heroId };
      }
    });
  };

  // Filter & Sort Heroes for the main grid
  const filteredAndSortedHeroes = useMemo(() => {
    let result = [...heroes];

    // Filter by Lane
    if (selectedLane !== 'All') {
      result = result.filter(
        (h) => h.primary_lane === selectedLane || h.lanes.includes(selectedLane)
      );
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.chinese_name.toLowerCase().includes(q) ||
          h.primary_role.toLowerCase().includes(q) ||
          h.counters.some((c) => c.target_name.toLowerCase().includes(q))
      );
    }

    // Filter by Tab (Favorites / Counter)
    if (activeTab === 'favorites') {
      result = result.filter((h) => favorites.has(h.hero_id));
    }

    // Attach AI scores
    const recMap = new Map<number, number>();
    recommendations.forEach((rec, idx) => recMap.set(rec.hero.hero_id, idx + 1));

    // Sort
    if (sortMode === 'ai') {
      result.sort((a, b) => {
        const rankA = recMap.get(a.hero_id) ?? 999;
        const rankB = recMap.get(b.hero_id) ?? 999;
        if (rankA !== rankB) return rankA - rankB;
        return b.win_rate - a.win_rate;
      });
    } else if (sortMode === 'win') {
      result.sort((a, b) => b.win_rate - a.win_rate);
    } else if (sortMode === 'pick') {
      result.sort((a, b) => b.pick_rate - a.pick_rate);
    } else if (sortMode === 'az') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [heroes, selectedLane, searchQuery, activeTab, favorites, recommendations, sortMode]);

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#F8FAFC] pb-44 selection:bg-[#B8FF01] selection:text-black">
      {/* Top Header Sort Bar */}
      <HeaderSortBar
        sortMode={sortMode}
        onSortChange={setSortMode}
        viewMode={viewMode}
        onViewChange={setViewMode}
        modelReady={modelReady}
        modelLatency={modelLatency}
        totalFiltered={filteredAndSortedHeroes.length}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-4 space-y-5">
        {/* View Mode 1: Draft AI Simulator View */}
        {activeTab === 'draft' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: 5v5 Simulator Board (7 Cols) */}
            <div className="lg:col-span-7 space-y-4">
              <DraftSimulator
                bluePicks={bluePicks}
                redPicks={redPicks}
                blueBans={blueBans}
                redBans={redBans}
                currentTurn={currentTurn}
                fearlessEnabled={fearlessEnabled}
                onToggleFearless={setFearlessEnabled}
                gameNumber={gameNumber}
                onGameNumberChange={handleGameChange}
                onResetDraft={handleResetDraft}
                onUndoStep={handleUndoStep}
                onSelectSlot={() => {}}
                blueFearlessUsedHeroes={blueFearlessUsedHeroes}
                redFearlessUsedHeroes={redFearlessUsedHeroes}
              />
            </div>

            {/* Right Column: Jev 6-Axis Radar & Top AI Recommendations (5 Cols) */}
            <div className="lg:col-span-5">
              <TacticalRadarPanel
                scores={tacticalScores}
                deltas={deltas}
                primaryInsight={primaryInsight}
                phaseStrategy={phaseStrategy}
                planAId={activeSidePlanAId}
                planBId={activeSidePlanBId}
                onOpenPlanModal={() => setIsPlanModalOpen(true)}
                onSelectQuickPlanA={handleSetPlanA}
                recommendations={recommendations}
                onSelectCandidate={handleSelectHero}
                activeSide={currentTurn.side}
                isPickPhase={currentTurn.action === 'pick'}
              />
            </div>
          </div>
        )}

        {/* View Mode 2: Instant Counter Lookup Tab Header */}
        {activeTab === 'counter' && (
          <div className="p-4 bg-[#12161F] border border-[#232A38] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                INSTANT COUNTER LOOKUP
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#B8FF01] text-black font-black">
                  KUROHIKO MATRIX
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Pilih atau cari hero musuh untuk melihat siapa counter alaminya dan cara melawannya.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Total: <span className="text-[#B8FF01] font-bold">{filteredAndSortedHeroes.length}</span> Hero
            </div>
          </div>
        )}

        {/* View Mode 3: Wiki & Tier List Tab Header */}
        {activeTab === 'wiki' && (
          <div className="p-4 bg-[#12161F] border border-[#232A38] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                HOK GLOBAL HERO TIER & WIKI
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F5C451] text-black font-black">
                  DIAMOND+ OFFICIAL
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tier S/A/B/C/D, Win Rate & Pick Rate resmi, build rekomendasi serta arcana.
              </p>
            </div>
            <button
              onClick={() => setViewMode('detailed')}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#232A38] hover:bg-[#B8FF01] hover:text-black transition-all"
            >
              Mode Detail HOKFIRE
            </button>
          </div>
        )}

        {/* Hero Grid Header Section */}
        <div className="flex items-center justify-between pt-2">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
            {activeTab === 'favorites'
              ? 'Daftar Hero Favorit Saya'
              : `Pilih Hero (${selectedLane === 'All' ? 'Semua Lane' : selectedLane})`}
          </h3>
          <span className="text-[11px] font-mono text-slate-500">
            Menampilkan {filteredAndSortedHeroes.length} dari {heroes.length}
          </span>
        </div>

        {/* Dual Mode Hero Grid */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-[#B8FF01] border-t-transparent animate-spin" />
            <p className="text-xs text-slate-400 font-mono">Memuat Database 120 Hero Global...</p>
          </div>
        ) : filteredAndSortedHeroes.length === 0 ? (
          <div className="py-16 text-center bg-[#12161F] rounded-2xl border border-[#232A38] p-6 space-y-2">
            <p className="text-sm font-semibold text-slate-300">
              Tidak ada hero yang cocok dengan pencarian "{searchQuery}"
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedLane('All');
              }}
              className="text-xs text-[#B8FF01] hover:underline font-mono"
            >
              Reset Filter
            </button>
          </div>
        ) : viewMode === 'compact' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {filteredAndSortedHeroes.map((hero) => {
              const isUnavailable = currentDraftUnavailableIds.has(hero.hero_id);
              const rec = recommendations.find((r) => r.hero.hero_id === hero.hero_id);
              return (
                <HeroCardCompact
                  key={hero.hero_id}
                  hero={hero}
                  isUnavailable={isUnavailable}
                  onClick={(h) => {
                    if (activeTab === 'draft') handleSelectHero(h);
                    else setWikiHero(h);
                  }}
                  quickBadge={rec ? `AI #${recommendations.indexOf(rec) + 1}` : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-3">
            {filteredAndSortedHeroes.map((hero) => {
              const isUnavailable = currentDraftUnavailableIds.has(hero.hero_id);
              const recIndex = recommendations.findIndex((r) => r.hero.hero_id === hero.hero_id);
              return (
                <HeroCardDetailed
                  key={hero.hero_id}
                  hero={hero}
                  isUnavailable={isUnavailable}
                  onClick={(h) => {
                    if (activeTab === 'draft') handleSelectHero(h);
                    else setWikiHero(h);
                  }}
                  aiRank={recIndex !== -1 ? recIndex + 1 : undefined}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Slide-over Wiki & Counter Drawer */}
      <HeroWikiDrawer
        hero={wikiHero}
        onClose={() => setWikiHero(null)}
        isFavorite={wikiHero ? favorites.has(wikiHero.hero_id) : false}
        onToggleFavorite={handleToggleFavorite}
        onPickForDraft={handleSelectHero}
        allHeroes={heroes}
        onSelectRelatedHero={(h) => setWikiHero(h)}
      />

      {/* Strategic Setup Plan A & Plan B Modal (Access to all 120 Heroes) */}
      <PlanSelectionModal
        isOpen={isPlanModalOpen}
        onClose={() => setIsPlanModalOpen(false)}
        heroes={heroes}
        currentPlanAId={activeSidePlanAId}
        currentPlanBId={activeSidePlanBId}
        onSelectPlanA={handleSetPlanA}
        onSelectPlanB={handleSetPlanB}
        activeSide={currentTurn.side}
        unavailableHeroIds={currentDraftUnavailableIds}
        recommendedOpeners={phaseStrategy?.candidateOpeners || []}
      />

      {/* Sticky Bottom Command Dock */}
      <BottomCommandDock
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedLane={selectedLane}
        onLaneChange={setSelectedLane}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        favoriteCount={favorites.size}
      />
    </div>
  );
};

export default App;
