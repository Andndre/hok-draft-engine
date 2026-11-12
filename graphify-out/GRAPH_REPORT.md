# Graph Report - hok-draft-engine  (2026-11-12)

## Corpus Check
- 262 files · ~1,562,407 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 10, .csv 3, .jsonl 2)

## Summary
- 1060 nodes · 2454 edges · 63 communities (55 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `aafddc84`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- HeroWikiDrawer.tsx
- 0_sync_global_assets.py
- package.json
- practiceState.ts
- build_artifact.py
- compilerOptions
- heroDataLoader.ts
- types.ts
- 1_ingest_kpl.py
- ui.test.mjs
- json
- validate-dataset.mjs
- gamePlan.ts
- test_data_pipeline.py
- AGENTS.md — Developer & Agent Field Manual
- check-deploy.py
- vite-env.d.ts
- PracticeDraft.tsx
- build-kpl-db.mjs
- ml-engine
- App.tsx
- draftRules.ts
- verify-dist.mjs
- react
- json
- validate.yml
- 0_sync_global_assets.py
- draft.test.mjs
- load-sqlite.mjs
- PostDraftGamePlanPanel.tsx
- draftSearch.ts
- collect-kpl-bp-all.mjs
- with
- extract_kpl_synergy.py
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
- 8. `data/stats/summary.json`
- 3. `data/battles.jsonl`
- 3. 接口响应结构（节选）
- 5. 快速开始
- slimRows
- w
- readText
- csvCell
- rankedCandidates
- assignHeroLanes
- BrowserWorkerAdapter

## God Nodes (most connected - your core abstractions)
1. `Hero` - 31 edges
2. `PracticeDraft()` - 31 edges
3. `App()` - 29 edges
4. `parse_hero_page()` - 25 edges
5. `runTournamentInference()` - 25 edges
6. `getDraftTurn()` - 22 edges
7. `react` - 22 edges
8. `norm()` - 20 edges
9. `rankedCandidates()` - 18 edges
10. `lucide-react` - 18 edges

## Surprising Connections (you probably didn't know these)
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `Hero`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `TacticalVector`  [INFERRED]
  AGENTS.md → apps/web/src/types.ts
- `Repository Layout` --references--> `verify()`  [INFERRED]
  CONTRIBUTING.md → .github/hostinger/check-deploy.py
- `Logika Taktis Kompetitif Utama` --references--> `evaluateEnemyCounterExposure()`  [INFERRED]
  README.md → apps/web/src/engine/tournamentInference.ts

## Import Cycles
- None detected.

## Communities (63 total, 8 thin omitted)

### Community 0 - "HeroWikiDrawer.tsx"
Cohesion: 0.11
Nodes (22): FACTUAL_SKILL_TAG_GROUPS, HeroWikiDrawer(), HeroWikiDrawerProps, MatchupCardData, MatchupEvidenceLine, MatchupPanel(), MatchupSourceLabel, TACTICAL_ROLE_TAGS (+14 more)

### Community 1 - "0_sync_global_assets.py"
Cohesion: 0.15
Nodes (9): build_evidence_response(), clean_ability_sentences(), compact_state_for_prompt(), evaluate_hero_evidence(), _guide_fields(), _match_ally_sentence(), _match_positive(), main() (+1 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (35): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+27 more)

### Community 3 - "practiceState.ts"
Cohesion: 0.19
Nodes (17): analyzeLaneOccupancy(), DraftAction, DraftContext, DraftPosition, Side, counterBonus(), evaluatePosition(), pairBonus() (+9 more)

### Community 4 - "build_artifact.py"
Cohesion: 0.22
Nodes (16): build_root(), contract(), digest(), extra_inventory(), extra_roots(), file_references(), identity(), inventory() (+8 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.17
Nodes (18): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+10 more)

### Community 7 - "types.ts"
Cohesion: 0.09
Nodes (26): BottomCommandDock(), HeaderSortBar(), Props, APP_NAVIGATION, ActiveTab, ArcanaItem, CounteredByInfo, CounterInfo (+18 more)

### Community 8 - "1_ingest_kpl.py"
Cohesion: 0.27
Nodes (3): ingest_kpl_data(), init_db(), load_global_mapping()

### Community 9 - "ui.test.mjs"
Cohesion: 0.22
Nodes (15): App(), HeroCardCompact(), HeroCardDetailed(), PostDraftGamePlanPanel(), PracticeDraft(), TacticalRadarPanel(), HeroThumbnail(), plainText() (+7 more)

### Community 10 - "json"
Cohesion: 0.10
Nodes (40): _alias_maps(), _build_variants(), canonical(), _cards(), _clean(), fetch_page(), _heading_list(), _hero_label_id() (+32 more)

### Community 11 - "validate-dataset.mjs"
Cohesion: 0.03
Nodes (47): actionRows, ALLOWED_LENS, anomalyLens, argv, battleIds, battleIndex, battles, completeHeroes (+39 more)

### Community 12 - "gamePlan.ts"
Cohesion: 0.07
Nodes (41): ALL_LANES, KplLaneRateMap, buildHeroMap(), classifyCompArchetype(), computeJungleAndGankPlan(), computeRelativeTempoShare(), computeRoamContextAdjustment(), computeTempoComparison() (+33 more)

### Community 13 - "test_data_pipeline.py"
Cohesion: 0.17
Nodes (14): approved_profiles(), audit_batch_proposals(), canonical(), create_proposal(), generate_batch_proposals(), global_released_heroes(), has_source_evidence(), has_text() (+6 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.05
Nodes (41): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+33 more)

### Community 15 - "check-deploy.py"
Cohesion: 0.13
Nodes (8): Repository Layout, Dependencies, diagnose_error(), fetch(), format_github_summary(), main(), select_assets(), verify()

### Community 17 - "PracticeDraft.tsx"
Cohesion: 0.21
Nodes (16): DraftSimulator(), DraftSimulatorProps, HeroRosterToolbar(), lanes, Props, axes, Props, DropdownOption (+8 more)

### Community 19 - "build-kpl-db.mjs"
Cohesion: 0.05
Nodes (37): actionRows, argv, banSlotsAll, battleCsv, battles, bpLenDist, byId, gamesByLeague (+29 more)

### Community 21 - "App.tsx"
Cohesion: 0.25
Nodes (12): MatchupPanelProps, Props, axes, Props, computeTacticalDeltas(), TeamCompositionIntegrity, TournamentPhaseStrategy, TournamentPredictionResult (+4 more)

### Community 22 - "draftRules.ts"
Cohesion: 0.13
Nodes (16): ActionKind, applyGameHero(), createInitialGameDraft(), DoublePickWindow, DRAFT_SEQUENCE, FLOWBORN_HERO_IDS, RANKED_DRAFT_SEQUENCE, RANKED_PHASES (+8 more)

### Community 23 - "verify-dist.mjs"
Cohesion: 0.14
Nodes (5): files, manifest, root, scripts, walk()

### Community 24 - "react"
Cohesion: 0.28
Nodes (11): HeroCardProps, PlanSelectionModal(), Props, HeroRoleIcons(), LaneIcon(), LaneLabel(), dialogs, useDialogFocus() (+3 more)

### Community 26 - "json"
Cohesion: 0.13
Nodes (13): attach_hokstats(), _load_json(), load_source_heroes(), export(), main(), main(), build_package(), encode() (+5 more)

### Community 27 - "validate.yml"
Cohesion: 0.09
Nodes (22): concurrency, cancel-in-progress, group, jobs, validate, name, on, pull_request (+14 more)

### Community 28 - "0_sync_global_assets.py"
Cohesion: 0.07
Nodes (28): asset_inventory(), Deployment, digest(), main(), parse_rsync_stats(), relative_path(), target_path(), main() (+20 more)

### Community 29 - "draft.test.mjs"
Cohesion: 0.14
Nodes (10): computeSeriesFearlessLocks(), findSeriesFearlessConflicts(), isFlowborn(), isLegalHero(), teamOnSide(), heroes, manifest, synergy (+2 more)

### Community 30 - "load-sqlite.mjs"
Cohesion: 0.11
Nodes (12): argv, DATA, db, HERE, leagues, OUT, parseLine(), playerRows (+4 more)

### Community 31 - "PostDraftGamePlanPanel.tsx"
Cohesion: 0.33
Nodes (6): FEASIBILITY_LABEL, PlanTab, Props, VERDICT_LABEL, GamePlanInput, LaneAssignmentMap

### Community 32 - "draftSearch.ts"
Cohesion: 0.27
Nodes (17): God Nodes (Abstraksi Paling Kritis):, isHeroGlobalReleased(), computeKplPairAdjustment(), evaluateTeamCompositionIntegrity(), getDoublePickWindow(), getDraftSequence(), getPairEvidence(), getTournamentPhase() (+9 more)

### Community 33 - "collect-kpl-bp-all.mjs"
Cohesion: 0.14
Nodes (19): argv, battleJobs(), D_MATCHES, F_BATTLES, F_FAILS, F_LEAGUES, F_STATUS, GAP (+11 more)

### Community 34 - "with"
Cohesion: 0.14
Nodes (14): with, artifact-ids, cache, cache-dependency-glob, cache-dependency-path, enable-cache, if-no-files-found, merge-multiple (+6 more)

### Community 35 - "extract_kpl_synergy.py"
Cohesion: 0.24
Nodes (5): classify_tempo_profile(), extract_lane_rates(), extract_synergy(), extract_tempo_curves(), normalize_hid()

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
Cohesion: 0.29
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
Cohesion: 0.15
Nodes (9): IMMOBILE_OPENERS, baseContext(), fixtures, heroes, limit, manifest, options, summary (+1 more)

### Community 48 - "env"
Cohesion: 0.33
Nodes (6): CLEANUP_OUTCOME, EXPECTED_BUILD_SHA256, HOSTINGER_HTTP_VERIFIED, TRANSFER_OUTCOME, VERIFY_OUTCOME, env

### Community 49 - "on"
Cohesion: 0.33
Nodes (6): on, pull_request, push, workflow_dispatch, branches, branches

### Community 50 - "8. `data/stats/summary.json`"
Cohesion: 0.40
Nodes (5): source(), 8.1 `coverage`, 8.2 `side_stats_*` 子对象, 8. `data/stats/summary.json`, 4. 字段速查

### Community 51 - "3. `data/battles.jsonl`"
Cohesion: 0.40
Nodes (5): 3.1 顶层, 3.2 `blue` / `red` 子对象, 3.3 `stats.blue` / `stats.red`, 3.4 `draft[]` 元素, 3. `data/battles.jsonl`

### Community 52 - "3. 接口响应结构（节选）"
Cohesion: 0.40
Nodes (5): 3.1 赛事列表 `leagues/open`, 3.2 赛程 `matches/open?league_id=`, 3.3 单局详情 `battle/open?battle_id=`, 3.4 原始字段 → 数据集字段映射, 3. 接口响应结构（节选）

### Community 53 - "5. 快速开始"
Cohesion: 0.40
Nodes (5): 5.1 用 jq 查某英雄的 ban 率, 5.2 用 pandas 读 `battles.csv` 统计蓝方胜率, 5.3 载入 SQLite 后用 SQL 查某赛事的 BP, 5.4 按年份比较英雄 BP 率, 5. 快速开始

### Community 54 - "slimRows"
Cohesion: 0.40
Nodes (5): draftOf(), playerRows, sideName(), sidesOf(), slimRows

### Community 55 - "w"
Cohesion: 0.40
Nodes (5): fillReadmeCoverage(), log(), w(), wj(), wjl()

### Community 57 - "readText"
Cohesion: 0.50
Nodes (4): parseCsvLine(), readCsv(), readJsonl(), readText()

### Community 59 - "rankedCandidates"
Cohesion: 0.24
Nodes (18): applyDraftAction(), emptyPosition(), getDraftTurn(), oppositeSide(), rankedCandidates(), DecisionTag, applyPracticeAction(), createGame() (+10 more)

### Community 60 - "assignHeroLanes"
Cohesion: 0.29
Nodes (8): assignHeroLanes(), getCandidateLanesWithWeights(), 1. Format Turnamen Kompetitif (18 Aksi / 4 Fase), 2. Format Ranked Match (16 Aksi / 2 Fase), Cara kerja mesin draft, Diagram Arsitektur Alur Keputusan (Decision Pipeline), Format Pertandingan: Turnamen & Ranked, Logika Taktis Kompetitif Utama

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 465 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Contributing to HoK Draft Engine` connect `AGENTS.md — Developer & Agent Field Manual` to `check-deploy.py`?**
  _High betweenness centrality (0.326) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `App()` (e.g. with `God Nodes (Abstraksi Paling Kritis):` and `isFlowborn()`) actually correct?**
  _`App()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `HeroWikiDrawer.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11384615384615385 - nodes in this community are weakly interconnected._
- **Why does `HoK Draft Engine` connect `AGENTS.md — Developer & Agent Field Manual` to `assignHeroLanes`?**
  _High betweenness centrality (0.323) - this node is a cross-community bridge._
- **Should `0_sync_global_assets.py` be split into smaller, more focused modules?**
  _Cohesion score 0.14761904761904762 - nodes in this community are weakly interconnected._
- **Why does `Cara kerja mesin draft` connect `assignHeroLanes` to `AGENTS.md — Developer & Agent Field Manual`?**
  _High betweenness centrality (0.318) - this node is a cross-community bridge._