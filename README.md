# hok-draft-engine 🛡️⚡

AI-Powered Draft Pick Analyzer, Counter Lookup, and Wiki Companion for **Honor of Kings (HoK Global)** terinspirasi dari paradigma keputusan taktis **System One (Jev)** milik TypeSafe.

Aplikasi ini menyajikan simulator draft turnamen 5v5 (termasuk regulasi **Fearless Draft / Global BP**), rekomendasi pick/ban dinamis berbasis 4 fase turnamen resmi, radar taktis 6 dimensi, kombo sinergi empiris turnamen pro (KPL), dan matriks counter dwi-sumber (HOKFIRE & Kurohiko).

---

## 1. Sorotan Arsitektur

1. **Zero Server Compute di Produksi:**
   - Hosting web berjalan 100% pada Static Hosting (HTML, JavaScript, CSS). Tanpa background worker Node.js atau daemon server Python yang memakan biaya bulanan.
   - Seluruh logika evaluasi berjalan langsung di sisi client (browser pengguna) dengan latensi ultra-rendah (`<15ms`).
2. **Dual-Stack Monorepo:**
   - `packages/ml-engine/`: Pipeline data lokal Python (`uv`) untuk scraping data hero Global, agregasi 11.141 match turnamen KPL ke SQLite, komputasi matriks sinergi duet, serta eksperimen pelatihan neural model PyTorch.
   - `apps/web/`: Single Page Application berbasis **Vite + React 19 + TypeScript + Tailwind CSS**, siap deploy ke Shared Hosting cPanel, Cloudflare Pages, Vercel, atau Nginx.
3. **Data Pipeline Multi-Sumber Terkalibrasi:**
   - **`https://hok.kurohiko.id/`**: Data 120 hero Global, peran lane, matriks counter komunitas, dan alasan taktis berbahasa Indonesia.
   - **`https://www.hokfire.com/`**: Rating tier Diamond+ resmi Global (`S/A/B/C/D`), Win Rate, Pick Rate, Ban Rate, dan panduan build/item/arcana.
   - **`kpl-bp-dataset` (Fire-Phoenixs)**: 11.141+ pertandingan turnamen profesional (KPL & KIC) dengan 184.441 tindakan Ban/Pick untuk mengekstrak frekuensi pembuka B1/R1, pre-ban turnamen, dan duet winrate.

---

## 2. Anatomi Mekanisme: Apa Sebenarnya JEV di Sini?

> ⚠️ **Transparansi Teknis:** Di dalam codebase terdapat model neural network `hok_jev_student.onnx` (hasil distilasi PyTorch Set-Transformer pada `packages/ml-engine/`). Namun, pada aplikasi web yang berjalan (`apps/web/src/engine/jevInference.ts`), model neural network murni tersebut **sengaja dinonaktifkan (`isNeural: false`)** dan digantikan oleh **Calibrated Deterministic Tournament Decision Core**.

### Mengapa Model Neural Network Murni Tidak Efektif untuk Draft Turnamen?
Jika Anda curiga bahwa black-box neural net tidak cocok untuk draft esports, kecurigaan Anda beralasan:
1. **Kegagalan Memahami Fase Turnamen (Phase Blindness):**
   Model neural net berbasis supervised learning memetakan input state secara statistik tanpa memahami konteks aturan fase:
   - *Fase Ban 1 (Step 0–3):* Tujuannya adalah **mem-ban counter terhadap rencana hero pembuka kita (Plan A / Plan B)** atau men-deny opener lawan.
   - *Fase Pick 1 (Step 4–9):* Memilih core pembuka fleksibel (B1/R1).
   - *Fase Ban 2 (Step 10–13):* Melakukan **targeted deny ban** pada sisa lane musuh yang masih kosong untuk memutus kombo mereka.
   - *Fase Pick 2 (Step 14–17):* Melakukan **last counter-pick** di R5/B5 dan menambal kekurangan radar tim.
   Neural network biasa cenderung menyamakan semua ban dan pick sebagai satu distribusi probabilitas statis.
2. **Noise Data Ranked vs Meta Kompetitif:**
   Data statistik publik kerap memberi winrate tinggi pada hero tanpa mobilitas (seperti Luban No.7, Hou Yi, Angela, Daji) karena pemain kasual tidak tahu cara dive. Model neural net yang dilatih pada data publik akan mengalami halusinasi dan menyarankan hero-hero ini di First Pick B1 — sebuah blunder fatal di turnamen kompetitif.
3. **Ketiadaan *Explainability* (Black-Box):**
   Pemain esports membutuhkan alasan rasional: *"Mengapa hero ini di-ban? Apa sinergi duetnya? Mengapa terjadi kontradiksi antara Kurohiko dan HOKFIRE?"* Neural net hanya mengeluarkan angka probabilitas tanpa reasoning taktis.

---

### Mesin yang Sebenarnya Bekerja: *Calibrated Tournament Decision Core*

Untuk menghasilkan keputusan setara analis turnamen pro, sistem menggunakan mesin terstruktur di [`apps/web/src/engine/jevInference.ts`](apps/web/src/engine/jevInference.ts):

