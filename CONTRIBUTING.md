# Contributing to HoK Draft Engine

Thank you for contributing! Read the setup path that matches what you plan to work on (`apps/web` frontend only vs. full `packages/ml-engine` + KPL data pipeline).

## Prerequisites

- **Git** (`2.40+` recommended for shallow submodule support)
- **Node.js `24+`** and `npm` (required for `apps/web`)
- **Python `3.13+`** managed with **[`uv`](https://docs.astral.sh/uv/)** (required only for `packages/ml-engine` or running the unified setup script; do **not** use global `pip`)

> Never hardcode credentials or commit `.env` files. Both `apps/web` and `packages/ml-engine` run local workflows without `.env` using the bundled manifests and local assets.

---

## Quick Setup

### Option A — Automated Setup (Recommended)

From the repository root:

```bash
# Full setup: initializes Fire-Phoenixs/kpl-bp-dataset submodule,
# syncs uv environment, ingests data/processed/hok_drafts.db, and runs npm ci
uv run scripts/setup.py --verify

# Frontend contributors only (skips Python/uv and raw 39.5 MB KPL dataset):
uv run scripts/setup.py --web-only --verify

# Data pipeline contributors only:
uv run scripts/setup.py --data-only --verify
```

*(On Linux/macOS or Windows without invoking `uv` first for `--web-only`, you can run `python3 scripts/setup.py --web-only`.)*

### Option B — Manual Setup

#### 1. Clone With Submodule (or Initialize After Clone)

Raw tournament records (`11,141` games from [`Fire-Phoenixs/kpl-bp-dataset`](https://github.com/Fire-Phoenixs/kpl-bp-dataset)) are linked as a shallow Git submodule at `data/raw/kpl-bp-dataset`:

```bash
git clone --recurse-submodules https://github.com/Andndre/hok-draft-engine.git
cd hok-draft-engine
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --depth 1 data/raw/kpl-bp-dataset
```

#### 2. Frontend Setup (`apps/web`)

```bash
cd apps/web
npm ci
npm run dev       # Vite dev server on http://localhost:3000
```

#### 3. Data Pipeline & KPL Ingestion (`packages/ml-engine`)

```bash
cd packages/ml-engine
uv sync --locked
uv run 1_ingest_kpl.py   # Builds gitignored SQLite DB at data/processed/hok_drafts.db
```

---

## Repository Layout

| Path | Ownership & Purpose |
|---|---|
| `apps/web/` | React 19 + TypeScript + Vite SPA + Web Worker Minimax search (`npm test`, `npm run benchmark`, `npm run build`) |
| `packages/ml-engine/` | `uv`-managed Python data ingestion, deterministic skill evidence audit, and dataset packager |
| `data/raw/kpl-bp-dataset/` | Submodule tracking `Fire-Phoenixs/kpl-bp-dataset` (`afc9ac6`, CC BY-NC 4.0) |
| `data/mappings/` | Tracked canonical hero catalog, Global release status, HoKStats reviews, tactical proposals, and KPL matrices |
| `data/processed/` | Gitignored local outputs (`hok_drafts.db`, `draft_benchmark.json`) rebuilt from raw submodule data |
| `apps/web/public/datasets/` | Published immutable SHA-256 JSON artifacts referenced by `apps/web/public/data_manifest.json` |
| `scripts/setup.py` | Cross-platform contributor bootstrapper |
| `.github/workflows/deploy.yml` | CI verification (`verify` job on all PRs) and Hostinger CD (`deploy` job on upstream `main`) |

---

## Critical Domain Rules & Data Workflow

1. **Counter Polarity (Never Invert):**
   - `hero.counters`: heroes **that this hero counters** (favorable targets).
   - `hero.countered_by`: heroes **that counter this hero** (threats).
2. **Never Hand-Edit `apps/web/public/datasets/` or `data_manifest.json`:**
   - Checksums are SHA-256 verified by `apps/web/tests/verify-dist.mjs` and the browser loader (`heroDataLoader.ts`).
   - Edit source mappings in `data/mappings/`, then regenerate bundles with:
     ```bash
     cd packages/ml-engine
     uv run extract_kpl_synergy.py
     uv run publish_data.py
     ```
3. **Hero Release Status & Alias Integrity:**
   - Every hero requires an explicit boolean `released` entry in `data/mappings/hero_release_status.json`.
   - ID `511` (Zhu Bajie) must remain `{ "released": false, "alias_of": 556 }` (merged into **Ata `#556`**).
4. **Keep Python Package Lean (`uv`):**
   - Runtime production runs zero neural/ONNX/cloud inference in the browser. Do not add heavy ML packages unless required and reviewed.

---

## Running Checks Before Opening a PR

Run both frontend and Python suites locally:

```bash
# Frontend tests, fixture benchmark, and verified static bundle
cd apps/web
npm test
npm run benchmark
npm run build

# Python pipeline unit tests (runs cleanly even with or without hok_drafts.db)
cd ../../packages/ml-engine
uv run python -m unittest discover -s . -p "test_*.py"
```

*(Optional historical holdout benchmark once `data/processed/hok_drafts.db` exists:)*

```bash
cd packages/ml-engine
uv run export_draft_benchmark.py --cutoff 2024-01-01 --limit 24
cd ../../apps/web
npm run benchmark -- --historical ../../data/processed/draft_benchmark.json --limit 24
```

If you modify TypeScript or Python structure, refresh the knowledge graph if `graphify` is installed (`graphify update .`).

---

## Licensing

See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE): source code is MIT-licensed, while derived KPL tournament statistics inherit **CC BY-NC 4.0** (attribution required, non-commercial use only).
