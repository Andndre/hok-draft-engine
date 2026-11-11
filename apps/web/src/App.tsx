import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Hero, Lane, ActiveTab, SortMode, ViewMode, TacticalVector, TacticalDelta, GameDraftData, LaneAssignmentMap, TournamentDataset } from './types';
import { loadTournamentDataset } from './engine/heroDataLoader';
import { runTournamentInference, TournamentPredictionResult, TournamentPhaseStrategy } from './engine/tournamentInference';
import { computeTacticalDeltas } from './engine/deltaExplainer';
import { assignmentToHeroLaneMap, buildDefaultLaneAssignments, swapAssignedLanes } from './engine/gamePlan';
import { AlertTriangle, BookOpen, FilterX, Gamepad2, RefreshCw, SearchX, SlidersHorizontal, Star } from 'lucide-react';
import { HeroRosterToolbar } from './components/HeroRosterToolbar';
import { focusHeroSearch } from './components/ui/presentation';
import { HeaderSortBar } from './components/HeaderSortBar';
import { HeroCardCompact } from './components/HeroCardCompact';
import { HeroCardDetailed } from './components/HeroCardDetailed';
import { BottomCommandDock } from './components/BottomCommandDock';
import { PracticeDraft } from './components/PracticeDraft';
import { DraftSimulator } from './components/DraftSimulator';
import { PostDraftGamePlanPanel } from './components/PostDraftGamePlanPanel';
import { TacticalRadarPanel } from './components/TacticalRadarPanel';
import { HeroWikiDrawer } from './components/HeroWikiDrawer';
import { PlanSelectionModal } from './components/PlanSelectionModal';
import { isHeroGlobalReleased } from './data/heroReleaseStatus';

import { assignHeroLanes, DRAFT_SEQUENCE, getDraftTurn, createInitialGameDraft, applyGameHero } from './engine/draftRules';
import type { Side } from './engine/draftRules';