```
┌────────────────────────────────────────────────────────────────────────┐
│                        INPUT DRAFT STATE                               │
│ (Our Picks, Enemy Picks, Banned IDs, Fearless History, Current Step)   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────┐
│   KPL EMPIRICAL MATRIX          │   │   DUAL COUNTER ENGINE            │
│ - B1/R1 Pro Frequency           │   │ - HOKFIRE Official Matchups      │
│ - KPL Pre-Ban History           │   │ - Kurohiko Community Matrix      │
│ - Duet Synergy Lift (WR & N)    │   │ - Smart Conflict Resolver        │
└────────────────┬────────────────┘   └──────────────────┬───────────────┘
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     │
                                     ▼
     ┌───────────────────────────────────────────────────────────────┐
     │           4-PHASE TOURNAMENT STRATEGY SIMULATOR               │
     │                                                               │
     │ • Fase Ban 1: Pre-Ban Hard Counters ke Target Opener (Plan A) │
     │ • Fase Pick 1: Amankan S-Tier Flex Core & Duet Synergy        │
     │ • Fase Ban 2: Targeted Ban Lane Musuh yg Kosong               │
     │ • Fase Pick 2: Last Counter-Pick (R5) & Radar Balancing       │
     └───────────────────────────────┬───────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌─────────────────────────────────┐             ┌────────────────────────────────┐
│   6-AXIS TACTICAL RADAR         │             │   SOFTMAX RANKED PICKS         │
│ - Early Game Pressure           │             │ - Skor Rekomendasi Terkalibrasi│
│ - CC Chain Lockdown             │             │ - Pro Combo Tagging            │
│ - Frontline Durability          │             │ - Lane Occupancy Enforcement   │
│ - Enemy Carry Shutdown          │             │ - AI #1..#5 Grid Badges        │
│ - Draft Flexibility             │             └────────────────────────────────┘
│ - Win Probability               │
└─────────────────────────────────┘
```

