import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { DraftFormat, Hero, Lane, ActiveTab, SortMode, ViewMode, TacticalVector, TacticalDelta, GameDraftData, LaneAssignmentMap, TournamentDataset, SeriesFormat, SeriesTeam, DuetPackageOption } from './types';
import { loadTournamentDataset } from './engine/heroDataLoader';
import { runTournamentInference, TournamentPredictionResult, TournamentPhaseStrategy } from './engine/tournamentInference';
import { pickPhaseCandidates, MAX_ADVISOR_BUDGET_MS } from './engine/draftSearch';
import type { SearchContext } from './engine/draftSearch';
import { rankRecommendationsByPosition, orderRecommendationsBySolver } from './engine/advisorRanking';
import type { AdvisorDecision, SolverStatus } from './engine/advisorRanking';
import { OpponentClient } from './engine/opponentClient';
import { computeTacticalDeltas } from './engine/deltaExplainer';
import { assignmentToHeroLaneMap, buildDefaultLaneAssignments, swapAssignedLanes } from './engine/gamePlan';
import { AlertTriangle, BookOpen, CheckCircle2, FilterX, Gamepad2, RefreshCw, Scan, SearchX, Share2, SlidersHorizontal, Star } from 'lucide-react';
import { useAppRouter } from './navigation/useAppRouter';
import { encodeTournamentSeries, encodeRankedDraft, encodePracticeSession, decodeAnyDraftShare } from './engine/draftShareCodec';
import type { PracticeSession } from './engine/practiceState';
import { HeroRosterToolbar } from './components/HeroRosterToolbar';
import { focusHeroSearch } from './components/ui/presentation';
import { searchHeroes, firstSelectableHero } from './heroSearch';
import { HeaderSortBar } from './components/HeaderSortBar';
import { HeroCardCompact } from './components/HeroCardCompact';
import { HeroCardDetailed } from './components/HeroCardDetailed';
import { BottomCommandDock } from './components/BottomCommandDock';
import { DraftSimulator } from './components/DraftSimulator';
import { TacticalRadarPanel } from './components/TacticalRadarPanel';
import { visionFormatMismatchReason } from './vision/visionMessages';
import type { VisionApplyResult } from './vision/visionMessages';
import { PlanSelectionModal } from './components/PlanSelectionModal';
import { isHeroGlobalReleased } from './data/heroReleaseStatus';

const PracticeDraft = lazy(() => import('./components/PracticeDraft').then(m => ({ default: m.PracticeDraft })));
const PostDraftGamePlanPanel = lazy(() => import('./components/PostDraftGamePlanPanel').then(m => ({ default: m.PostDraftGamePlanPanel })));
const VisionPanel = lazy(() => import('./components/VisionPanel').then(m => ({ default: m.VisionPanel })));
const HeroWikiDrawer = lazy(() => import('./components/HeroWikiDrawer').then(m => ({ default: m.HeroWikiDrawer })));
const WikiHub = lazy(() => import('./components/WikiHub').then(m => ({ default: m.WikiHub })));

import { assignHeroLanes, DRAFT_SEQUENCE, getDraftTurn, createInitialGameDraft, applyGameHero, computeSeriesFearlessLocks, findSeriesFearlessConflicts, teamOnSide, FLOWBORN_HERO_IDS, isFlowborn, toPosition } from './engine/draftRules';
import type { DraftPosition, Side } from './engine/draftRules';

/** Draft format the Live Advisor follows; it is tied to the calibrated ranked region profile, independent of the simulator's draftFormat. */
const VISION_ADVISOR_FORMAT: DraftFormat = 'ranked';

