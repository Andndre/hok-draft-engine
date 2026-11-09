# Graph Report - hok-draft-engine  (2026-11-09)

## Corpus Check
- 48 files · ~442,381 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .wasm 4, (none) 2, .example 2)

## Summary
- 286 nodes · 499 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9e7b8758`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- json
- package.json
- App.tsx
- 4_export_and_publish_r2.py
- compilerOptions
- manifest.json
- r2ModelLoader.ts
- Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*
- JevTeacherScorer
- 0_sync_global_assets.py
- HeroWikiDrawer.tsx
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- ml-engine

## God Nodes (most connected - your core abstractions)
1. `Hero` - 21 edges
2. `compilerOptions` - 17 edges
3. `App()` - 15 edges
4. `react` - 12 edges
5. `build_master_database()` - 11 edges
6. `TacticalVector` - 8 edges
7. `isHeroGlobalReleased()` - 8 edges
8. `runJevInference()` - 8 edges
9. `lucide-react` - 8 edges
10. `Lane` - 7 edges

## Surprising Connections (you probably didn't know these)
- `1. Formula Prioritas Pembuka Fase 1 (`computeOpenerPriorityScore`)` --references--> `computeOpenerPriorityScore()`  [INFERRED]
  README.md → apps/web/src/engine/jevInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `TacticalVector`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `runJevInference()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/jevInference.ts

## Import Cycles
- None detected.

## Communities (17 total, 5 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.12
Nodes (18): HeaderSortBarProps, ArcanaItem, CounteredByInfo, CounterInfo, CounterItemInfo, DraftSlot, GameDraftData, HeroAbility (+10 more)

### Community 1 - "json"
Cohesion: 0.07
Nodes (13): ingest_kpl_data(), init_db(), load_global_mapping(), sigmoid(), compute_sha256(), generate_manifest_and_metadata(), main(), extract_synergy() (+5 more)

### Community 2 - "package.json"
Cohesion: 0.08
Nodes (35): dependencies, clsx@^2.1.1, lucide-react@^1.16.0, onnxruntime-web@^1.21.0, react@^19.0.0, react-dom@^19.0.0, tailwind-merge@^3.0.2, devDependencies (+27 more)

### Community 3 - "App.tsx"
Cohesion: 0.10
Nodes (38): God Nodes (Abstraksi Paling Kritis):, App(), DRAFT_SEQUENCE, BottomCommandDock(), BottomCommandDockProps, LANES_CONFIG, DraftSimulator(), DraftSimulatorProps (+30 more)

### Community 4 - "4_export_and_publish_r2.py"
Cohesion: 0.13
Nodes (4): DraftDataset, JevStudentNet, train_student_model(), export_onnx()

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "manifest.json"
Cohesion: 0.18
Nodes (10): hero_count, inputs, model_file, model_name, model_size_bytes, model_version, outputs, sha256 (+2 more)

### Community 7 - "r2ModelLoader.ts"
Cohesion: 0.33
Nodes (9): getInferenceSession(), fetchManifest(), fetchWithFallback(), getFromIDB(), loadOnnxModelBuffer(), openIndexedDB(), R2_BASE_URL, saveToIDB() (+1 more)

### Community 8 - "Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*"
Cohesion: 0.12
Nodes (16): 1. Formula Prioritas Pembuka Fase 1 (`computeOpenerPriorityScore`), 1. Sorotan Arsitektur, 2. Anatomi Mekanisme: Apa Sebenarnya JEV di Sini?, 2. Logika Pre-Ban Protektif (Fase Ban 1, Step 0–3), 3. Logika Sinergi Duet Empiris (Fase Pick 1 & 2), 3. Struktur Monorepo, 4. Dual Counter Matchup & Smart Conflict Resolution, 4. Panduan Eksekusi Cepat (+8 more)

### Community 10 - "0_sync_global_assets.py"
Cohesion: 0.23
Nodes (7): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster()

### Community 11 - "HeroWikiDrawer.tsx"
Cohesion: 0.38
Nodes (5): HeroWikiDrawer(), HeroWikiDrawerProps, getItemMeta(), ItemMeta, ITEMS_MAP

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.11
Nodes (18): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+10 more)

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 121 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `God Nodes (Abstraksi Paling Kritis):` connect `App.tsx` to `AGENTS.md — Developer & Agent Field Manual`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12105263157894737 - nodes in this community are weakly interconnected._
- **Why does `3. Navigasi Knowledge Graph (`graphify`)` connect `AGENTS.md — Developer & Agent Field Manual` to `App.tsx`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.07493061979648474 - nodes in this community are weakly interconnected._
- **Why does `computeOpenerPriorityScore()` connect `App.tsx` to `Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07507507507507508 - nodes in this community are weakly interconnected._