export const App: React.FC = () => {
  const [dataset, setDataset] = useState<TournamentDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<ActiveTab>('draft');
  const [draftMode, setDraftMode] = useState<'simulator' | 'practice'>('simulator');
  const [practiceAssistance, setPracticeAssistance] = useState(true);
  const practiceActive = activeTab === 'draft' && draftMode === 'practice';
  const [selectedLane, setSelectedLane] = useState<Lane | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('ai');
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [onlyGlobalReleased, setOnlyGlobalReleased] = useState<boolean>(true);
  const [laneOverridesByGame, setLaneOverridesByGame] = useState<Record<number, { blue?: LaneAssignmentMap | null; red?: LaneAssignmentMap | null }>>({});

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


  const [gamesData, setGamesData] = useState<Record<number, GameDraftData>>({
    1: createInitialGameDraft(),
    2: createInitialGameDraft(),
    3: createInitialGameDraft(),
    4: createInitialGameDraft(),
    5: createInitialGameDraft(),
  });

  const currentGame = gamesData[gameNumber] || createInitialGameDraft();
  const { bluePicks, redPicks, blueBans, redBans, draftStep, bluePlanAId, bluePlanBId, redPlanAId, redPlanBId } = currentGame;

  const [synergyData, setSynergyData] = useState<Record<string, any>>({});

  // Tournament AI State
  const [engineReady, setEngineReady] = useState(false);
  const [tacticalScores, setTacticalScores] = useState<TacticalVector>({
    draft_advantage: 0.50,
    early_game_pressure: 0.50,
    cc_chain_lockdown: 0.50,
    frontline_durability: 0.50,
    enemy_carry_shutdown: 0.50,
    draft_flexibility: 0.50,
    team_utility: 0.50,
  });
  const [previousScores, setPreviousScores] = useState<TacticalVector | null>(null);
  const [deltas, setDeltas] = useState<TacticalDelta[]>([]);
  const [primaryInsight, setPrimaryInsight] = useState<string>('');
  const [recommendations, setRecommendations] = useState<TournamentPredictionResult['recommendations']>([]);
  const [phaseStrategy, setPhaseStrategy] = useState<TournamentPhaseStrategy | undefined>(undefined);

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await loadTournamentDataset();
      setDataset(data); setHeroes(data.heroes); setSynergyData(data.synergy);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Data belum dapat dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);

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
  const currentTurn = useMemo(() => getDraftTurn(draftStep), [draftStep]);

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

  // 2. Trigger Tournament AI Model Inference on draft updates
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
        const result = await runTournamentInference(
          ourHeroIds,
          enemyHeroIds,
          bannedIds,
          teamFearlessIds,
          turn.action === 'pick',
          turn.side === 'blue',
          allH,
          turn.stepIndex,
          planAId,
          planBId,
          onlyGlobalReleased,
          synergyData,
          Array.from(turn.side === 'blue' ? redFearlessSet : blueFearlessSet)
        );

        setEngineReady(true);
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
        console.error('[DraftEngine] Error during inference:', err);
      }
    },
    [previousScores, onlyGlobalReleased, synergyData]
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
    onlyGlobalReleased,
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
    if (currentTurn.isComplete || currentDraftUnavailableIds.has(hero.hero_id) || (onlyGlobalReleased && !isHeroGlobalReleased(hero))) return;

    setPreviousScores(tacticalScores);

    updateCurrentDraft((prev) => applyGameHero(prev, hero, { heroes, onlyGlobal: onlyGlobalReleased, fearless: { blue: [...blueFearlessUnavailableIds], red: [...redFearlessUnavailableIds] } }));
  };

  // Reset Current Game Draft ONLY (preserves other games!)
  const handleResetDraft = () => {
    updateCurrentDraft(() => createInitialGameDraft());
    setLaneOverridesByGame((prev) => ({ ...prev, [gameNumber]: {} }));
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(`Draft Game ${gameNumber} di-reset. Giliran Blue Side BAN Fase 1.`);
  };

  // Undo Step in Current Game
  const handleUndoStep = () => {
    if (draftStep === 0) return;
    setLaneOverridesByGame((prev) => ({ ...prev, [gameNumber]: {} }));
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

  const kplLaneRates = synergyData?.hero_lane_rates;
  const filledBlueHeroes = useMemo(() => bluePicks.filter((h): h is Hero => h !== null), [bluePicks]);
  const filledRedHeroes = useMemo(() => redPicks.filter((h): h is Hero => h !== null), [redPicks]);

  const defaultBlueAssignment = useMemo(
    () => buildDefaultLaneAssignments(filledBlueHeroes, kplLaneRates),
    [filledBlueHeroes, kplLaneRates]
  );
  const defaultRedAssignment = useMemo(
    () => buildDefaultLaneAssignments(filledRedHeroes, kplLaneRates),
    [filledRedHeroes, kplLaneRates]
  );

  const gameLaneOverrides = laneOverridesByGame[gameNumber];
  const activeBlueAssignment = currentTurn.isComplete
    ? gameLaneOverrides?.blue ?? defaultBlueAssignment
    : defaultBlueAssignment;
  const activeRedAssignment = currentTurn.isComplete
    ? gameLaneOverrides?.red ?? defaultRedAssignment
    : defaultRedAssignment;

  const blueAssignedLanes = useMemo(
    () =>
      currentTurn.isComplete
        ? assignmentToHeroLaneMap(activeBlueAssignment)
        : assignHeroLanes(filledBlueHeroes, kplLaneRates).assignments,
    [currentTurn.isComplete, activeBlueAssignment, filledBlueHeroes, kplLaneRates]
  );
  const redAssignedLanes = useMemo(
    () =>
      currentTurn.isComplete
        ? assignmentToHeroLaneMap(activeRedAssignment)
        : assignHeroLanes(filledRedHeroes, kplLaneRates).assignments,
    [currentTurn.isComplete, activeRedAssignment, filledRedHeroes, kplLaneRates]
  );

  const handleSwapSimulatorLane = (side: Side, laneA: Lane, laneB: Lane) => {
    const base = side === 'blue' ? activeBlueAssignment : activeRedAssignment;
    const swapped = swapAssignedLanes(base, laneA, laneB);
    setLaneOverridesByGame((prev) => ({
      ...prev,
      [gameNumber]: {
        ...(prev[gameNumber] || {}),
        [side]: swapped,
      },
    }));
  };

  const handleResetSimulatorLanes = () => {
    setLaneOverridesByGame((prev) => ({ ...prev, [gameNumber]: {} }));
  };

  // Filter & Sort Heroes for the main grid
  const filteredAndSortedHeroes = useMemo(() => {
    let result = [...heroes];

    // Filter by Global Released status
    if (onlyGlobalReleased) {
      result = result.filter((h) => isHeroGlobalReleased(h));
    }

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
    if (sortMode === 'ai' && activeTab === 'draft') {
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
    } else if (sortMode === 'az' || sortMode === 'ai') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [heroes, selectedLane, searchQuery, activeTab, favorites, recommendations, sortMode, onlyGlobalReleased]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Lewati ke konten utama</a>
      <HeaderSortBar activeTab={activeTab} onTabChange={setActiveTab} engineReady={engineReady} globalLocked={practiceActive} onlyGlobalReleased={practiceActive || onlyGlobalReleased} onToggleGlobalReleased={() => setOnlyGlobalReleased(value => !value)} favoriteCount={favorites.size} />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="page-heading"><div><h1>{activeTab === 'draft' ? 'Ruang draft' : activeTab === 'counter' ? 'Cari matchup hero' : activeTab === 'wiki' ? 'Wiki & tier hero' : 'Hero favorit'}</h1><p>{activeTab === 'draft' ? (draftMode === 'practice' ? 'Pilih sisi, susun strategi, lalu uji keputusanmu melawan AI.' : 'Atur kedua tim dan cari pilihan terbaik untuk setiap giliran.') : activeTab === 'counter' ? 'Buka hero untuk melihat ancaman, target empuk, dan sinerginya.' : activeTab === 'wiki' ? 'Pelajari skill, build item, arcana, dan statistik hero Global.' : 'Simpan hero dari wiki untuk mengaksesnya kembali dengan cepat.'}</p></div>
          {activeTab === 'draft' && <nav className="mode-switch" aria-label="Mode draft"><button type="button" aria-pressed={draftMode === 'simulator'} onClick={() => setDraftMode('simulator')}><SlidersHorizontal aria-hidden="true" />Simulator</button><button type="button" aria-pressed={draftMode === 'practice'} onClick={() => setDraftMode('practice')}><Gamepad2 aria-hidden="true" />Latihan vs AI</button></nav>}
        </div>
        {loadError && <section role="alert" className="empty-state"><AlertTriangle aria-hidden="true" /><h2>Data hero belum dapat dimuat</h2><p>{loadError}</p><button type="button" className="ui-button ui-button--primary" onClick={() => void loadData()}><RefreshCw aria-hidden="true" />Coba lagi</button></section>}
        {dataset && <div hidden={!practiceActive}><PracticeDraft dataset={dataset} active={practiceActive} assistance={practiceAssistance} onAssistanceChange={setPracticeAssistance} selectedLane={selectedLane} onLaneChange={setSelectedLane} searchQuery={searchQuery} onSearchChange={setSearchQuery} sortMode={sortMode} onSortChange={setSortMode} viewMode={viewMode} onViewChange={setViewMode} favorites={favorites} onToggleFavorite={handleToggleFavorite} /></div>}
        {!practiceActive && <>
          {activeTab === 'draft' && !loadError && <DraftSimulator bluePicks={bluePicks} redPicks={redPicks} blueBans={blueBans} redBans={redBans} blueAssignedLanes={blueAssignedLanes} redAssignedLanes={redAssignedLanes} currentTurn={currentTurn} fearlessEnabled={fearlessEnabled} onToggleFearless={setFearlessEnabled} gameNumber={gameNumber} onGameNumberChange={handleGameChange} onResetDraft={handleResetDraft} onUndoStep={handleUndoStep} blueFearlessUsedHeroes={blueFearlessUsedHeroes} redFearlessUsedHeroes={redFearlessUsedHeroes} onInspectHero={setWikiHero} onRequestHero={!loading ? focusHeroSearch : undefined} />}
          {activeTab === 'draft' && !loadError && currentTurn.isComplete && filledBlueHeroes.length === 5 && filledRedHeroes.length === 5 && (
            <PostDraftGamePlanPanel
              key={`sim-game-${gameNumber}`}
              blueHeroes={filledBlueHeroes}
              redHeroes={filledRedHeroes}
              synergy={synergyData}
              defaultPerspective="blue"
              blueAssignment={activeBlueAssignment}
              redAssignment={activeRedAssignment}
              hasCustomAssignments={Boolean(gameLaneOverrides?.blue || gameLaneOverrides?.red)}
              onSwapLane={handleSwapSimulatorLane}
              onResetLanes={handleResetSimulatorLanes}
              onInspectHero={setWikiHero}
            />
          )}
          {!loadError && <div className={activeTab === 'draft' ? 'draft-workspace' : ''}>
            <section className="hero-roster" id="hero-roster" aria-label="Katalog hero" aria-busy={loading}>
              <HeroRosterToolbar title={activeTab === 'favorites' ? 'Hero favorit' : activeTab === 'draft' ? 'Pilih hero untuk ' + (currentTurn.action === 'ban' ? 'ban' : 'pick') : 'Jelajahi hero'} count={filteredAndSortedHeroes.length} searchQuery={searchQuery} onSearchChange={setSearchQuery} selectedLane={selectedLane} onLaneChange={setSelectedLane} sortMode={sortMode} onSortChange={setSortMode} viewMode={viewMode} onViewChange={setViewMode} hideAiSort={activeTab !== 'draft'} />
              {loading ? <div className="hero-grid" role="status" aria-label="Memuat katalog hero"><span className="sr-only">Memuat database hero…</span>{Array.from({ length: 12 }, (_, index) => <div key={index} className="roster-skeleton" aria-hidden="true" />)}</div>
                : !filteredAndSortedHeroes.length ? <div className="empty-state">{activeTab === 'favorites' && !favorites.size ? <Star aria-hidden="true" /> : <SearchX aria-hidden="true" />}<h3>{activeTab === 'favorites' && !favorites.size ? 'Belum ada hero favorit' : 'Hero tidak ditemukan'}</h3><p>{activeTab === 'favorites' && !favorites.size ? 'Buka wiki hero, lalu simpan ke favorit.' : 'Coba nama lain atau hapus filter lane yang aktif.'}</p><button type="button" className="ui-button ui-button--quiet" onClick={() => { setSearchQuery(''); setSelectedLane('All'); if (activeTab === 'favorites' && !favorites.size) setActiveTab('wiki'); }}>{activeTab === 'favorites' && !favorites.size ? <BookOpen aria-hidden="true" /> : <FilterX aria-hidden="true" />}{activeTab === 'favorites' && !favorites.size ? 'Jelajahi hero' : 'Bersihkan filter'}</button></div>
                : <div className={'hero-grid' + (viewMode === 'detailed' ? ' hero-grid--detailed' : '')}>{filteredAndSortedHeroes.map(hero => {
                  const isUnavailable = activeTab === 'draft' && currentDraftUnavailableIds.has(hero.hero_id);
                  const rec = activeTab === 'draft' ? recommendations.find(r => r.hero.hero_id === hero.hero_id) : undefined;
                  const rank = rec ? recommendations.indexOf(rec) + 1 : 0;
                  const shared = {
                    hero,
                    isUnavailable,
                    onClick: setWikiHero,
                    onSelect: activeTab === 'draft' ? handleSelectHero : undefined,
                    selectionDisabled: currentTurn.isComplete,
                    action: currentTurn.action,
                    aiRank: rank > 0 ? rank : undefined,
                    recommendationReason: rec?.proComboTag || rec?.laneTag,
                    projection: rec?.projection,
                  };
                  return viewMode === 'compact' ? <HeroCardCompact key={hero.hero_id} {...shared} quickBadge={rank > 0 && rank <= 5 ? 'AI #' + rank : undefined} /> : <HeroCardDetailed key={hero.hero_id} {...shared} aiRank={rank > 0 ? rank : undefined} />;
                })}</div>}
            </section>
            {activeTab === 'draft' && !loading && <aside className="analysis-sidebar"><TacticalRadarPanel scores={tacticalScores} deltas={deltas} primaryInsight={primaryInsight} phaseStrategy={phaseStrategy} planAId={activeSidePlanAId} planBId={activeSidePlanBId} onOpenPlanModal={() => setIsPlanModalOpen(true)} onSelectQuickPlanA={handleSetPlanA} recommendations={recommendations} onSelectCandidate={handleSelectHero} onInspectHero={setWikiHero} activeSide={currentTurn.side} isPickPhase={currentTurn.action === 'pick'} isComplete={currentTurn.isComplete} /></aside>}
          </div>}
        </>}
      </main>
      <BottomCommandDock activeTab={activeTab} onTabChange={setActiveTab} favoriteCount={favorites.size} />
      <HeroWikiDrawer hero={wikiHero} onClose={() => setWikiHero(null)} isFavorite={wikiHero ? favorites.has(wikiHero.hero_id) : false} onToggleFavorite={handleToggleFavorite} onPickForDraft={activeTab === 'draft' && draftMode === 'simulator' && wikiHero && !currentTurn.isComplete && !currentDraftUnavailableIds.has(wikiHero.hero_id) ? handleSelectHero : undefined} draftActionLabel={currentTurn.action === 'ban' ? 'Ban hero ini' : 'Pick hero ini'} initialTab={activeTab === 'counter' ? 'counters' : 'build'} allHeroes={heroes} onSelectRelatedHero={setWikiHero} itemCatalog={dataset?.items} spellCatalog={dataset?.spells} />
      <PlanSelectionModal isOpen={isPlanModalOpen} onClose={() => setIsPlanModalOpen(false)} heroes={heroes} currentPlanAId={activeSidePlanAId} currentPlanBId={activeSidePlanBId} onSelectPlanA={handleSetPlanA} onSelectPlanB={handleSetPlanB} activeSide={currentTurn.side} unavailableHeroIds={currentDraftUnavailableIds} recommendedOpeners={phaseStrategy?.candidateOpeners || []} onlyGlobalReleased={onlyGlobalReleased} />
    </div>
  );
};

export default App;
