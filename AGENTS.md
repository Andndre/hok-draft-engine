# AGENTS.md — Developer & Agent Field Manual

Selamat datang di repository **`hok-draft-engine`** 🛡️⚡.
Dokumen ini disusun sebagai panduan operasional komprehensif agar setiap autonomous coding agent (Antigravity, Claude Code, OpenAI Codex, Cursor, Devin, Aider, OpenClaw, dll.) dapat langsung memahami arsitektur, domain logic, standar perkakas, dan batasan ketat proyek ini tanpa perlu membaca ulang seluruh codebase dari nol.

---

## 1. Misi & Arsitektur Utama

`hok-draft-engine` adalah sistem simulator Draft Pick, Counter Matrix, dan Wiki Interaktif untuk **Honor of Kings (HoK Global)** dengan mesin taktis deterministik dan pencarian Minimax lokal. **Ekstraksi bukti skill lokal (skill evidence audit)** mengelola label taktis pada pipeline pengelola secara deterministik:
1. **Zero Server Compute di Produksi:**
   - Keputusan draft berjalan di browser melalui scorer TypeScript dan Web Worker minimax (maksimal 4 aksi, 8 kandidat per node, anggaran 1.500 ms) tanpa dependensi server eksternal.
   - Backend web adalah static assets (HTML/JS/CSS) yang dapat dideploy di Shared Hosting cPanel, Cloudflare Pages, atau Nginx statis.
2. **Dual-Stack Monorepo:**
   - `packages/ml-engine/`: Pipeline Python lokal untuk ekstraksi data, audit bukti skill & review proposal profil taktis, dan kompilasi dataset berversi SHA-256 ke `apps/web/public/`.
   - `apps/web/`: Single Page Application (SPA) berbasis Vite, React 19, TypeScript, dan Tailwind CSS.
