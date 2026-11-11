# Graph Report - hok-draft-engine  (2026-11-11)

## Corpus Check
- 247 files · ~1,090,622 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: (none) 10, .csv 3, .jsonl 2)

## Summary
- 1041 nodes · 2379 edges · 56 communities (49 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2184c12b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- PracticeDraft.tsx
- 0_sync_global_assets.py
- package.json
- draftRules.ts
- 0_sync_global_assets.py
- compilerOptions
- heroDataLoader.ts
- publish_data.py
- evaluateLaneMatchup
- main
- json
- validate-dataset.mjs
- types.ts
- test_data_pipeline.py
- AGENTS.md — Developer & Agent Field Manual
- vite-env.d.ts
- gamePlan.ts
- build-kpl-db.mjs
- ml-engine
- gamePlan.test.mjs
- build_artifact.py
- verify-dist.mjs
- generatePostDraftGamePlan
- json
- validate.yml
- setup.py
- load-sqlite.mjs
- check-deploy.py
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

## God Nodes (most connected - your core abstractions)
1. `PracticeDraft()` - 31 edges
2. `Hero` - 31 edges
3. `App()` - 25 edges
4. `parse_hero_page()` - 25 edges
5. `runTournamentInference()` - 23 edges
6. `react` - 22 edges
7. `getDraftTurn()` - 21 edges
8. `norm()` - 20 edges
9. `rankedCandidates()` - 18 edges
10. `lucide-react` - 18 edges

## Surprising Connections (you probably didn't know these)
- `C. Hero Rilis Global vs Eksklusif CN` --references--> `isHeroGlobalReleased()`  [INFERRED]
  AGENTS.md → apps/web/src/data/heroReleaseStatus.ts
- `Repository Layout` --references--> `verify()`  [INFERRED]
  CONTRIBUTING.md → .github/hostinger/check-deploy.py
- `Cara kerja mesin draft` --references--> `assignHeroLanes()`  [INFERRED]
  README.md → apps/web/src/engine/draftRules.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `runTournamentInference()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/tournamentInference.ts
- `God Nodes (Abstraksi Paling Kritis):` --references--> `loadTournamentDataset()`  [INFERRED]
  AGENTS.md → apps/web/src/engine/heroDataLoader.ts

## Import Cycles
- None detected.

## Communities (56 total, 7 thin omitted)

### Community 0 - "PracticeDraft.tsx"
Cohesion: 0.06
Nodes (86): God Nodes (Abstraksi Paling Kritis):, App(), BottomCommandDock(), DraftSimulator(), DraftSimulatorProps, HeaderSortBar(), Props, HeroCardCompact() (+78 more)

### Community 1 - "0_sync_global_assets.py"
Cohesion: 0.10
Nodes (13): build_master_database(), download_and_process_portrait(), fetch_hokfire_data(), load_kpl_hero_mapping(), load_kpl_win_rates(), scrape_kurohiko_hero_counters(), scrape_kurohiko_roster(), clean_ability_sentences() (+5 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^1.70.0, react@^19.3.1, react-dom@^19.3.1, tailwind-merge@^3.7.0, devDependencies, tailwindcss@^4.3.5 (+26 more)

### Community 3 - "draftRules.ts"
Cohesion: 0.05
Nodes (79): ActionKind, analyzeLaneOccupancy(), applyDraftAction(), applyGameHero(), assignHeroLanes(), computeKplPairAdjustment(), createInitialGameDraft(), DraftAction (+71 more)

### Community 4 - "0_sync_global_assets.py"
Cohesion: 0.16
Nodes (10): asset_inventory(), Deployment, digest(), main(), parse_rsync_stats(), relative_path(), target_path(), main() (+2 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 6 - "heroDataLoader.ts"
Cohesion: 0.17
Nodes (18): ArtifactKind, CachedPackage, DATA_CACHE_KEY, DatasetIO, decodePackage(), fetchText(), KINDS, loadHeroMetadata() (+10 more)

### Community 7 - "publish_data.py"
Cohesion: 0.26
Nodes (8): attach_hokstats(), _load_json(), load_source_heroes(), build_package(), encode(), _load_json(), main(), write_package()

### Community 8 - "evaluateLaneMatchup"
Cohesion: 0.33
Nodes (6): computeRoamContextAdjustment(), evaluateLaneMatchup(), evaluateSwapMacroProfile(), getPairWinRate(), hasKplFlexLane(), scoreHeroMatchup()

### Community 9 - "main"
Cohesion: 0.60
Nodes (6): battleJobs(), getJson(), loadLeagues(), loadMatches(), main(), sleep()

### Community 10 - "json"
Cohesion: 0.10
Nodes (40): _alias_maps(), _build_variants(), canonical(), _cards(), _clean(), fetch_page(), _heading_list(), _hero_label_id() (+32 more)

### Community 11 - "validate-dataset.mjs"
Cohesion: 0.03
Nodes (47): actionRows, ALLOWED_LENS, anomalyLens, argv, battleIds, battleIndex, battles, completeHeroes (+39 more)

### Community 12 - "types.ts"
Cohesion: 0.08
Nodes (24): ArcanaItem, CounteredByInfo, CounterInfo, DraftSlot, GameDraftData, HeroAbility, HeroTempoBucket, HokfireCounters (+16 more)

### Community 13 - "test_data_pipeline.py"
Cohesion: 0.14
Nodes (17): build_evidence_response(), approved_profiles(), audit_batch_proposals(), canonical(), create_proposal(), generate_batch_proposals(), global_released_heroes(), has_source_evidence() (+9 more)

### Community 14 - "AGENTS.md — Developer & Agent Field Manual"
Cohesion: 0.04
Nodes (45): 1. Misi & Arsitektur Utama, 2. Standar Lingkungan & Perkakas (Wajib Diikuti), 3. Navigasi Knowledge Graph (`graphify`), 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS), 5. Alur Kerja & Perintah Pemeliharaan Rutin, 6. Struktur Direktori Proyek, A. Membangun & Memperbarui Frontend Statis:, A. Python & Manajemen Package (`uv`) (+37 more)

### Community 17 - "gamePlan.ts"
Cohesion: 0.12
Nodes (19): ALL_LANES, KplLaneRateMap, computeRelativeTempoShare(), computeTempoComparison(), estimateHeroTempoFromProfile(), LANE_SWAP_PAIRS, summarizeTeamTempoWithExact(), TempoCurveMap (+11 more)

### Community 19 - "build-kpl-db.mjs"
Cohesion: 0.05
Nodes (37): actionRows, argv, banSlotsAll, battleCsv, battles, bpLenDist, byId, gamesByLeague (+29 more)

### Community 21 - "gamePlan.test.mjs"
Cohesion: 0.25
Nodes (4): globalHeroes, heroes, manifest, synergy

### Community 22 - "build_artifact.py"
Cohesion: 0.15
Nodes (18): build_root(), contract(), digest(), extra_inventory(), extra_roots(), file_references(), identity(), inventory() (+10 more)

### Community 23 - "verify-dist.mjs"
Cohesion: 0.25
Nodes (5): files, manifest, root, scripts, walk()

### Community 24 - "generatePostDraftGamePlan"
Cohesion: 0.39
Nodes (8): buildHeroMap(), classifyCompArchetype(), computeJungleAndGankPlan(), countHardCc(), deriveWinningCondition(), evaluateAllLanes(), generatePostDraftGamePlan(), suggestBeneficialLaneSwaps()

### Community 26 - "json"
Cohesion: 0.13
Nodes (8): ingest_kpl_data(), init_db(), load_global_mapping(), export(), main(), main(), compute_opener_score(), simulate_step()

### Community 27 - "validate.yml"
Cohesion: 0.09
Nodes (22): concurrency, cancel-in-progress, group, jobs, validate, name, on, pull_request (+14 more)

### Community 28 - "setup.py"
Cohesion: 0.32
Nodes (9): _check_node_version(), _ensure_kpl_submodule(), main(), _require_tool(), _resolve_tool(), _run(), setup_data(), setup_web() (+1 more)

### Community 30 - "load-sqlite.mjs"
Cohesion: 0.11
Nodes (12): argv, DATA, db, HERE, leagues, OUT, parseLine(), playerRows (+4 more)

### Community 31 - "check-deploy.py"
Cohesion: 0.14
Nodes (7): Dependencies, diagnose_error(), fetch(), format_github_summary(), main(), select_assets(), verify()

### Community 33 - "collect-kpl-bp-all.mjs"
Cohesion: 0.14
Nodes (13): argv, D_MATCHES, F_BATTLES, F_FAILS, F_LEAGUES, F_STATUS, GAP, RAW (+5 more)

### Community 34 - "with"
Cohesion: 0.14
Nodes (14): with, artifact-ids, cache, cache-dependency-glob, cache-dependency-path, enable-cache, if-no-files-found, merge-multiple (+6 more)

### Community 35 - "extract_kpl_synergy.py"
Cohesion: 0.23
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

## Knowledge Gaps
- **1 isolated node(s):** `ml-engine`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 460 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Cara kerja mesin draft` connect `AGENTS.md — Developer & Agent Field Manual` to `draftRules.ts`?**
  _High betweenness centrality (0.316) - this node is a cross-community bridge._
- **What connects `ml-engine` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `PracticeDraft.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06315789473684211 - nodes in this community are weakly interconnected._
- **Why does `assignHeroLanes()` connect `draftRules.ts` to `PracticeDraft.tsx`, `gamePlan.ts`, `gamePlan.test.mjs`, `AGENTS.md — Developer & Agent Field Manual`?**
  _High betweenness centrality (0.313) - this node is a cross-community bridge._
- **Should `0_sync_global_assets.py` be split into smaller, more focused modules?**
  _Cohesion score 0.1028225806451613 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07301587301587302 - nodes in this community are weakly interconnected._
- **Should `draftRules.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05154295246038365 - nodes in this community are weakly interconnected._