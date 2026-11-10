# Graph Report - hok-draft-engine  (2026-11-11)

## Corpus Check
- 236 files · ~1,239,799 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .css 1)

## Summary
- 536 nodes · 1456 edges · 20 communities (10 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d4583ce4`
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
- json
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `Hero` - 26 edges
2. `PracticeDraft()` - 26 edges
3. `parse_hero_page()` - 25 edges
4. `react` - 21 edges
5. `runTournamentInference()` - 20 edges
6. `App()` - 20 edges
7. `norm()` - 20 edges
8. `getDraftTurn()` - 19 edges
9. `_clean()` - 17 edges
10. `lucide-react` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Logika Taktis Kompetitif Utama` --references--> `evaluateEnemyCounterExposure()`  [INFERRED]
  README.md → apps/web/src/engine/tournamentInference.ts
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `runTournamentInference()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/tournamentInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `loadTournamentDataset()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/heroDataLoader.ts

## Import Cycles
- None detected.

## Communities (20 total, 10 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.06
Nodes (90): God Nodes (Abstraksi Paling Kritis):, App(), BottomCommandDock(), DraftSimulator(), DraftSimulatorProps, HeaderSortBar(), Props, HeroCardCompact() (+82 more)

### Community 1 - "json"
Cohesion: 0.09
Nodes (15): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), download_file() (+7 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+26 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.06
Nodes (66): isHeroGlobalReleased(), ActionKind, ALL_LANES, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), DRAFT_SEQUENCE, DraftAction (+58 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.14
Nodes (19): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+11 more)

### Community 8 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 10 - "json"
Cohesion: 0.11
Nodes (36): _alias_maps(), _build_variants(), canonical(), _cards(), _clean(), fetch_page(), _heading_list(), _hero_label_id() (+28 more)

### Community 13 - "json"
Cohesion: 0.06
Nodes (36): ingest_kpl_data(), init_db(), load_global_mapping(), attach_hokstats(), _load_json(), load_source_heroes(), export(), main() (+28 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.06
Nodes (32): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+24 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 181 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `types.ts` to `package.json`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05548312327973345 - nodes in this community are weakly interconnected._
- **Why does `lucide-react` connect `types.ts` to `package.json`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.08636977058029689 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `types.ts` to `draftRules.ts`, `AGENTS.md — Developer & Agent Field Manual`, `heroDataLoader.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07301587301587302 - nodes in this community are weakly interconnected._