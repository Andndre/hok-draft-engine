"""
build_notebooklm_export.py
Mengompilasi seluruh informasi substantif hok-draft-engine ke dalam berkas Markdown
tematik siap impor untuk Google NotebookLM (di bawah limit 50 sumber).
"""

import json
import os
import re
from pathlib import Path

ROOT = Path("D:/hok-draft-engine")
EXPORT_DIR = ROOT / "notebooklm-export"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

print(f"Export directory: {EXPORT_DIR}")

def load_json(rel_path):
    p = ROOT / rel_path
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def read_text(rel_path):
    p = ROOT / rel_path
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return f.read()
    return ""

def write_export(filename, content):
    dest = EXPORT_DIR / filename
    with open(dest, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")
    size_kb = dest.stat().st_size / 1024
    print(f"Generated: {filename} ({size_kb:.1f} KB)")

# ==============================================================================
# 00. MASTER INDEX
# ==============================================================================
def generate_00_index():
    content = """# HoK Draft Engine — Knowledge Base Dossier untuk Google NotebookLM

> **Ringkasan Repositori & Domain:**
> `hok-draft-engine` adalah sistem simulator Draft Pick turnamen & ranked, counter matrix terarah, latihan AI minimax, dan analisis game plan pasca-draft untuk game **Honor of Kings (HoK Global)**. Sistem beroperasi dengan prinsip **zero-server compute di produksi** (seluruh inferensi taktis dan pencarian Minimax berjalan in-browser via Web Worker).

Dokumen ini adalah indeks navigasi untuk rangkaian 6 berkas pengetahuan tematik yang dirancang khusus untuk ingestion ke dalam **Google NotebookLM**. Seluruh informasi teknis, empiris, matematis, dan arsitektural proyek dikurasi ke dalam berkas-berkas berikut tanpa redundansi file biner/cache:

---

## Struktur Berkas Ekspor NotebookLM

| Berkas | Judul & Cakupan Informasi | Sumber Utama |
|---|---|---|
| **`01_ARSITEKTUR_DAN_SPESIFIKASI_ENGINE.md`** | Arsitektur Zero-Server Compute, Decision Pipeline, Format Pertandingan (Turnamen 18-step, Ranked 16-step, Game 7 Ultimate Battle), State Machine, Aturan Ketat Pengembang & Agen. | `README.md`, `AGENTS.md` (§1-§2, §4-§6) |
| **`02_METODOLOGI_DATA_KPL_DAN_ANALISIS_STATISTIK.md`** | Data 11.141+ game pro KPL/CN (2019–2026), skema database SQLite, metodologi recency 12 bulan, formula sinergi duet, matriks counter terukur KPL, dan analisis first-pick B1. | `data/raw/kpl-bp-dataset/`, `extract_kpl_synergy.py`, `extract_kpl_matchups.py`, `kpl_synergy_matrix.json` |
| **`03_METADATA_HERO_DAN_ATRIBUT_TAKTIK.md`** | Katalog 120 Hero Global, status rilis Global vs CN, semantik relasi counter anti-inversi, kritik popularity band HoK Camp, lane & flex lane KPL, dan audit bukti skill (29 tag taktis). | `hero_metadata.json`, `hero_release_status.json`, `skill_evidence_audit.py`, `tactical_proposals/` |
| **`04_LOGIKA_MATEMATIKA_DAN_ALGORITMA_PENCARIAN.md`** | Bayesian shrinkage kekuatan kompetitif, model hierarkis opener B1, pencarian Minimax Alpha-Beta (Head-Tail pass), penyelaras rekomendasi solver (advisor ranking), dan generator game plan 5v5 pasca-draft. | `tournamentInference.ts`, `draftSearch.ts`, `advisorRanking.ts`, `gamePlan.ts`, `draftRules.ts` |
| **`05_PIPELINE_COMPUTER_VISION_DAN_BENCHMARK.md`** | Lapisan computer vision in-browser (scrcpy mirror), prinsip read-only anti-cheat, NCC matcher, perbaikan circle-mask padlock ban 40%, layout manual vs regular lattice solver, dan harness draft benchmark. | `apps/web/src/vision/*`, `capture_vision_corpus.py`, `calibrate_vision_regions.py`, `draft_benchmark.json` |
| **`06_GRAPH_KNOWLEDGE_DAN_KOMUNITAS_MODUL.md`** | Laporan Graphify (1.708 node, 4.243 edge, 87 komunitas modul), analisis 10 God Nodes utama, dan dekomposisi klaster dependensi lintas-lapisan. | `graphify-out/GRAPH_REPORT.md`, `graphify-out/wiki/` |

---

## Petunjuk Penggunaan di Google NotebookLM

1. Buka [notebooklm.google.com](https://notebooklm.google.com/).
2. Buat Notebook baru, beri nama **HoK Draft Engine — Full Intelligence**.
3. Klik **Add Sources** -> Pilih **Upload Files**.
4. Unggah seluruh berkas `.md` yang berada di direktori `D:/hok-draft-engine/notebooklm-export/`.
5. Semua sumber akan terindeks rapi, siap untuk grounding tanya-jawab, penulisan analisis strategi, rekonstruksi algoritma, maupun evaluasi logika draft meta.
"""
    write_export("00_INDEX_DAN_PANDUAN_NOTEBOOKLM.md", content)

# ==============================================================================
# 01. ENGINE ARCHITECTURE & SPECS
# ==============================================================================
def generate_01_architecture():
    readme = read_text("README.md")
    agents = read_text("AGENTS.md")
    contributing = read_text("CONTRIBUTING.md")

    # Extract key sections from README
    content = f"""# 01 — Arsitektur Sistem, Spesifikasi Engine, dan Kontrak Desain

## 1. Misi & Filosofi Desain

`hok-draft-engine` adalah sistem simulator Draft Pick, Counter Matrix terarah, analisis Game Plan pasca-draft, dan Wiki Interaktif untuk **Honor of Kings (HoK Global)**.

### Prinsip Utama: Zero-Server Compute di Produksi
1. **Komputasi Berjalan 100% di Client:**
   - Seluruh evaluasi taktis, inferensi aturan turnamen, dan pencarian pohon Minimax Alpha-Beta berjalan langsung di browser pengguna via Web Worker (`opponent.worker.ts`).
   - Tidak ada backend komputasi atau server dinamis di produksi. Web hosting hanya menyajikan berkas statis (HTML/JS/CSS/JSON).
2. **Dual-Stack Monorepo:**
   - `packages/ml-engine/`: Pipeline data Python lokal (dikelola via `uv`) untuk ekstraksi data pro KPL, kalibrasi vision, audit bukti skill deterministik, dan kompilasi dataset ke `apps/web/public/`.
   - `apps/web/`: Single Page Application (SPA) berbasis Vite, React 19, TypeScript, dan Tailwind CSS.
3. **Multi-Source Data Ingestion:**
   - **Data 120 Hero Global:** `hok.kurohiko.id` (alasan taktis lokal & relasi counter awal).
   - **Data Statistik Ladder Diamond+:** HoK Camp via `hokfire.com` / `hokstats.gg` (popularity band, build item, arcana).
   - **Data Empiris Turnamen Pro KPL:** Submodule `data/raw/kpl-bp-dataset` (11.141+ game KPL & CN Cup 2019–2026, frekuensi pick/ban, winrate duet, dan rekam jejak B1).
   - **Audit Bukti Skill Deterministik:** Parsing teks skill resmi lokal untuk verifikasi atribut crowd control dan mobilitas tanpa asumsi subjektif.

---

## 2. Diagram Alur Keputusan (Decision Pipeline)

Alur keputusan rekomendasi draft beroperasi dalam 4 tahap terintegrasi:

```mermaid
flowchart TD
    subgraph ClientState["1. State Giliran Draft (Client)"]
        A["Input Giliran: Step 0..17, Sisi Blue / Red"] --> B["Analisis Okupansi Lane & Fearless BP"]
        B --> C["Evaluasi Paparan Counter Lawan (Exposure)"]
    end

    subgraph InferenceEngine["2. Filter Legalitas & Penskoringan Kandidat (tournamentInference.ts)"]
        C --> D{{"Deteksi Fase Draft"}}
        D -->|Fase 1: Ban 1| E1["Pre-Ban Counter Opener & Deny Kontestasi"]
        D -->|Fase 2: Pick 1| E2["Opener B1 / Respon R1-R2 & Sinergi Duet KPL"]
        D -->|Fase 3: Ban 2| E3["Putus Kombo Lane Kosong Lawan (Anti-Wasted Ban)"]
        D -->|Fase 4: Pick 2| E4["Penutup Komposisi Lane & Counter R5"]

        E1 --> F["Kandidat Legal Terfilter Lane & Role"]
        E2 --> F
        E3 --> F
        E4 --> F
    end

    subgraph SearchWorker["3. Penyelarasan Game-Theoretic Minimax (draftSearch.ts @ Web Worker)"]
        F --> G{{"Cek Slot Pembuka Buta?"}}
        G -->|Kedua Sisi Belum Pick| H1["Blind Opener: Depth 1 (Kunci Rekam Jejak B1)"]
        G -->|Lawan Punya Pick| H2["Pencarian Penuh: Iterative Deepening Depth 1..4"]
        H1 --> I["Head Pass: Alpha-Beta 8 Cabang Teratas"]
        H2 --> I
        I --> J["Tail Pass: Evaluasi 1-Ply Respons Lawan untuk Sisa Kandidat"]
    end

    subgraph UIOutput["4. Output Rekomendasi Terpadu (advisorRanking.ts)"]
        J --> K["Urutkan Seluruh Rekomendasi berdasar Nilai Solver"]
        K --> L["Kartu #1 = Pilihan Solver (Kecuali Plan A/B Terkunci)"]
    end
```

---

## 3. Format Pertandingan Resmi

Engine mendukung 3 format draft kompetitif:

### A. Format Turnamen Kompetitif (18 Aksi / 4 Fase)
Format standar turnamen resmi KPL / Honor of Kings Championship:

```mermaid
flowchart TD
    subgraph P1["Fase 1: Ban 1 (Langkah 0-3)"]
        direction LR
        B1["Blue Ban 1"] --> R1["Red Ban 1"] --> B2["Blue Ban 2"] --> R2["Red Ban 2"]
    end

    subgraph P2["Fase 2: Pick 1 (Langkah 4-9)"]
        direction LR
        BP1["Blue Pick B1"] --> RP1["Red Pick R1+R2"] --> BP2["Blue Pick B2+B3"] --> RP2["Red Pick R3"]
    end

    subgraph P3["Fase 3: Ban 2 (Langkah 10-13)"]
        direction LR
        RB1["Red Ban 3"] --> BB1["Blue Ban 3"] --> RB2["Red Ban 4"] --> BB2["Blue Ban 4"]
    end

    subgraph P4["Fase 4: Pick 2 (Langkah 14-17)"]
        direction LR
        RP3["Red Pick R4"] --> BP3["Blue Pick B4+B5"] --> RP4["Red Pick R5 (Last Pick)"]
    end

    R2 --> BP1
    RP2 --> RB1
    BB2 --> RP3
```

- **Fase 1 (Ban 1):** B1 ban -> R1 ban -> B2 ban -> R2 ban.
- **Fase 2 (Pick 1):** B1 pick -> R1+R2 pick -> B2+B3 pick -> R3 pick.
- **Fase 3 (Ban 2):** R3 ban -> B3 ban -> R4 ban -> B4 ban.
- **Fase 4 (Pick 2):** R4 pick -> B4+B5 pick -> R5 pick (Counter Last Pick).

### B. Format Ranked Match (16 Aksi / 2 Fase)
Format ranked publik Diamond+ / Master:
- **Fase 1: Blind Ban Simultan (Langkah 0–5):** Masing-masing tim melakukan 3 ban secara tertutup tanpa mengetahui ban lawan. Kedua tim dapat mem-ban hero yang sama (*cross-team overlap* diizinkan, tetapi dilarang ban ganda di tim yang sama).
- **Fase 2: Pick Bergiliran (Langkah 6–15):** Urutan pick standar: `B1` -> `R1 + R2` -> `B2 + B3` -> `R3 + R4` -> `B4 + B5` -> `R5`.

### C. Ultimate Battle (Game 7 BO7)
Format khusus Game 7 seri Fearless:
- Aturan Fearless BP di-reset penuh (seluruh pool hero terbuka kembali).
- Total 10 langkah aksi (Blind Pick simultan tanpa ban fase 2).

---

## 4. Invarian Pengembang & Kontrak State Machine

1. **Satu Sumber Kebenaran Urutan Draft (`draftRules.ts`):**
   - Fungsi `getDraftTurn(step, options)` adalah satu-satunya otoritas untuk menentukan giliran aktif, sisi (`blue` / `red`), jenis aksi (`ban` / `pick`), dan fase turnamen.
   - Variabel `rankedBanCount` (3, 4, atau 5 ban) dan `isUltimateBattle` wajib dipropagasi identik ke board UI, inferensi, dan worker minimax.
2. **Integritas Fearless BP:**
   - Dalam seri multi-game (BO3/BO5/BO7), hero yang telah dimainkan oleh tim pada game sebelumnya dikunci permanen untuk tim tersebut di game-game berikutnya (kecuali Game 7 Ultimate Battle).
   - Engine melarang keras rekomendasi hero yang sudah terkunci oleh aturan Fearless.
3. **Penyelarasan Solver & Plan A/B:**
   - Rekomendasi UI selalu mengurutkan kartu berdasarkan nilai posisi solver Minimax (`advisorRanking.ts`).
   - Kartu #1 otomatis menjadi **Pilihan Solver**, kecuali pengguna mengunci rencana manual (*Plan A / Plan B*).
   - Rencana pemain (Plan A/B) tidak pernah dikirim ke AI worker lawan agar tidak terjadi kebocoran informasi (*cheating prevention*).
4. **Keamanan Eksekusi Browser:**
   - Worker Minimax membutuhkan secure context (`https://` atau `localhost`).
   - Header COOP (`Cross-Origin-Opener-Policy: same-origin`) dan COEP (`Cross-Origin-Embedder-Policy: credentialless`) dikonfigurasi pada build agar runtime Web Worker memiliki isolasi memori optimal.
"""
    write_export("01_ARSITEKTUR_DAN_SPESIFIKASI_ENGINE.md", content)

def get_hero_name_map():
    name_map = {}
    # 1. from hero_metadata.json
    heroes_raw = load_json("data/processed/hero_metadata.json") or []
    if isinstance(heroes_raw, dict):
        heroes_list = list(heroes_raw.values())
    else:
        heroes_list = list(heroes_raw)
    for h in heroes_list:
        hid = h.get("hero_id")
        name = h.get("name")
        cname = h.get("chinese_name", "")
        if hid and name:
            name_map[int(hid)] = f"{name} ({cname})" if cname else name

    # 2. from kpl heroes.json
    kpl_heroes = load_json("data/raw/kpl-bp-dataset/data/heroes.json") or []
    if isinstance(kpl_heroes, list):
        for kh in kpl_heroes:
            hid = kh.get("hero_id")
            cname = kh.get("hero", "")
            if hid and int(hid) not in name_map:
                name_map[int(hid)] = f"{cname} (CN/KPL Exclusive)"
    return name_map

# ==============================================================================
# 02. KPL DATASET & STATISTICAL METHODOLOGY
# ==============================================================================
def generate_02_kpl():
    synergy = load_json("data/mappings/kpl_synergy_matrix.json") or {}
    matchups_raw = load_json("data/mappings/hero_measured_matchups.json") or {}
    name_map = get_hero_name_map()
    
    # Generate B1 Openers Markdown Table
    b1_openers = synergy.get("b1_openers", {})
    sorted_openers = sorted(
        b1_openers.items(),
        key=lambda x: x[1].get("weighted_b1_picks", x[1].get("b1_picks", 0)),
        reverse=True
    )[:30] # Top 30

    opener_table = "| ID | Hero | B1 Picks (All-Time) | Weighted Picks (12 Mo) | B1 Winrate | Weighted B1 WR | P1 Bans (All-Time) |\n"
    opener_table += "|---|---|---|---|---|---|---|\n"
    for hid, stats in sorted_openers:
        hid_int = int(hid)
        hname = name_map.get(hid_int, stats.get("name", f"Hero {hid}"))
        b1_p = stats.get("b1_picks", 0)
        wb1_p = f"{stats.get('weighted_b1_picks', 0):.1f}"
        b1_wr = f"{stats.get('b1_win_rate', 0)*100:.1f}%"
        wb1_wr = f"{stats.get('weighted_b1_win_rate', 0)*100:.1f}%"
        p1_bans = stats.get("p1_bans", 0)
        opener_table += f"| {hid} | **{hname}** | {b1_p} | {wb1_p} | {b1_wr} | {wb1_wr} | {p1_bans} |\n"

    # Top measured matchups from hero_measured_matchups.json
    all_measured = []
    heroes_matchups = matchups_raw.get("heroes", {})
    for hid_str, hdata in heroes_matchups.items():
        hid_int = int(hid_str)
        h_name = name_map.get(hid_int, f"Hero {hid_str}")
        for mc in hdata.get("measured_counters", []):
            target_id = mc.get("target_id")
            target_name = mc.get("target_name") or name_map.get(target_id, f"Hero {target_id}")
            delta = mc.get("delta", 0)
            w_delta = mc.get("weighted_delta", 0)
            n_sample = mc.get("n", 0)
            if n_sample >= 30 and delta > 0.05:
                all_measured.append({
                    "hero_a": h_name,
                    "hero_b": target_name,
                    "delta": delta,
                    "weighted_delta": w_delta,
                    "sample": n_sample
                })
    all_measured.sort(key=lambda x: x["delta"], reverse=True)
    top_matchups = all_measured[:25]

    matchup_table = "| Hero A (Unggul) | vs Hero B (Lawan) | Sampel Match | Delta WR (Paired) | Weighted Delta (12 Mo) |\n"
    matchup_table += "|---|---|---|---|---|\n"
    for m in top_matchups:
        ha = m.get("hero_a")
        hb = m.get("hero_b")
        samp = m.get("sample", 0)
        d = f"{m.get('delta', 0)*100:+.2f}%"
        wd = f"{m.get('weighted_delta', 0)*100:+.2f}%"
        matchup_table += f"| **{ha}** | {hb} | {samp} | {d} | {wd} |\n"

    latex_decay = r"$$w_i = \exp\left( - \frac{\Delta t_i}{\tau} \right)$$"
    latex_wr = r"$$WR_{weighted} = \frac{\sum w_i \cdot y_i}{\sum w_i}$$"
    latex_n = r"$$N_{weighted} = \sum w_i$$"
    latex_delta = r"$$\Delta(A, B) = WR(A \mid B \text{ di tim lawan}) - WR(A \mid B \text{ absen dari draft})$$"

    content = f"""# 02 — Metodologi Dataset KPL dan Analisis Statistik Turnamen

## 1. Cakupan & Integritas Dataset KPL

Data turnamen profesional Honor of Kings diambil dari arsip resmi turnamen King Pro League (KPL) dan kompetisi pro utama China (Honor of Kings Challenger Cup, World Champion Cup, KPL Spring/Summer/Annual Finals) periode **2019 hingga 2026**.

### Ringkasan Korpus:
- **Jumlah Turnamen Resmi:** 33 turnamen
- **Rentang Tahun:** 2019 – 2026
- **Total Seri Pertandingan (Matches/BO):** 2.887 seri
- **Total Game Individual:** 11.141 game
- **Game dengan BP Lengkap (10 pick, 8-10 ban):** 9.817 game (basis kalkulasi statistik)
- **Aksi Draft Terdata:** 85.442 aksi ban + 98.170 aksi pick
- **Jumlah Hero Kompetitif Unik:** 133 hero
- **Jumlah Tim Profesional:** 83 tim

---

## 2. Skema Database SQLite (`hok_drafts.db`)

Dataset KPL distrukturkan ke dalam database relasional lokal dengan arsitektur tabel utama:

```sql
-- 1. Turnamen / Liga
CREATE TABLE leagues (
    league_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    season TEXT,
    tier TEXT
);

-- 2. Seri Pertandingan (BO3 / BO5 / BO7)
CREATE TABLE matches (
    match_id INTEGER PRIMARY KEY,
    league_id INTEGER REFERENCES leagues(league_id),
    home_team_id INTEGER,
    away_team_id INTEGER,
    match_time TEXT,
    bo_type INTEGER
);

-- 3. Game Individual
CREATE TABLE battles (
    battle_id INTEGER PRIMARY KEY,
    match_id INTEGER REFERENCES matches(match_id),
    game_num INTEGER,
    blue_team_id INTEGER,
    red_team_id INTEGER,
    winner_side TEXT CHECK (winner_side IN ('blue', 'red')),
    duration_seconds INTEGER,
    complete BOOLEAN NOT NULL -- 1 jika 10 pick & 8/10 ban lengkap
);

-- 4. Aksi Draft Per-Giliran
CREATE TABLE draft_actions (
    action_id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER REFERENCES battles(battle_id),
    step_order INTEGER NOT NULL, -- urutan aksi 0..17
    side TEXT CHECK (side IN ('blue', 'red')),
    action_type TEXT CHECK (action_type IN ('ban', 'pick')),
    hero_id INTEGER NOT NULL,
    phase INTEGER -- 1..4
);

-- 5. Performa Hero
CREATE TABLE hero_stats (
    hero_id INTEGER,
    league_id INTEGER,
    picks INTEGER,
    bans INTEGER,
    wins INTEGER,
    win_rate REAL,
    ban_rate REAL,
    pick_rate REAL,
    PRIMARY KEY (hero_id, league_id)
);
```

---

## 3. Metodologi Pembobotan Recency (12 Bulan)

Format meta turnamen HoK berubah dinamis seiring patch bulanan. Menggunakan winrate all-time (2019–2026) secara mentah akan menghasilkan distorsi historis (misal: Dun memiliki 290 pick B1 all-time, namun pada 12 bulan terakhir hanya mencatatkan 50,4 pick berbobot).

### Formula Pembobotan Waktu (Exponential Decay):
Setiap pertandingan diberi bobot berdasarkan selisih hari terhadap tanggal cutoff:
{latex_decay}
di mana $\\tau = 365,25$ hari (half-life 1 tahun).

- **Weighted Win Rate:**
  {latex_wr}
  di mana $y_i \\in \\{{0, 1\\}}$ adalah indikator kemenangan hero pada game $i$.
- **Weighted Picks / Bans:**
  {latex_n}

---

## 4. Analisis Rekam Jejak First-Pick (B1 Openers)

Slot pembuka pertama sisi Blue (B1) adalah aksi paling berisiko dalam draft turnamen karena langsung terekspos terhadap respon balik 2 hero musuh (R1 & R2). Engine mengevaluasi prioritas pembuka berdasarkan performa spesifik saat di-first-pick, bukan winrate global.

### Tabel 30 Meta Openers Teratas KPL:

{opener_table}

---

## 5. Metodologi Matriks Counter & Measured Matchups

`packages/ml-engine/extract_kpl_matchups.py` mengekstraksi relasi counter empiris dari 9.817 game KPL lengkap.

### Formula Delta Winrate Terukur:
Untuk pasangan Hero A vs Hero B:
{latex_delta}

> **Catatan Metodologi Kritis:**
> Baseline wajib menggunakan kondisi *"Hero B absen dari seluruh draft"*. Jika baseline menggunakan *"Hero B di tim sendiri"*, sinergi positif akan menggelembungkan deviasi sehingga seluruh pasangan tampak negatif.
> $\\Delta(A, B) > 0$ menandakan Hero A secara empiris diuntungkan saat menghadapi Hero B.

### Aturan Hirarki Bukti (CRITICAL RULE):
1. **Bukti terukur KPL hanya boleh MENGAKUI (*confirm*) atau MENOLAK (*veto*) relasi kurasi yang sudah ada.**
2. **Data terukur DILARANG MEMBUAT relasi counter baru secara otomatis tanpa kurasi manusia.** Ini mencegah korelasi semu akibat sampel pertandingan tipis.
3. Ambang batas validasi empiris:
   - Sampel minimal: `MEASURED_MIN_SAMPLE = 30` pertandingan berpasangan.
   - Deviasi minimal: `MEASURED_MIN_DELTA = 0,02` (2 percentage points).

### Sampel Matchup Terukur KPL Terkuat:

{matchup_table}

---

## 6. Sinergi Duet KPL (Duo Synergy)

Sinergi pasangan dihitung dari frekuensi kemunculan bersama dalam satu tim profesional dan winrate kombo:
- **Baseline Duo:** Duet hero yang sering dipilih bersama di KPL (misal: Lu Bu + Sun Bin, Marco Polo + Yao, Gongsun Li + Donghuang).
- **Penalti Okupansi:** Kombo 2 hero yang memperebutkan lane yang sama (misal dua Jungler murni) otomatis diberi diskualifikasi taktis.
"""
    write_export("02_METODOLOGI_DATA_KPL_DAN_ANALISIS_STATISTIK.md", content)

# ==============================================================================
# 03. HERO METADATA & TACTICAL ATTRIBUTES
# ==============================================================================
def generate_03_hero_metadata():
    heroes_raw = load_json("data/processed/hero_metadata.json") or []
    if isinstance(heroes_raw, dict):
        hero_list = list(heroes_raw.values())
    else:
        hero_list = list(heroes_raw)
    
    # Sort heroes by name
    sorted_heroes = sorted(hero_list, key=lambda h: h.get("name", ""))

    hero_rows = []
    for h in sorted_heroes:
        hid = h.get("hero_id")
        name = h.get("name")
        cname = h.get("chinese_name", "-")
        role = h.get("primary_role", "-")
        plane = h.get("primary_lane", "-")
        lanes = ", ".join(h.get("lanes", []))
        pop = h.get("tier", "-") # popularity band
        wr = f"{h.get('win_rate', 0)*100:.1f}%" if h.get('win_rate') else "-"
        kpl_wr = f"{h.get('kpl_win_rate', 0)*100:.1f}%" if h.get('kpl_win_rate') else "-"
        counters = ", ".join([c.get("target_name", "") for c in h.get("counters", [])[:3]]) or "-"
        countered = ", ".join([c.get("counter_name", "") for c in h.get("countered_by", [])[:3]]) or "-"
        hero_rows.append(f"| {hid} | **{name}** ({cname}) | {role} | {plane} | {lanes} | {pop} | {wr} | {kpl_wr} | {counters} | {countered} |")

    hero_table = "\n".join(hero_rows)

    content = f"""# 03 — Metadata Hero, Atribut Taktis, dan Audit Bukti Skill

## 1. Spesifikasi Katalog Hero & Status Rilis Global

Sistem mengelola **120 Hero Honor of Kings Global**.

### Aturan Integritas Rilis Server:
- Game asal (*King's Glory* / CN) memiliki katalog 130+ hero. Tidak semua hero CN telah dirilis di HoK Global.
- `hero_release_status.json` memvalidasi status rilis resmi. Rekomendasi draft secara ketat memfilter hero eksklusif CN yang belum aktif di server Global.
- **Konsolidasi Hero Khusus:** **Zhu Bajie (#511)** telah di-merge menjadi **Ata (#556)** pada server Global. Seluruh data 1.701 pertandingan KPL dan matriks sinergi duet dialihkan ke ID 556. ID 511 berstatus non-aktif.

---

## 2. Semantik Relasi Counter (Anti-Inversi Mutlak)

> **ATURAN MUTLAK ARSITEKTUR DATA:**
> Jangan pernah membalik semantik relasi counter. Bug inversi 180 derajat merusak seluruh integritas engine draft.

1. **`hero.counters` (`target_id`, `target_name`):**
   - Menyimpan hero-hero yang **DI-COUNTER OLEH HERO INI** (*Target Empuk / Unggul Melawan*).
   - *Contoh:* Liang meng-counter **Li Bai, Arke, Augran** (karena ultimate suppress Liang menghentikan mobilitas dash mereka seketika).
2. **`hero.countered_by` (`counter_id`, `counter_name`):**
   - Menyimpan hero-hero yang **MENG-COUNTER HERO INI** (*Ancaman Alami / Lemah Melawan*).
   - *Contoh:* Liang di-counter oleh **Gan & Mo, Lady Zhen, Kui, Shouyue** (karena poke jarak jauh dan hook membatalkan ultimate Liang dari luar jangkauan).
3. **Invarian Simetri Provenance:**
   - Setiap entri `h.counters[x]` wajib memiliki pasangan simetris `x.countered_by[h]` dengan alasan mekanis identik.
   - Sumber relasi diverifikasi antara `kurohiko` (analisis taktis komunitas) dan `curation` (audit mekanika skill tim internal).

---

## 3. Popularity Band vs Tier Kekuatan Kompetitif

Field `popularity_band` (S / A / B / C) dari HoK Camp sering disalahartikan sebagai "Tier List Kekuatan". Pada arsitektur engine ini:
- **Popularity Band BUKAN Tier Kekuatan:** Band S hanya mencerminkan hero yang paling sering di-pick oleh pemain kasual ladder publik Diamond+.
- **Fakta Empiris KPL:**
  - **Angela & Daji:** Popularity Band **S** di publik, namun di turnamen KPL winrate-nya hanya **~46%–47%** karena nol mobilitas escape dan mudah di-gank terkoordinasi.
  - **Guan Yu & Zilong:** Popularity Band **C** di publik, namun di KPL mencatatkan winrate **~54%–58%** dengan ribuan pick turnamen.
- Oleh karena itu, field `pick_rate` dan `popularity_band` **DILARANG** masuk ke dalam fungsi pembobotan kekuatan kompetitif. Kekuatan kompetitif dihitung murni melalui penyusutan Bayesian data KPL.

---

## 4. Sistem Penugasan Lane & Flex Lane

Engine membagi penugasan lane ke dalam 3 hierarki:
1. **Primary Lane:** Lane baku hero di meta resmi (Clash, Jungle, Mid, Farm, Roaming).
2. **Official Flex Lane:** Lane alternatif yang diakui oleh game client.
3. **Pro KPL Flex Lane:** Lane alternatif yang terbukti secara empiris di turnamen pro (contoh: Bai Qi di Jungle pada 26% game KPL, Liang di Roaming, Meng Ya di Clash Lane).

*Invarian Display:* Rekomendasi pick memprioritaskan kandidat yang mengisi **Lane Utama** yang masih kosong. Hero flex hanya diprioritaskan jika opsi lane utama telah habis atau ter-counter keras.

---

## 5. Audit Bukti Skill Deterministik (Skill Evidence Audit)

`packages/ml-engine/skill_evidence_audit.py` mengekstraksi 29 tag taktis secara deterministik langsung dari teks deskripsi skill resmi hero (tanpa melibatkan model probabilistik / LLM di runtime):

| Kategori Taktis | Tag Bukti Skill | Indikator Teks Resmi |
|---|---|---|
| **Crowd Control (Hard)** | `suppress`, `airborne`, `freeze`, `stun`, `stone`, `taunt` | "suppresses", "knocks airborne", "freezes", "stuns", "petrifies", "taunts" |
| **Crowd Control (Soft)** | `slow`, `silence`, `disarm` | "reduces movement speed", "silences", "disarms" |
| **Mobilitas** | `dash`, `blink`, `leap`, `speed_boost` | "dashes forward", "teleports", "soars into the sky", "increases movement speed" |
| **Defensif & Bertahan** | `immunity`, `invulnerability`, `shield`, `untargetable`, `damage_reduction` | "immune to crowd control", "becomes untargetable", "gains shield", "reduces damage taken" |
| **Gaya Permainan** | `poke`, `burst`, `sustain`, `anti_dive`, `dive` | Range kemampuan > 900 px, execute damage, HP recovery, skill penahan tower dive |

---

## 6. Direktori Lengkap 120 Hero Global

Berikut adalah tabel komprehensif 120 Hero Honor of Kings Global beserta atribut taktis utamanya:

| ID | Nama Hero | Role | Lane Primer | Semua Lane Legal | Popularity | Winrate Ranked | Winrate KPL | Meng-counter (Kuat vs) | Di-counter (Lemah vs) |
|---|---|---|---|---|---|---|---|---|---|
{hero_table}
"""
    write_export("03_METADATA_HERO_DAN_ATRIBUT_TAKTIK.md", content)

# ==============================================================================
# 04. CORE ALGORITHMS & SEARCH ENGINE
# ==============================================================================
def generate_04_algorithms():
    content = r"""# 04 — Logika Matematika, Inferensi Taktis, dan Algoritma Pencarian Minimax

## 1. Landasan Matematika Kekuatan Kompetitif

### A. Bayesian Shrinkage untuk Winrate KPL
Untuk mencegah hero dengan sampel pertandingan sedikit (misal 5 game dengan 4 kemenangan = 80%) mendominasi ranking, engine menerapkan penyusutan Bayesian (*Bayesian Shrinkage*) terhadap prior netral (winrate 50% dengan bobot prior $M = 40$ pertandingan):

$$kplShrunk = \frac{WR_{KPL} \times N_{matches} + 0.50 \times 40}{N_{matches} + 40}$$

- Jika $N_{matches} \to \infty$, $kplShrunk \to WR_{KPL}$.
- Jika $N_{matches} = 0$, $kplShrunk = 0.50$.
- Jika hero memiliki sampel tipis (misal $N=10, WR=0.80$), maka:
  $$kplShrunk = \frac{0.80 \times 10 + 0.50 \times 40}{10 + 40} = \frac{8 + 20}{50} = 0.56$$
  Hero secara otomatis ditarik kembali ke nilai wajar kompetitif.

---

### B. Model Hierarkis First-Pick Opener B1
Penilaian pembuka pertama (B1) dievaluasi melalui model posterior hierarkis khusus:

$$posterior\_B1 = \frac{WR_{B1} \times n_{B1} + kplShrunk \times 40}{n_{B1} + 40}$$

Skor deviasi dihitung terhadap **rata-rata medan B1** (di turnamen, sisi Blue memiliki baseline kemenangan first-pick $> 50\%$):
$$Score_{Opener} = (posterior\_B1 - Mean_{Field\_B1}) \times W_{B1\_Record} + PresenceTerm$$

---

### C. Penalti Immobile Carry di Giliran Awal
Hero carry statis tanpa skill mobilitas escape (contoh: **Luban No.7 [112], Hou Yi [169], Angela [142], Daji [109]**) memiliki winrate tinggi di public ladder Diamond+, namun sangat rapuh di turnamen kompetitif.
- Pada langkah Step 0–4 (Fase 1 Ban dan First Pick), engine memberlakukan penalti keras:
  $$Penalti_{immobile} = -2.50$$
- Aturan ini secara mutlak mencegah simulator merekomendasikan Luban No.7 atau Hou Yi sebagai B1 first-pick.

---

### D. Anti-Wasted Ban Logic
Engine melarang membuang slot ban untuk hero yang justru secara alami di-counter oleh pembuka kita:
- Fungsi `getOpenerAdvantageAgainst(openerId, candidateId)` memberikan diskon penalti $-1.30$ (hard counter) atau $-0.70$ (soft counter) pada fase ban.
- *Contoh Nyata:* Ao'yin memiliki knockback skill 3 yang membatalkan kanal ultimate Marco Polo. Jika tim kita telah mengamankan Ao'yin, mem-ban Marco Polo adalah pemborosan slot ban.

---

## 2. Mesin Pencarian Minimax Alpha-Beta (`draftSearch.ts`)

Pencarian keputusan draft dievaluasi sebagai permainan *two-player zero-sum sequential game* berbobot taktis:

$$\max_{a \in Actions} \min_{b \in Responses} \left[ Strength(Kita) - Strength(Musuh) \right]$$

### A. Pemotongan Kedalaman Pembuka Buta (Blind Opener Pruning)
- **Kondisi:** Saat kedua tim belum melakukan pick sama sekali (Langkah B1 Blue).
- **Aturan:** `BLIND_OPENER_MAX_DEPTH = 1`.
- **Rasional:** Saat papan kosong, respons cabang pohon di kedalaman 2–4 hanyalah simulasi hipotetis hero yang dipilih solver sendiri (spekulasi tanpa jangkar lawan nyata). Bukti empiris first-pick B1 KPL jauh lebih valid daripada eksplorasi pohon kosong. Memotong kedalaman ke 1 ply menaikkan kesesuaian B1 dengan meta pro dari 0/5 menjadi 5/5.

---

### B. Head Pass & Tail Pass Architecture

```mermaid
flowchart LR
    A["Semua Kandidat Legal"] --> B["Penyaring Heuristik (Top 8)"]
    B --> C["Head Pass: Alpha-Beta Minimax (Depth 1..4)"]
    A --> D["Tail Pass: Evaluasi 1-Ply Respons Lawan (Deadline-Aware)"]
    C --> E["Pilihan Solver = Nilai Tertinggi Head"]
    D --> F["Pengurutan Daftar Rekomendasi Belakang"]
    E --> G["Daftar Rekomendasi Terpadu (advisorRanking.ts)"]
    F --> G
```

1. **Head Pass (Alpha-Beta Penuh):**
   - Mengambil 8 cabang kandidat teratas dari saringan taktis.
   - Dievaluasi dengan algoritma Alpha-Beta Pruning menggunakan *Iterative Deepening* hingga kedalaman 4 ply.
   - Kandidat dengan nilai tertinggi pada Head Pass menjadi **Pilihan Solver** definitif.
2. **Tail Pass (1-Ply Window Lawan):**
   - Kandidat di luar 8 besar dievaluasi dengan respons 1-ply terbaik lawan.
   - Dirancang sadar tenggat waktu (*deadline-aware*): jika kuota waktu habis, evaluasi parsial tetap aman digunakan tanpa membuat thread macet.

---

### C. Alokasi Anggaran Waktu Komputasi (Time Budgets)
Engine menerapkan dua profil anggaran komputasi di Web Worker:
- **Lawan AI Simulasi:** `MAX_SEARCH_BUDGET_MS = 1.500 ms` (respons instan agar UX latihan mulus).
- **Live Advisor Rekomendasi:** `MAX_ADVISOR_BUDGET_MS = 8.000 ms` dengan opsi perpanjangan (pencarian komprehensif mendalam untuk saran pemain).

---

## 3. Penyelaras Rekomendasi Solver (`advisorRanking.ts`)

### Masalah Historis & Terobosan:
- Evaluasi heuristik statis (*sheet recommendation*) dan solver game-theory Minimax awalnya hanya memiliki kesesuaian **19,5% (8/41 posisi)** karena perbedaan skala bobot.
- `advisorRanking.ts` menyelesaikan masalah ini dengan mengurutkan ulang kandidat rekomendasi menggunakan evaluator fungsi posisi milik solver (`evaluatePosition`).
- **Hasil:** Kesesuaian melonjak menjadi **80,5% (33/41 posisi)** pada pengujian benchmark resmi.

---

## 4. Generator Game Plan Pasca-Draft (`gamePlan.ts`)

Setelah seluruh 10 hero terpilih, engine secara otomatis mengompilasi analisis taktis pertandingan 5v5:

1. **Matchup Per-Lane:**
   - Menyandingkan hero berdasarkan penetapan lane resmi (Clash vs Clash, Mid vs Mid, Farm vs Farm, Jungle vs Jungle, Roam vs Roam).
   - Menghitung keunggulan relatif (*advantage delta*) dan faktor counter spesifik.
2. **Analisis Kurva Tempo Pertandingan (Tempo Curves):**
   - Menghitung agregat kekuatan tim pada 3 fase: Early Game (0–4 menit), Mid Game (4–10 menit), dan Late Game (>10 menit).
   - Mengidentifikasi tim mana yang memiliki *power spike* awal dan tim mana yang mengandalkan *late-game scaling*.
3. **Syarat Kemenangan & Kekalahan (Win/Loss Conditions):**
   - Mendeteksi komposisi tim: *Poke Comp, Hard Engage, Split Push, Protect Carry, Sustain Bruiser*.
   - Merumuskan rekomendasi rute jungle awal dan prioritas gank jalur utama.
"""
    write_export("04_LOGIKA_MATEMATIKA_DAN_ALGORITMA_PENCARIAN.md", content)

# ==============================================================================
# 05. VISION PIPELINE & BENCHMARK
# ==============================================================================
def generate_05_vision():
    content = r"""# 05 — Pipeline Computer Vision (Live Advisor) dan Validasi Benchmark

## 1. Misi & Kontrak Keselamatan Game Integrity

**Live Draft Advisor** adalah lapisan computer vision berbasis browser murni yang membaca layar draft **Ranked Match** Honor of Kings Global dari jendela mirroring Android (via `scrcpy`), mengenali hero di setiap slot pick dan ban, memirror state draft ke simulator, dan menyajikan rekomendasi pick terbaik secara real-time.

### Kontrak Keamanan Keras (Non-Negotiable):
1. **100% READ-ONLY:**
   - Sistem **TIDAK PERNAH** menginjeksi input sintetis (mouse/tap/keyboard/adb) ke dalam game client.
   - Penggunaan otomatisasi input pada game kompetitif melanggar kebijakan anti-cheat dan dapat memicu ban akun. Sistem ini murni berfungsi sebagai asisten analisis visual pasif.
2. **Zero-Server Ingestion:**
   - Seluruh pemrosesan frame gambar dilakukan secara lokal di memori browser pengguna (`OffscreenCanvas` dan `Float32Array`).
   - Tidak ada transmisi video atau frame ke server eksternal, menjamin privasi dan latensi pengenalan instan.

---

## 2. Resep Operasional Mirroring Perangkat

Untuk menjalankan Live Advisor:
```powershell
# Mirror perangkat Android menggunakan scrcpy (aspek rasio 20:9 native borderless)
scrcpy --window-width=1920 --window-height=864 --always-on-top --window-border=less
```
- **Dilarang memakai `--fullscreen` pada monitor 16:9:** Gambar perangkat akan mengalami *letterboxing*, menyebabkan deteksi rasio aspek menolak frame.
- **Dilarang menambahkan `--max-size`:** Membatasi ukuran merusak resolusi native template matching.

---

## 3. Pipeline Pemrosesan Citra (`apps/web/src/vision/`)

```mermaid
flowchart TD
    A["Frame Layar (getDisplayMedia @ 60fps)"] --> B["OffscreenCanvas Grayscale (Float32Array)"]
    B --> C["Deteksi Slot Kosong (Std Dev Grayscale)"]
    C -->|Std Dev < 30.0| D["Slot Kosong (Bypass Matcher)"]
    C -->|Std Dev >= 30.0| E["Deteksi Chevron Lock (badgeLock.ts)"]
    E --> F{{"Jenis Slot?"}}
    F -->|Slot Pick| G["dHash Shortlist -> NCC Matcher (MinScore 0.55, Margin 0.04)"]
    F -->|Slot Ban| H["Masked NCC Circle-Mask (MinScore 0.72, Margin 0.10)"]
    G --> I["Tier-2 Chroma Refinement (Cb/Cr)"]
    H --> I
    I --> J["Proyeksi ke State Machine Draft (DraftObserver)"]
```

### Tahapan Kunci Algoritma:

1. **Threshold Grayscale Slot Kosong (`BLANK_SLOT_STD_THRESHOLD = 30.0`):**
   - Placeholder slot pick kosong memiliki standar deviasi grayscale 8,3 – 26,8.
   - Slot yang terisi hero memiliki standar deviasi 31,0 – 68,4.
   - Nilai ambang 30,0 memisahkan slot kosong dan terisi secara sempurna tanpa *false fill*.
2. **Solusi Circle-Masking & Eksklusi Padlock Ban:**
   - **Masalah Historis:** Ikon ban di dalam game dipotong melingkar (*circle-masked*) dan tertutup badge gembok (*padlock*) sebesar ~40% lingkaran, menyebabkan NCC konvensional selalu gagal mengenali hero ban.
   - **Solusi:** Masked NCC (radius lingkaran 31 piksel terpusat dengan pengecualian kuadran padlock $x \ge 0.6, y \ge 0.5$) terhadap 144 varian sampling bilinear.
   - **Hasil:** Akurasi pengenalan ban melonjak dari 66,7% menjadi **100% (222/222 frame uji teridentifikasi benar dengan 0 error)**.
3. **Penyempurnaan Chroma Tier-2 (Cb/Cr):**
   - Membedakan hero dengan profil grayscale identik (contoh: Luna vs Xuan Ce, Daji vs Kongkong'er).
   - Analisis kanal warna krominan memastikan skor separasi hero benar selalu $> 0.83$ dengan margin $\ge 0.20$.

---

## 4. Asimetri Pengenalan: Penanganan Kesalahan yang Aman

Engine menerapkan aturan asimetri observasi yang disengaja:
- **BAN Tidak Teridentifikasi $\to$ Soft Handling:**
  - Jika hero ban gagal teridentifikasi atau berstatus estimasi, aksi ban tetap dicatat terjadi (state machine maju), namun hero tersebut **TIDAK DIHAPUS DARI POOL PICKS**.
  - Kesalahan tebakan ban tidak boleh merusak legalitas rekomendasi hero pemain.
- **PICK Tidak Teridentifikasi $\to$ Hard Truncation:**
  - Jika slot pick terisi tetapi hero gagal dikenali secara meyakinkan, replay draft **seketika berhenti** pada giliran tersebut (`truncated = true`).
  - Simulator menolak berspekulasi jika identitas hero yang dipilih di papan pertandingan belum pasti.
- **Deteksi Chevron Lock (Pra-Seleksi vs Terkunci):**
  - Potret hero di slot pick tanpa ikon chevron lock dianggap sebagai **Pra-Seleksi** (hero masih bisa berganti sebelum waktu habis).
  - Hanya potret dengan status `locked === true` yang dieksekusi sebagai aksi pick permanen.

---

## 5. Harness Draft Benchmark & Verifikasi Keputusan

Engine diverifikasi secara berkala menggunakan suite benchmark resmi:
- **Korpus Uji:** `data/processed/draft_benchmark.json` memuat puluhan skenario posisi draft turnamen nyata (pertandingan KPL, situasi counter B1/R1, perebutan flex lane).
- **Metrik Keberhasilan:**
  - Kesesuaian Lembar Rekomendasi vs Solver Minimax: **80,5%**.
  - Akurasi First Pick B1: **100% (5/5 posisi pembuka meta pro)**.
  - Runtime Latensi: Rata-rata inferensi heuristik $< 9$ ms; solver minimax $< 1.500$ ms (AI) / $< 4.000$ ms (Advisor).
"""
    write_export("05_PIPELINE_COMPUTER_VISION_DAN_BENCHMARK.md", content)

# ==============================================================================
# 06. KNOWLEDGE GRAPH & ARCHITECTURAL COMMUNITIES
# ==============================================================================
def generate_06_graph():
    content = r"""# 06 — Knowledge Graph Arsitektur dan Komunitas Modul

## 1. Ringkasan Topologi Graphify

Repositori `hok-draft-engine` telah dipetakan secara menyeluruh ke dalam Knowledge Graph persistent berbasis AST (Abstract Syntax Tree) dan analisis dependensi:

- **Total Node:** 1.708 entitas (fungsi, kelas, file, antarmuka, konstanta)
- **Total Edge:** 4.243 koneksi relasional (impor, panggilan fungsi, implementasi antarmuka, dependensi data)
- **Total Komunitas Arsitektur:** 87 klaster modular (79 komunitas utama)
- **Cakupan Kode:** 342 file (~2.520.400 kata sumber)
- **Rasio Ekstraksi:** 98% terverifikasi secara deterministik, 2% inferensi struktural berbobot kepercayaan 0,89.

---

## 2. Analisis 10 God Nodes (Abstraksi Paling Kritis)

God Nodes adalah entitas dengan derajat konektivitas tertinggi di dalam codebase, merepresentasikan fondasi utama sistem:

| Peringkat | Nama Node | Derajat Koneksi (Edges) | Lokasi File | Peran Arsitektural |
|---|---|---|---|---|
| **1** | `VisionPipeline` | 49 edges | `apps/web/src/vision/pipeline.ts` | Orkestrator utama seluruh tahapan visual capture, cropping, matching, dan caching frame. |
| **2** | `Hero` | 48 edges | `apps/web/src/types.ts` | Kontrak tipe data sentral untuk representasi statistik, counters, items, build, dan tier hero. |
| **3** | `runTournamentInference()` | 40 edges | `apps/web/src/engine/tournamentInference.ts` | Inti kalkulasi taktis 4 fase turnamen dan pembobotan skor kandidat draft. |
| **4** | `App()` | 39 edges | `apps/web/src/App.tsx` | Root controller antarmuka React, sinkronisasi state draft, Fearless BP, dan mode tab. |
| **5** | `getDraftTurn()` | 36 edges | `apps/web/src/engine/draftRules.ts` | Otoritas tunggal penentuan giliran, fase turnamen, dan validasi legalitas aksi draft. |
| **6** | `PracticeDraft()` | 35 edges | `apps/web/src/components/PracticeDraft.tsx` | Komponen interaktif simulator latihan melawan AI bot. |
| **7** | `VisionPanel()` | 33 edges | `apps/web/src/components/VisionPanel.tsx` | Antarmuka Live Draft Advisor, manajemen screen share, dan visualisasi overlay slot. |
| **8** | `applyDraftAction()` | 26 edges | `apps/web/src/engine/draftRules.ts` | Mutator state transisi giliran pick dan ban secara atomik. |
| **9** | `parse_hero_page()` | 25 edges | `packages/ml-engine/0_sync_global_assets.py` | Parser data hero sumber Kurohiko dan mapping taktis awal. |
| **10** | `TacticalVector` | 20 edges | `apps/web/src/types.ts` | Representasi vektor 7 sumbu radar kekuatan tim (Crowd Control, Mobilitas, Sustain, Burst, Poke, Frontline, Pusher). |

---

## 3. Klaster Komunitas Arsitektural Utama

### Komunitas 0: Pipeline Computer Vision & Template Matching
- **Komponen Utama:** `pipeline.ts`, `heroMatcher.ts`, `geometry.ts`, `badgeLock.ts`, `manualLayout.ts`, `observer.ts`.
- **Fungsi:** Mengambil stream frame dari scrcpy, melakukan normalisasi grayscale, dHash shortlist, masked NCC circle-masking, dan proyeksi ke state machine.

### Komunitas 1: State Machine Draft & Antarmuka Pengguna (UI)
- **Komponen Utama:** `App.tsx`, `PracticeDraft.tsx`, `VisionPanel.tsx`, `HeroWikiDrawer.tsx`, `TacticalRadarPanel.tsx`.
- **Fungsi:** Mengelola interaksi pemain, pemilihan hero, rendering radar taktis, drawer wiki edukasi hero, dan rendering kartu rekomendasi.

### Komunitas 2: Tactical Decision Engine (TypeScript)
- **Komponen Utama:** `tournamentInference.ts`, `draftRules.ts`, `advisorRanking.ts`, `heroDataLoader.ts`.
- **Fungsi:** Menyaring kandidat legal, menghitung kekuatan Bayesian, mengevaluasi occupancy lane, dan menyelaraskan rekomendasi dengan solver.

### Komunitas 3: Game-Theoretic Minimax Search (Web Worker)
- **Komponen Utama:** `draftSearch.ts`, `opponent.worker.ts`, `opponentClient.ts`.
- **Fungsi:** Mengeksekusi pencarian pohon Alpha-Beta zero-sum di thread terpisah latar belakang dengan pembatasan anggaran waktu 1.500 ms / 8.000 ms.

### Komunitas 4: Analisis Game Plan Pasca-Draft
- **Komponen Utama:** `gamePlan.ts`, `deltaExplainer.ts`.
- **Fungsi:** Membangun evaluasi matchup 5v5 pasca-draft, kurva tempo zero-sum KPL, dan panduan taktis kemenangan tim.

### Komunitas 5: Pipeline Data Empiris KPL (Python / uv)
- **Komponen Utama:** `1_ingest_kpl.py`, `extract_kpl_synergy.py`, `extract_kpl_matchups.py`, `publish_data.py`.
- **Fungsi:** Membangun SQLite `hok_drafts.db`, menghitung sinergi pasangan berbobot waktu (recency 12 bulan), dan menerbitkan JSON berversi SHA-256.

### Komunitas 6: Audit Bukti Skill Deterministik (Python / uv)
- **Komponen Utama:** `skill_evidence_audit.py`, `tactical_profiles.py`.
- **Fungsi:** Parsing deterministik teks deskripsi skill resmi hero untuk ekstraksi 29 tag taktis crowd control dan mobilitas.

---

## 4. Alur Ketergantungan Lintas Lapisan (Dependency Flow)

```mermaid
graph TD
    subgraph DataLayer["Lapisan Data & Ekstraksi (packages/ml-engine)"]
        D1["kpl-bp-dataset (11.141 game)"] --> D2["1_ingest_kpl.py (SQLite DB)"]
        D2 --> D3["extract_kpl_synergy.py"]
        D2 --> D4["extract_kpl_matchups.py"]
        D5["Skill Descriptions"] --> D6["skill_evidence_audit.py"]
        D3 --> D7["publish_data.py"]
        D4 --> D7
        D6 --> D7
    end

    subgraph ClientData["Artefak Publik Berversi (apps/web/public)"]
        D7 --> P1["data_manifest.json (SHA-256)"]
        D7 --> P2["hero_metadata.json"]
        D7 --> P3["kpl_synergy_matrix.json"]
    end

    subgraph EngineLayer["Lapisan Engine Taktis (apps/web/src/engine)"]
        P1 --> E1["heroDataLoader.ts (IndexedDB Cache)"]
        P2 --> E1
        P3 --> E1
        E1 --> E2["tournamentInference.ts"]
        E2 --> E3["advisorRanking.ts"]
        E3 --> E4["draftSearch.ts (Web Worker Minimax)"]
        E2 --> E5["gamePlan.ts"]
    end

    subgraph UILayer["Lapisan Antarmuka & Vision (apps/web/src)"]
        E3 --> U1["App.tsx / PracticeDraft.tsx"]
        E5 --> U1
        U2["scrcpy Window"] --> U3["vision/pipeline.ts"]
        U3 --> U4["visionAdapter.ts"]
        U4 --> E2
        U3 --> U5["VisionPanel.tsx"]
    end
```
"""
    write_export("06_GRAPH_KNOWLEDGE_DAN_KOMUNITAS_MODUL.md", content)

if __name__ == "__main__":
    generate_00_index()
    generate_01_architecture()
    generate_02_kpl()
    generate_03_hero_metadata()
    generate_04_algorithms()
    generate_05_vision()
    generate_06_graph()
    print("All 7 dossiers successfully generated!")
