# HoK Draft Engine

Simulator draft, latihan melawan AI, analisis game plan pasca-draft, counter lookup, dan wiki hero **Honor of Kings Global**. Frontend React/TypeScript berjalan pada static hosting; keputusan draft dihitung di browser pengguna.

## Cara kerja mesin draft

Sistem ini dirancang dengan pendekatan **zero-server compute di produksi**, menjalankan kalkulasi taktis deterministik dan pencarian Minimax langsung di browser pengguna.

| Bagian | Peran |
|---|---|
| Aturan & Solver Flex Lane ([draftRules.ts](apps/web/src/engine/draftRules.ts)) | Mengunci urutan 18 aksi, validasi Fearless/Global, serta `assignHeroLanes` berbasis lane primer, flex resmi, dan distribusi flex pro KPL. |
| Mesin Taktis TypeScript ([tournamentInference.ts](apps/web/src/engine/tournamentInference.ts)) | Menghitung bobot ranking instan dari 4 fase turnamen, presensi KPL, sinergi duet, okupansi lane fleksibel, dan matriks counter. |
| Pencarian Minimax Web Worker ([draftSearch.ts](apps/web/src/engine/draftSearch.ts)) | Membandingkan pohon keputusan zero-sum kedua tim via Iterative Deepening Minimax (Depth 1..4, Width 8 cabang, batas 1.500 ms). |
| Mesin Game Plan Pasca-Draft ([gamePlan.ts](apps/web/src/engine/gamePlan.ts)) | Menilai matchup 5v5 (konteks Roam 2v2 & swap `<04:00`/re-swap `04:00`), kurva tempo KPL zero-sum, syarat menang/kalah, rute jungle, anti-invade, dan prioritas gank. |
| Pipeline Audit Bukti Skill ([skill_evidence_audit.py](packages/ml-engine/skill_evidence_audit.py)) | Ekstraksi bukti skill resmi dan panduan taktis untuk memvalidasi 29 tag mobilitas, crowd control, dan peran tim. |
| Sinergi & Tempo Empiris KPL ([extract_kpl_synergy.py](packages/ml-engine/extract_kpl_synergy.py)) | Menghitung frekuensi pick B1/R1, ban fase 1/2 tersaring Global, winrate duet, kurva tempo (Early/Mid/Late), dan flex lane (`year >= 2024`) dari 11.141+ game turnamen pro KPL & CN 2019–2026 ([Fire-Phoenixs/kpl-bp-dataset](https://github.com/Fire-Phoenixs/kpl-bp-dataset)). |

### Diagram Arsitektur Alur Keputusan (Decision Pipeline)

```mermaid
flowchart TD
    subgraph ClientState["1. State Giliran Draft (Client)"]
        A["Input Turn (Step 0..17, Blue / Red)"] --> B["Analisis Okupansi Lane & Fearless BP"]
        B --> C["Evaluasi Paparan Counter Lawan (Exposure)"]
    end

    subgraph InferenceEngine["2. Mesin Inferensi Taktis (tournamentInference.ts)"]
        C --> D{"Deteksi 4 Fase Turnamen"}
        D -->|Fase 1: Ban 1| E1["Pre-Ban Counter B1 / Deny S-Tier"]
        D -->|Fase 2: Pick 1| E2["Amankan Opener B1 & Sinergi Duet KPL"]
        D -->|Fase 3: Ban 2| E3["Putus Kombo Lane Kosong Musuh & Proteksi Core"]
        D -->|Fase 4: Pick 2| E4["Penutup Lane Kosong & R5 Counter-Pick"]
        
        E1 --> F["Normalisasi Skor Softmax"]
        E2 --> F
        E3 --> F
        E4 --> F
    end

    subgraph SearchWorker["3. Pencarian Minimax (draftSearch.ts @ Web Worker)"]
        F --> G["Shortlist 8 Kandidat Teratas (Width 8)"]
        G --> H["Iterative Deepening Minimax (Depth 1..4)"]
        H --> I["Evaluasi Posisi Asimetris: Strength(Kita) - Strength(Musuh)"]
        I --> J["Alpha-Beta Pruning (Batas Waktu 1.500 ms)"]
    end

    J --> K["Rekomendasi AI Terbaik & Variasi Utama (PV)"]
```

### Format Pertandingan: Turnamen & Ranked

Aplikasi mendukung dua format draft kompetitif yang terintegrasi penuh di mode Simulator maupun Latihan vs AI:

#### 1. Format Turnamen Kompetitif (18 Aksi / 4 Fase)
Format standar turnamen resmi KPL / Global:

```mermaid
flowchart LR
    subgraph P1["Fase 1: Ban 1 (Langkah 0-3)"]
        B1["Blue Ban 1"] --> R1["Red Ban 1"]
        R1 --> B2["Blue Ban 2"]
        B2 --> R2["Red Ban 2"]
    end

    subgraph P2["Fase 2: Pick 1 (Langkah 4-9)"]
        R2 --> BP1["Blue Pick B1"]
        BP1 --> RP1["Red Pick R1+R2"]
        RP1 --> BP2["Blue Pick B2+B3"]
        BP2 --> RP2["Red Pick R3"]
    end

    subgraph P3["Fase 3: Ban 2 (Langkah 10-13)"]
        RP2 --> RB1["Red Ban 3"]
        RB1 --> BB1["Blue Ban 3"]
        BB1 --> RB2["Red Ban 4"]
        RB2 --> BB2["Blue Ban 4"]
    end

    subgraph P4["Fase 4: Pick 2 (Langkah 14-17)"]
        BB2 --> RP3["Red Pick R4"]
        RP3 --> BP3["Blue Pick B4+B5"]
        BP3 --> RP4["Red Pick R5 (Last Pick)"]
    end
```

#### 2. Format Ranked Match (16 Aksi / 2 Fase)
Format ranked publik Diamond+:
- **Fase 1: Blind Ban Simultan (Langkah 0–5):** Masing-masing tim melakukan 3 ban secara tertutup tanpa mengetahui ban lawan. Kedua tim dapat mem-ban hero yang sama (cross-team overlap diizinkan, tetapi dilarang ban ganda di tim yang sama).
- **Fase 2: Pick Bergiliran (Langkah 6–15):** Urutan pick standar: `B1` $\to$ `R1 + R2` $\to$ `B2 + B3` $\to$ `R3 + R4` $\to$ `B4 + B5` $\to$ `R5`. Hero yang di-ban oleh tim mana pun tidak dapat di-pick.

### Logika Taktis Kompetitif Utama

1. **Fase Ban 1 (Pre-Ban & Deny First Pick):**
   - **Sisi Blue:** Mengamankan First-Pick B1 (Plan A/B). Blue dilarang mem-ban opener rencananya sendiri, melainkan mem-ban hero hard counter alaminya berdasarkan data pre-ban turnamen KPL.
   - **Sisi Red:** Karena Blue memegang First-Pick B1, Red fokus mem-ban S-Tier opener Blue (*Deny B1 Blue*) atau mengamankan core respon R1+R2 miliknya.
2. **Fase Pick 1 (Opener & Sinergi KPL):**
   - **Filter Anti-Immobile Carry:** Hero carry tanpa skill escape (Luban No.7, Hou Yi, Angela, Daji, Milady) dikenakan penalti keras `-2.0` sampai `-2.5` agar tidak direkomendasikan pada pick pembuka (B1/R1/R2) karena sangat rentan terhadap komposisi dive turnamen.
   - **Sinergi Duet KPL:** Menghitung bonus `synergy_lift` untuk pasangan hero yang memiliki riwayat $\ge 20$ match dan winrate $\ge 50\%$ di KPL.
3. **Fase Ban 2 (Break Enemy Combo & Strictly Lane-Aware):**
   - Musuh telah memiliki 3 hero di Fase 1 (menyisakan 2 lane kosong). Mesin menyisir kandidat hero yang *bisa mengisi 2 lane kosong musuh* dan memiliki sinergi tinggi dengan 3 hero musuh yang sudah ada, lalu merekomendasikan ban untuk memutus kombo tersebut sebelum musuh sempat melengkapinya.
   - Penalti keras `-2.40` diberikan jika pengguna mencoba mem-ban hero di lane yang sudah diisi musuh (*anti-wasted ban*).
4. **Fase Pick 2 (Penutup Komposisi & Counter Pick):**
   - Memastikan sisa lane kosong terisi tanpa duplikasi role.
   - Langkah 17 (Red Pick R5) mendapat bobot counter tertinggi (`+0.70`) sebagai *Last Counter-Pick* penutup draft.
5. **Peredam Paparan Counter Musuh (`evaluateEnemyCounterExposure`):**
   - Mencegah algoritma memaksakan rekomendasi hero bersinergi tinggi jika hero tersebut menjadi target empuk musuh:
     - 1 counter musuh: Penalti `-0.55`, bobot sinergi KPL diredam ke **55%**.
     - 2 counter musuh: Penalti `-1.45`, bobot sinergi KPL diredam ke **10%**.
     - 3+ counter musuh: Penalti `-2.60+`, bobot sinergi KPL dipotong menjadi **0%**.
6. **Mekanisme Deny Pick & Pemetaan Flex Dinamis:**
   - Evaluasi Minimax bekerja zero-sum: $\text{Strength}(\text{Kita}) - \text{Strength}(\text{Musuh})$.
   - Ketika AI mengambil hero kunci lawan, nilai tree musuh di masa depan anjlok drastis. Akibatnya, Minimax secara alami memprioritaskan *Deny Pick* jika langkah tersebut memberikan keuntungan posisi ganda (memperkuat tim sendiri sekaligus memotong opsi terbaik lawan).
   - Evaluasi okupansi lane di `PICK_PHASE_1`, `BAN_PHASE_2`, `PICK_PHASE_2`, serta `draftSearch.ts` menggunakan `assignHeroLanes` sehingga hero fleksibel (seperti flex resmi atau flex pro KPL `>= 20` game dengan share `>= 15%`) otomatis menggeser penugasan tim tanpa penalti duplikasi lane palsu.

## Game Plan Pasca-Draft, Winning Condition & Simulator Swap

Setelah 18 aksi draft selesai (baik di mode Simulator maupun di akhir game Latihan vs AI), [`PostDraftGamePlanPanel.tsx`](apps/web/src/components/PostDraftGamePlanPanel.tsx) dan [`gamePlan.ts`](apps/web/src/engine/gamePlan.ts) menyajikan evaluasi taktis pasca-draft dari perspektif **Tim Blue** maupun **Tim Red**:

1. **Peta Lane & Simulator Swap 5v5 (`00:00–04:00` + Re-Swap `04:00`):**
   - Menugaskan 5 hero ke `Clash`, `Jungle`, `Mid`, `Farm`, `Roam` (`primer = 100`, `flex resmi = 40+`, `flex KPL = 20 + share * 10`) dan menandai kartu papan draft (`DraftSimulator.tsx`) dengan lencana `Swap` jika hero digeser dari lane primernya.
   - Evaluasi `Mid` & `Farm` memperhitungkan perlindungan **konteks Roam 2v2** (`TERTOLONG_ROAM`) agar hero solo yang tertahan oleh dukungan Roam tidak dipaksa swap taktis yang merugikan makro.
   - Memisahkan `PRIMARY`, `OFFICIAL_FLEX`, `KPL_PRO_FLEX`, dan `TACTICAL_SWAP`. Usulan swap taktis pra-`04:00` hanya diizinkan antar-laner (`Clash`/`Mid`/`Farm`), sedangkan pertukaran yang melibatkan `Roam` atau `Jungle` ditolak kecuali kedua hero valid flex resmi/KPL (swap manual non-flex memicu penalti makro dan label `SWAP_BERISIKO` plus instruksi re-swap setelah menit `04:00`).
2. **Kurva Tempo KPL (Zero-Sum) & Winning Condition:**
   - Memakai **132** kurva winrate empiris KPL (`>= 15` game valid dengan tiga jendela `Early <15m`, `Mid 15–19m`, `Late >=19m`) dengan fallback `profile_estimate` (`Estimasi Profil (KPL minim)`) untuk hero ber-sampel minim.
   - `relativeShares` menormalisasi pangsa tempo relatif kedua tim langsung dari rata-rata winrate fase tanpa pembulatan ganda sehingga persentase dan bilah split selalu berjumlah **100%**, disertai keterangan rata-rata WR fase hero mentah (heuristik, bukan probabilitas kemenangan terkalibrasi).
   - Merangkum arketipe komposisi, syarat menang/kalah utama, dan checklist item counter ancaman lawan.
3. **Pola Start Jungle, Anti-Invade & Gold-Sharing Pra-04:00:**
   - Menentukan kuadran pembukaan (`Strongside` vs `Weakside`), beralih ke protokol `SAFE_SPLIT_OR_GUARD` (*Split-Map Vertical Trade*) jika trio awal lawan berisiko invasi Lv 1–2, serta menyusun rencana *Gold-Sharing* pra-`04:00`, prioritas gank lane, dan fokus objektif `Tyrant` / `Overlord` pada menit `04:00`.

## Simulator dan latihan

- **Simulator:** pengguna mengendalikan kedua tim dan dapat memilih format pertandingan (**Turnamen** atau **Ranked**), serta mengatur Plan A/B masing-masing.
- **Latihan vs AI:** pilih format (Turnamen/Ranked) dan sisi (Blue/Red); AI menjalankan ban/pick tim lawan secara otomatis. Sisi tetap sepanjang seri, maksimal lima game (Fearless tersedia pada format Turnamen).
- **Filter Roster Hero (Global vs Global + CN):** tombol toggle di header navigasi dapat digunakan di seluruh mode (Simulator, Latihan vs AI, Counter Lookup, dan Wiki). Pengguna dapat memilih untuk fokus hanya pada hero rilis Global atau membuka katalog hero server CN.
- **Bantuan opsional:** rekomendasi, radar, badge peringkat, dan sortir AI (serta indikator lane di papan draft) disembunyikan selama latihan berlangsung bila bantuan nonaktif. Wiki dan statistik hero tetap tersedia.
- **Fearless per tim:** pada format Turnamen dengan opsi Fearless aktif, hero yang sudah dipilih suatu tim pada game sebelumnya terkunci untuk pick tim tersebut. Ban tetap mengikuti ketersediaan pada game aktif.
- **Undo latihan:** kembali ke sebelum keputusan pemain terakhir, termasuk membuang respons AI sesudahnya (termasuk reset override lane swap). Game terdahulu menjadi ulasan setelah game berikutnya dimulai.
- **Evaluasi akhir:** menampilkan komposisi kedua tim, panel `Game Plan & Winning Condition` beserta simulator swap lane interaktif, dan alternatif keputusan; tidak menetapkan pemenang pertandingan.

Aturan bersama berada di `apps/web/src/engine/draftRules.ts`. Aplikasi mendukung dua format: **Turnamen (18 aksi)** dan **Ranked (16 aksi)**. Reset, undo, dan pergantian mode/game membatalkan keputusan AI yang tertunda. Worker tidak menerima Plan A/B pemain.

## Sumber dan integritas data

- **Kurohiko:** katalog hero, relasi counter, dan alasan taktis komunitas.
- **HOKFIRE:** statistik, build, arcana, skill, dan referensi matchup.
- **HoKStats:** panduan skill/draft, preset build alternatif, detail item/spell, dan matchup editorial. Data disimpan terpisah dari HOKFIRE/KPL dan tidak otomatis menjadi sinyal ranking sebelum ditinjau.
- **Dataset KPL/CN Pro ([Fire-Phoenixs/kpl-bp-dataset](https://github.com/Fire-Phoenixs/kpl-bp-dataset)):** frekuensi opener, ban, serta sinergi empiris (submodule `data/raw/kpl-bp-dataset`, CC BY-NC 4.0). Data historis CN tidak otomatis mewakili meta Global saat ini.

`hero.counters` berisi hero **yang di-counter oleh hero tersebut**. `hero.countered_by` berisi hero **yang meng-counter hero tersebut**. Arah ini tidak boleh dibalik.

Status rilis ditinjau di `data/mappings/hero_release_status.json`. Hero tanpa status eksplisit belum dapat digunakan. ID 511 tetap menjadi alias tidak aktif untuk **Ata 556**. Hero immobile yang ditandai sebagai opener berisiko tidak masuk rekomendasi B1 atau ban fase pertama.

## Menjalankan aplikasi & setup contributor

Gunakan **Git**, **Node.js 24+**, dan **Python 3.13+** yang dikelola melalui **[`uv`](https://docs.astral.sh/uv/)** (ikuti [`packages/ml-engine/pyproject.toml`](packages/ml-engine/pyproject.toml)).

### Clone & Bootstrap Cepat

Data mentah turnamen berada pada Git submodule [`data/raw/kpl-bp-dataset`](data/raw/kpl-bp-dataset). Untuk contributor penuh maupun frontend-only, lihat panduan lengkap di **[CONTRIBUTING.md](CONTRIBUTING.md)**.

```powershell
# Clone beserta submodule dataset KPL
git clone --recurse-submodules https://github.com/Andndre/hok-draft-engine.git
cd hok-draft-engine

# Atau jika sudah terlanjur clone biasa:
uv run scripts/setup.py --verify

# Contributor UI saja (tanpa perlu Python/uv atau dataset mentah 39.5 MB):
uv run scripts/setup.py --web-only --verify
```

```powershell
cd apps/web
npm.cmd ci
npm.cmd run dev

# Build statis; Vite menyalin isi public secara otomatis
npm.cmd run build
npm.cmd run preview
```

Deploy isi `apps/web/dist/` ke static hosting (atau otomatis ke Hostinger via `.github/workflows/deploy.yml`). Distribusi produksi menyajikan aplikasi statis, dataset versi manifest, dan aset gambar langsung dari origin yang sama (`chunks/` dan `datasets/` immutable). Lihat [`LICENSE`](LICENSE) dan [`NOTICE`](NOTICE) untuk lisensi kode (MIT) serta atribusi dataset turunan KPL (CC BY-NC 4.0).

## Memperbarui hero dan metadata

1. Perbarui sumber hero/statistik/counter dan sinergi di `data/mappings/` melalui pipeline scraper/ekstraktor atau koreksi yang ditinjau.
2. Untuk memperbarui data HoKStats, jalankan importer lokal. Ia membuat coverage report, mencatat sumber/tanggal/patch, dan mengabaikan matchup yang tidak bisa dicocokkan ke katalog hero.

```powershell
cd packages/ml-engine
uv run hokstats_source.py sync

# Tinjau sumber hero, matchup, item, atau spell sebelum dipakai scorer
uv run hokstats_source.py review-guide --hero-id 640 --reviewer "Nama reviewer" --status approved
uv run hokstats_source.py review-matchup --hero-id 640 --relation strong_against --target-id 126 --reviewer "Nama reviewer" --status approved
uv run hokstats_source.py review-catalog --kind item --record-id 1127 --reviewer "Nama reviewer" --status approved

uv run publish_data.py
```

Importer mempertahankan review hanya selama hash sumber cocok. Relasi `strong_against` berarti hero tersebut meng-counter target; `countered_by` berarti hero itu terancam oleh target. Record tanpa bukti tidak dianggap sebagai relasi negatif.

3. Tambahkan atau perbarui status rilis setiap hero pada `hero_release_status.json`. Tinjau kemampuan lane, arah counter, dan mapping Global; pertahankan alias Ata.
4. Bila perlu, audit dan tinjau proposal profil taktis seperti contoh di bawah.
5. Bangun paket data:

```powershell
cd packages/ml-engine
uv run publish_data.py
```

`publish_data.py` menghasilkan manifest schema v2 dan folder `datasets/<versi>/` di `apps/web/public/`. Paket berisi metadata hero, sinergi, status rilis, katalog item, dan katalog spell; semua artefak divalidasi dengan SHA-256 dan disebar secara atomik oleh workflow deploy statis.

Browser memeriksa manifest saat aplikasi dibuka, memvalidasi seluruh artefak, lalu menyimpan satu paket lengkap pada cache IndexedDB `tournament_dataset_v17`. Tidak ada fetch HoKStats atau panggilan API eksternal saat runtime. Jika pembaruan gagal, browser memakai paket valid terakhir atau paket bawaan. Jangan mengedit artefak hasil publikasi secara manual karena checksum akan berubah.

Seri latihan mempertahankan snapshot dataset sampai selesai. Saat memulai seri baru, aplikasi memeriksa pembaruan lagi. Penambahan hero dan perubahan status rilis tidak memerlukan perubahan kode atau whitelist TypeScript.

## Profil taktis dan audit bukti skill lokal

Pipeline taktis memakai **ekstraksi bukti skill deterministik** (`skill_evidence_audit.py` dan `tactical_profiles.py audit-batch`) yang membaca deskripsi skill resmi, role, serta panduan taktis hero secara 100% lokal dan deterministik di komputer pengelola tanpa memerlukan GPU atau layanan eksternal.

### Audit batch hero Global

Untuk mengekstrak bukti skill, mengisi 29 label taktis, dan menghasilkan proposal otomatis untuk 120 hero Global aktif:

```powershell
cd packages/ml-engine

# Audit batch 120 hero Global (auto-approve hero dengan bukti lengkap tanpa ambiguitas)
uv run tactical_profiles.py audit-batch --output-dir ../../data/mappings/tactical_proposals

# Atau audit batch tanpa auto-approve (semua tetap berstatus pending)
uv run tactical_profiles.py audit-batch --output-dir ../../data/mappings/tactical_proposals --no-auto-approve

# Proposal hero tunggal
uv run tactical_profiles.py propose --hero-id 156 --output ../../data/mappings/tactical_proposals/liang.json

# Review manual dan simpan status
uv run tactical_profiles.py review --proposal ../../data/mappings/tactical_proposals/liang.json --reviewer "Nama reviewer" --status approved

# Publikasikan dataset produksi
uv run publish_data.py
```

### Label taktis dan verifikasi bukti

Label mencakup:
- **Mobilitas:** `mobility`, `dash`, `blink`, `leap`, `teleport`
- **Crowd Control:** `suppress`, `cc_knockup`, `cc_knockback`, `cc_pull`, `cc_stun`, `cc_root`, `cc_silence`, `cc_slow`
- **Peran & Utilitas Tim:** `engage`, `disengage`, `frontline`, `peel`, `ally_shield`, `ally_heal`, `ally_move_speed_buff`, `ally_attack_speed_buff`, `ally_damage_buff`, `ally_cleanse`, `ally_cc_immunity`
- **Kerentanan:** `dive_vulnerable`, `kite_vulnerable`, `low_damage`, `weak_early`

Auditor menyaring kata negasi (seperti pasif Yaria yang mengecualikan suppress agar tidak ditandai sebagai `suppress=ya`) dan kontaminasi teks hero antar-sumber. Nilai yang tidak didukung bukti skill resmi tetap `tidak_diketahui`.

Proposal menyimpan sumber resmi, hash konten, dan status review. Publisher hanya menyertakan profil berstatus `approved` dengan SHA-256 hash sumber yang valid; perubahan pada data sumber hero otomatis membatalkan approval lama agar ditinjau ulang. Hero tanpa profil taktis approved tetap menggunakan fallback heuristik role bawaan.

**Fixture offline:** pengujian tanpa evaluasi live dapat memakai `--response-fixture <file.json>` atau `--response-fixtures-dir <dir>` untuk menguji alur pipeline.

## Pengujian dan benchmark

```powershell
cd apps/web
npm.cmd test
npm.cmd run benchmark
npm.cmd run build
```

Pengujian mencakup validasi Global/Fearless, lima game tanpa pengulangan pick per tim, matching lane flex, arah counter Liang, alias Ata, batas waktu pencarian, worker aktual melalui transport Node, pembatalan, hasil kedaluwarsa, kedua sisi pemain, pembaruan/cache paket data, serta suite pasca-draft ([gamePlan.test.mjs](apps/web/tests/gamePlan.test.mjs) dan SSR [ui.test.mjs](apps/web/tests/ui.test.mjs): normalisasi kurva tempo 100%, konteks Roam 2v2, penolakan swap non-flex ke Roam/Jungle, dan rencana anti-invade jungle).

```powershell
cd packages/ml-engine
uv run python -m unittest test_data_pipeline.py test_skill_evidence_audit.py test_hokstats_source.py
uv run export_draft_benchmark.py --cutoff 2024-01-01 --limit 24

cd ../../apps/web
npm.cmd run benchmark -- --historical ../../data/processed/draft_benchmark.json --limit 24 --output ../../data/processed/draft_benchmark_results.json
```

Benchmark membandingkan baseline dengan pencarian pada fixture taktis dan posisi KPL yang dipisahkan berdasarkan tanggal. Statistik KPL untuk benchmark dihitung hanya dari pertandingan sebelum cutoff. Pilihan historis bukan satu-satunya keputusan yang benar; angka agreement bukan estimasi kekuatan atau win rate AI. Metadata role dan statistik publik masih memakai snapshot saat ini, sehingga evaluasi ini bukan backtest meta historis yang lengkap.

Data lokal KPL 2025–2026 memakai 20 aksi. Exporter menyaring pertandingan yang cocok dengan format aplikasi 18 aksi dan roster Global; cutoff default 2024 menyediakan holdout kompatibel. Benchmark tidak mengubah aturan aplikasi menjadi 20 aksi.

Panduan agen berada di [AGENTS.md](AGENTS.md). Navigasi arsitektur dapat dimulai dari [knowledge graph](graphify-out/graph.html). Jalankan `graphify update .` setelah mengubah sumber TypeScript/Python.
