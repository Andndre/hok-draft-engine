# Graph Report - hok-draft-engine  (2026-11-09)

## Corpus Check
- 48 files · ~442,161 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .wasm 4, (none) 2, .example 2)

## Summary
- 287 nodes · 516 edges · 16 communities (10 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5610957a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- json
- package.json
- App.tsx
- 4_export_and_publish_r2.py
- compilerOptions
- heroDataLoader.ts
- Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*
- JevTeacherScorer
- HeroWikiDrawer.tsx
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `Hero` - 23 edges
2. `App()` - 18 edges
3. `compilerOptions` - 17 edges
4. `react` - 12 edges
5. `build_master_database()` - 11 edges
6. `isHeroGlobalReleased()` - 10 edges
7. `lucide-react` - 8 edges
8. `Lane` - 8 edges
9. `TacticalVector` - 8 edges
10. `TournamentPhaseStrategy` - 7 edges

## Surprising Connections (you probably didn't know these)
- `God Nodes (Abstraksi Paling Kritis):` --references--> `App()`  [INFERRED]
  AGENTS.md → apps/web/src/App.tsx
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `TacticalVector`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `HeroWikiDrawerProps` --references--> `Hero`  [EXTRACTED]
  apps/web/src/components/HeroWikiDrawer.tsx → apps/web/src/types.ts

## Import Cycles
- None detected.

## Communities (16 total, 6 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.09
Nodes (26): lucide-react@^1.70.0, BottomCommandDock(), BottomCommandDockProps, LANES_CONFIG, HeaderSortBar(), HeaderSortBarProps, ActiveTab, ArcanaItem (+18 more)

### Community 1 - "json"
Cohesion: 0.08
Nodes (17): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), ingest_kpl_data() (+9 more)

### Community 2 - "package.json"
Cohesion: 0.08
Nodes (31): dependencies, clsx@^2.1.1, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5, @tailwindcss/vite@^4.3.5 (+23 more)

### Community 3 - "App.tsx"
Cohesion: 0.09
Nodes (45): God Nodes (Abstraksi Paling Kritis):, App(), DraftSimulator(), DraftSimulatorProps, HeroCardCompact(), HeroCardCompactProps, HeroCardDetailed(), HeroCardDetailedProps (+37 more)

### Community 4 - "4_export_and_publish_r2.py"
Cohesion: 0.08
Nodes (6): DraftDataset, JevStudentNet, train_student_model(), compute_sha256(), export_onnx(), generate_manifest_and_metadata()

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.48
Nodes (6): fetchWithFallback(), getFromIDB(), loadHeroMetadata(), openIndexedDB(), R2_BASE_URL, saveToIDB()

### Community 8 - "Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*"
Cohesion: 0.12
Nodes (16): 1. Formula Prioritas Pembuka Fase 1 (`computeOpenerPriorityScore`), 1. Sorotan Arsitektur, 2. Anatomi Mekanisme: Apa Sebenarnya JEV di Sini?, 2. Logika Pre-Ban Protektif (Fase Ban 1, Step 0–3), 3. Logika Sinergi Duet Empiris (Fase Pick 1 & 2), 3. Struktur Monorepo, 4. Dual Counter Matchup & Smart Conflict Resolution, 4. Panduan Eksekusi Cepat (+8 more)

### Community 11 - "HeroWikiDrawer.tsx"
Cohesion: 0.38
Nodes (5): HeroWikiDrawer(), HeroWikiDrawerProps, getItemMeta(), ItemMeta, ITEMS_MAP

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.11
Nodes (18): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+10 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 118 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.tsx` to `types.ts`, `package.json`, `HeroWikiDrawer.tsx`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09113300492610837 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `App.tsx` to `AGENTS.md — Developer & Agent Field Manual`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.08244897959183674 - nodes in this community are weakly interconnected._
- **Why does `3. Navigasi Knowledge Graph (`graphify`)` connect `AGENTS.md — Developer & Agent Field Manual` to `App.tsx`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._