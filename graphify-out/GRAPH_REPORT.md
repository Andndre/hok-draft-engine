# Graph Report - hok-draft-engine  (2026-11-09)

## Corpus Check
- 80 files · ~499,054 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .css 1)

## Summary
- 478 nodes · 1176 edges · 17 communities (11 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `527c1eee`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- json
- package.json
- draftRules.ts
- 4_export_and_publish_r2.py
- compilerOptions
- heroDataLoader.ts
- verify-dist.mjs
- types.ts
- tactical_profiles.py
- BrowserWorkerAdapter
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `PracticeDraft()` - 26 edges
2. `Hero` - 24 edges
3. `App()` - 20 edges
4. `getDraftTurn()` - 19 edges
5. `react` - 18 edges
6. `runTournamentInference()` - 17 edges
7. `compilerOptions` - 17 edges
8. `rankedCandidates()` - 16 edges
9. `lucide-react` - 16 edges
10. `HeroThumbnail()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `TacticalVector`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `App()`  [INFERRED]
  AGENTS.md → apps/web/src/App.tsx
- `God Nodes (Abstraksi Paling Kritis):` --references--> `loadTournamentDataset()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/heroDataLoader.ts

## Import Cycles
- None detected.

## Communities (17 total, 6 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.09
Nodes (53): App(), BottomCommandDock(), DraftSimulator(), DraftSimulatorProps, HeaderSortBar(), HeroCardCompact(), HeroCardProps, HeroCardDetailed() (+45 more)

### Community 1 - "json"
Cohesion: 0.15
Nodes (9): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), download_file() (+1 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+26 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.06
Nodes (64): God Nodes (Abstraksi Paling Kritis):, isHeroGlobalReleased(), ActionKind, ALL_LANES, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), DRAFT_SEQUENCE (+56 more)

### Community 4 - "4_export_and_publish_r2.py"
Cohesion: 0.07
Nodes (8): JevTeacherScorer, sigmoid(), DraftDataset, JevStudentNet, train_student_model(), compute_sha256(), export_onnx(), generate_manifest_and_metadata()

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.13
Nodes (19): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+11 more)

### Community 8 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 9 - "types.ts"
Cohesion: 0.11
Nodes (21): Props, APP_NAVIGATION, ActiveTab, ArcanaItem, CounteredByInfo, CounterInfo, CounterItemInfo, DraftSlot (+13 more)

### Community 10 - "tactical_profiles.py"
Cohesion: 0.05
Nodes (35): ingest_kpl_data(), init_db(), load_global_mapping(), export(), main(), main(), extract_synergy(), normalize_hid() (+27 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.07
Nodes (27): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+19 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 180 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `draftRules.ts` to `types.ts`, `AGENTS.md — Developer & Agent Field Manual`, `heroDataLoader.ts`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09440947797112181 - nodes in this community are weakly interconnected._
- **Why does `3. Navigasi Knowledge Graph (`graphify`)` connect `AGENTS.md — Developer & Agent Field Manual` to `draftRules.ts`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07301587301587302 - nodes in this community are weakly interconnected._
- **Should `draftRules.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06374085684430512 - nodes in this community are weakly interconnected._
- **Should `4_export_and_publish_r2.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06538461538461539 - nodes in this community are weakly interconnected._