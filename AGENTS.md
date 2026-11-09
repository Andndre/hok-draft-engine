# AGENTS.md — Developer & Agent Field Manual

Selamat datang di repository **`hok-draft-engine`** 🛡️⚡.
Dokumen ini disusun sebagai panduan operasional komprehensif agar setiap autonomous coding agent (Antigravity, Claude Code, OpenAI Codex, Cursor, Devin, Aider, OpenClaw, dll.) dapat langsung memahami arsitektur, domain logic, standar perkakas, dan batasan ketat proyek ini tanpa perlu membaca ulang seluruh codebase dari nol.

---

## 1. Misi & Arsitektur Utama

`hok-draft-engine` adalah sistem simulator Draft Pick, Counter Matrix, dan Wiki Interaktif untuk **Honor of Kings (HoK Global)** yang mengadopsi paradigma arsitektur **System One (Jev)** milik TypeSafe:
1. **Zero Server Compute di Produksi:**
   - Seluruh logika inferensi AI berjalan langsung di browser client via `onnxruntime-web` (WASM/WebGPU) dan IndexedDB model caching (`0ms` cold reload, `<10ms` latency).
   - Backend web adalah static assets (HTML/JS/CSS) yang dapat dideploy di Shared Hosting cPanel, Cloudflare Pages, atau Nginx statis.
2. **Dual-Stack Monorepo:**
   - `packages/ml-engine/`: Pipeline Python lokal untuk ekstraksi data, training PyTorch Set-Transformer Pointer Network, kuantisasi model ke format ONNX, dan sinkronisasi Cloudflare R2 / RustFS S3.
   - `apps/web/`: Single Page Application (SPA) berbasis Vite, React 19, TypeScript, dan Tailwind CSS.
3. **Multi-Source Data Ingestion:**
   - Data 120 hero Global dari `https://hok.kurohiko.id/` (alasan taktis lokal & counter matrix).
   - Data statistik tier Diamond+ dari `https://www.hokfire.com/` (builds, arcana, tier resmi S/A/B/C/D).
   - Data empiris 11.141+ pertandingan turnamen profesional (KPL / KIC 2019–2026) dari dataset Fire-Phoenixs (frekuensi pick B1/R1, ban fase 1/2, dan duet winrate).

---

## 2. Standar Lingkungan & Perkakas (Wajib Diikuti)

Setiap agen yang mengeksekusi perintah shell **WAJIB** mematuhi aturan berikut:

### A. Python & Manajemen Package (`uv`)
- Lingkungan mesin ini menggunakan **`uv`** sebagai tool manager, virtualenv, dan package installer tunggal.
- **DILARANG** menggunakan `pip install` global, `python -m pip`, atau `python -m venv`.
- Eksekusi skrip modul: `cd packages/ml-engine && uv run <script.py>`.
- Eksekusi skrip ad-hoc / lepas: Gunakan flag `--with`:
  ```powershell
  uv run --with boto3 python scratch/sync_s3.py
  ```
- Eksekusi CLI global: Jalankan instan via `uvx <package>` atau terisolasi via `uv tool install <package>`.

### B. Shell & PowerShell Safety (Windows)
- Lingkungan command prompt adalah **PowerShell on Windows**.
- **DILARANG** memasukkan teks multiline markdown atau teks panjang dengan format kompleks secara inline ke parameter CLI (misal: `gh pr create --body "..."`). Karakter `$`, backtick, dan escape sequence dapat terdistorsi oleh parser PowerShell.
- **WAJIB** menulis ke file temporary terlebih dahulu (`temp_body.md`), jalankan dengan argumen file (`--body-file "temp_body.md"`), lalu hapus file temporary setelah selesai.

### C. Local Dev Stack & Object Storage
- Local dev stack web server dan database dikelola via **EnvKit** (`https://hok-draft-engine.test/`).
- S3 Object Storage lokal (RustFS / MinIO) berjalan di:
  - Endpoint: `http://127.0.0.1:9000`
  - Bucket: `hok-draft-engine`
  - Access Key: `rustfsadmin` | Secret: `rustfsadmin`

---

## 3. Navigasi Knowledge Graph (`graphify`)

Repositori ini telah dipetakan secara terstruktur menggunakan **`graphify`** ke dalam direktori `graphify-out/`:
- **Interactive Graph:** [`graphify-out/graph.html`](graphify-out/graph.html)
- **GraphRAG JSON:** [`graphify-out/graph.json`](graphify-out/graph.json)
- **Executive Report:** [`graphify-out/GRAPH_REPORT.md`](graphify-out/GRAPH_REPORT.md)
- **Agent Wiki (30 Artikel):** [`graphify-out/wiki/index.md`](graphify-out/wiki/index.md)

