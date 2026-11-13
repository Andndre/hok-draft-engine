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

### D. Live Draft Advisor (Lapisan Vision)
- **Live Draft Advisor** adalah lapisan computer vision in-browser yang membaca layar draft **Ranked** Honor of Kings Global dari jendela Android yang di-mirror (scrcpy), mengenali potret hero mana yang menempati slot mana, memirror board terdeteksi ke simulator yang ada, dan menyarankan pick berikutnya. Seluruhnya berjalan di browser — tanpa server, tanpa Python saat runtime.
- **READ-ONLY. Tidak pernah meng-inject input ke game.** Ini keputusan produk yang keras: input sintetis (adb/scrcpy) dianggap automation oleh anti-cheat game, sehingga auto-play sepenuhnya di luar scope. UI menyatakan hal ini secara permanen.
- Resep operasional (mirror perangkat):
  ```powershell
  # Mirror the phone (scrcpy 5.0.1): borderless, 20:9 client area, always on top
  scrcpy --window-width=1920 --window-height=864 --always-on-top --window-border=less
  ```
  - **Jangan** pakai `--fullscreen` di monitor 16:9: gambar device akan letterbox, pemeriksaan aspect menolaknya, dan advisor melaporkan mismatch.
  - **Jangan** pass `--max-size`: scrcpy sudah meng-encode di resolusi native perangkat.
- Aplikasi wajib berjalan di secure context (`https` atau `localhost`) karena `getDisplayMedia` menuntutnya.
- Alur operator: `cd apps\web && npm.cmd run dev` → http://localhost:3000 → tab **Draft** → mode **Live Advisor** → **Mulai** → share jendela scrcpy. Format draft simulator harus **Ranked** agar "Terapkan ke Simulator" berfungsi; selain itu panel menolak dengan alasan eksplisit. **Geometri slot 100% manual**: operator menyeret titik kuning di pratinjau (atau memakai slider) sampai kotak jatuh tepat di slot — pick garis solid, ban dashed, berlabel (`B1`…`R5`, `ban B1`…`ban R3`) — dan grid itulah satu-satunya sumber geometri untuk pengenalan. Deteksi tata letak otomatis (content-rect + solver lattice) tidak lagi berjalan di produksi; modulnya dipertahankan hanya sebagai harness pengukuran offline (§5.E).
- Kode (pure TypeScript, tanpa React, tanpa DOM saat import) di `apps/web/src/vision/`: `types.ts` (kontrak; `GrayImage.data` = `Float32Array`), `geometry.ts` (crop/resize/normalize/aspectFit/dHash/hamming/ncc), `capture.ts` (`getDisplayMedia` → `OffscreenCanvas` → plane gray + RGBA), `referenceSet.ts` (memuat 137 potret hero dari path `portrait_asset` yang dipublikasikan), `heroMatcher.ts` (dHash shortlist → NCC zoom/badge-aware → abstention; pick 0.55/0.04, ban 0.72/0.10), `badgeLock.ts` (detektor chevron lock), `manualLayout.ts` (**sumber geometri produksi**: anchor ternormalisasi → grid pick/ban persegi + `resolveSlotSides`), `observer.ts` (fold deteksi ke draft state machine; mengekspos `abstainedBans` / `estimatedBans` / `unidentifiedBans`), `pipeline.ts` (orkestrasi; retry translasi khusus pick terkunci — `LOCKED_PICK_RECOVERY_*`). `contentRect.ts` (rect device-image dalam letterbox/pillarbox) dan `layoutSolver.ts` (lattice reguler) tetap ada sebagai **harness pengukuran offline** dan tidak dipakai jalur produksi (lihat §5.E).
- `apps/web/src/engine/visionAdapter.ts` mengubah `DraftPosition` terdeteksi menjadi rekomendasi dengan memanggil `runTournamentInference` yang ada, me-mirror panggilan `App.tsx` persis (invariant turnamen aplikasi otomatis berlaku). `apps/web/src/components/VisionPanel.tsx` adalah UI (toggle sisi, start/stop share, preview frame + overlay slot yang bisa diseret, warning cross-check sisi, board terdeteksi, rekomendasi, apply-to-simulator); panel selalu menerbitkan grid manual ke pipeline sejak frame pertama, tanpa toggle mode dan tanpa checkbox solver. `App.tsx` hanya wiring: mode draft ketiga `'vision'`.
- Tooling (semua lokal, tanpa layanan eksternal):
  - `packages/ml-engine/capture_vision_corpus.py` — capture corpus ground-truth via adb (`adb exec-out screencap -p`), menulis `NNN_<label>.png` + `manifest.jsonl`.
  - `packages/ml-engine/build_vision_contact_sheet.py` — render contact sheet berlabel + `contact_sheet_index.json` machine-readable yang memetakan setiap sel kembali ke frame sumbernya.
  - `packages/ml-engine/convert_reference_images.py` — konversi potret webp/jpg ke PNG untuk tooling Node (137 hero; 138 file termasuk alias tidak aktif `#511`).
  - `packages/ml-engine/calibrate_vision_regions.py` — kalibrator; me-mirror geometri TS bit-for-bit dan self-check Python↔TypeScript (dHash exact, NCC ≤ 1e-6); mengeluarkan profil region dan laporan fill-order.
  - `apps/web/scripts/png-decode.mjs` — decoder PNG tanpa dependensi (`node:zlib`), byte-exact terhadap Pillow.
  - `apps/web/scripts/evaluate-vision-corpus.mjs` — harness pengukuran (`--profile`, `--corpus`, `--reference`, `--annotations`, `--ranges`, `--exclude`, `--scale`); slot ban di-match dengan `kind: 'ban'` persis seperti jalur live (ambang ban bawaan `HeroMatcher`: `banMinScore = 0.72`, `banMinMargin = 0.10`), memuat ground truth ban operator `ban-identity-ground-truth.json`, dan melaporkan tabel akurasi ban per-ikon di ringkasan; pemeriksaan duplikatnya di-scope ke slot pick karena identitas ban adalah estimasi dan tidak boleh menyamar sebagai pelanggaran legalitas pick.
  - `apps/web/scripts/derive-vision-profile.mjs` — derivasi profil dari frame apa pun dengan solver asli.
  - `apps/web/scripts/h264-fidelity.mjs` — mengukur degradasi H.264 terhadap corpus mentah (shells out ke ffmpeg).