export const App: React.FC = () => {
  const [dataset, setDataset] = useState<TournamentDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation & Routing (Hash Deep Linking & URL Sync)
  const {
    route,
    navigate,
    openHeroModal,
    closeHeroModal,
    getShareDraftUrl,
    getSharePracticeUrl,
  } = useAppRouter();

  const activeTab = route.activeTab;
  const draftMode = route.draftMode;

  const handleTabChange = useCallback((newTab: ActiveTab) => {
    navigate({ activeTab: newTab });
  }, [navigate]);

  const handleDraftModeChange = useCallback((newMode: 'simulator' | 'practice' | 'vision') => {
    navigate({ activeTab: 'draft', draftMode: newMode });
  }, [navigate]);

  const [draftFormat, setDraftFormat] = useState<DraftFormat>('tournament');
  const [rankedBanCount, setRankedBanCount] = useState<3 | 4 | 5>(3);
  const [practiceAssistance, setPracticeAssistance] = useState(true);
  const practiceActive = activeTab === 'draft' && draftMode === 'practice';
  const visionActive = activeTab === 'draft' && draftMode === 'vision';
  const [hasVisitedPractice, setHasVisitedPractice] = useState(false);

  useEffect(() => {
    if (practiceActive) setHasVisitedPractice(true);
  }, [practiceActive]);

  useEffect(() => {
    const titles: Record<ActiveTab, string> = {
      draft:
        draftMode === 'practice'
          ? 'Latihan Draft vs AI — HoK Draft Engine'
          : draftMode === 'vision'
            ? 'Live Draft Advisor — HoK Draft Engine'
            : 'Simulator Draft — HoK Draft Engine',
      counter: 'Wiki & Ensiklopedia — HoK Draft Engine',
      wiki: 'Wiki & Ensiklopedia — HoK Draft Engine',
      favorites: 'Hero Favorit — HoK Draft Engine',
    };
    document.title = titles[activeTab];
  }, [activeTab, draftMode]);
  const [selectedLane, setSelectedLane] = useState<Lane | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
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

  // Drawer modal, Strategic Plan Modal & Toast notifications
  const [wikiHero, setWikiHero] = useState<Hero | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sharedDraftNotice, setSharedDraftNotice] = useState<string | null>(null);
  const hasHydratedShareRef = useRef<string | null>(null);

  const handleInspectHero = useCallback((hero: Hero) => {
    setWikiHero(hero);
    openHeroModal(hero.slug || hero.hero_id);
  }, [openHeroModal]);

  const handleCloseWikiDrawer = useCallback(() => {
    setWikiHero(null);
    closeHeroModal();
  }, [closeHeroModal]);

  const [sharedPracticeSession, setSharedPracticeSession] = useState<PracticeSession | null>(null);

  // Fearless Draft (Global BP) State & Multi-Game Match Storage
  const [fearlessEnabled, setFearlessEnabled] = useState(true);
  const [gameNumber, setGameNumber] = useState(1);
  const [seriesFormat, setSeriesFormat] = useState<SeriesFormat>('BO5');
  const [teamAName, setTeamAName] = useState('Tim A');
  const [teamBName, setTeamBName] = useState('Tim B');

  const [gamesData, setGamesData] = useState<Record<number, GameDraftData>>({
    1: createInitialGameDraft('tournament', 'A', false),
    2: createInitialGameDraft('tournament', 'A', false),
    3: createInitialGameDraft('tournament', 'A', false),
    4: createInitialGameDraft('tournament', 'A', false),
    5: createInitialGameDraft('tournament', 'A', false),
    6: createInitialGameDraft('tournament', 'A', false),
    7: createInitialGameDraft('tournament', 'A', false),
  });

  const currentGame = gamesData[gameNumber] || createInitialGameDraft(draftFormat, 'A', false, draftFormat === 'ranked' ? rankedBanCount : 3);
  const { bluePicks, redPicks, blueBans, redBans, draftStep, bluePlanAId, bluePlanBId, redPlanAId, redPlanBId, blueTeam, winner: currentGameWinner, isUltimateBattle } = currentGame;

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
  // 'delta' = judul berisi cerita perubahan radar setelah aksi; 'recommendation' =
  // judul menyebut hero #1 dari daftar yang DIPAHAMI pengguna.
  const [insightMode, setInsightMode] = useState<'delta' | 'recommendation'>('recommendation');
  const [deltas, setDeltas] = useState<TacticalDelta[]>([]);
  const [primaryInsight, setPrimaryInsight] = useState<string>('');
  const [recommendations, setRecommendations] = useState<TournamentPredictionResult['recommendations']>([]);
  const [duetPackages, setDuetPackages] = useState<DuetPackageOption[]>([]);
  const [phaseStrategy, setPhaseStrategy] = useState<TournamentPhaseStrategy | undefined>(undefined);

  // Jawaban solver Minimax untuk jalur advisor (lihat efek "advisor" di bawah).
  // `advisorDecisionKey` menandai papan mana jawaban itu milik, supaya jawaban lama
  // tidak pernah dipromosikan ke daftar yang dibangun untuk posisi lain.
  const [advisorDecision, setAdvisorDecision] = useState<AdvisorDecision | null>(null);
  const [advisorDecisionKey, setAdvisorDecisionKey] = useState<string | null>(null);
  // Status solver untuk UI: "mesin sedang menghitung" → siap / tidak tersedia.
  const [advisorStatus, setAdvisorStatus] = useState<SolverStatus>({ state: 'idle' });
  const advisorRevisionRef = useRef(0);

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await loadTournamentDataset();
      setDataset(data); setHeroes(data.heroes); setSynergyData(data.synergy);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Data belum dapat dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);

  // Synchronize route.heroIdOrSlug with wikiHero
  useEffect(() => {
    if (route.heroIdOrSlug && heroes.length > 0) {
      const found = heroes.find(
        (h) =>
          String(h.hero_id) === route.heroIdOrSlug ||
          (h.slug && h.slug.toLowerCase() === route.heroIdOrSlug?.toLowerCase())
      );
      if (found) {
        setWikiHero(found);
      }
    } else if (!route.heroIdOrSlug && wikiHero) {
      setWikiHero(null);
    }
  }, [route.heroIdOrSlug, heroes]);

  // Synchronize route.shareData to restore tournament, ranked, or practice draft state
  useEffect(() => {
    if (!route.shareData || !dataset || heroes.length === 0) return;
    if (hasHydratedShareRef.current === route.shareData) return;

    const decoded = decodeAnyDraftShare(route.shareData, heroes);
    if (decoded) {
      if (decoded.kind === 'tournament') {
        setSeriesFormat(decoded.seriesFormat);
        setFearlessEnabled(decoded.fearlessEnabled);
        setGameNumber(decoded.gameNumber);
        setTeamAName(decoded.teamAName);
        setTeamBName(decoded.teamBName);
        setGamesData(decoded.gamesData);
        setDraftFormat('tournament');
        navigate({ activeTab: 'draft', draftMode: 'simulator' }, { replace: true });
        setSharedDraftNotice(`Simulasi turnamen ${decoded.teamAName} vs ${decoded.teamBName} (${decoded.seriesFormat}) berhasil dimuat!`);
      } else if (decoded.kind === 'ranked') {
        setDraftFormat('ranked');
        setRankedBanCount(decoded.rankedBanCount);
        setGameNumber(1);
        setGamesData((prev) => ({
          ...prev,
          1: decoded.game,
        }));
        navigate({ activeTab: 'draft', draftMode: 'simulator' }, { replace: true });
        setSharedDraftNotice(`Draft Ranked (${decoded.rankedBanCount} Ban) berhasil dimuat!`);
      } else if (decoded.kind === 'practice') {
        setSharedPracticeSession(decoded.session);
        setPracticeAssistance(decoded.assistance);
        navigate({ activeTab: 'draft', draftMode: 'practice' }, { replace: true });
        setSharedDraftNotice(`Sesi Latihan vs AI (${decoded.playerSide.toUpperCase()}, ${decoded.format === 'ranked' ? 'Ranked' : 'Tournament'}) berhasil dimuat!`);
      }
      hasHydratedShareRef.current = route.shareData;
      setTimeout(() => setSharedDraftNotice(null), 4000);
    }
  }, [route.shareData, dataset, heroes, navigate]);

  const handleShareSimulatorDraft = useCallback(() => {
    let shareCode: string;
    if (draftFormat === 'ranked') {
      shareCode = encodeRankedDraft({
        rankedBanCount,
        game: currentGame,
      });
    } else {
      shareCode = encodeTournamentSeries({
        seriesFormat,
        fearlessEnabled,
        gameNumber,
        teamAName,
        teamBName,
        gamesData,
      });
    }
    const fullUrl = getShareDraftUrl(shareCode);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        const label = draftFormat === 'ranked' ? 'Tautan draft ranked' : 'Tautan simulasi turnamen';
        setToastMessage(`${label} berhasil disalin ke clipboard!`);
        setTimeout(() => setToastMessage(null), 3500);
      });
    }
  }, [draftFormat, rankedBanCount, currentGame, seriesFormat, fearlessEnabled, gameNumber, teamAName, teamBName, gamesData, getShareDraftUrl]);

  const handleSharePracticeSession = useCallback((practiceSession: PracticeSession) => {
    const shareCode = encodePracticeSession(practiceSession, practiceAssistance);
    const fullUrl = getSharePracticeUrl(shareCode);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        setToastMessage('Tautan sesi latihan vs AI berhasil disalin ke clipboard!');
        setTimeout(() => setToastMessage(null), 3500);
      });
    }
  }, [practiceAssistance, getSharePracticeUrl]);

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
  const currentTurn = useMemo(
    () => getDraftTurn(draftStep, draftFormat, isUltimateBattle, rankedBanCount),
    [draftStep, draftFormat, isUltimateBattle]
  );

  // Series Score (Team A vs Team B wins)
  const seriesScore = useMemo(() => {
    let teamAWins = 0;
    let teamBWins = 0;
    Object.values(gamesData).forEach((g) => {
      if (!g.winner) return;
      const winnerTeam = teamOnSide(g, g.winner);
      if (winnerTeam === 'A') teamAWins++;
      else if (winnerTeam === 'B') teamBWins++;
    });
    return { teamA: teamAWins, teamB: teamBWins };
  }, [gamesData]);

  // Fearless Draft: Accumulate heroes picked by each TEAM in prior games (Game < gameNumber)
  const fearlessLocks = useMemo(() => {
    if (!fearlessEnabled || draftFormat === 'ranked') {
      return { blue: new Set<number>(), red: new Set<number>() };
    }
    return computeSeriesFearlessLocks(gamesData, gameNumber, fearlessEnabled);
  }, [gamesData, gameNumber, fearlessEnabled, draftFormat]);

  const blueFearlessUnavailableIds = fearlessLocks.blue;
  const redFearlessUnavailableIds = fearlessLocks.red;

  const fearlessConflicts = useMemo(() => {
    if (!fearlessEnabled || draftFormat === 'ranked') return [];
    return findSeriesFearlessConflicts(gamesData);
  }, [gamesData, fearlessEnabled, draftFormat]);

  const blueFearlessUsedHeroes = useMemo(() => {
    const list: Hero[] = [];
    const seen = new Set<number>();
    for (let g = 1; g < gameNumber; g++) {
      const past = gamesData[g];
      if (!past) continue;
      const curBlueTeam = teamOnSide(gamesData[gameNumber] || { blueTeam }, 'blue');
      const bTeam = teamOnSide(past, 'blue');
      const picks = bTeam === curBlueTeam ? past.bluePicks : (teamOnSide(past, 'red') === curBlueTeam ? past.redPicks : []);
      for (const h of picks) {
        if (h && !seen.has(h.hero_id)) {
          seen.add(h.hero_id);
          list.push(h);
        }
      }
    }
    return list;
  }, [gamesData, gameNumber, blueTeam]);

  const redFearlessUsedHeroes = useMemo(() => {
    const list: Hero[] = [];
    const seen = new Set<number>();
    for (let g = 1; g < gameNumber; g++) {
      const past = gamesData[g];
      if (!past) continue;
      const curRedTeam = teamOnSide(gamesData[gameNumber] || { blueTeam }, 'red');
      const bTeam = teamOnSide(past, 'blue');
      const picks = bTeam === curRedTeam ? past.bluePicks : (teamOnSide(past, 'red') === curRedTeam ? past.redPicks : []);
      for (const h of picks) {
        if (h && !seen.has(h.hero_id)) {
          seen.add(h.hero_id);
          list.push(h);
        }
      }
    }
    return list;
  }, [gamesData, gameNumber, blueTeam]);

  // Unavailable heroes in current draft for the ACTIVE TEAM:
  // - Already picked or banned in current match
  // - In Ranked blind ban, opposing teams can ban the same hero
  // - PLUS heroes that the ACTIVE side already picked in previous games of this Fearless series!
  // - If any Flowborn role is picked/banned/locked, all 5 Flowborn role variants are unavailable!
  const currentDraftUnavailableIds = useMemo(() => {
    const ids = new Set<number>();
    bluePicks.forEach((h) => h && ids.add(h.hero_id));
    redPicks.forEach((h) => h && ids.add(h.hero_id));

    if (currentTurn.action === 'ban' && draftFormat === 'ranked') {
      const ownBans = currentTurn.side === 'blue' ? blueBans : redBans;
      ownBans.forEach((h) => h && ids.add(h.hero_id));
    } else {
      blueBans.forEach((h) => h && ids.add(h.hero_id));
      redBans.forEach((h) => h && ids.add(h.hero_id));
    }

    if (fearlessEnabled && draftFormat !== 'ranked' && currentTurn.action === 'pick') {
      const teamFearlessSet = currentTurn.side === 'blue' ? blueFearlessUnavailableIds : redFearlessUnavailableIds;
      teamFearlessSet.forEach((id) => ids.add(id));
    }

    if (Array.from(ids).some(isFlowborn)) {
      FLOWBORN_HERO_IDS.forEach((fId) => ids.add(fId));
    }

    return ids;
  }, [bluePicks, redPicks, blueBans, redBans, fearlessEnabled, draftFormat, currentTurn, blueFearlessUnavailableIds, redFearlessUnavailableIds]);

  const allPickedHeroIds = useMemo(() => {
    const ids = new Set([...bluePicks, ...redPicks].filter(Boolean).map(h => h!.hero_id));
    if (Array.from(ids).some(isFlowborn)) {
      FLOWBORN_HERO_IDS.forEach((fId) => ids.add(fId));
    }
    return ids;
  }, [bluePicks, redPicks]);

  const allBannedHeroIds = useMemo(() => {
    const ids = new Set([...blueBans, ...redBans].filter(Boolean).map(h => h!.hero_id));
    if (Array.from(ids).some(isFlowborn)) {
      FLOWBORN_HERO_IDS.forEach((fId) => ids.add(fId));
    }
    return ids;
  }, [blueBans, redBans]);

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
      const bannedIds = (draftFormat === 'ranked' && turn.action === 'ban')
        ? (turn.side === 'blue' ? bBans : rBans).filter(Boolean).map((h) => h!.hero_id)
        : [...bBans, ...rBans].filter(Boolean).map((h) => h!.hero_id);
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
          Array.from(turn.side === 'blue' ? redFearlessSet : blueFearlessSet),
          draftFormat,
          isUltimateBattle,
          rankedBanCount
        );

        setEngineReady(true);
        setTacticalScores(result.tacticalScores);
        // Rekomendasi yang dilihat pengguna harus persis kandidat yang consider mesin.
        // Sheet mentah bisa menyebut hero yang lane-nya sudah penuh (mis. dua Clash
        // tanpa jungler) — padahal mesin tidak akan pernah memilihnya. Kandidat
        //considered didahulukan; sisanya tetap tampil agar semua hero punya peringkat.
        const engineCandidates =
          turn.action === 'pick'
            ? pickPhaseCandidates(result.recommendations, ourPicks.filter(Boolean) as Hero[], synergyData?.hero_lane_rates)
            : result.recommendations;
        const engineIds = new Set(engineCandidates.map((rec) => rec.hero.hero_id));
        const laneOrdered =
          engineCandidates.length === result.recommendations.length
            ? result.recommendations
            : [...engineCandidates, ...result.recommendations.filter((rec) => !engineIds.has(rec.hero.hero_id))];
        // Urutan akhir mengikuti EVALUATOR POSISI milik solver (game theory), bukan
        // skor heuristik per-hero: diukur, sheet dan solver hanya cocok di 19,5%
        // posisi pick, dan 63,4% setelah kandidat diurutkan ulang dengan evaluator
        // yang sama. Plan A/B yang dikunci pengguna tetap didahulukan.
        const advisorContext: SearchContext = {
          heroes: allH,
          onlyGlobal: onlyGlobalReleased,
          fearless: { blue: Array.from(blueFearlessSet), red: Array.from(redFearlessSet) },
          format: draftFormat,
          synergy: synergyData,
          aiSide: turn.side,
          aiPlan: { a: planAId ?? null, b: planBId ?? null },
        };
        const advisorPosition: DraftPosition = {
          step: turn.stepIndex,
          picks: {
            blue: bPicks.filter(Boolean).map((h) => h!.hero_id),
            red: rPicks.filter(Boolean).map((h) => h!.hero_id),
          },
          bans: {
            blue: bBans.filter(Boolean).map((h) => h!.hero_id),
            red: rBans.filter(Boolean).map((h) => h!.hero_id),
          },
        };
        setRecommendations(
          turn.action === 'pick'
            ? rankRecommendationsByPosition(laneOrdered, advisorPosition, advisorContext, { lockedPlanHeroId: planAId })
            : laneOrdered,
        );
        setDuetPackages(result.duetPackages || []);
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
            setInsightMode('delta');
          }
        } else {
          // Judul TIDAK diset di sini: daftar yang dilihat pengguna bisa berubah
          // setelah solver menjawab (judul ditulis dari `displayRecommendations`,
          // bukan dari sheet mentah) — supaya judul dan daftar tidak pernah
          // menyebut hero berbeda.
          setInsightMode('recommendation');
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

  // ---------------------------------------------------------------------------
  // Jalur advisor: rekomendasi utama untuk pemain datang dari SOLVER MINIMAX yang
  // sama dengan yang dipakai AI lawan, bukan perkiraan 1-ply yang cepat. Product
  // owner tidak peduli latensi di jalur ini, jadi pencarian boleh memakai anggaran
  // yang diperpanjang (MAX_ADVISOR_BUDGET_MS) dan kedalaman 4.
  //
  // Posisi yang dikirim adalah state publik murni: Plan A/B pemain tidak pernah ikut
  // (AGENTS.md §4.F). Selama pencarian berjalan, urutan cepat tetap tampil.
  // ---------------------------------------------------------------------------
  const simulatorActive = activeTab === 'draft' && draftMode === 'simulator';
  // Worker terpisah dari worker lawan AI latihan, supaya pencarian advisor yang panjang
  // tidak pernah menunda giliran AI di mode latihan. Sisi default konstruktor tidak
  // dipakai: setiap permintaan advisor mengirim `side` sendiri.
  const advisorClient = useMemo(
    () => (dataset ? new OpponentClient(dataset, 'blue') : null),
    [dataset]
  );
  useEffect(() => () => advisorClient?.cancel(), [advisorClient]);

  const advisorPosition = useMemo<DraftPosition>(() => ({
    step: draftStep,
    picks: {
      blue: bluePicks.filter((h): h is Hero => h !== null).map((h) => h.hero_id),
      red: redPicks.filter((h): h is Hero => h !== null).map((h) => h.hero_id),
    },
    bans: {
      blue: blueBans.filter((h): h is Hero => h !== null).map((h) => h.hero_id),
      red: redBans.filter((h): h is Hero => h !== null).map((h) => h.hero_id),
    },
  }), [draftStep, bluePicks, redPicks, blueBans, redBans]);

  // Identitas papan: satu string yang berubah setiap kali posisi, sisi, format, atau
  // kunci Fearless berubah. Plan A/B sengaja TIDAK ikut — solver tidak pernah menerima
  // plan, jadi mengunci plan tidak perlu mengulang pencarian.
  const advisorSignature = useMemo(
    () => JSON.stringify({
      position: advisorPosition,
      format: draftFormat,
      onlyGlobal: onlyGlobalReleased,
      fearless: {
        blue: [...blueFearlessUnavailableIds].sort((a, b) => a - b),
        red: [...redFearlessUnavailableIds].sort((a, b) => a - b),
      },
      side: currentTurn.side,
      action: currentTurn.action,
      complete: currentTurn.isComplete,
      ultimate: isUltimateBattle,
      rankedBanCount,
      game: gameNumber,
    }),
    [
      advisorPosition,
      draftFormat,
      onlyGlobalReleased,
      blueFearlessUnavailableIds,
      redFearlessUnavailableIds,
      currentTurn.side,
      currentTurn.action,
      currentTurn.isComplete,
      isUltimateBattle,
      gameNumber,
    ]
  );

  useEffect(() => {
    // Jawaban lama tidak pernah berlaku untuk papan baru.
    setAdvisorDecision(null);
    setAdvisorDecisionKey(null);
    if (!advisorClient || !simulatorActive) {
      setAdvisorStatus({ state: 'idle' });
      return;
    }
    // Advisor jalan untuk SEMUA giliran — pick maupun ban. Solver bisa menilai
    // kedua jenis aksi (urutan draft含 ban), dan daftar ban yang benar adalah
    // bagian dari "rekomendasi terbaik di semua kondisi".
    if (currentTurn.isComplete) {
      setAdvisorStatus({ state: 'idle' });
      return;
    }

    const controller = new AbortController();
    const key = advisorSignature;
    const revision = advisorRevisionRef.current + 1;
    advisorRevisionRef.current = revision;
    // UI harus tahu bahwa mesin sedang bekerja: urutan cepat tampil sementara,
    // lalu digantikan urutan solver penuh.
    setAdvisorStatus({ state: 'calculating' });
    void advisorClient
      .decide(
        advisorPosition,
        {
          fearless: { blue: [...blueFearlessUnavailableIds], red: [...redFearlessUnavailableIds] },
          // Plan A/B milik pemain TIDAK boleh sampai ke pencari.
          aiPlan: { a: null, b: null },
          format: draftFormat,
          side: currentTurn.side,
          isUltimateBattle,
          rankedBanCount,
          onlyGlobal: onlyGlobalReleased,
          options: {
            maxDepth: 4,
            width: 8,
            budgetMs: MAX_ADVISOR_BUDGET_MS,
            allowExtendedBudget: true,
            // Nilai per kandidat → SELURUH daftar bisa diurutkan oleh solver.
            orderCandidates: true,
          },
        },
        { sessionId: 'simulator-advisor', revision },
        controller.signal,
      )
      .then((decision) => {
        // Stale guard ganda: signal (reset/undo/mode/unmount) dan tag sesi+revisi.
        if (controller.signal.aborted) return;
        if (decision.heroId === null || decision.engineKind === 'deterministic') {
          setAdvisorStatus({ state: 'fallback' });
          return;
        }
        setAdvisorDecision({
          heroId: decision.heroId,
          engineKind: decision.engineKind,
          completedDepth: decision.completedDepth,
          elapsedMs: decision.elapsedMs,
          rootValues: decision.rootValues,
        });
        setAdvisorDecisionKey(key);
        setAdvisorStatus({
          state: 'ready',
          heroId: decision.heroId,
          depth: decision.completedDepth,
          elapsedMs: decision.elapsedMs,
        });
      })
      .catch(() => {
        // Dibatalkan / watchdog: urutan cepat tetap tampil.
        if (!controller.signal.aborted) setAdvisorStatus({ state: 'fallback' });
      });

    return () => controller.abort();
  }, [
    advisorClient,
    simulatorActive,
    advisorSignature,
    advisorPosition,
    currentTurn.isComplete,
    currentTurn.action,
    currentTurn.side,
    draftFormat,
    isUltimateBattle,
    rankedBanCount,
    blueFearlessUnavailableIds,
    redFearlessUnavailableIds,
  ]);

  // Urutan rekomendasi yang DILIHAT pengguna. Selama pencarian berjalan (atau bila
  // solver gagal) ini sama dengan urutan cepat. Setelah solver menjawab, SELURUH
  // daftar diurutkan ulang menurut nilai yang dihitung mesin itu sendiri — bukan
  // cuma #1 yang naik. Plan A/B yang dikunci pengguna tetap di posisi pertama:
  // keputusan pengguna mengalahkan mesin.
  const displayRecommendations = useMemo(() => {
    if (!advisorDecision || advisorDecisionKey !== advisorSignature) return recommendations;
    // Plan A/B yang dikunci pengguna hanya dipromosikan ke posisi pertama pada fase PICK.
    // Pada fase BAN, hero rencana tim sendiri tidak boleh dipromosikan sebagai target ban!
    const lockedPlanId = currentTurn.action === 'pick' ? (activeSidePlanAId ?? activeSidePlanBId) : null;
    return orderRecommendationsBySolver(recommendations, advisorDecision.rootValues, {
      lockedPlanHeroId: lockedPlanId,
    });
  }, [
    recommendations,
    advisorDecision,
    advisorDecisionKey,
    advisorSignature,
    activeSidePlanAId,
    activeSidePlanBId,
    currentTurn.action,
  ]);

  // Judul "Rekomendasi #1" SELALU mengikuti daftar yang dilihat pengguna. Begitu
  // solver menjawab, daftar berubah dan judul ikut berubah — judul tidak pernah
  // menyebut hero yang berbeda dari posisi pertama di layar.
  useEffect(() => {
    if (insightMode !== 'recommendation') return;
    const topRec = displayRecommendations[0];
    if (!topRec) return;
    setPrimaryInsight(
      `Rekomendasi #1 (${currentTurn.side.toUpperCase()} ${currentTurn.action.toUpperCase()}): ${topRec.hero.name} — ${
        topRec.proComboTag || topRec.laneTag || 'Prioritas Taktis Tertinggi'
      }`
    );
  }, [displayRecommendations, currentTurn.side, currentTurn.action, insightMode]);

  // Helper to mutate current game draft
  const updateCurrentDraft = useCallback(
    (updater: (prev: GameDraftData) => GameDraftData) => {
      setGamesData((prev) => ({
        ...prev,
        [gameNumber]: updater(prev[gameNumber] || createInitialGameDraft(draftFormat, 'A', false, draftFormat === 'ranked' ? rankedBanCount : 3)),
      }));
    },
    [gameNumber, draftFormat]
  );

  const handleFormatChange = (newFormat: DraftFormat) => {
    setDraftFormat(newFormat);
    setGamesData({
      1: createInitialGameDraft(newFormat, 'A', false, newFormat === 'ranked' ? rankedBanCount : 3),
      2: createInitialGameDraft(newFormat, 'A', false, newFormat === 'ranked' ? rankedBanCount : 3),
      3: createInitialGameDraft(newFormat, 'A', false, newFormat === 'ranked' ? rankedBanCount : 3),
      4: createInitialGameDraft(newFormat, 'A', false, newFormat === 'ranked' ? rankedBanCount : 3),
      5: createInitialGameDraft(newFormat, 'A', false, newFormat === 'ranked' ? rankedBanCount : 3),
    });
    setLaneOverridesByGame({});
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(newFormat === 'ranked' ? 'Format Ranked aktif (Blind Ban 3 + Pick Standar).' : 'Format Turnamen aktif (4 Fase Ban & Pick).');
  };

  // Handle hero pick / ban selection
  const handleSelectHero = (hero: Hero) => {
    if (currentTurn.isComplete || currentDraftUnavailableIds.has(hero.hero_id) || (onlyGlobalReleased && !isHeroGlobalReleased(hero))) return;

    setPreviousScores(tacticalScores);

    updateCurrentDraft((prev) => applyGameHero(prev, hero, { heroes, onlyGlobal: onlyGlobalReleased, fearless: { blue: [...blueFearlessUnavailableIds], red: [...redFearlessUnavailableIds] }, format: draftFormat }, draftFormat));
  };

  // Roster selection: after a pick/ban from a filtered result list, hand the search
  // field back focused with its query highlighted so the next name can be typed at once.
  const handleRosterSelectHeroRef = useRef<(hero: Hero) => void>(() => {});
  handleRosterSelectHeroRef.current = (hero: Hero) => {
    handleSelectHero(hero);
    if (searchQuery.trim()) focusHeroSearch({ select: true });
  };
  const handleRosterSelectHero = useCallback((hero: Hero) => {
    handleRosterSelectHeroRef.current(hero);
  }, []);

  // Handle two-hero core package selection on double-pick turns
  const handleSelectDuetPackage = (duet: DuetPackageOption) => {
    if (currentTurn.isComplete) return;
    setPreviousScores(tacticalScores);

    updateCurrentDraft((prev) => {
      const ctx = {
        heroes,
        onlyGlobal: onlyGlobalReleased,
        fearless: { blue: [...blueFearlessUnavailableIds], red: [...redFearlessUnavailableIds] },
        format: draftFormat,
        isUltimateBattle,
      };
      const afterFirst = applyGameHero(prev, duet.primaryHero, ctx, draftFormat, isUltimateBattle);
      const afterSecond = applyGameHero(afterFirst, duet.secondaryHero, ctx, draftFormat, isUltimateBattle);
      return afterSecond;
    });
  };

  // Reset Current Game Draft ONLY (preserves other games!)
  const handleResetDraft = () => {
    updateCurrentDraft(() => createInitialGameDraft(draftFormat, 'A', false, draftFormat === 'ranked' ? rankedBanCount : 3));
    setLaneOverridesByGame((prev) => ({ ...prev, [gameNumber]: {} }));
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(draftFormat === 'ranked' ? 'Draft Ranked di-reset. Giliran Blind Ban.' : `Draft Game ${gameNumber} di-reset. Giliran Blue Side BAN Fase 1.`);
  };

  // Undo Step in Current Game
  const handleUndoStep = () => {
    if (draftStep === 0) return;
    setLaneOverridesByGame((prev) => ({ ...prev, [gameNumber]: {} }));
    const prevStepIndex = draftStep - 1;
    const prevTurn = getDraftTurn(prevStepIndex, draftFormat, isUltimateBattle, rankedBanCount);

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

  // Switch Game in Fearless Mode: Check loser side selection or Ultimate Battle
  const handleGameChange = (game: number) => {
    // If going to Game 7 in BO7 and score is 3-3, configure Ultimate Battle
    const targetIsUltimate = (seriesFormat === 'BO7' && game === 7 && seriesScore.teamA === 3 && seriesScore.teamB === 3);
    setGamesData((prev) => {
      const existing = prev[game];
      if (existing && existing.isUltimateBattle !== targetIsUltimate) {
        return {
          ...prev,
          [game]: {
            ...existing,
            isUltimateBattle: targetIsUltimate,
          }
        };
      }
      return prev;
    });

    setGameNumber(game);
    setPreviousScores(null);
    setDeltas([]);
    setPrimaryInsight(targetIsUltimate ? 'Game 7: Ultimate Battle (Blind Pick 0 Ban, Mirror Hero Legal).' : `Beralih ke Game ${game} dalam Seri Fearless Draft.`);
  };

  // Switch from Live Advisor back to the simulator view so the user can see the applied board.
  const handleSwitchToSimulator = useCallback(() => {
    handleDraftModeChange('simulator');
  }, [handleDraftModeChange]);

  // Record winner of current game
  const handleRecordWinner = (winnerSide: 'blue' | 'red') => {
    updateCurrentDraft((prev) => ({
      ...prev,
      winner: winnerSide,
    }));
    const winningTeam = teamOnSide(currentGame, winnerSide);
    const winningName = winningTeam === 'A' ? teamAName : teamBName;
    setPrimaryInsight(`Hasil Game ${gameNumber} dicatat: ${winningName} (${winnerSide.toUpperCase()}) menang.`);
  };

  // Apply a detected live-board position into the simulator by replaying every detected action through applyGameHero.
  // The advisor's format is independent of the simulator's, so refuse to apply while they disagree — the ranked
  // sequence (16 steps) and the tournament sequence (18 steps) make any cross-format step comparison meaningless.
  const handleApplyVisionToSimulator = useCallback((detectedPosition: DraftPosition): VisionApplyResult => {
    if (draftFormat !== VISION_ADVISOR_FORMAT) {
      return { ok: false, reason: visionFormatMismatchReason(VISION_ADVISOR_FORMAT) };
    }
    let outcome: VisionApplyResult = { ok: false, reason: 'Tidak dapat menerapkan posisi.' };
    updateCurrentDraft((prevGame) => {
      const currentPosition = toPosition(prevGame);
      if (currentPosition.step >= detectedPosition.step) {
        outcome = { ok: false, reason: 'Simulator sudah melewati posisi terdeteksi.' };
        return prevGame;
      }
      let game = prevGame;
      let appliedCount = 0;
      const ctx = {
        heroes,
        onlyGlobal: onlyGlobalReleased,
        fearless: { blue: [...blueFearlessUnavailableIds], red: [...redFearlessUnavailableIds] },
        format: draftFormat,
        isUltimateBattle,
      };
      for (let step = currentPosition.step; step < detectedPosition.step; step += 1) {
        const turn = getDraftTurn(step, draftFormat, isUltimateBattle, rankedBanCount);
        const field = turn.action === 'pick' ? 'picks' : 'bans';
        const slotsKey = `${turn.side}${field === 'picks' ? 'Picks' : 'Bans'}` as const;
        const filledCount = game[slotsKey].filter(Boolean).length;
        const heroId = detectedPosition[field][turn.side][filledCount];
        const hero = heroes.find(h => h.hero_id === heroId);
        if (!hero) {
          outcome = { ok: false, reason: `Hero tidak dikenali pada langkah ${step + 1}.` };
          break;
        }
        const next = applyGameHero(game, hero, ctx, draftFormat, isUltimateBattle);
        if (next === game) {
          outcome = { ok: false, reason: `Aksi ditolak pada langkah ${step + 1} (hero tidak legal).` };
          break;
        }
        game = next;
        appliedCount += 1;
      }
      if (appliedCount > 0) {
        outcome = { ok: true, appliedCount, newStep: toPosition(game).step };
      } else if (!outcome.ok && outcome.reason === 'Tidak dapat menerapkan posisi.') {
        outcome = { ok: false, reason: 'Tidak ada aksi baru yang dapat diterapkan.' };
      }
      return game;
    });
    return outcome;
  }, [heroes, onlyGlobalReleased, blueFearlessUnavailableIds, redFearlessUnavailableIds, draftFormat, isUltimateBattle, updateCurrentDraft]);

  // Swap sides for current game (only when draft hasn't started)
  const handleSwapSides = () => {
    if (draftStep > 0) return;
    updateCurrentDraft((prev) => {
      const nextBlueTeam: SeriesTeam = prev.blueTeam === 'A' ? 'B' : 'A';
      return {
        ...prev,
        blueTeam: nextBlueTeam,
        // Swap strategic plans as well to follow team identity
        bluePlanAId: prev.redPlanAId,
        bluePlanBId: prev.redPlanBId,
        redPlanAId: prev.bluePlanAId,
        redPlanBId: prev.bluePlanBId,
      };
    });
    setPrimaryInsight(`Sisi tim ditukar: Blue sekarang Tim ${blueTeam === 'A' ? 'B' : 'A'}.`);
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

  // Filter & Sort Heroes for the main grid (base filtering memoized separately from deferred typing)
  const baseHeroesAndCompare = useMemo(() => {
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

    // Filter by Tab (Favorites / Counter)
    if (activeTab === 'favorites') {
      result = result.filter((h) => favorites.has(h.hero_id));
    }

    // Attach AI scores
    const recMap = new Map<number, number>();
    displayRecommendations.forEach((rec, idx) => recMap.set(rec.hero.hero_id, idx + 1));

    const compare = (a: Hero, b: Hero) => {
      if (sortMode === 'ai' && activeTab === 'draft') {
        const rankA = recMap.get(a.hero_id) ?? 999;
        const rankB = recMap.get(b.hero_id) ?? 999;
        if (rankA !== rankB) return rankA - rankB;
        return b.win_rate - a.win_rate;
      }
      if (sortMode === 'win') return b.win_rate - a.win_rate;
      if (sortMode === 'pick') return b.pick_rate - a.pick_rate;
      return a.name.localeCompare(b.name);
    };

    return { result, compare };
  }, [heroes, selectedLane, activeTab, favorites, displayRecommendations, sortMode, onlyGlobalReleased]);

  const filteredAndSortedHeroes = useMemo(
    () => searchHeroes(baseHeroesAndCompare.result, deferredSearchQuery, baseHeroesAndCompare.compare),
    [baseHeroesAndCompare, deferredSearchQuery]
  );

  const recommendationByHeroId = useMemo(
    () => new Map(displayRecommendations.map((rec, index) => [rec.hero.hero_id, { rec, rank: index + 1 }])),
    [displayRecommendations]
  );

  // Enter in the search field commits the first result that is still legal. Skipping the
  // taken ones keeps "type a name, press Enter" working after earlier bans and picks.
  const handleConfirmHeroSearch = () => {
    if (activeTab !== 'draft' || currentTurn.isComplete || !searchQuery.trim()) return;
    const candidates =
      deferredSearchQuery === searchQuery
        ? filteredAndSortedHeroes
        : searchHeroes(baseHeroesAndCompare.result, searchQuery, baseHeroesAndCompare.compare);
    const first = firstSelectableHero(candidates, (hero) => !currentDraftUnavailableIds.has(hero.hero_id));
    if (first) handleRosterSelectHero(first);
  };

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Lewati ke konten utama</a>
      <HeaderSortBar activeTab={activeTab} onTabChange={handleTabChange} engineReady={engineReady} globalLocked={false} onlyGlobalReleased={onlyGlobalReleased} onToggleGlobalReleased={() => setOnlyGlobalReleased(value => !value)} favoriteCount={favorites.size} />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="page-heading"><div><h1>{activeTab === 'draft' ? 'Ruang draft' : activeTab === 'favorites' ? 'Hero favorit' : 'Wiki & Ensiklopedia'}</h1><p>{activeTab === 'draft' ? (draftMode === 'practice' ? 'Pilih sisi, susun strategi, lalu uji keputusanmu melawan AI.' : draftMode === 'vision' ? 'Pantau layar draft secara langsung dan lihat rekomendasi read-only.' : 'Atur kedua tim dan cari pilihan terbaik untuk setiap giliran.') : activeTab === 'favorites' ? 'Simpan hero dari wiki untuk mengaksesnya kembali dengan cepat.' : 'Ensiklopedia lengkap Honor of Kings: Hero & Matrix Counter, Item Equipment, Arcana Level 5, dan Battle Spell.'}</p></div>
          {activeTab === 'draft' && <div className="mode-switch" role="group" aria-label="Mode draft"><button type="button" aria-pressed={draftMode === 'simulator'} onClick={() => handleDraftModeChange('simulator')}><SlidersHorizontal aria-hidden="true" />Simulator</button><button type="button" aria-pressed={draftMode === 'practice'} onClick={() => handleDraftModeChange('practice')}><Gamepad2 aria-hidden="true" />Latihan vs AI</button><button type="button" aria-pressed={draftMode === 'vision'} onClick={() => handleDraftModeChange('vision')}><Scan aria-hidden="true" />Live Advisor <span className="beta-badge">Beta</span></button></div>}
        </div>
        {loadError && <section role="alert" className="empty-state"><AlertTriangle aria-hidden="true" /><h2>Data hero belum dapat dimuat</h2><p>{loadError}</p><button type="button" className="ui-button ui-button--primary" onClick={() => void loadData()}><RefreshCw aria-hidden="true" />Coba lagi</button></section>}
        {dataset && (practiceActive || hasVisitedPractice) && (
          <Suspense fallback={<div className="surface-panel p-6 text-sm text-slate-400" role="status">Memuat ruang latihan…</div>}>
            <div hidden={!practiceActive}><PracticeDraft dataset={dataset} active={practiceActive} onlyGlobalReleased={onlyGlobalReleased} assistance={practiceAssistance} onAssistanceChange={setPracticeAssistance} selectedLane={selectedLane} onLaneChange={setSelectedLane} searchQuery={searchQuery} onSearchChange={setSearchQuery} sortMode={sortMode} onSortChange={setSortMode} viewMode={viewMode} onViewChange={setViewMode} favorites={favorites} onToggleFavorite={handleToggleFavorite} initialSharedSession={sharedPracticeSession} onShareSession={handleSharePracticeSession} /></div>
          </Suspense>
        )}
        {!practiceActive && <>
          {activeTab === 'draft' && !loadError && draftMode !== 'vision' && (
            <DraftSimulator
              format={draftFormat}
              onFormatChange={handleFormatChange}
              bluePicks={bluePicks}
              redPicks={redPicks}
              blueBans={blueBans}
              redBans={redBans}
              blueAssignedLanes={blueAssignedLanes}
              redAssignedLanes={redAssignedLanes}
              currentTurn={currentTurn}
              fearlessEnabled={fearlessEnabled}
              onToggleFearless={setFearlessEnabled}
              gameNumber={gameNumber}
              onGameNumberChange={handleGameChange}
              onResetDraft={handleResetDraft}
              onUndoStep={handleUndoStep}
              blueFearlessUsedHeroes={blueFearlessUsedHeroes}
              redFearlessUsedHeroes={redFearlessUsedHeroes}
              onInspectHero={handleInspectHero}
              onRequestHero={!loading ? () => focusHeroSearch({ select: true }) : undefined}
              seriesFormat={seriesFormat}
              onSeriesFormatChange={setSeriesFormat}
              onShareSeries={handleShareSimulatorDraft}
              blueTeamName={blueTeam === 'A' ? teamAName : teamBName}
              redTeamName={blueTeam === 'A' ? teamBName : teamAName}
              onSwapSides={handleSwapSides}
              onRecordWinner={handleRecordWinner}
              currentGameWinner={currentGameWinner}
              seriesScore={seriesScore}
              teamAName={teamAName}
              teamBName={teamBName}
              isUltimateBattle={isUltimateBattle}
              fearlessConflicts={fearlessConflicts}
              rankedBanCount={rankedBanCount}
              onRankedBanCountChange={setRankedBanCount}
            />
          )}
          {activeTab === 'draft' && !loadError && draftMode === 'vision' && (
            <Suspense fallback={<div className="surface-panel p-6 text-sm text-slate-400" role="status">Memuat Live Draft Advisor…</div>}>
              <VisionPanel
                dataset={dataset}
                heroes={heroes}
                synergyData={synergyData}
                advisorFormat={VISION_ADVISOR_FORMAT}
                simulatorFormat={draftFormat}
                onlyGlobalReleased={onlyGlobalReleased}
                fearlessLocks={{ blue: blueFearlessUnavailableIds, red: redFearlessUnavailableIds }}
                bluePlanAId={bluePlanAId}
                bluePlanBId={bluePlanBId}
                redPlanAId={redPlanAId}
                redPlanBId={redPlanBId}
                isUltimateBattle={isUltimateBattle}
                currentGamePosition={toPosition(currentGame)}
                onApplyToSimulator={handleApplyVisionToSimulator}
                onSwitchToSimulator={handleSwitchToSimulator}
                onInspectHero={handleInspectHero}
              />
            </Suspense>
          )}
          {activeTab === 'draft' && !loadError && !visionActive && currentTurn.isComplete && filledBlueHeroes.length === 5 && filledRedHeroes.length === 5 && (
            <Suspense fallback={<div className="surface-panel p-6 text-sm text-slate-400" role="status">Memuat analisis pasca-draft…</div>}>
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
                onInspectHero={handleInspectHero}
              />
            </Suspense>
          )}
          {!loadError && (activeTab === 'wiki' || activeTab === 'counter') && (
            <Suspense fallback={<div className="surface-panel p-6 text-sm text-slate-400" role="status">Memuat Ensiklopedia Wiki…</div>}>
              <WikiHub
                heroes={heroes}
                items={dataset?.items}
                spells={dataset?.spells}
                onInspectHero={handleInspectHero}
                onlyGlobalReleased={onlyGlobalReleased}
                initialSubTab={route.wikiSubTab}
                onSubTabChange={(subTab) => navigate({ activeTab: 'wiki', wikiSubTab: subTab })}
                initialTargetHeroId={activeTab === 'counter' ? heroes[0]?.hero_id : undefined}
              />
            </Suspense>
          )}
          {!loadError && !visionActive && (activeTab === 'draft' || activeTab === 'favorites') && <div className={activeTab === 'draft' ? 'draft-workspace' : ''}>
            <section className="hero-roster" id="hero-roster" aria-label="Katalog hero" aria-busy={loading}>
              <HeroRosterToolbar title={activeTab === 'favorites' ? 'Hero favorit' : activeTab === 'draft' ? 'Pilih hero untuk ' + (currentTurn.action === 'ban' ? 'ban' : 'pick') : 'Jelajahi hero'} count={filteredAndSortedHeroes.length} searchQuery={searchQuery} onSearchChange={setSearchQuery} onConfirmSearch={handleConfirmHeroSearch} selectedLane={selectedLane} onLaneChange={setSelectedLane} sortMode={sortMode} onSortChange={setSortMode} viewMode={viewMode} onViewChange={setViewMode} hideAiSort={activeTab !== 'draft'} />
              {loading ? <div className="hero-grid" role="status" aria-label="Memuat katalog hero"><span className="sr-only">Memuat database hero…</span>{Array.from({ length: 12 }, (_, index) => <div key={index} className="roster-skeleton" aria-hidden="true" />)}</div>
                : !filteredAndSortedHeroes.length ? <div className="empty-state">{activeTab === 'favorites' && !favorites.size ? <Star aria-hidden="true" /> : <SearchX aria-hidden="true" />}<h3>{activeTab === 'favorites' && !favorites.size ? 'Belum ada hero favorit' : 'Hero tidak ditemukan'}</h3><p>{activeTab === 'favorites' && !favorites.size ? 'Buka wiki hero, lalu simpan ke favorit.' : 'Coba nama lain atau hapus filter lane yang aktif.'}</p><button type="button" className="ui-button ui-button--quiet" onClick={() => { setSearchQuery(''); setSelectedLane('All'); if (activeTab === 'favorites' && !favorites.size) handleTabChange('wiki'); }}>{activeTab === 'favorites' && !favorites.size ? <BookOpen aria-hidden="true" /> : <FilterX aria-hidden="true" />}{activeTab === 'favorites' && !favorites.size ? 'Jelajahi hero' : 'Bersihkan filter'}</button></div>
                : <div className={'hero-grid' + (viewMode === 'detailed' ? ' hero-grid--detailed' : '')}>{filteredAndSortedHeroes.map((hero, index) => {
                  const isUnavailable = activeTab === 'draft' && currentDraftUnavailableIds.has(hero.hero_id);
                  let unavailableLabel: string | undefined = undefined;
                  if (isUnavailable) {
                    if (allPickedHeroIds.has(hero.hero_id)) {
                      unavailableLabel = 'Terpilih';
                    } else if (allBannedHeroIds.has(hero.hero_id)) {
                      unavailableLabel = 'Terban';
                    } else if (fearlessEnabled && draftFormat !== 'ranked' && (blueFearlessUnavailableIds.has(hero.hero_id) || redFearlessUnavailableIds.has(hero.hero_id))) {
                      unavailableLabel = 'Terkunci';
                    } else {
                      unavailableLabel = currentTurn.action === 'ban' ? 'Terban' : 'Terpilih';
                    }
                  }
                  const recEntry = activeTab === 'draft' ? recommendationByHeroId.get(hero.hero_id) : undefined;
                  const rec = recEntry?.rec;
                  const rank = recEntry?.rank ?? 0;
                  const shared = {
                    hero,
                    isUnavailable,
                    unavailableLabel,
                    onClick: handleInspectHero,
                    onSelect: activeTab === 'draft' ? handleRosterSelectHero : undefined,
                    selectionDisabled: currentTurn.isComplete,
                    action: currentTurn.action,
                    aiRank: rank > 0 ? rank : undefined,
                    recommendationReason: rec?.proComboTag || rec?.laneTag,
                    projection: rec?.projection,
                    imagePriority: index < 12 ? ('eager' as const) : ('lazy' as const),
                  };
                  return viewMode === 'compact' ? <HeroCardCompact key={hero.hero_id} {...shared} quickBadge={rank > 0 && rank <= 5 ? 'AI #' + rank : undefined} /> : <HeroCardDetailed key={hero.hero_id} {...shared} aiRank={rank > 0 ? rank : undefined} />;
                })}</div>}
            </section>
            {activeTab === 'draft' && !loading && <aside className="analysis-sidebar"><TacticalRadarPanel scores={tacticalScores} deltas={deltas} primaryInsight={primaryInsight} phaseStrategy={phaseStrategy} planAId={activeSidePlanAId} planBId={activeSidePlanBId} onOpenPlanModal={() => setIsPlanModalOpen(true)} onSelectQuickPlanA={handleSetPlanA} recommendations={displayRecommendations} solverStatus={advisorStatus} onSelectCandidate={handleSelectHero} onInspectHero={handleInspectHero} activeSide={currentTurn.side} isPickPhase={currentTurn.action === 'pick'} isComplete={currentTurn.isComplete} duetPackages={duetPackages} onSelectDuetPackage={handleSelectDuetPackage} /></aside>}
          </div>}
        </>}
      </main>
      <BottomCommandDock activeTab={activeTab} onTabChange={handleTabChange} favoriteCount={favorites.size} />
      {wikiHero && (
        <Suspense fallback={null}>
          <HeroWikiDrawer hero={wikiHero} onClose={handleCloseWikiDrawer} isFavorite={favorites.has(wikiHero.hero_id)} onToggleFavorite={handleToggleFavorite} onPickForDraft={activeTab === 'draft' && draftMode === 'simulator' && !currentTurn.isComplete && !currentDraftUnavailableIds.has(wikiHero.hero_id) ? handleSelectHero : undefined} draftActionLabel={currentTurn.action === 'ban' ? 'Ban hero ini' : 'Pick hero ini'} initialTab={activeTab === 'counter' ? 'counters' : 'build'} allHeroes={heroes} onSelectRelatedHero={handleInspectHero} itemCatalog={dataset?.items} spellCatalog={dataset?.spells} />
        </Suspense>
      )}
      <PlanSelectionModal isOpen={isPlanModalOpen} onClose={() => setIsPlanModalOpen(false)} heroes={heroes} currentPlanAId={activeSidePlanAId} currentPlanBId={activeSidePlanBId} onSelectPlanA={handleSetPlanA} onSelectPlanB={handleSetPlanB} activeSide={currentTurn.side} unavailableHeroIds={currentDraftUnavailableIds} recommendedOpeners={phaseStrategy?.candidateOpeners || []} onlyGlobalReleased={onlyGlobalReleased} />
      {(toastMessage || sharedDraftNotice) && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/95 text-white border border-emerald-500/40 shadow-xl backdrop-blur-md text-xs sm:text-sm font-medium animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{toastMessage || sharedDraftNotice}</span>
        </aside>
      )}
    </div>
  );
};

export default App;
