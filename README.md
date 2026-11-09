# HoK Draft Engine

Simulator draft, latihan melawan AI, counter lookup, dan wiki hero **Honor of Kings Global**. Frontend React/TypeScript berjalan pada static hosting; keputusan draft dihitung di browser pengguna.

## Cara kerja

| Bagian | Peran |
|---|---|
| Mesin taktis TypeScript | Memberi peringkat pick/ban dari fase draft, statistik hero, counter, sinergi KPL, Plan A/B, dan komposisi lane. |
| Pencarian lokal dalam Web Worker | Membandingkan respons kedua tim dengan iterative deepening minimax: maksimal empat aksi, delapan kandidat per node, anggaran 1.500 ms per keputusan. |
| Pipeline NanoJev lokal | Mengklasifikasikan sumber skill/taktis pada komputer pengelola menjadi proposal yang harus direview. TypeSafe API tersedia sebagai provider opsional. |
| Eksperimen PyTorch/ONNX | Tetap tersedia untuk penelitian. Tidak dijalankan atau didistribusikan oleh frontend produksi. |

Jev TypeSafe adalah layanan eksternal yang menghasilkan keputusan terstruktur. Model `hok_jev_student.onnx` di pipeline adalah model lokal proyek ini, bukan bobot Jev milik TypeSafe. NanoJev adalah model komunitas terpisah yang dapat dipakai secara lokal pada pipeline. Pelatihan maupun pemanggilan API model tidak diperlukan saat pengguna melakukan draft.

Pencarian memakai heuristik yang dapat diperiksa, shortlist kandidat, dan kedalaman terbatas. Hasilnya bukan jaminan draft optimal secara global. Radar komposisi dan ranking rekomendasi juga bukan probabilitas kemenangan terkalibrasi.

## Simulator dan latihan

- **Simulator:** pengguna mengendalikan kedua tim dan dapat mengatur Plan A/B masing-masing.
- **Latihan vs AI:** pilih Blue atau Red; AI menjalankan ban/pick tim lawan secara otomatis. Sisi tetap sepanjang seri, maksimal lima game.
- **Bantuan opsional:** rekomendasi, radar, badge peringkat, dan sortir AI dapat disembunyikan selama latihan. Wiki dan statistik hero tetap tersedia.
- **Fearless per tim:** hero yang sudah dipilih suatu tim pada game sebelumnya terkunci untuk pick tim tersebut. Ban tetap mengikuti ketersediaan pada game aktif.
- **Undo latihan:** kembali ke sebelum keputusan pemain terakhir, termasuk membuang respons AI sesudahnya. Game terdahulu menjadi ulasan setelah game berikutnya dimulai.
- **Evaluasi akhir:** menampilkan komposisi kedua tim dan alternatif keputusan pada posisi saat itu; tidak menetapkan pemenang pertandingan.

Aturan bersama berada di `apps/web/src/engine/draftRules.ts`. Format aplikasi saat ini adalah **18 aksi**: empat ban awal, enam pick awal, empat ban kedua, empat pick akhir. Reset, undo, dan pergantian mode/game membatalkan keputusan AI yang tertunda. Worker tidak menerima Plan A/B pemain.

## Sumber dan integritas data

- **Kurohiko:** katalog hero, relasi counter, dan alasan taktis komunitas.
- **HOKFIRE:** statistik, build, arcana, skill, dan referensi matchup.
- **Dataset KPL/KIC:** frekuensi opener, ban, serta sinergi empiris. Data historis CN tidak otomatis mewakili meta Global saat ini.

`hero.counters` berisi hero **yang di-counter oleh hero tersebut**. `hero.countered_by` berisi hero **yang meng-counter hero tersebut**. Arah ini tidak boleh dibalik.

Status rilis ditinjau di `data/mappings/hero_release_status.json`. Hero tanpa status eksplisit belum dapat digunakan. ID 511 tetap menjadi alias tidak aktif untuk **Ata 556**. Hero immobile yang ditandai sebagai opener berisiko tidak masuk rekomendasi B1 atau ban fase pertama.

