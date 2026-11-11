# ML & Data Pipeline (`packages/ml-engine`)

Local `uv`-managed Python 3.13 pipeline for tournament data ingestion, deterministic skill evidence auditing, hero/catalog maintenance, and SHA-256 dataset packaging.

> Production inference runs deterministically in TypeScript + Web Worker inside `apps/web/`. There is no ONNX, PyTorch, or cloud model runtime in production or in this package's dependencies.

## Setup

Initialize the `Fire-Phoenixs/kpl-bp-dataset` submodule first, then sync dependencies and ingest `data/processed/hok_drafts.db`:

```bash
git submodule update --init --depth 1 data/raw/kpl-bp-dataset
cd packages/ml-engine
uv sync --locked
uv run 1_ingest_kpl.py
```

Or run `uv run scripts/setup.py --data-only` from the repository root.

## Pipeline Scripts

| Script | Purpose | Key Inputs / Outputs |
|---|---|---|
| `0_sync_global_assets.py` | Scrapes Global hero roster/stats/counters (Kurohiko + HOKFIRE) and downloads `128x128` `.webp` portraits | Writes `data/assets/heroes/`, `data/mappings/master_heroes_global.json` |
| `fetch_hokfire_icons.py` | Fetches item, arcana, summoner spell, and ability PNG icons | Writes `data/assets/`, copies to `apps/web/public/assets/` |
| `1_ingest_kpl.py` | Parses `data/raw/kpl-bp-dataset/data/*.csv` with Fearless BP tracking and alias mapping (`511 -> 556`) | Builds gitignored `data/processed/hok_drafts.db` |
| `extract_kpl_synergy.py` | Computes duet winrate/synergy lift, B1/R1 openers, Phase 1/2 bans, duration tempo curves, and modern (`year >= 2024`) KPL lane rates | Reads `hok_drafts.db` + `players.jsonl`; writes `data/mappings/kpl_synergy_matrix.json` & `apps/web/public/kpl_synergy_matrix.json` |
| `extract_kpl_counters.py` | Computes head-to-head KPL matchup profiles (`>= 12` games threshold) | Reads `hok_drafts.db`; writes `kpl_counter_matrix.json` |
| `hokstats_source.py` | Offline importer + hash-tracked reviewer CLI (`sync`, `review-guide`, `review-matchup`, `review-catalog`) | Writes `data/mappings/hokstats_*.json` |
| `skill_evidence_audit.py` | Deterministic skill evidence extractor for 28 tactical tags (mobility, CC, utility, vulnerabilities) with negation filtering | Imported by `tactical_profiles.py` |
| `tactical_profiles.py` | Batch proposal generator, source-hash validator, and manual reviewer (`audit-batch`, `propose`, `review`) | Reads/writes `data/mappings/tactical_proposals/` |
| `publish_data.py` | Compiles `schema_version: 2` immutable artifacts into `apps/web/public/datasets/<version>/` + `data_manifest.json` | Reads `data/mappings/`; writes `apps/web/public/datasets/` |
| `export_draft_benchmark.py` | Exports leak-free chronological holdout benchmark positions from `hok_drafts.db` | Writes `data/processed/draft_benchmark.json` |

## Tests

```bash
cd packages/ml-engine
uv run python -m unittest discover -s . -p "test_*.py"
```