3. **Multi-Source Data Ingestion:**
   - Data 120 hero Global dari `https://hok.kurohiko.id/` (alasan taktis lokal & counter matrix).
   - Data statistik tier Diamond+ dari `https://www.hokfire.com/` (builds, arcana, tier resmi S/A/B/C/D).
   - Panduan skill, preset build alternatif, detail item/spell, dan matchup editorial dari HoKStats melalui importer offline. Sumber ini tetap terpisah, beratribusi, dan memerlukan review untuk memengaruhi scorer.
   - Data empiris 11.141+ game turnamen profesional (KPL & cup pro CN 2019–2026) dari submodule `data/raw/kpl-bp-dataset` ([Fire-Phoenixs/kpl-bp-dataset](https://github.com/Fire-Phoenixs/kpl-bp-dataset), frekuensi pick B1/R1, ban fase 1/2, dan duet winrate).

---

## 2. Standar Lingkungan & Perkakas (Wajib Diikuti)

Setiap agen yang mengeksekusi perintah shell **WAJIB** mematuhi aturan berikut:

### A. Python & Manajemen Package (`uv`)
- Lingkungan mesin ini menggunakan **`uv`** sebagai tool manager, virtualenv, dan package installer tunggal.
- **DILARANG** menggunakan `pip install` global, `python -m pip`, atau `python -m venv`.
- Eksekusi skrip modul: `cd packages/ml-engine && uv run <script.py>`.
- Eksekusi skrip ad-hoc / lepas: Gunakan flag `--with`:
  ```powershell
  uv run --with httpx python scratch/check_source.py
  ```
- Eksekusi CLI global: Jalankan instan via `uvx <package>` atau terisolasi via `uv tool install <package>`.

### B. Shell & PowerShell Safety (Windows)
- Lingkungan command prompt adalah **PowerShell on Windows**.
- **DILARANG** memasukkan teks multiline markdown atau teks panjang dengan format kompleks secara inline ke parameter CLI (misal: `gh pr create --body "..."`). Karakter `$`, backtick, dan escape sequence dapat terdistorsi oleh parser PowerShell.
- **WAJIB** menulis ke file temporary terlebih dahulu (`temp_body.md`), jalankan dengan argumen file (`--body-file "temp_body.md"`), lalu hapus file temporary setelah selesai.

### C. Local Dev Stack (bebas tooling — jangan asumsikan tool tertentu)
- Proyek ini **tidak punya backend atau server aplikasi**. `apps/web` adalah SPA statis (Vite + React) dan `packages/ml-engine` adalah pipeline Python lokal yang menulis SQLite. Tidak ada PHP, tidak ada database server, tidak ada proses long-running.
- **Development frontend (jalur utama, tanpa tooling khusus):**
  ```powershell
  cd apps/web
  npm ci
  npm run dev        # http://localhost:3000 (port diatur di vite.config.ts)
  ```
- **Verifikasi build produksi:** `cd apps/web && npm run build` → menghasilkan `apps/web/dist/` dan menjalankan `tests/verify-dist.mjs`. Ini satu-satunya artefak yang perlu disajikan untuk uji manual.
- **Menyajikan `dist/` boleh pakai apa saja:** `npx serve dist`, `python -m http.server`, nginx/apache, cPanel, Cloudflare Pages, atau local dev stack pihak ketiga (Flock, EnvKit, Herd, Laragon, Laravel Sail, dsb.) **jika contributor memang memakainya**. Jangan menulis instruksi yang mengharuskan salah satu tool tersebut, dan jangan menganggap URL `*.test` selalu tersedia.
- Bila menyajikan `dist/` di luar `npm run dev`, pertahankan header dari `vite.config.ts` (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`) agar perilaku `crossOriginIsolated` sama.
- Worker minimax hanya berjalan di secure context — `localhost`/`127.0.0.1` aman, membuka `index.html` langsung via `file://` tidak didukung.
- Database proyek hanyalah **SQLite** hasil pipeline di `data/processed/hok_drafts.db` (gitignored, dibangun ulang dengan `uv run 1_ingest_kpl.py`). MySQL/Postgres dari tool lokal tidak dipakai.
- Saat melaporkan masalah, sebutkan tool/versi yang dipakai (`npm`, `uv`, port, URL lokal) agar bisa direproduksi di mesin lain.

---

## 3. Navigasi Knowledge Graph (`graphify`)

Repositori ini telah dipetakan secara terstruktur menggunakan **`graphify`** ke dalam direktori `graphify-out/`:
- **Interactive Graph:** [`graphify-out/graph.html`](graphify-out/graph.html)
- **GraphRAG JSON:** [`graphify-out/graph.json`](graphify-out/graph.json)
- **Executive Report:** [`graphify-out/GRAPH_REPORT.md`](graphify-out/GRAPH_REPORT.md)
- **Agent Wiki:** [`graphify-out/wiki/index.md`](graphify-out/wiki/index.md)

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
| `runTournamentInference()` | 7 edges | [`apps/web/src/engine/tournamentInference.ts`](apps/web/src/engine/tournamentInference.ts) | Decision core kalkulasi 4-fase turnamen & skor rekomendasi. |
| `loadTournamentDataset()` | — | [`apps/web/src/engine/heroDataLoader.ts`](apps/web/src/engine/heroDataLoader.ts) | Loader paket berversi, checksum, fallback, dan cache IndexedDB atomik. |
| `isHeroGlobalReleased()` | 7 edges | [`apps/web/src/data/heroReleaseStatus.ts`](apps/web/src/data/heroReleaseStatus.ts) | Filter integritas server Global vs hero eksklusif CN/KPL. |
| `TacticalVector` | 7 edges | [`apps/web/src/types.ts`](apps/web/src/types.ts) | Vektor 7 sumbu radar taktis, termasuk team utility. |

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
- **DILARANG** merekomendasikan Luban No.7 atau hero immobile ini sebagai First Pick (Blue B1) atau Ban Prioritas Fase 1. Di [`apps/web/src/engine/tournamentInference.ts`](apps/web/src/engine/tournamentInference.ts), terdapat penalti khusus `openerPenalty = -2.5` dan sanksi `-2.0` pada Step 0–4 untuk mencegah anomali ini.
- Meta Openers sah untuk B1 First Pick: **Liang, Haya, Dun, Ao'yin, Augran, Marco Polo, Lady Sun**.

### C. Hero Rilis Global vs Eksklusif CN
- HoK Global belum merilis seluruh hero dari King's Glory (CN).
- Status rilis setiap hero ditinjau di `data/mappings/hero_release_status.json`, lalu diterbitkan dalam dataset. `isHeroGlobalReleased()` membaca flag dataset; status yang belum diketahui ditolak. ID 511 selalu merupakan alias tidak aktif untuk Ata 556.
- **Zhu Bajie (#511)** telah di-merge ke **Ata (#556)** di Global Server. Seluruh data 1.701 match KPL dan sinergi duet turnamen telah dialihkan ke ID 556. ID 511 tidak aktif di katalog.
- Toggle `🌐 Rilis Global (Aktif)` di UI wajib memfilter hero non-global agar tidak muncul di rekomendasi draft.

### D. Paket Data dan Cache
- Loader memeriksa `data_manifest.json` saat aplikasi dibuka dan memvalidasi SHA-256 seluruh artefak sebelum mengaktifkan paket.
- Manifest schema v2 dan cache `tournament_dataset_v17` menyimpan paket hero, sinergi, status rilis, item, dan spell; versi dataset berubah otomatis ketika isi artefak berubah.
- Jalankan `uv run hokstats_source.py sync` dari `packages/ml-engine` untuk mengimpor HoKStats. Matchup, hero guide, item, dan spell tetap berstatus pending sampai sumbernya direview; hash yang berubah membatalkan review lama.
- Jangan mengedit JSON di folder datasets secara manual. Perbarui sumber di data/mappings lalu jalankan `uv run publish_data.py`. Byte artefak dilindungi oleh .gitattributes.
- Seri latihan memakai snapshot tetap. Data baru hanya berlaku saat memulai seri berikutnya.
- Profil taktis hero (29 tag crowd control, mobilitas, frontline/peel, dan kerentanan) diekstraksi secara deterministik dari deskripsi skill resmi dan panduan taktis melalui `skill_evidence_audit.py` (atau `tactical_profiles.py audit-batch`) secara lokal tanpa layanan eksternal.
- Setiap proposal taktis menyimpan sumber resmi, hash konten, dan status review. Proposal harus berstatus approved untuk dikompilasi ke dataset produksi; status pending/rejected diabaikan oleh publisher.
- Jika data sumber hero berubah (misal revisi skill atau update patch), hash sumber berubah dan secara otomatis membatalkan approval lama hingga ditinjau kembali.

### E. Invarian Latihan dan Pencarian
- Urutan 18 aksi, fase, dan validasi terpusat di draftRules.ts. Terapkan aksi melalui fungsi bersama, termasuk dari kartu, rekomendasi, dan drawer.
- AI hanya menerima state publik, riwayat Fearless, dan Plan A/B miliknya; jangan kirim rencana pemain ke worker.
- Setiap hasil worker harus cocok dengan sessionId dan revision. Reset, undo, atau pergantian mode/game membatalkan pekerjaan tertunda.
- Undo latihan menghapus keputusan pemain terakhir beserta semua respons AI sesudahnya. Game terdahulu bersifat read-only setelah game berikutnya dimulai.
- Bantuan nonaktif menyembunyikan rekomendasi, badge, sortir AI, radar, dan petunjuk taktis selama draft. Wiki tetap dapat dibaca.
- Skor radar dan ranking adalah heuristik, bukan probabilitas kemenangan terkalibrasi.

---

## 5. Alur Kerja & Perintah Pemeliharaan Rutin

### A. Membangun & Memperbarui Frontend Statis:
```powershell
# 1. Pindah ke direktori web
cd apps/web

# 2. Build TypeScript & Vite bundle
npm.cmd run build

# Vite menyalin public assets ke dist secara otomatis.
```

### B. Publikasi Paket Dataset ke Frontend Statis:
```powershell
cd packages/ml-engine
uv run publish_data.py
```

### C. Menjalankan Uji Simulasi Draft AI:
Untuk memverifikasi bahwa rekomendasi Fase Ban dan Pick AI berjalan sesuai kaidah kompetitif:
```powershell
cd packages/ml-engine
uv run python -m unittest test_data_pipeline.py test_skill_evidence_audit.py test_hokstats_source.py
# Dari apps/web: npm.cmd test dan npm.cmd run benchmark
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
│   └── wiki/                         # Artikel wiki struktur sistem
├── data/
│   ├── raw/kpl-bp-dataset/           # 11.141 match turnamen KPL mentah
│   ├── assets/heroes/                # 128x128 webp potret hero
│   ├── mappings/
│   │   └── master_heroes_global.json # Canonical 120 hero Global + stats & counters
│   └── processed/
│       ├── hok_drafts.db             # Database SQLite KPL Fearless draft
│       └── hero_metadata.json        # Database metadata client siap saji
├── packages/
│   └── ml-engine/                    # Pipeline ekstraksi data & audit bukti skill (uv)
│       ├── 0_sync_global_assets.py   # Scraper Kurohiko & HOKFIRE
│       ├── hokstats_source.py        # Importer offline hero/item/spell/matchup HoKStats
│       ├── 1_ingest_kpl.py           # Ingestion database KPL
│       ├── extract_kpl_synergy.py    # Ekstraksi sinergi duet & matriks turnamen KPL
│       ├── tactical_profiles.py      # Ekstraksi profil taktis, audit proposal batch & CLI review
│       ├── skill_evidence_audit.py   # Parser deterministik bukti skill resmi & 29 tag taktis
│       └── publish_data.py           # Paket produksi berversi + publikasi manifest terakhir
└── apps/
    └── web/                          # Static Frontend SPA (Vite + React 19 + TS)
        ├── public/                   # Asset statis & paket dataset berversi
        ├── dist/                     # Hasil build produksi siap upload
        └── src/
            ├── engine/
            │   ├── tournamentInference.ts   # Mesin inferensi taktis 4 fase turnamen
            │   └── heroDataLoader.ts  # Loader dataset atomik + IndexedDB cache
            ├── components/
            │   ├── DraftSimulator.tsx# Board draft 5v5 Blue vs Red
            │   ├── TacticalRadarPanel.tsx # Visualisasi radar taktis 6 dimensi
            │   └── HeroWikiDrawer.tsx# Sidebar informasi hero, counters & sinergi KPL
            ├── data/
            │   └── heroReleaseStatus.ts # Pemetaan whitelist hero rilis Global
            └── App.tsx               # Orchestrator aplikasi utama
```
