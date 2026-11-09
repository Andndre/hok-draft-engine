# Graph Report - hok-draft-engine  (2026-11-09)

## Corpus Check
- 74 files · ~500,153 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .css 1)

## Summary
- 458 nodes · 1052 edges · 17 communities (10 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `19ac3f33`
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
- JevTeacherScorer
- tactical_profiles.py
- BrowserWorkerAdapter
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `Hero` - 25 edges
2. `PracticeDraft()` - 21 edges
3. `App()` - 19 edges
4. `getDraftTurn()` - 19 edges
5. `runTournamentInference()` - 17 edges
6. `compilerOptions` - 17 edges
7. `rankedCandidates()` - 16 edges
8. `react` - 14 edges
9. `loadTournamentDataset()` - 13 edges
10. `isLegalHero()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `loadTournamentDataset()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/heroDataLoader.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `App()`  [INFERRED]
  AGENTS.md → apps/web/src/App.tsx
- `God Nodes (Abstraksi Paling Kritis):` --references--> `runTournamentInference()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/tournamentInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts

## Import Cycles
- None detected.

## Communities (17 total, 7 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.06
Nodes (68): God Nodes (Abstraksi Paling Kritis):, App(), BottomCommandDock(), BottomCommandDockProps, LANES_CONFIG, DraftSimulator(), DraftSimulatorProps, HeaderSortBar() (+60 more)

### Community 1 - "json"
Cohesion: 0.15
Nodes (9): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), download_file() (+1 more)

### Community 2 - "package.json"
Cohesion: 0.06
Nodes (37): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+29 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.07
Nodes (54): ActionKind, ALL_LANES, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), DRAFT_SEQUENCE, DraftAction, DraftContext (+46 more)

### Community 4 - "4_export_and_publish_r2.py"
Cohesion: 0.08
Nodes (6): DraftDataset, JevStudentNet, train_student_model(), compute_sha256(), export_onnx(), generate_manifest_and_metadata()

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.14
Nodes (19): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+11 more)

### Community 8 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 10 - "tactical_profiles.py"
Cohesion: 0.05
Nodes (36): ingest_kpl_data(), init_db(), load_global_mapping(), sigmoid(), export(), main(), main(), extract_synergy() (+28 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.07
Nodes (27): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+19 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 175 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `types.ts` to `package.json`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06470588235294118 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `types.ts` to `AGENTS.md — Developer & Agent Field Manual`, `heroDataLoader.ts`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.14666666666666667 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06155632984901278 - nodes in this community are weakly interconnected._
- **Should `draftRules.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06993006993006994 - nodes in this community are weakly interconnected._