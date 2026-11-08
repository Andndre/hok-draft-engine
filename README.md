# hok-draft-engine 🛡️⚡

AI-Powered Draft Pick Analyzer, Counter Lookup, and Wiki Companion for **Honor of Kings (HoK Global)** inspired by TypeSafe's **System One (Jev)** decision model architecture.

---

## 1. Architectural Highlights

1. **Zero Server Compute on Production:**
   - Production web hosting runs 100% on Shared Hosting (Static HTML/JS/CSS). Zero Node.js or Python background daemons.
   - Production inference runs entirely in the user's browser via `onnxruntime-web` (WebAssembly/WebGPU) with IndexedDB model caching (`0ms` cold reload, `<10ms` forward pass).
2. **Cloudflare R2 Object Storage & CDN:**
   - Compiled `.onnx` models, `manifest.json`, `hero_metadata.json`, and optimized 128x128 `.webp` hero portraits can be hosted on Cloudflare R2 with zero egress fees.
   - Built-in fallback stages all assets directly into `apps/web/public/` for standalone static hosting out of the box.
3. **Data Pipeline (120 Global Heroes + KPL Tournament History):**
   - **`https://hok.kurohiko.id/`**: Full 120 Global hero roster (Agudo to Ziya, 5 Flowborn variants, Fatih, Augran, Ao'yin, Luara, Dyadia, etc.) + community counter matrices and Indonesian tactical reasons.
   - **`https://www.hokfire.com/`**: Official Global Diamond+ tier ratings (`S/A/B/C/D`), Win %, Pick %, Ban %, and build guides.
   - **`kpl-bp-dataset` (Fire-Phoenixs)**: 11,141+ professional tournament games (KPL/KIC 2019–2026) with 184,441 Ban/Pick actions and Fearless Draft (Global BP) series tracking.
4. **Jev-Style Decision Engine:**
   - Replicates TypeSafe's **System One (Jev)** paradigm: Draft state in $\rightarrow$ typed choice distribution, confidence scores, and 6 calibrated tactical dimension vectors out in a single forward pass.
   - **Deterministic $\Delta$ Delta Explainer**: Computes tactical score deltas *before* vs *after* a pick to generate sharp tactical reasoning without calling expensive LLM APIs.

---

## 2. Monorepo Structure

```text
hok-draft-engine/
├── data/
│   ├── raw/
│   │   └── kpl-bp-dataset/           # Cloned 11,141 matches & 184,441 BP actions
│   ├── assets/
│   │   └── heroes/                   # 120 standardized 128x128 .webp portraits
│   ├── mappings/
│   │   └── master_heroes_global.json # Master 120 Global heroes bridged to KPL CN IDs
│   └── processed/
│       ├── hok_drafts.db             # Local SQLite parsed tournament database
│       ├── teacher_draft_dataset.npz # 44,642 distillation decision tuples
│       ├── student_net.pt            # PyTorch trained weights
│       ├── hok_jev_student.onnx      # Quantized ONNX model
│       ├── manifest.json             # Model manifest with SHA256 checksum
│       └── hero_metadata.json        # Unified client metadata
├── packages/
│   └── ml-engine/                    # [LOCAL PYTHON PIPELINE - uv]
│       ├── pyproject.toml
│       ├── .env.example
│       ├── 0_sync_global_assets.py   # Scrapes Kurohiko & HOKFIRE, standardizes 128x128 webp
│       ├── 1_ingest_kpl.py           # Parses KPL dataset & tracks Fearless Draft in SQLite
│       ├── 2_jev_teacher_scorer.py   # Computes empirical synergy/counter matrices & 6-axis vectors
│       ├── 3_train_student_net.py    # Trains PyTorch Set-Transformer Pointer Network
│       └── 4_export_and_publish_r2.py# Exports ONNX, checks integrity & syncs to R2 / web public
└── apps/
    └── web/                          # [STATIC FRONTEND - Vite + React 19 + TypeScript + Tailwind]
        ├── .env.example
        ├── public/                   # Staged ONNX, manifest, metadata & 120 portraits
        ├── src/
        │   ├── engine/
        │   │   ├── r2ModelLoader.ts  # Manifest check & IndexedDB caching
        │   │   ├── jevInference.ts   # ONNX Runtime Web WASM session runner (<10ms)
        │   │   └── deltaExplainer.ts # Deterministic tactical delta generator (Indonesian/English)
        │   ├── components/
        │   │   ├── HeaderSortBar.tsx # Sorting (AI, Win, Pick, A-Z) & View Toggle
        │   │   ├── HeroCardCompact.tsx # Kurohiko-style 48x48 horizontal pill card
        │   │   ├── HeroCardDetailed.tsx# HOKFIRE-style vertical card with diagonal tier ribbon
        │   │   ├── BottomCommandDock.tsx# Sticky glass dock (Role pills, Search '/', 4 Tabs)
        │   │   ├── DraftSimulator.tsx# 5v5 Blue/Red simulator + Fearless Draft toggle
        │   │   ├── TacticalRadarPanel.tsx # 6-axis Jev visualizer + Top 5 AI picks
        │   │   └── HeroWikiDrawer.tsx# Slide-over wiki drawer (Counters, Guides, Synergies)
        │   └── App.tsx
```

---

## 3. Quick Start & Execution Guide

### Prasyarat:
- Python 3.11+ dikelola via `uv`
- Node.js 18+ & npm

### A. Menjalankan ML Pipeline (Lokal):
```powershell
cd packages/ml-engine

# 1. Tarik & sinkronisasi data 120 hero Global serta gambar portrait 128x128 webp
uv run 0_sync_global_assets.py

# 2. Ingest 11,141 pertandingan KPL & hitung Fearless Draft (Global BP) ke SQLite
uv run 1_ingest_kpl.py

# 3. Hitung matriks sinergi/counter & generate 44,000+ data training Jev Teacher
uv run 2_jev_teacher_scorer.py

# 4. Training PyTorch Set-Transformer Student Network
uv run 3_train_student_net.py

# 5. Export ke ONNX, verifikasi inferensi, dan publish ke Cloudflare R2 / apps/web/public
uv run 4_export_and_publish_r2.py
```

### B. Menjalankan Static Web Frontend:
```powershell
cd apps/web

# Development Server (Hot Reload)
npm run dev

# Production Static Build
npm run build
```
Hasil build berada di `apps/web/dist/`. Kamu cukup meng-upload seluruh isi folder `dist/` ke Shared Hosting (cPanel `public_html`, Apache, Nginx, Cloudflare Pages, atau GitHub Pages).

### C. Konfigurasi Cloudflare R2 (Opsional):
Jika ingin menyajikan model `.onnx` dan aset secara terpisah lewat CDN R2:
1. Salin `packages/ml-engine/.env.example` ke `packages/ml-engine/.env` dan isi kredensial R2 kamu:
   ```env
   R2_ENDPOINT_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=your_access_key
   R2_SECRET_ACCESS_KEY=your_secret_key
   R2_BUCKET_NAME=hok-draft-engine
   R2_PUBLIC_URL=https://cdn.yourdomain.com
   ```
2. Salin `apps/web/.env.example` ke `apps/web/.env`:
   ```env
   VITE_R2_PUBLIC_URL=https://cdn.yourdomain.com
   ```
3. Jalankan kembali `uv run 4_export_and_publish_r2.py` untuk mengunggah otomatis.