### Aturan Agen saat Menjelajahi Codebase:
1. Sebelum melakukan `grep` atau membaca source code mentah secara acak, gunakan query graph:
   ```powershell
   graphify query "<pertanyaan>"
   graphify path "<NodeA>" "<NodeB>"
   graphify explain "<Node>"
   ```
2. Jika butuh ringkasan arsitektur modul, baca [`graphify-out/wiki/index.md`](graphify-out/wiki/index.md) dan buka artikel komunitas terkait.
3. Setelah mengubah kode sumber (TypeScript / Python), perbarui graph dengan perintah (cepat & tanpa LLM cost):
   ```powershell
   graphify update .
   ```

### God Nodes (Abstraksi Paling Kritis):
| God Node | Koneksi | Lokasi | Peran Kritis |
|---|---|---|---|
| `Hero` | 20 edges | [`apps/web/src/types.ts`](apps/web/src/types.ts) | Definisi tipe sentral untuk hero, stats, counters, items, dan build. |
| `App()` | 14 edges | [`apps/web/src/App.tsx`](apps/web/src/App.tsx) | Root controller state draft (Fearless BP, Plan A/B, sequence sync). |
| `runJevInference()` | 7 edges | [`apps/web/src/engine/jevInference.ts`](apps/web/src/engine/jevInference.ts) | Decision core kalkulasi 4-fase turnamen & skor rekomendasi. |
| `loadHeroMetadata()` | 7 edges | [`apps/web/src/engine/r2ModelLoader.ts`](apps/web/src/engine/r2ModelLoader.ts) | Loader metadata dari fallback/S3 dengan proteksi cache IndexedDB. |
| `isHeroGlobalReleased()` | 7 edges | [`apps/web/src/data/heroReleaseStatus.ts`](apps/web/src/data/heroReleaseStatus.ts) | Filter integritas server Global vs hero eksklusif CN/KPL. |
| `TacticalVector` | 7 edges | [`apps/web/src/types.ts`](apps/web/src/types.ts) | Vektor 6 sumbu radar taktis (Early, CC, Frontline, Carry Shutdown, Flex, WinProb). |

---

## 4. Logika Domain & Batasan Taktis (CRITICAL PITFALLS)

Setiap agen yang memodifikasi logika inferensi, data mapping, atau antarmuka wajib memahami aturan domain ini:

### A. Semantik Relasi Counter (JANGAN PERNAH DIBALIK!)
Di masa lalu terjadi bug inversi 180 derajat karena salah menginterpretasikan artikel "Counter Alami Hero". Aturan mutlak struktur data:
- **`hero.counters`** (`target_id`, `target_name`):
  Menyimpan hero-hero yang **DI-COUNTER OLEH HERO INI** (*Target Empuk / Kuat Melawan*).
  *Contoh:* Untuk Liang, `counters` berisi `[Li Bai, Arke, Augran, Chicha, Jing]` karena ulti suppress Liang menghentikan dash mereka.
- **`hero.countered_by`** (`counter_id`, `counter_name`):
  Menyimpan hero-hero yang **MENG-COUNTER HERO INI** (*Ancaman Alami / Lemah Melawan*).
  *Contoh:* Untuk Liang, `countered_by` berisi `[Gan & Mo, Lady Zhen, Kui, Shouyue]` karena poke jarak jauh dan hook mereka membatalkan ulti Liang.

### B. Competitive Tournament Tiers vs Casual Pub Tiers
- Hero carry tanpa skill mobilitas / escape (**Luban No.7 [112], Hou Yi [169], Angela [142], Daji [109], Milady [504]**) memiliki winrate tinggi di public ranked match karena musuh kasual tidak tahu cara dive.
- Namun di turnamen resmi (dan di Global tanpa Master Luban [525]), hero-hero ini adalah **Tier B atau C**.
- **DILARANG** merekomendasikan Luban No.7 atau hero immobile ini sebagai First Pick (Blue B1) atau Ban Prioritas Fase 1. Di [`apps/web/src/engine/jevInference.ts`](apps/web/src/engine/jevInference.ts), terdapat penalti khusus `openerPenalty = -2.5` dan sanksi `-2.0` pada Step 0–4 untuk mencegah anomali ini.
- Meta Openers sah untuk B1 First Pick: **Liang, Haya, Dun, Ao'yin, Augran, Marco Polo, Lady Sun**.