## Menjalankan aplikasi

Gunakan Node.js 24+ dan Python yang dikelola melalui **uv**. Python pipeline mengikuti versi pada `packages/ml-engine/pyproject.toml`.

```powershell
cd apps/web
npm.cmd ci
npm.cmd run dev

# Build statis; Vite menyalin isi public secara otomatis
npm.cmd run build
npm.cmd run preview
```

Deploy isi `apps/web/dist/` ke static hosting. Distribusi produksi tidak memuat ONNX/WASM. Jika memakai domain data tersendiri, set `VITE_R2_PUBLIC_URL` pada environment build dan izinkan origin frontend melalui CORS object storage.

## Memperbarui hero dan metadata

1. Perbarui sumber hero/statistik/counter dan sinergi di `data/mappings/` melalui pipeline scraper/ekstraktor atau koreksi yang ditinjau.
2. Tambahkan atau perbarui status rilis setiap hero pada `hero_release_status.json`. Tinjau kemampuan lane, arah counter, dan mapping Global; pertahankan alias Ata.
3. Bila perlu, buat dan review proposal label NanoJev seperti contoh di bawah.
4. Bangun paket data:

```powershell
cd packages/ml-engine
uv run publish_data.py

# Opsional: unggah ke endpoint S3/RustFS/R2 yang sudah dikonfigurasi
uv run publish_data.py --publish
```

`publish_data.py` menghasilkan `data_manifest.json` dan folder `datasets/<versi>/` di public. Paket berisi metadata hero, sinergi, dan status rilis beserta SHA-256. Artefak berversi diunggah terlebih dahulu; manifest menjadi pointer yang diunggah terakhir. Aset hero juga disinkronkan sebelum manifest.

Browser memeriksa manifest saat aplikasi dibuka, memvalidasi seluruh artefak, lalu menyimpan satu paket lengkap pada cache IndexedDB `tournament_dataset_v16`. Jika pembaruan gagal, browser memakai paket valid terakhir atau paket bawaan. Jangan mengedit artefak hasil publikasi secara manual karena checksum akan berubah.

Seri latihan mempertahankan snapshot dataset sampai selesai. Saat memulai seri baru, aplikasi memeriksa pembaruan lagi. Penambahan hero dan perubahan status rilis tidak memerlukan training model atau perubahan whitelist TypeScript.

## Proposal taktis dengan NanoJev lokal

