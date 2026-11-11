# Graph Report - hok-draft-engine  (2026-11-11)

## Corpus Check
- 244 files · ~1,420,948 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .css 1)

## Summary
- 604 nodes · 1679 edges · 24 communities (15 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2821b68c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- json
- package.json
- draftRules.ts
- compilerOptions
- heroDataLoader.ts
- verify-dist.mjs
- json
- BrowserWorkerAdapter
- types.ts
- json
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- gamePlan.ts
- ml-engine
- gamePlan.test.mjs
- generatePostDraftGamePlan
- HeaderSortBar.tsx

## God Nodes (most connected - your core abstractions)
1. `Hero` - 30 edges
2. `PracticeDraft()` - 30 edges
3. `App()` - 25 edges
4. `parse_hero_page()` - 25 edges
5. `react` - 22 edges
6. `runTournamentInference()` - 21 edges
7. `norm()` - 20 edges
8. `getDraftTurn()` - 19 edges
9. `lucide-react` - 18 edges
10. `_clean()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `Logika Taktis Kompetitif Utama` --references--> `evaluateEnemyCounterExposure()`  [INFERRED]
  README.md → apps/web/src/engine/tournamentInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `runTournamentInference()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/tournamentInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `loadTournamentDataset()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/heroDataLoader.ts

## Import Cycles
- None detected.

## Communities (24 total, 9 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.07
Nodes (78): God Nodes (Abstraksi Paling Kritis):, App(), BottomCommandDock(), DraftSimulator(), DraftSimulatorProps, HeaderSortBar(), HeroCardCompact(), HeroCardProps (+70 more)

### Community 1 - "json"
Cohesion: 0.09
Nodes (15): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), download_file() (+7 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+26 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.06
Nodes (71): ActionKind, ALL_LANES, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), assignHeroLanes(), DRAFT_SEQUENCE, DraftAction (+63 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.13
Nodes (20): isHeroGlobalReleased(), ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS (+12 more)

### Community 8 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 10 - "json"
Cohesion: 0.11
Nodes (36): _alias_maps(), _build_variants(), canonical(), _cards(), _clean(), fetch_page(), _heading_list(), _hero_label_id() (+28 more)

### Community 12 - "types.ts"
Cohesion: 0.09
Nodes (21): ArcanaItem, CompArchetypeSummary, CounteredByInfo, CounterInfo, DraftSlot, HeroAbility, HeroTempoBucket, HokfireCounters (+13 more)

### Community 13 - "json"
Cohesion: 0.05
Nodes (39): ingest_kpl_data(), init_db(), load_global_mapping(), attach_hokstats(), _load_json(), load_source_heroes(), export(), main() (+31 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.06
Nodes (32): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+24 more)

### Community 17 - "gamePlan.ts"
Cohesion: 0.12
Nodes (20): computeRoamContextAdjustment(), evaluateLaneMatchup(), evaluateSwapMacroProfile(), getPairWinRate(), hasKplFlexLane(), LANE_SWAP_PAIRS, scoreHeroMatchup(), TempoCurveMap (+12 more)

### Community 21 - "gamePlan.test.mjs"
Cohesion: 0.17
Nodes (8): computeRelativeTempoShare(), computeTempoComparison(), estimateHeroTempoFromProfile(), summarizeTeamTempoWithExact(), globalHeroes, heroes, manifest, synergy

### Community 24 - "generatePostDraftGamePlan"
Cohesion: 0.39
Nodes (8): buildHeroMap(), classifyCompArchetype(), computeJungleAndGankPlan(), countHardCc(), deriveWinningCondition(), evaluateAllLanes(), generatePostDraftGamePlan(), suggestBeneficialLaneSwaps()

### Community 26 - "HeaderSortBar.tsx"
Cohesion: 0.67
Nodes (3): Props, APP_NAVIGATION, ActiveTab

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 195 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `types.ts` to `package.json`, `HeaderSortBar.tsx`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0713877784123358 - nodes in this community are weakly interconnected._
- **Why does `lucide-react` connect `types.ts` to `package.json`, `HeaderSortBar.tsx`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.08636977058029689 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `types.ts` to `draftRules.ts`, `AGENTS.md — Developer & Agent Field Manual`, `heroDataLoader.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07301587301587302 - nodes in this community are weakly interconnected._