- Fixture hanya JSON (tanpa art game) di `apps/web/tests/fixtures/vision/`: `annotations.json`, `hero-identity-ground-truth.json`, `ban-identity-ground-truth.json` (identitas ban draft #1 yang diberikan operator), `region-profile-2800x1260.json`, `region-profile-2800x1260.json.fillorder.json`, `solver-derived-profiles.json`.
- Corpus `data/vision-corpus/` **gitignored** (frame-nya art Tencent/Level Infinite); hanya `data/vision-corpus/README.md` yang ter-track dan harus di-capture lokal sebelum pengukuran apa pun bisa berjalan.

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

### F. Invarian Lapisan Vision (Live Draft Advisor)
Sebelas invariant berikut adalah alasan fitur ini aman; agen selanjutnya dilarang melanggarnya:
1. **Read-only. Tidak pernah inject input ke game.** Anti-cheat memperlakukan input sintetis sebagai automation; auto-play di luar scope.
2. **Advisor adalah proyeksi layar.** `DraftObserver` membangun ulang posisi dari nol pada setiap observasi dan tidak pernah men-patch-nya inkremental — observasi yang lebih pendek harus menyusutkan posisi.
3. **Empty ≠ unidentified.** `heroId === null && abstained === false` berarti slot terlihat kosong → replay berhenti bersih, `truncated: false`. `abstained === true` berarti slot terisi tetapi hero tidak dapat diidentifikasi → `truncated: true` dengan error keras. Jangan pernah menukar keduanya.
4. **Asimetri disengaja: BAN yang tidak teridentifikasi itu soft, PICK yang tidak teridentifikasi itu keras.** Identifikasi ban kini bekerja: ikon ban di-game di-crop melingkar (circle-masked) dan badge padlock menutup ~40% lingkaran, jadi slot ban memakai jalur match khusus ban (masked NCC terhadap varian referensi bergaya ban) dengan ambang abstention per-kind yang ketat dan terukur (`banMinScore = 0.72`, `banMinMargin = 0.10`; pick tetap 0.55/0.04 — lihat `heroMatcher.ts` DEFAULTS). Ban yang lolos ambang diidentifikasi; ban yang tidak lolos dihitung (`unidentifiedBans` — kini diekspos `observer.ts` sebagai gabungan `abstainedBans` (abstain pada ambang) dan `estimatedBans` (teridentifikasi, jadi estimasi)), replay melampaui giliran itu, dan pick tetap diterapkan; pick tak teridentifikasi memotong replay. Tebakan ban yang salah adalah error yang lebih ringan daripada tebakan pick yang salah. Setiap identitas ban yang lolos dari lapisan vision tetap ESTIMASI: ditandai `estimated: true` dan dilipat ke jalur soft yang SAMA PERSIS dengan ban tak teridentifikasi: dihitung dalam `unidentifiedBans`, step tetap maju (ban tetap terjadi — occupancy terverifikasi std), pick tetap diterapkan, dan hero tersebut **tidak pernah masuk posisi** — id ban yang salah tidak akan pernah diam-diam menghapus hero dari pool rekomendasi. Invarian asimetri tidak berubah: PICK tak teridentifikasi tetap memotong replay dengan keras. Panel kini melaporkan kedua kategori secara terpisah, mis. `4 ban teridentifikasi (perkiraan) · 2 ban tidak teridentifikasi — semua ban tetap di luar posisi draft` (varian semua-abstain: `2 ban tidak teridentifikasi — semua ban tetap di luar posisi draft`; varian semua-perkiraan: `4 ban teridentifikasi (perkiraan) — semua ban tetap di luar posisi draft`; tidak ada yang dirender saat tidak ada ban yang tak terpercaya). Substansi invarian tetap: ban yang teridentifikasi tetap hanya ESTIMASI dan tetap tidak pernah masuk posisi draft.
5. **Potret tanpa chevron lock adalah pre-selection, bukan pick** — tidak boleh diterapkan sebagai aksi committed (hero di slot itu masih bisa berubah). Di UI, slot pick hanya dianggap committed saat `locked === true`; slot berisi hero dengan `locked === false` **atau `undefined`** dirender sebagai pra-pilih (outline dashed, palet muted, chip "Pilih Dulu" + catatan "bisa berubah", aria-label "… pra-pilih, belum terkunci, masih bisa berubah") — memperlakukan `undefined` sebagai belum committed adalah arah yang aman. Identitas ban selalu dirender sebagai estimasi: nama italic muted, chip "perkiraan", tanpa badge confidence, aria-label "… (perkiraan, bisa salah)".
6. **Layout yang memuat kolom termirror tidak pernah dipercaya untuk identitas** (`MIRRORED_COLUMN_CONFIDENCE_CAP = 0.5`, di bawah threshold trust). Dua kolom tim HoK bukan mirror satu sama lain — label pemain berada di sisi berlawanan — sehingga kolom termirror secara sistematis meleset ~15 px dan pernah menghasilkan bacaan duplikat hero nyata.
7. **Tim pemain selalu dirender di KIRI; lawan di KANAN.** Sisi absolut kolom kiri dicatat per profil sebagai `ownSide`, dan `resolveSlotSides(profile, operatorSide)` men-mirror-nya saat runtime. Jangan pernah hardcode "blue ada di kanan".
8. **Sisi terdeteksi tidak pernah menimpa toggle manual operator** — hanya menghasilkan warning. Pilihan satu-bit operator tetap otoritatif.
9. **Setiap aksi vision lewat jalur aksi bersama yang ada** (`applyDraftAction` / `applyGameHero` di `apps/web/src/engine/draftRules.ts`) — jalur yang sama dipakai kartu hero, rekomendasi, dan drawer. Jangan pernah mutasi `gamesData` langsung.
10. **`BLANK_SLOT_STD_THRESHOLD = 30.0` adalah hasil pengukuran, bukan angka arbitrer.** Placeholder pick kosong terukur std grayscale 8.3–26.8; slot terisi 31.0–68.4; lingkaran ban kosong 5.5–13.7; terisi 42.9–76.1. Klasternya tidak tumpang tindih. Nilai lama 4.0 mengklasifikasi setiap placeholder kosong sebagai terisi dan merusak advisor sejak frame ban-phase pertama.
11. **Frame yang bukan draft tidak boleh dipercaya.** Screen classifier wajib menolak lobby, layar VS-loading (yang menampilkan art SKIN), dan footage in-match.

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

### D. Menjalankan Live Draft Advisor:
```powershell
# 1. Mirror perangkat (scrcpy 5.0.1): borderless, area client 20:9, selalu di atas
scrcpy --window-width=1920 --window-height=864 --always-on-top --window-border=less

# 2. Dev server di secure context (localhost memenuhi syarat getDisplayMedia)
cd apps\web
npm.cmd run dev        # http://localhost:3000

# 3. Tab Draft → mode Live Advisor → Mulai → share jendela scrcpy.
#    Format draft simulator harus Ranked agar "Terapkan ke Simulator" berfungsi.
#    Periksa overlay: kotak slot pick (solid) dan ban (dashed) berlabel
#    (B1…R5, ban B1…ban R3) harus jatuh tepat di slot layar.
```
Jangan pakai `--fullscreen` di monitor 16:9 (device image letterbox → aspect check menolak) dan jangan pass `--max-size` (scrcpy sudah encode di resolusi native). Advisor read-only dan tidak pernah meng-inject input ke game.

### E. Mengukur Akurasi Lapisan Vision (Kalibrasi & Corpus):
Corpus `data/vision-corpus/` gitignored dan harus di-capture lokal lebih dulu (`capture_vision_corpus.py` via adb) sebelum perintah berikut dapat berjalan:
```powershell
cd D:\hok-draft-engine\packages\ml-engine
uv run convert_reference_images.py --out C:\Users\Andndre\AppData\Local\Temp\opencode\ref-png
uv run calibrate_vision_regions.py --corpus D:\hok-draft-engine\data\vision-corpus --reference C:\Users\Andndre\AppData\Local\Temp\opencode\ref-png --out D:\hok-draft-engine\apps\web\tests\fixtures\vision\region-profile-2800x1260.json
node D:\hok-draft-engine\apps\web\scripts\evaluate-vision-corpus.mjs --corpus D:\hok-draft-engine\data\vision-corpus --profile D:\hok-draft-engine\apps\web\tests\fixtures\vision\region-profile-2800x1260.json --reference C:\Users\Andndre\AppData\Local\Temp\opencode\ref-png --annotations D:\hok-draft-engine\apps\web\tests\fixtures\vision\annotations.json --ranges "28-78,222-256" --exclude "32-36,50-54"
```
Hasil acuan (profil terkalibrasi 2800×1260) — **diukur ulang 13 Nov 2026, jalur harness offline**:
- **Status produksi:** jalur produksi memakai grid manual (`manualLayout.ts`) — content-rect dan solver hanya dipakai harness. Harness tetap memakai profil terkalibrasi + matcher apa adanya, jadi angka di bawah mengukur kualitas matcher, bukan jalur live.
- Frame 078 dan frame 065 keduanya **10/10** identitas hero benar (slot 9 frame 065 adalah pre-selection terdokumentasi yang settle dua frame kemudian — teridentifikasi, tetapi tetap belum terkunci); 0 pelanggaran duplikat hero di 76 frame spanning dua draft lengkap; identitas pick **396/760** slot-frame; stabilitas temporal slot pick 88–100% per slot.
- **Retry translasi pick terkunci** (`LOCKED_PICK_RECOVERY_DX = ±{4,8,12}`, floor 0.60 skor / 0.12 margin, hanya untuk slot pick yang `locked` dan abstain pada percobaan pertama): pada sweep corpus 86 frame menambah **+16 identifikasi** (413 → 429 pada hitungan sweep; harness berbasis profil yang mengecualikan frame pra-isi melaporkan 396/760) tanpa satu pun pelanggaran duplikat. Semua 16 recovery adalah slot 6 draft #2 = **Florentino #631 @ 0.654**, terverifikasi visual pada frame 256. Slot kosong/role-icon dan pra-seleksi **tidak pernah** di-retry.
- H.264/capture path: pada default scrcpy (H.264, 8 Mbps, native encode) pengenalan identik dengan baseline raw-PNG di setiap ukuran jendela yang diuji (native 2800×1260, 1920×864, 1400×630); deviasi piksel per-slot terburuk ≈ 0.9% dari 255 dengan NCC ≥ 0.985; degradasi mulai sekitar 1 Mbps (slot ban false-fill) dan identitas pick baru pecah dekat 0.25 Mbps. Akurasi pick identik pada capture scale 1.0 / 0.7 / 0.5.
- **Layout otomatis — lattice reguler (perangkat tanpa kalibrasi):** solver kini memuat **satu lattice reguler** ke bukti terdeteksi dan menurunkan setiap slot darinya, menggantikan derivasi per-slot dari bounding box art yang mengukur tile 4–8% terlalu kecil (median tinggi art-bbox 96 px vs tile sebenarnya ~100–104 px). Kandidat di-cluster ke dua kolom tepi; **pitch + fase** baris bersama di-fit dengan RANSAC atas hipotesis gap berpasangan dan di-refine dengan median gap baris terdeteksi bersebelahan; fase dijangkar pada **atas bbox kandidat** (kotak tile yang dirender bersifat top-anchored; pusat art-bbox bias saat art tidak mengisi tile penuh) dengan satu refit pengecualian-outlier; residual diumpankan ke confidence. Setiap slot dalam satu kolom berbagi **tepat satu x**, dan y tiap baris = fase + k·pitch — slot kosong termasuk; jumlah baris didiskover (family 5 sebagai fallback). **Ukuran tile tidak lagi berbasis art-bbox:** prioritas tile placeholder persis (rendering tile milik game, fill ≥ 0.9) pada lattice → median per-sumbu (`source: 'evidence'`); selain itu pitch ter-fit × rasio dimensionless tile÷pitch profil terkalibrasi **147/203** (`source: 'pitch-ratio'`, bebas resolusi); jalur yang diambil dilaporkan di `tileWidthSource` / `tileHeightSource` plus catatan berbahasa Indonesia. **Jumlah strip ban didiskover, bukan diasumsikan:** ikon tiap sisi di-dedup/di-cluster dan pitch uniform 1-D di-fit; jumlah slot ban per sisi berasal dari posisi ikon (tidak pernah di-hardcode). Strip dengan **4 atau 5 ikon** menghasilkan 4 atau 5 slot ban per sisi dengan pitch uniform (teruji); saat deteksi melihat **lebih sedikit** ikon daripada isi strip, jumlah family terkalibrasi (3) dipertahankan sebagai floor, karena murni menghitung akan undercount pada ikon gelap/ter-padlock di ujung yang terlewat — fallback-nya dinyatakan di diagnostik. Jalur sizing art-bbox lama dihapus seluruhnya, bukan dipertahankan sebagai fallback: itulah defek terukurnya, dan jalur bukti-placeholder menjangkau frame yang dulu dilayaninya. Gate sudut ban direlaksasi dari 0.2/0.8 ke 0.32/0.68 agar strip 5-ikon muat secara geometris. Terukur pada **87 frame draft-window, 45 solver-trusted**, replay corpus melalui jalur solver: total pick slot-frame teridentifikasi **279/450 → 308/450** (+29), pelanggaran duplikat **0 → 0**; per slot: s0 12→10 (dua misread OLD pada draft #2 yang membaca "193" di tempat harness terkalibrasi membaca 577, hilang), s1 42→42, s2 31→31, s3 33→33, s4 32→37, s5 45→43 (dua sel kini abstain di tempat OLD membaca 114 yang benar-terkalibrasi), s6 24→28 (termasuk menghapus misread "547"), **s7 13→38 (+25 — slot yang gagal di operator)**, s8 21→20, s9 26→26. Pada capture nyata operator melalui jalur solver: R1 (Haya) **0.5096 → 0.5513 (teridentifikasi)**, B3 (Erin) **0.5309 → 0.6343 (teridentifikasi)**. (Angka harness terkalibrasi kini **396/760 pick**, **222/222 ban = 100% dengan 0 salah**, **0 pelanggaran duplikat**, frame 078 = 10/10, frame 065 = 10/10 — lihat butir hasil acuan di atas; angka 392/760 dan 148/222 di paragraf ini adalah rekaman historis sebelum perbaikan chroma/Tier-2.)
- **Batas lattice (dinyatakan polos):** lattice sengaja **tidak** mereproduksi jitter refinement NCC per-slot (rect referensi slot 0 setinggi 154 px vs family 147 px), jadi jalur solver mencapai 0.5513 di tempat jalur terkalibrasi mencapai 0.5712 — keduanya teridentifikasi. Diskover jumlah baris tidak bisa melebihi family 5 hari ini; papan hipotetis 6 baris akan berakhir untrusted alih-alih salah ter-layout diam-diam. Jika game suatu saat merilis lebih dari 3 ban per sisi, profil akan membawa 18/20 slot — perubahan bentuk output yang **belum** diadaptasi oleh observer.
- **Content rect — pencarian aspect-constrained:** `detectContentRect` tidak lagi bergantung pada band near-black saja. Ketika band scan mengembalikan seluruh surface **dan** tidak ada profil terkalibrasi yang bisa direkonsiliasi dengan aspect whole-surface (deviasi > `PROFILE_ASPECT_TOLERANCE = 0.01`), pencarian content-rect aspect-constrained berjalan: jumlah gradien absolut per-kolom/per-baris, 14 kandidat tepi teratas per sumbu, enumerasi (left,right,top,bottom) dengan jendela aspect yang di-binary-search (±1% dari aspect profil), score = total energi boundary dengan tie-break largest-rect, plus evidence gate yang menuntut setiap tepi terpilih ≥ **2×** energi gradien median sumbunya. Verdict membawa `source`: `'bars' | 'aspect-search' | 'whole-surface'`. Kasus terukur: capture operator (jendela Windows Photos menampilkan frame 2800×1260 pada zoom ~68%) adalah surface **1901×982** yang band chromenya **bertekstur** (toolbar baris 0–60: mean 37.7, std 27.9; status bar bawah 40: mean 48.4, std 34.3) → uji band near-black (mean ≤ 8, std ≤ 4) gagal → seluruh surface menjadi content → aspect 1.936 vs profil 2.222 = deviasi **12.9%** → profil terkalibrasi ditolak → jalur solver mengambil alih dengan rect offset 2–8 px dan undersized 4–8% → pick R1 berskor 0.5096 dan pick B3 berskor 0.5309, keduanya **abstain**, dan observer melaporkan `truncated: true` pada step 7. Setelah perbaikan, pencarian mengembalikan **x=2, y=75, 1898×854** — persis ground truth dari NCC template matching (0.99991) — dengan confidence **0.977**, `source: 'aspect-search'`, dan profil **terkalibrasi** dipakai kembali: R1 = **Haya #521 @ 0.5712** (teridentifikasi), B3 = **Erin #155 @ 0.6920** (teridentifikasi), ban tidak berubah (bR1 Li Xin #507 @ 0.8744, bR2 Xuance #195 @ 0.9320, bR3 Daji #109 abstain, bB1 Dunshan #509 @ 0.8985, bB2 Arke #116 @ 0.8997, bB3 Luna #146 abstain), observer **`truncated: false`, replay step 11**. Kombinasi pemenang hanya mengungguli runner-up **3.6%** (210005 vs 202807 — tepi artwork in-game di kolom 1783); yang mencegah rect salah adalah konjungsi empat syarat: jendela aspect ±1%, gate dominasi 2× gradien median (boundary game nyata terukur 5.9×–24× median; tekstur chrome uniform mentok di ~1.1×), empat tepi panjang dominan, dan tie-break largest-rect. Ketika salah satu syarat gagal, pencarian mengembalikan seluruh surface — tidak pernah menghasilkan crop sampah. **Jalur scrcpy tidak tersentuh:** ketika aspect surface sudah cocok dengan profil, pencarian tidak pernah berjalan. Keterbatasan operasional: verdict content-rect **di-cache per ukuran surface**, jadi memindahkan atau men-zoom gambar di dalam jendela mirror tanpa mengubah ukuran jendela meninggalkan rect basi.
- Identitas ban kini bekerja, dan root cause kegagalan lama sudah terbukti: ikon ban di-game di-crop melingkar (circle-masked) — potret berada di dalam lingkaran yang sudutnya panel gelap — dan badge padlock menutup ~40% lingkaran; membandingkan representasi itu langsung dengan potret referensi persegi 128×128-lah yang membuat skor tak pernah melewati ambang (bukan resolusi). Jalur ban sekarang masked NCC (lingkaran radius 31 ter-centre, minus wilayah padlock x ≥ 0.6, y ≥ 0.5 dari ikon 64×64) terhadap varian referensi bergaya ban per-reference (zoom 1.0–1.6, dx −4…+6, dy −4…+2 — 144 konfigurasi), dua tahap (coarse scan → shortlist 10 → fine grid), melalui sampling plan bilinear precomputed bersama yang mempertahankan semantik `cropGray` + `resizeGray` persis. `ReferenceEntry` mendapat field opsional `full64` (potret 64×64 ternormalisasi) yang dipakai jalur ban untuk mensintesis varian itu; referensi tanpa `full64` tetap memakai jalur legacy verbatim. Ambang ban baru: `banMinScore = 0.72`, `banMinMargin = 0.10` (slot pick tetap 0.55/0.04). Harness meng-match slot ban dengan `kind: 'ban'` persis seperti jalur live, memuat fixture ground truth baru `ban-identity-ground-truth.json`, dan melaporkan tabel akurasi ban per-ikon; pemeriksaan duplikatnya di-scope ke slot pick karena identitas ban adalah estimasi dan tidak boleh menyamar sebagai pelanggaran legalitas pick. Ground truth (operator, draft #1 saja): strip merah = Li Xin #507, Xuan Ce #195, Daji #109; strip biru = Dunshan #509, Arke #116, Luna #146. Harness atas kedua jendela draft: **148/222 = 66.7% ban slot-frame benar, 0 identifikasi salah, 74 abstain** (rekaman sebelum chroma); **setelah skor ban berbantuan chroma (Cb/Cr) angka terkini 222/222 = 100%, 0 salah, 0 abstain** — skor benar terendah 0.786 (Luna) dan 0.801 (Daji), yaitu dua ikon yang dulu abstain. Pemisahan: skor hero-benar ban yang teridentifikasi tidak pernah di bawah **0.834** dengan margin ≥ **0.20**, skor hero-salah tidak pernah di atas **0.640** dengan margin ≤ **0.02**. Dua yang abstain melakukannya dengan aman: **Daji** berskor 0.584–0.631 melawan Kongkong'er #550 di 0.605–0.640, dan **Luna** 0.618–0.670 melawan Xuan Ce dengan margin ≈ 0 — wilayah lingkaran yang terlihat memang ambigu dalam grayscale. Konfusi lama teratasi: false positive sebelumnya (ban sisi merah terbaca "Ying" #538 padahal hero-nya Xuan Ce #195) hilang — Xuan Ce kini berskor 0.900–0.923 dengan margin ≥ 0.26. Bukti isolasi hipotesis circle-mask: dengan eksklusi padlock crop yang sama memuncak di 0.83–0.92; tanpanya hanya 0.44–0.65, jadi padlock mendominasi korelasi, bukan sekadar meng-occlude. Resolusi BUKAN penyebab: urutan hero-benar-vs-salah identik pada capture scale 1.0 / 0.686 / 0.5 dan skornya bahkan sedikit naik saat di-downscale (smoothing); jendela capture lebih besar tidak mengubah ban identification dan tidak merusaknya; akurasi pick tetap 10/10 pada ketiga scale. Penyebab lama yang salah atribusi (ikon sisi biru "tidak teridentifikasi karena badge di shadow") keliru — ikon sisi biru gagal karena representasi, bukan alignment (offset icon-centroid vs rect-centre ≤ ~1 px); eksklusi padlock plus referensi ter-zoom memperbaiki 3 dari 4 ikon yang sebelumnya gagal. Angka sisi pick: frame 078 = 10/10 dan frame 065 = **10/10** setelah jalur Tier-2 pick berbantuan chroma (dulu 9/10; slot 9 adalah pre-selection terdokumentasi — teridentifikasi tetapi tetap belum terkunci), 0 pelanggaran duplikat di 76 frame. Biaya: dengan cache match per-slot (slot ban selalu di-cache; slot pick hanya saat locked — pre-selection yang belum terkunci selalu di-match ulang), wall-clock matching per frame turun dari **176.3 ms ke 43.6 ms** dengan **72% panggilan matcher terhindar** (446 → 124 panggilan), dan frame statis steady-state berjalan di **~1.2 ms**; hasil tidak berubah — 0 flip identitas / abstention / `estimated` / `locked` di seluruh 446 verdict (skor bisa goyah paling banyak 0.0011, goyah confidence yang memang sudah ada di jalur fresh-match).
- **Registrasi profil terkalibrasi ke frame live:** kandidat tile dari solver mendeteksi tile yang benar-benar terlihat, di-match one-to-one ke slot pick profil (greedy nearest, gate 0.15 × sisi tile), lalu koreksi di-fit — translasi per-sumbu (L1 median, selalu diizinkan) plus, hanya dengan bukti cukup, skala seragam (deviasi ≤ 5% dan MAD rasio ≤ 0.02) atau skala per-sumbu (split w/h ≥ 0.025 yang jelas, kedua sumbu dalam 5%). Satu robust refit membuang outlier dengan residual > max(2.5 × median, 0.03 × sisi) lalu refit sekali. Guard keras: ≥ 3 pasangan total dan ≥ 2 di satu kolom; translasi ≤ 0.08 × sisi tile (≈ 11.8 px); residual median ≤ 0.06 × sisi; residual pasangan maksimum ≤ 0.12 × sisi. Layout yang benar-benar berbeda bergeser ≥ 0.25 × sisi (≈ 37 px) — tiga kali cap — dan ditangani jalur solver-override. Terukur di corpus: registrasi berlaku pada 65 dari 76 frame (ditolak pada 9 frame sparse/overlay karena "pasangan terlalu sedikit" dan 2 karena "residual terlalu besar"); deviasi pusat per-slot dari tile terlihat membaik dari rerata 5.11 px ke 4.36 px, offender terburuk membaik paling banyak (frame 065 slot 0: 8.1 → 4.0 px; slot 7: 13.3 → 8.0 px; frame 078 slot 0: 8.1 → 4.5 px; slot 7: 13.3 → 8.7 px). **Koreksi hanya diterapkan pada geometri overlay yang dipublikasikan — crop pengenalan tetap memakai rect terkalibrasi.** Ini terukur, bukan asumsi: menerapkan koreksi ke crop justru **meregresi** identitas (frame 078 10/10 → 9/10; frame 065 9/10 → 7/10 dengan translasi rigid; lebih buruk lagi dengan skala). Rect terkalibrasi adalah optimum matcher secara konstruksi — `refine_rect` kalibrator memaksimalkan NCC, jadi optimum matcher memang sengaja offset dari kotak tile yang terlihat; angka identitas harness karena itu tetap tidak berubah struktural. **Dengan kata lain: overlay menunjukkan di mana hero terlihat secara visual; matcher men-crop di mana skornya terbaik; keduanya berbeda beberapa piksel pada tile 147 px dan perbedaannya disengaja.** Registrasi tidak pernah menjadi sumber confidence: hanya berjalan pada jalur terkalibrasi yang sudah resolved dan tidak pernah men-gate trust; saat guard menolak koreksi, geometri terkalibrasi polos yang dipublikasikan — perilaku byte-for-byte seperti sebelumnya.

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
│   ├── vision-corpus/                # Frame layar BP (gitignored; hanya README.md ter-track)
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
│       ├── capture_vision_corpus.py  # Capture corpus layar BP via adb + manifest.jsonl
│       ├── build_vision_contact_sheet.py # Contact sheet berlabel + contact_sheet_index.json
│       ├── convert_reference_images.py  # Konversi potret ke PNG tooling Node (137 hero)
│       ├── calibrate_vision_regions.py  # Kalibrator region + self-check Python↔TypeScript
│       └── publish_data.py           # Paket produksi berversi + publikasi manifest terakhir
└── apps/
    └── web/                          # Static Frontend SPA (Vite + React 19 + TS)
        ├── public/                   # Asset statis & paket dataset berversi
        ├── dist/                     # Hasil build produksi siap upload
        ├── scripts/                  # Tooling Node mandiri (tanpa dependensi runtime)
        │   ├── png-decode.mjs        # Decoder PNG via node:zlib, byte-exact vs Pillow
        │   ├── evaluate-vision-corpus.mjs # Harness akurasi vision corpus
        │   ├── derive-vision-profile.mjs  # Derivasi profil layout dengan solver asli
        │   └── h264-fidelity.mjs     # Ukur degradasi H.264 vs corpus mentah (ffmpeg)
        ├── tests/fixtures/vision/    # Fixture JSON vision (tanpa art game)
        └── src/
            ├── engine/
            │   ├── tournamentInference.ts   # Mesin inferensi taktis 4 fase turnamen
            │   ├── heroDataLoader.ts  # Loader dataset atomik + IndexedDB cache
            │   └── visionAdapter.ts   # Proyeksi deteksi vision ke runTournamentInference
            ├── vision/                # Lapisan CV pure TS (tanpa React/DOM saat import)
            │   ├── types.ts           # Kontrak data vision (GrayImage.data = Float32Array)
            │   ├── geometry.ts        # crop/resize/normalize/aspectFit/dHash/hamming/NCC
            │   ├── capture.ts         # getDisplayMedia → OffscreenCanvas → gray + RGBA
            │   ├── referenceSet.ts    # Muat 137 potret hero dari path portrait_asset
            │   ├── heroMatcher.ts     # dHash shortlist → NCC zoom/badge-aware → abstention
            │   ├── badgeLock.ts       # Detektor chevron lock
            │   ├── contentRect.ts     # Rect device-image dalam letterbox/pillarbox + fallback pencarian aspect-constrained
            │   ├── regionMap.ts       # Registry profil region + resolveSlotSides
            │   ├── layoutSolver.ts    # Derivasi layout lattice reguler dari frame tanpa kalibrasi
            │   ├── observer.ts        # Rebuild penuh draft state per observasi
            │   └── pipeline.ts        # Orkestrasi end-to-end lapisan vision
            ├── components/
            │   ├── DraftSimulator.tsx# Board draft 5v5 Blue vs Red
            │   ├── TacticalRadarPanel.tsx # Visualisasi radar taktis 6 dimensi
            │   ├── HeroWikiDrawer.tsx# Sidebar informasi hero, counters & sinergi KPL
            │   └── VisionPanel.tsx   # UI vision: share, overlay slot, rekomendasi
            ├── data/
            │   └── heroReleaseStatus.ts # Pemetaan whitelist hero rilis Global
            └── App.tsx               # Orchestrator aplikasi utama (mode draft 'vision')
```