Default pipeline adalah **NanoJev lokal**, tanpa API key atau panggilan inference cloud. Adapter memakai [TianyuCodings/NanoJev dan checkpoint C-Tianyu/NanoJev](https://huggingface.co/C-Tianyu/NanoJev). Model 0,6B ini dijalankan pada komputer pengelola; bobotnya tidak masuk ke web public/dist.

Jalur inferensi upstream saat ini membutuhkan **PyTorch CUDA dan GPU NVIDIA**. Siapkan environment CUDA terlebih dahulu. Pada mesin CPU-only, CLI berhenti dengan pesan yang jelas; tidak ada fallback cloud otomatis. Latihan browser dan pembaruan data yang ditinjau secara manual tetap dapat digunakan.

Unduh rilis model/source sekali melalui Hugging Face. Unduhan membutuhkan internet, sedangkan inferensi berikutnya membaca file lokal:

```powershell
cd packages/ml-engine
uv run --no-sync --with huggingface-hub tactical_profiles.py download

# Pada environment PyTorch CUDA yang sudah disiapkan
uv run --no-sync --with transformers==5.17.0 --with safetensors==0.8.0 tactical_profiles.py propose --hero-id 156 --output ../../data/mappings/tactical_proposals/liang.json

# Baca sumber dan proposal; koreksi label bila perlu sebelum menyetujui
uv run tactical_profiles.py review --proposal ../../data/mappings/tactical_proposals/liang.json --reviewer "Nama reviewer" --status approved
uv run publish_data.py
```

Bobot unduhan diverifikasi terhadap SHA-256 rilis. Lokasi default adalah `data/processed/nanojev/`; gunakan `--checkpoint-dir` untuk checkpoint lokal lain dan `--nanojev-source` bila source inferensi tersimpan terpisah. Dependency model dipasang melalui uv, bukan installer Python global.

Label meliputi mobilitas, suppress, engage, disengage, frontline, dan kerentanan dive. Semua sumber diproses dalam chunk sesuai batas token model tanpa pemotongan diam-diam. Bukti yang bertentangan atau memiliki probabilitas pilihan di bawah 0,7 menjadi `tidak_diketahui`; batas ini dapat diatur melalui `--minimum-probability`.

Proposal menyimpan sumber, hash konten, provider, hash bobot, hasil per chunk, serta status review. Probabilitas NanoJev belum dikalibrasi untuk HoK; pipeline tidak mengubahnya menjadi confidence terkalibrasi. Checkpoint publik dilatih pada tugas game lain, sehingga kemampuan klasifikasi HoK tetap harus dievaluasi. Review pengelola wajib sebelum publikasi.

Publisher hanya memakai proposal approved dengan sumber yang masih cocok. Pilihan yang tidak diketahui tidak menjadi fakta negatif. Status rilis dan counter tidak ditimpa oleh hasil model; hero tanpa profil memakai heuristik role.

**TypeSafe API opsional:** pilih `--provider typesafe` secara eksplisit dan set `TYPESAFE_API_KEY` di environment pipeline atau .env yang diabaikan Git. Jangan memakai nama variabel VITE_ untuk kredensial. Formatnya mengikuti [System One API](https://docs.typesafe.ai/api/system-one).

Pengujian tanpa model memakai `--response-fixture <file.json>`. Fixture ternormalisasi berisi `model` dan `answers`; setiap label memiliki `choice` (ya/tidak/tidak_diketahui) dan `confidence` (null untuk NanoJev). Fixture hanya menguji alur data dan tidak membuktikan akurasi model.

## Pengujian dan benchmark

```powershell
cd apps/web
npm.cmd test
npm.cmd run benchmark
npm.cmd run build
```

Pengujian mencakup validasi Global/Fearless, lima game tanpa pengulangan pick per tim, matching lane flex, arah counter Liang, alias Ata, batas waktu pencarian, worker aktual melalui transport Node, pembatalan, hasil kedaluwarsa, kedua sisi pemain, serta pembaruan/cache paket data.

```powershell
cd packages/ml-engine
uv run python -m unittest test_data_pipeline.py test_nanojev_provider.py
uv run export_draft_benchmark.py --cutoff 2024-01-01 --limit 24

cd ../../apps/web
npm.cmd run benchmark -- --historical ../../data/processed/draft_benchmark.json --limit 24 --output ../../data/processed/draft_benchmark_results.json
```

Benchmark membandingkan baseline dengan pencarian pada fixture taktis dan posisi KPL yang dipisahkan berdasarkan tanggal. Statistik KPL untuk benchmark dihitung hanya dari pertandingan sebelum cutoff. Pilihan historis bukan satu-satunya keputusan yang benar; angka agreement bukan estimasi kekuatan atau win rate AI. Metadata role dan statistik publik masih memakai snapshot saat ini, sehingga evaluasi ini bukan backtest meta historis yang lengkap.

Data lokal KPL 2025–2026 memakai 20 aksi. Exporter menyaring pertandingan yang cocok dengan format aplikasi 18 aksi dan roster Global; cutoff default 2024 menyediakan holdout kompatibel. Benchmark tidak mengubah aturan aplikasi menjadi 20 aksi.

Eksperimen neural tetap memakai `2_jev_teacher_scorer.py`, `3_train_student_net.py`, dan `4_export_and_publish_r2.py`. Ekspornya berada di `data/processed/experimental-model/`; publikasi jarak jauh memerlukan `EXPERIMENTAL_MODEL_BUCKET` tersendiri.

Panduan agen berada di [AGENTS.md](AGENTS.md). Navigasi arsitektur dapat dimulai dari [knowledge graph](graphify-out/graph.html). Jalankan `graphify update .` setelah mengubah sumber TypeScript/Python.