#### 1. Formula Prioritas Pembuka Fase 1 (`computeOpenerPriorityScore`)
Menentukan hero mana yang paling layak dijadikan *First-Pick B1* atau diamankan di *R1+R2*:
$$\text{Score}_{\text{opener}} = (\text{WR} - 0.48) \times 4.5 + \text{PR} \times 3.5 + W_{\text{tier}} + \text{Bonus}_{\text{KPL}} + \text{Bonus}_{\text{flex}} + \text{Penalty}_{\text{immobile}}$$
* **$W_{\text{tier}}$**: Bobot tier turnamen ($S = +0.65, A = +0.25, B = 0, C = -0.25$).
* **$\text{Bonus}_{\text{KPL}}$**: Dihitung dari frekuensi riil hero dipilih di B1/R1 dalam 11.141 match KPL ($\min(0.85, \frac{\text{B1}}{400} + \frac{\text{P1\_Bans}}{1200})$).
* **$\text{Penalty}_{\text{immobile}}$**: Sanksi keras ($-2.5$) untuk hero carry tanpa mobilitas (Luban No.7, Hou Yi, Angela, Daji, Milady) jika Master Luban (#525) tidak tersedia di server Global.

#### 2. Logika Pre-Ban Protektif (Fase Ban 1, Step 0–3)
Jika Blue Side merencanakan First-Pick pada suatu hero (misal: **Liang**):
* AI **melarang mem-ban** Liang sendiri (`score -= 3.0`).
* AI mencari hero-hero yang merupakan *hard counter* terhadap Liang (seperti Shouyue, Lady Zhen, Kui, Gan & Mo) dan memberikan dorongan skor ban tinggi (`score += 1.25 + prebanBoost`) untuk memprioritaskan ban terhadap ancaman pembuka kita.

#### 3. Logika Sinergi Duet Empiris (Fase Pick 1 & 2)
Ketika satu hero telah dipilih (misal: **Ata** atau **Dolia**), AI membaca `kpl_synergy_matrix.json`:
* Pasangan duet dengan minimal 20 match di turnamen pro dan winrate $\ge 50\%$ mendapat dorongan skor sinergi:
  $$\text{SynergyBoost} = \text{SynergyLift} \times 2.2 + 0.35$$
* Menghasilkan tag informatif di UI: *"🔗 Kombo KPL: 75% WR dg Allain (20 Match)"*.

#### 4. Dual Counter Matchup & Smart Conflict Resolution
Sistem membedakan secara tegas arah relasi counter:
* **`counters`** (*Target Empuk*): Hero yang dikalahkan oleh hero aktif.
* **`countered_by`** (*Ancaman Alami*): Hero yang mengalahkan hero aktif.
* Jika terjadi kontradiksi (misal: Kurohiko artikel lama mencatat Dian Wei meng-counter Kaizer, sementara data resmi HOKFIRE dan match KPL membuktikan Kaizer unggul), AI memberikan label **`DISPUTED`** dan menyertakan catatan meta turnamen aktif.

#### 5. Radar Taktis 6 Dimensi & Deterministic $\Delta$ Explainer
Tanpa perlu memanggil LLM berbayar yang lambat:
* Setiap kali giliran draft berubah, sistem menghitung ulang 6 dimensi taktis: *Early Game Pressure, CC Chain Lockdown, Frontline Durability, Enemy Carry Shutdown, Draft Flexibility,* dan *Win Probability*.
* Sistem membandingkan skor sebelum vs sesudah pick untuk menghasilkan penjelasan otomatis dalam Bahasa Indonesia (misal: *"+18% CC Lockdown: Knockup area menambah kontrol pertarungan tim"*).

---

## 3. Struktur Monorepo

```text
hok-draft-engine/
├── AGENTS.md                         # Field manual lengkap untuk coding agents
├── README.md                         # Dokumentasi arsitektur proyek
├── graphify-out/                     # Navigasi Knowledge Graph (graph.html, wiki, JSON)
├── data/
│   ├── raw/kpl-bp-dataset/           # 11.141 match turnamen KPL mentah
│   ├── assets/heroes/                # 120 potret hero 128x128 .webp terstandarisasi
│   ├── mappings/
│   │   ├── master_heroes_global.json # 120 master hero Global + mapping ID KPL CN
│   │   ├── kpl_synergy_matrix.json   # Matriks sinergi duet & B1 opener KPL
│   │   └── kpl_counter_matrix.json   # Matriks counter empiris KPL
│   └── processed/
│       ├── hok_drafts.db             # Database SQLite turnamen KPL
│       ├── hok_jev_student.onnx      # Model ONNX hasil kompilasi
│       ├── manifest.json             # Model manifest dengan SHA256 checksum
│       └── hero_metadata.json        # Database metadata client siap saji
├── packages/
│   └── ml-engine/                    # [LOCAL PYTHON PIPELINE - uv]
│       ├── pyproject.toml
│       ├── 0_sync_global_assets.py   # Scraper Kurohiko & HOKFIRE
│       ├── 1_ingest_kpl.py           # Ingestion database KPL ke SQLite
│       ├── 2_jev_teacher_scorer.py   # Komputasi sinergi duet & 6-axis vectors
│       ├── 3_train_student_net.py    # Training PyTorch model
│       ├── 4_export_and_publish_r2.py# Export ONNX & publish ke S3 / web public
│       ├── extract_kpl_synergy.py    # Ekstraktor sinergi turnamen KPL
│       ├── extract_kpl_counters.py   # Ekstraktor counter turnamen KPL
│       ├── fetch_hokfire_icons.py    # Pengunduh aset ikon ability, item & arcana
│       └── verify_simulation.py      # Test suite verifikasi simulasi draft AI
└── apps/
    └── web/                          # [STATIC FRONTEND - Vite + React 19 + TS]
        ├── public/                   # Asset statis, JSON, & ONNX model
        ├── dist/                     # Hasil build produksi siap deploy
        └── src/
            ├── engine/
            │   ├── jevInference.ts   # Mesin inferensi taktis 4 fase turnamen
            │   ├── r2ModelLoader.ts  # Model loader & cache IndexedDB
            │   └── deltaExplainer.ts # Generator penjelasan delta taktis
            ├── components/
            │   ├── HeaderSortBar.tsx # Filter lane, sortir AI/Win/Pick, & toggle Global
            │   ├── DraftSimulator.tsx# Board draft 5v5 Blue vs Red
            │   ├── TacticalRadarPanel.tsx # Visualisasi radar 6 dimensi & Plan A/B
            │   └── HeroWikiDrawer.tsx# Sidebar profil hero, items, arcana & counters
            ├── data/
            │   └── heroReleaseStatus.ts # Whitelist status rilis server Global
            └── App.tsx               # Orchestrator aplikasi utama
```

---

## 4. Panduan Eksekusi Cepat

### Prasyarat:
- Python 3.11+ dikelola via **`uv`**
- Node.js 18+ & npm

### A. Menjalankan Static Web Frontend (Lokal):
```powershell
cd apps/web

# Development Server (Hot Reload di https://localhost:5173 atau test domain)
npm run dev

# Production Static Build
npm run build

# Salin aset statis ke folder dist
Copy-Item -Recurse -Force public\assets dist\
Copy-Item -Force public\*.json dist\
```
Hasil build berada di `apps/web/dist/`. Cukup upload seluruh isi folder `dist/` ke Shared Hosting cPanel (`public_html`), Apache, Nginx, Cloudflare Pages, atau GitHub Pages.

### B. Menjalankan Uji Verifikasi Simulasi Draft AI:
```powershell
cd packages/ml-engine
uv run verify_simulation.py
```

### C. Menjalankan Pipeline Data & ML (Opsional / Developer):
```powershell
cd packages/ml-engine

# 1. Sinkronisasi data 120 hero Global & download gambar portrait
uv run 0_sync_global_assets.py

# 2. Ingest 11.141 match KPL ke SQLite
uv run 1_ingest_kpl.py

# 3. Hitung matriks sinergi KPL & opener B1
uv run extract_kpl_synergy.py

# 4. Export ONNX, perbarui manifest & sinkronkan aset ke apps/web/public
uv run 4_export_and_publish_r2.py
```
