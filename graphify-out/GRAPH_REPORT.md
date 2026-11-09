# Graph Report - hok-draft-engine  (2026-11-09)

## Corpus Check
- 63 files · ~493,782 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .css 1)

## Summary
- 375 nodes · 761 edges · 16 communities (10 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1deeb4b4`
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
- Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*
- JevTeacherScorer
- tactical_profiles.py
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `Hero` - 24 edges
2. `App()` - 18 edges
3. `compilerOptions` - 17 edges
4. `react` - 12 edges
5. `rankedCandidates()` - 11 edges
6. `runTournamentInference()` - 11 edges
7. `build_master_database()` - 11 edges
8. `isHeroGlobalReleased()` - 11 edges
9. `getDraftTurn()` - 11 edges
10. `evaluatePosition()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `God Nodes (Abstraksi Paling Kritis):` --references--> `TacticalVector`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `App()`  [INFERRED]
  AGENTS.md → apps/web/src/App.tsx
- `God Nodes (Abstraksi Paling Kritis):` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `export_onnx()` --calls--> `JevStudentNet`  [INFERRED]
  packages/ml-engine/4_export_and_publish_r2.py → packages/ml-engine/3_train_student_net.py

## Import Cycles
- None detected.

## Communities (16 total, 6 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.06
Nodes (58): God Nodes (Abstraksi Paling Kritis):, App(), BottomCommandDock(), BottomCommandDockProps, LANES_CONFIG, DraftSimulator(), DraftSimulatorProps, HeaderSortBar() (+50 more)

### Community 1 - "json"
Cohesion: 0.15
Nodes (9): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), download_file() (+1 more)

### Community 2 - "package.json"
Cohesion: 0.08
Nodes (33): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+25 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.11
Nodes (39): ActionKind, ALL_LANES, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), DRAFT_SEQUENCE, DraftAction, DraftContext (+31 more)

### Community 4 - "4_export_and_publish_r2.py"
Cohesion: 0.08
Nodes (6): DraftDataset, JevStudentNet, train_student_model(), compute_sha256(), export_onnx(), generate_manifest_and_metadata()

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.09
Nodes (19): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+11 more)

### Community 8 - "Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*"
Cohesion: 0.12
Nodes (16): 1. Formula Prioritas Pembuka Fase 1 (`computeOpenerPriorityScore`), 1. Sorotan Arsitektur, 2. Anatomi Mekanisme: Apa Sebenarnya JEV di Sini?, 2. Logika Pre-Ban Protektif (Fase Ban 1, Step 0–3), 3. Logika Sinergi Duet Empiris (Fase Pick 1 & 2), 3. Struktur Monorepo, 4. Dual Counter Matchup & Smart Conflict Resolution, 4. Panduan Eksekusi Cepat (+8 more)

### Community 10 - "tactical_profiles.py"
Cohesion: 0.08
Nodes (23): ingest_kpl_data(), init_db(), load_global_mapping(), main(), extract_synergy(), normalize_hid(), build_package(), encode() (+15 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.11
Nodes (18): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+10 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 143 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `types.ts` to `package.json`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06430745814307458 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `types.ts` to `AGENTS.md — Developer & Agent Field Manual`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.14666666666666667 - nodes in this community are weakly interconnected._
- **Why does `3. Navigasi Knowledge Graph (`graphify`)` connect `AGENTS.md — Developer & Agent Field Manual` to `types.ts`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.0773109243697479 - nodes in this community are weakly interconnected._