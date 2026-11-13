# Graph Report - hok-draft-engine  (2026-11-14)

## Corpus Check
- 295 files · ~1,637,981 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 10, .csv 3, .jsonl 2)

## Summary
- 1557 nodes · 3813 edges · 84 communities (77 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 84 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `288a289f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- HeroWikiDrawer.tsx
- practiceState.ts
- package.json
- test_skill_evidence_audit.py
- build_artifact.py
- compilerOptions
- heroDataLoader.ts
- png-decode.mjs
- DraftFormat
- App.tsx
- json
- validate-dataset.mjs
- gamePlan.ts
- tactical_profiles.py
- HoK Draft Engine
- check-deploy.py
- vite-env.d.ts
- assignHeroLanes
- build-kpl-db.mjs
- ml-engine
- extract_kpl_synergy.py
- draftRules.ts
- verify-dist.mjs
- ref_node_fs
- json
- validate.yml
- deploy.py
- capture.ts
- load-sqlite.mjs
- Hero
- tournamentInference.ts
- collect-kpl-bp-all.mjs
- with
- ndarray
- 字段字典
- remote-deploy.sh
- 数据来源与合规说明
- env
- KPL BP Dataset — 王者荣耀职业赛事 BP 数据集
- checkHeroStats
- deploy
- KPL BP 数据统计速览
- deploy.yml
- steps
- verify
- benchmark.mjs
- env
- on
- 5. Alur Kerja & Perintah Pemeliharaan Rutin
- 3. `data/battles.jsonl`
- main
- calibrate_vision_regions.py
- slimRows
- w
- convert_reference_images.py
- readText
- csvCell
- Live Draft Advisor (membaca layar BP HoK Global)
- vision.test.mjs
- build_vision_contact_sheet.py
- capture_vision_corpus.py
- evaluate-vision-corpus.mjs
- VisionPipeline
- VisionPanel.tsx
- CaptureSource
- vision-runtime.test.mjs
- json
- pipeline.ts
- Vision Corpus — Ground Truth Layar Ban&Pick HoK Global
- h264-fidelity.mjs
- refine_rect
- react
- Contributing to HoK Draft Engine
- HeaderSortBar.tsx
- 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS)
- Option B — Manual Setup
- 2. Standar Lingkungan & Perkakas (Wajib Diikuti)
- observer.ts
- 3. 接口响应结构（节选）
- 5. 快速开始
- PostDraftGamePlanPanel.tsx

## God Nodes (most connected - your core abstractions)
1. `VisionPipeline` - 49 edges
2. `Hero` - 46 edges
3. `VisionPanel()` - 33 edges
4. `App()` - 32 edges
5. `PracticeDraft()` - 31 edges
6. `runTournamentInference()` - 29 edges
7. `getDraftTurn()` - 26 edges
8. `parse_hero_page()` - 25 edges
9. `react` - 25 edges
10. `HeroThumbnail()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Yang ditampilkan panel` --references--> `runTournamentInference()`  [INFERRED]
  README.md → apps/web/src/engine/tournamentInference.ts
- `Harness vision (Live Draft Advisor)` --references--> `HeroMatcher`  [INFERRED]
  README.md → apps/web/src/vision/heroMatcher.ts
- `Repository Layout` --references--> `verify()`  [INFERRED]
  CONTRIBUTING.md → .github/hostinger/check-deploy.py
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `App()`  [INFERRED]
  AGENTS.md → apps/web/src/App.tsx

## Import Cycles
- None detected.

## Communities (84 total, 7 thin omitted)

### Community 0 - "HeroWikiDrawer.tsx"
Cohesion: 0.11
Nodes (19): FACTUAL_SKILL_TAG_GROUPS, HeroWikiDrawerProps, MatchupCardData, MatchupEvidenceLine, MatchupPanel(), MatchupPanelProps, MatchupSourceLabel, TACTICAL_ROLE_TAGS (+11 more)

### Community 1 - "practiceState.ts"
Cohesion: 0.18
Nodes (21): applyDraftAction(), DraftAction, getDraftTurn(), oppositeSide(), rankedCandidates(), SearchDecision, DecisionTag, matchesDecisionTag() (+13 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+26 more)

### Community 3 - "test_skill_evidence_audit.py"
Cohesion: 0.19
Nodes (6): clean_ability_sentences(), compact_state_for_prompt(), evaluate_hero_evidence(), _guide_fields(), _match_ally_sentence(), _match_positive()

### Community 4 - "build_artifact.py"
Cohesion: 0.21
Nodes (16): build_root(), contract(), digest(), extra_inventory(), extra_roots(), file_references(), identity(), inventory() (+8 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.17
Nodes (18): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+10 more)

### Community 7 - "png-decode.mjs"
Cohesion: 0.14
Nodes (18): COLOR_TYPE_CHANNELS, COLOR_TYPE_NAMES, decodePng(), expandToRgba(), FILTER_NAMES, filterNames(), RFC-2083, paethPredictor() (+10 more)

### Community 8 - "DraftFormat"
Cohesion: 0.20
Nodes (9): VisionPanelProps, PracticeConfig, VisionRecommendationInput, DraftFormat, ManualLayoutConfig, ObserverOptions, SideCrossCheck, VisionPipelineOptions (+1 more)

### Community 9 - "App.tsx"
Cohesion: 0.15
Nodes (31): App(), BottomCommandDock(), DraftSimulator(), HeroCardCompact(), HeroCardDetailed(), HeroRosterToolbar(), HeroWikiDrawer(), PlanSelectionModal() (+23 more)

### Community 10 - "json"
Cohesion: 0.10
Nodes (40): _alias_maps(), _build_variants(), canonical(), _cards(), _clean(), fetch_page(), _heading_list(), _hero_label_id() (+32 more)

### Community 11 - "validate-dataset.mjs"
Cohesion: 0.03
Nodes (47): actionRows, ALLOWED_LENS, anomalyLens, argv, battleIds, battleIndex, battles, completeHeroes (+39 more)

### Community 12 - "gamePlan.ts"
Cohesion: 0.05
Nodes (61): ALL_LANES, KplLaneRateMap, buildHeroMap(), classifyCompArchetype(), computeJungleAndGankPlan(), computeRelativeTempoShare(), computeRoamContextAdjustment(), computeTempoComparison() (+53 more)

### Community 13 - "tactical_profiles.py"
Cohesion: 0.14
Nodes (17): build_evidence_response(), approved_profiles(), audit_batch_proposals(), canonical(), create_proposal(), generate_batch_proposals(), global_released_heroes(), has_source_evidence() (+9 more)

### Community 14 - "HoK Draft Engine"
Cohesion: 0.17
Nodes (12): Audit batch hero Global, Clone & Bootstrap Cepat, Game Plan Pasca-Draft, Winning Condition & Simulator Swap, Harness vision (Live Draft Advisor), HoK Draft Engine, Label taktis dan verifikasi bukti, Memperbarui hero dan metadata, Menjalankan aplikasi & setup contributor (+4 more)

### Community 15 - "check-deploy.py"
Cohesion: 0.14
Nodes (7): Dependencies, diagnose_error(), fetch(), format_github_summary(), main(), select_assets(), verify()

### Community 17 - "assignHeroLanes"
Cohesion: 0.29
Nodes (8): assignHeroLanes(), getCandidateLanesWithWeights(), 1. Format Turnamen Kompetitif (18 Aksi / 4 Fase), 2. Format Ranked Match (16 Aksi / 2 Fase), Cara kerja mesin draft, Diagram Arsitektur Alur Keputusan (Decision Pipeline), Format Pertandingan: Turnamen & Ranked, Logika Taktis Kompetitif Utama

### Community 19 - "build-kpl-db.mjs"
Cohesion: 0.05
Nodes (37): actionRows, argv, banSlotsAll, battleCsv, battles, bpLenDist, byId, gamesByLeague (+29 more)

### Community 21 - "extract_kpl_synergy.py"
Cohesion: 0.27
Nodes (5): classify_tempo_profile(), extract_lane_rates(), extract_synergy(), extract_tempo_curves(), normalize_hid()

### Community 22 - "draftRules.ts"
Cohesion: 0.11
Nodes (22): F. Invarian Lapisan Vision (Live Draft Advisor), ActionKind, applyGameHero(), computeSeriesFearlessLocks(), createInitialGameDraft(), DoublePickWindow, findSeriesFearlessConflicts(), getDraftPhases() (+14 more)

### Community 23 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 24 - "ref_node_fs"
Cohesion: 0.08
Nodes (12): OpponentClient, computeVisionRecommendation(), allHeroes, call(), G, globalHeroes, manifest, nonGlobalHeroes (+4 more)

### Community 26 - "json"
Cohesion: 0.26
Nodes (8): attach_hokstats(), _load_json(), load_source_heroes(), build_package(), encode(), _load_json(), main(), write_package()

### Community 27 - "validate.yml"
Cohesion: 0.09
Nodes (22): concurrency, cancel-in-progress, group, jobs, validate, name, on, pull_request (+14 more)

### Community 28 - "deploy.py"
Cohesion: 0.16
Nodes (10): asset_inventory(), Deployment, digest(), main(), parse_rsync_stats(), relative_path(), target_path(), main() (+2 more)

### Community 29 - "capture.ts"
Cohesion: 0.29
Nodes (4): CaptureOptions, DrawContext, FrameSink, CaptureFrame

### Community 30 - "load-sqlite.mjs"
Cohesion: 0.11
Nodes (12): argv, DATA, db, HERE, leagues, OUT, parseLine(), playerRows (+4 more)

### Community 31 - "Hero"
Cohesion: 0.27
Nodes (14): God Nodes (Abstraksi Paling Kritis):, DraftSimulatorProps, Props, axes, Props, Props, TournamentPhaseStrategy, TournamentPredictionResult (+6 more)

### Community 32 - "tournamentInference.ts"
Cohesion: 0.15
Nodes (30): analyzeLaneOccupancy(), computeKplPairAdjustment(), DRAFT_SEQUENCE, DraftContext, evaluateTeamCompositionIntegrity(), FLOWBORN_HERO_IDS, getDoublePickWindow(), getDraftSequence() (+22 more)

### Community 33 - "collect-kpl-bp-all.mjs"
Cohesion: 0.14
Nodes (19): argv, battleJobs(), D_MATCHES, F_BATTLES, F_FAILS, F_LEAGUES, F_STATUS, GAP (+11 more)

### Community 34 - "with"
Cohesion: 0.14
Nodes (14): with, artifact-ids, cache, cache-dependency-glob, cache-dependency-path, enable-cache, if-no-files-found, merge-multiple (+6 more)

### Community 35 - "ndarray"
Cohesion: 0.14
Nodes (11): aspect_fit(), build_references(), _centred_subcrop(), crop_gray(), d_hash(), ncc(), normalize_gray(), resize_gray() (+3 more)

### Community 36 - "字段字典"
Cohesion: 0.18
Nodes (11): 10. `data/stats/team-stats.json`, 11. `data/provenance/source-leagues.json`, 12. 缺失与异常速查, 1. `data/leagues.json`, 2. `data/matches.csv`, 4. `data/battles.csv`, 5. `data/draft-actions.csv`, 6. `data/players.jsonl` (+3 more)

### Community 37 - "remote-deploy.sh"
Cohesion: 0.44
Nodes (10): check_public_permissions(), check_runtime_permissions(), check_writable(), cleanup_trap(), fail(), finish_stage(), safe_asset(), safe_directory() (+2 more)

### Community 38 - "数据来源与合规说明"
Cohesion: 0.20
Nodes (10): 10. 变更与联系, 1. 一句话概括, 2. 抓取对象, 4. robots.txt 核实结果, 5. 采集参数（可复现）, 6. 字段含义与数据限制, 7. 数据权利归属, 8. 允许 / 不建议的用法 (+2 more)

### Community 39 - "env"
Cohesion: 0.22
Nodes (9): env, HOSTINGER_FORCE_VENDOR_SYNC, HOSTINGER_RSYNC_BWLIMIT, HOSTINGER_SSH_HOST, HOSTINGER_SSH_KEY, HOSTINGER_SSH_KNOWN_HOSTS, HOSTINGER_SSH_PORT, HOSTINGER_SSH_USER (+1 more)

### Community 40 - "KPL BP Dataset — 王者荣耀职业赛事 BP 数据集"
Cohesion: 0.25
Nodes (8): 1. 数据范围与体量, 2. 来源与致谢, 3. 目录结构, 6. 统计口径与已知限制, 7. 版本与更新方式, 8. 许可、免责与非商业声明, 9. 引用, KPL BP Dataset — 王者荣耀职业赛事 BP 数据集

### Community 41 - "checkHeroStats"
Cohesion: 0.32
Nodes (8): checkHeroStats(), exists(), isInt(), isNum(), isStr(), missingFiles, noteHero(), uniq()

### Community 42 - "deploy"
Cohesion: 0.25
Nodes (8): cancel-in-progress, group, concurrency, environment, if, needs, runs-on, deploy

### Community 43 - "KPL BP 数据统计速览"
Cohesion: 0.18
Nodes (7): 1. 总览, 2. 按年份, 3. 按赛事（BP 完整率）, 4. 英雄 BP 榜（全量，仅完整对局）, 5. 各年 ban 率前 5, 6. 口径与数据质量说明, KPL BP 数据统计速览

### Community 44 - "deploy.yml"
Cohesion: 0.29
Nodes (6): env, CI, jobs, name, permissions, contents

### Community 45 - "steps"
Cohesion: 0.48
Nodes (7): steps, id, if, name, run, uses, steps

### Community 46 - "verify"
Cohesion: 0.29
Nodes (7): HOSTINGER_TIMING_JOB, verify, artifact_id, build_sha256, env, outputs, runs-on

### Community 47 - "benchmark.mjs"
Cohesion: 0.17
Nodes (8): baseContext(), fixtures, heroes, limit, manifest, options, summary, synergy

### Community 48 - "env"
Cohesion: 0.33
Nodes (6): CLEANUP_OUTCOME, EXPECTED_BUILD_SHA256, HOSTINGER_HTTP_VERIFIED, TRANSFER_OUTCOME, VERIFY_OUTCOME, env

### Community 49 - "on"
Cohesion: 0.33
Nodes (6): on, pull_request, push, workflow_dispatch, branches, branches

### Community 50 - "5. Alur Kerja & Perintah Pemeliharaan Rutin"
Cohesion: 0.18
Nodes (11): 5. Alur Kerja & Perintah Pemeliharaan Rutin, A. Membangun & Memperbarui Frontend Statis:, B. Publikasi Paket Dataset ke Frontend Statis:, C. Menjalankan Uji Simulasi Draft AI:, D. Menjalankan Live Draft Advisor:, E. Mengukur Akurasi Lapisan Vision (Kalibrasi & Corpus):, source(), 8.1 `coverage` (+3 more)

### Community 51 - "3. `data/battles.jsonl`"
Cohesion: 0.40
Nodes (5): 3.1 顶层, 3.2 `blue` / `red` 子对象, 3.3 `stats.blue` / `stats.red`, 3.4 `draft[]` 元素, 3. `data/battles.jsonl`

### Community 52 - "main"
Cohesion: 0.16
Nodes (9): badge_lock_frames(), Corpus, crop_std(), detect_ban_circles(), first_filled_frame(), main(), tile_averages(), region_warm_cool() (+1 more)

### Community 53 - "calibrate_vision_regions.py"
Cohesion: 0.13
Nodes (6): badge_strict_counts(), _ensure_numpy(), expected_order_note(), hamming(), png_resave_filter0(), refilter_references()

### Community 54 - "slimRows"
Cohesion: 0.40
Nodes (5): draftOf(), playerRows, sideName(), sidesOf(), slimRows

### Community 55 - "w"
Cohesion: 0.40
Nodes (5): fillReadmeCoverage(), log(), w(), wj(), wjl()

### Community 56 - "convert_reference_images.py"
Cohesion: 0.19
Nodes (7): load_manifest(), parse_args(), collect_sources(), convert(), default_out_dir(), main(), parse_args()

### Community 57 - "readText"
Cohesion: 0.50
Nodes (4): parseCsvLine(), readCsv(), readJsonl(), readText()

### Community 59 - "Live Draft Advisor (membaca layar BP HoK Global)"
Cohesion: 0.40
Nodes (5): Belum terbukti (batasan), Cara menjalankan, Hasil terukur, Live Draft Advisor (membaca layar BP HoK Global), Yang ditampilkan panel

### Community 60 - "vision.test.mjs"
Cohesion: 0.08
Nodes (56): allocate(), aspectFit(), clamp(), cropGray(), dHash(), hammingDistance(), ncc(), normalizeGray() (+48 more)

### Community 61 - "build_vision_contact_sheet.py"
Cohesion: 0.11
Nodes (11): collect_frames(), load_manifest(), main(), parse_args(), pick_cell_height(), probe_thumbnails(), render_caption(), render_sheet() (+3 more)

### Community 64 - "capture_vision_corpus.py"
Cohesion: 0.06
Nodes (33): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), adb_binary() (+25 more)

### Community 65 - "evaluate-vision-corpus.mjs"
Cohesion: 0.16
Nodes (23): computeAbstention(), computeBanIdentity(), computeChangePoints(), computeDuplicates(), computeStability(), evaluateFrames(), fail(), fmtCandidates() (+15 more)

### Community 66 - "VisionPipeline"
Cohesion: 0.11
Nodes (5): scaleRect(), shouldRunColourCheck(), sortSlotsChronologically(), VisionPipeline, resolveSlotSides()

### Community 67 - "VisionPanel.tsx"
Cohesion: 0.11
Nodes (30): AugmentedSlotObservation, drawSlotOverlay(), estimateOverlayMetrics(), findHero(), formatConfidence(), formatLayoutSourceMessage(), formatSideCheckWarning(), getSlotOverlayLabel() (+22 more)

### Community 69 - "vision-runtime.test.mjs"
Cohesion: 0.11
Nodes (19): BadgeCounts, badgeStrictCounts(), detectSlotLockBadge(), LOCK_BADGE_MIN_RATIO, LOCK_BADGE_PROBE, unidentifiedBansMessage(), BLANK_SLOT_STD_THRESHOLD, COLOUR_CHECK_INTERVAL_MS (+11 more)

### Community 70 - "json"
Cohesion: 0.18
Nodes (6): ingest_kpl_data(), init_db(), load_global_mapping(), main(), compute_opener_score(), simulate_step()

### Community 71 - "pipeline.ts"
Cohesion: 0.11
Nodes (28): cropRgba(), buildSlotObservations(), cropStd(), isBlankSlot(), LayoutSource, LayoutStatus, LOCKED_PICK_RECOVERY_DX, LOCKED_PICK_RECOVERY_MIN_MARGIN (+20 more)

### Community 72 - "Vision Corpus — Ground Truth Layar Ban&Pick HoK Global"
Cohesion: 0.22
Nodes (9): bash (Linux / macOS / Git Bash), Catatan Commit & Lisensi, Kontrak Pengumpulan (WAJIB diikuti agar korpus bisa dipakai), Konvensi Nama & Manifest, Memindahkan Frame ke Golden Fixture (opsional, nanti), Perintah Capture, Tujuan, Vision Corpus — Ground Truth Layar Ban&Pick HoK Global (+1 more)

### Community 73 - "h264-fidelity.mjs"
Cohesion: 0.31
Nodes (11): decodedPngSize(), defaultVariants(), fail(), main(), meanAbsDiff(), ncc(), parseArgs(), parseVariantSpec() (+3 more)

### Community 77 - "refine_rect"
Cohesion: 0.28
Nodes (6): Matcher, RefEntry, refine_rect(), objective(), pos_pass(), size_pass()

### Community 78 - "react"
Cohesion: 0.18
Nodes (17): HeroCardProps, lanes, Props, Props, DropdownOption, Props, HeroRoleIcons(), LaneIcon() (+9 more)

### Community 79 - "Contributing to HoK Draft Engine"
Cohesion: 0.22
Nodes (6): Contributing to HoK Draft Engine, Critical Domain Rules & Data Workflow, Licensing, Prerequisites, Repository Layout, Running Checks Before Opening a PR

### Community 80 - "HeaderSortBar.tsx"
Cohesion: 0.52
Nodes (4): HeaderSortBar(), Props, APP_NAVIGATION, ActiveTab

### Community 81 - "4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS)"
Cohesion: 0.17
Nodes (11): 1. Misi & Arsitektur Utama, 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 6. Struktur Direktori Proyek, A. Semantik Relasi Counter (JANGAN PERNAH DIBALIK!), AGENTS.md — Developer & Agent Field Manual, Aturan Agen saat Menjelajahi Codebase:, B. Competitive Tournament Tiers vs Casual Pub Tiers (+3 more)

### Community 83 - "Option B — Manual Setup"
Cohesion: 0.33
Nodes (6): 1. Clone With Submodule (or Initialize After Clone), 2. Frontend Setup (`apps/web`), 3. Data Pipeline & KPL Ingestion (`packages/ml-engine`), Option A — Automated Setup (Recommended), Option B — Manual Setup, Quick Setup

### Community 84 - "2. Standar Lingkungan & Perkakas (Wajib Diikuti)"
Cohesion: 0.50
Nodes (4): 2. Standar Lingkungan & Perkakas (Wajib Diikuti), A. Python & Manajemen Package (`uv`), B. Shell & PowerShell Safety (Windows), C. Local Dev Stack (bebas tooling — jangan asumsikan tool tertentu)

### Community 85 - "observer.ts"
Cohesion: 0.10
Nodes (24): D. Live Draft Advisor (Lapisan Vision), DraftPosition, emptyPosition(), TournamentPhaseId, collectSlotQueues(), DraftObserver, ObserverResult, sameIds() (+16 more)

### Community 86 - "3. 接口响应结构（节选）"
Cohesion: 0.40
Nodes (5): 3.1 赛事列表 `leagues/open`, 3.2 赛程 `matches/open?league_id=`, 3.3 单局详情 `battle/open?battle_id=`, 3.4 原始字段 → 数据集字段映射, 3. 接口响应结构（节选）

### Community 87 - "5. 快速开始"
Cohesion: 0.40
Nodes (5): 5.1 用 jq 查某英雄的 ban 率, 5.2 用 pandas 读 `battles.csv` 统计蓝方胜率, 5.3 载入 SQLite 后用 SQL 查某赛事的 BP, 5.4 按年份比较英雄 BP 率, 5. 快速开始

### Community 93 - "PostDraftGamePlanPanel.tsx"
Cohesion: 0.27
Nodes (9): FEASIBILITY_LABEL, PlanTab, Props, VERDICT_LABEL, VisionDetectedBoardProps, Side, GamePlanInput, LaneAssignmentMap (+1 more)

## Knowledge Gaps
- **3 isolated node(s):** `ml-engine`, `RFC-2083`, `RFC-2083`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 623 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `E. Mengukur Akurasi Lapisan Vision (Kalibrasi & Corpus):` connect `5. Alur Kerja & Perintah Pemeliharaan Rutin` to `vision.test.mjs`, `refine_rect`?**
  _High betweenness centrality (0.362) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `VisionPanel()` (e.g. with `.clickSlot()` and `.getLastFrame()`) actually correct?**
  _`VisionPanel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ml-engine`, `RFC-2083`, `RFC-2083` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `HeroWikiDrawer.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11462450592885376 - nodes in this community are weakly interconnected._
- **Why does `refine_rect()` connect `refine_rect` to `5. Alur Kerja & Perintah Pemeliharaan Rutin`, `main`, `calibrate_vision_regions.py`?**
  _High betweenness centrality (0.350) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07301587301587302 - nodes in this community are weakly interconnected._
- **Why does `cropGray()` connect `vision.test.mjs` to `5. Alur Kerja & Perintah Pemeliharaan Rutin`, `VisionPipeline`, `pipeline.ts`?**
  _High betweenness centrality (0.176) - this node is a cross-community bridge._