### C. Hero Rilis Global vs Eksklusif CN
- HoK Global belum merilis seluruh hero dari King's Glory (CN).
- Hero seperti **Su Lie (#194), Master Luban (#525), Shen Mengxi (#312), Geya (#548), Taiyi Zhenren (#186)** diisolasi dalam `CN_ONLY_HERO_IDS` di [`apps/web/src/data/heroReleaseStatus.ts`](apps/web/src/data/heroReleaseStatus.ts).
- **Zhu Bajie (#511)** telah di-merge ke **Ata (#556)** di Global Server. Seluruh data 1.701 match KPL dan sinergi duet turnamen telah dialihkan ke ID 556. ID 511 tidak aktif di katalog.
- Toggle `🌐 Rilis Global (Aktif)` di UI wajib memfilter hero non-global agar tidak muncul di rekomendasi draft.

### D. Mekanisme Cache IndexedDB Client-Side
- Browser menyimpan metadata hero di IndexedDB untuk memastikan waktu buka secepat kilat (`0ms`).
- Jika Anda memperbarui `hero_metadata.json` (mengubah winrate, tier, counters, atau sinergi), Anda **WAJIB menaikkan cache key** di [`apps/web/src/engine/r2ModelLoader.ts`](apps/web/src/engine/r2ModelLoader.ts) (contoh: dari `v14` ke `v15` atau `v16`). Jika tidak, browser pengguna akan terus memakai data lama yang tersimpan di IndexedDB mereka.

---

## 5. Alur Kerja & Perintah Pemeliharaan Rutin

### A. Membangun & Memperbarui Frontend Statis:
```powershell
# 1. Pindah ke direktori web
cd apps/web

# 2. Build TypeScript & Vite bundle
npm run build

# 3. Salin public assets ke folder dist
Copy-Item -Recurse -Force public\assets dist\
Copy-Item -Force public\*.json dist\
```

### B. Sinkronisasi Data & Model ke R2 / S3:
```powershell
cd packages/ml-engine
uv run 4_export_and_publish_r2.py
```

### C. Menjalankan Uji Simulasi Draft AI:
Untuk memverifikasi bahwa rekomendasi Fase Ban dan Pick AI berjalan sesuai kaidah kompetitif:
```powershell
cd packages/ml-engine
uv run verify_simulation.py
```

---

## 6. Struktur Direktori Proyek

```text
hok-draft-engine/
├── AGENTS.md                         # Dokumen instruksi ini (Entry point para agen)
├── README.md                         # Dokumentasi arsitektur umum & overview
├── graphify-out/                     # Hasil pemetaan Knowledge Graph
│   ├── graph.html                    # Visualisasi graph interaktif
│   ├── graph.json                    # Graph data (GraphRAG format)
│   ├── GRAPH_REPORT.md               # Laporan ringkasan topologi & komunitas
│   └── wiki/                         # 31 artikel wiki struktur sistem
├── data/
│   ├── raw/kpl-bp-dataset/           # 11.141 match turnamen KPL mentah
│   ├── assets/heroes/                # 128x128 webp potret hero
│   ├── mappings/
│   │   └── master_heroes_global.json # Canonical 120 hero Global + stats & counters
│   └── processed/
│       ├── hok_drafts.db             # Database SQLite KPL Fearless draft
│       └── hero_metadata.json        # Database metadata client siap saji
├── packages/
│   └── ml-engine/                    # Pipeline ekstraksi & Machine Learning (uv)
│       ├── 0_sync_global_assets.py   # Scraper Kurohiko & HOKFIRE
│       ├── 1_ingest_kpl.py           # Ingestion database KPL
│       ├── 2_jev_teacher_scorer.py   # Komputasi sinergi duet & 6-axis vectors
│       ├── 3_train_student_net.py    # Training PyTorch model
│       └── 4_export_and_publish_r2.py# Export ONNX & publish R2
└── apps/
    └── web/                          # Static Frontend SPA (Vite + React 19 + TS)
        ├── public/                   # Asset statis, JSON, & ONNX model
        ├── dist/                     # Hasil build produksi siap upload
        └── src/
            ├── engine/
            │   ├── jevInference.ts   # Mesin inferensi taktis 4 fase turnamen
            │   └── r2ModelLoader.ts  # Model & metadata loader + IndexedDB cache
            ├── components/
            │   ├── DraftSimulator.tsx# Board draft 5v5 Blue vs Red
            │   ├── TacticalRadarPanel.tsx # Visualisasi radar taktis 6 dimensi
            │   └── HeroWikiDrawer.tsx# Sidebar informasi hero, counters & sinergi KPL
            ├── data/
            │   └── heroReleaseStatus.ts # Pemetaan whitelist hero rilis Global
            └── App.tsx               # Orchestrator aplikasi utama
```
