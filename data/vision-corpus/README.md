# Vision Corpus — Ground Truth Layar Ban&Pick HoK Global

## Tujuan

Folder ini menyimpan **korpus screenshot asli** layar Ban&Pick Honor of Kings Global
yang diambil langsung dari device Android pada resolusi native. Korpus ini adalah
ground truth untuk fitur *live draft advisor*:

1. **Kalibrasi region map** — menentukan koordinat piksel setiap slot ban/pick
   (10 slot pick, 8 slot ban) pada resolusi device yang tetap.
2. **Pengukuran akurasi pengenalan hero** — membandingkan hasil pengenalan
   (OCR / template matching) terhadap jawaban manusia ("hero apa di slot mana").

**PENTING:** frame diambil dari device (via `adb exec-out screencap -p`), BUKAN
screenshot jendela scrcpy. Jendela scrcpy menskalakan gambar sehingga koordinat
piksel tidak bisa dipakai untuk kalibrasi.

## Perintah Capture

### Windows PowerShell

```powershell
cd D:\hok-draft-engine\packages\ml-engine

# Cek device yang terhubung
uv run capture_vision_corpus.py --list-devices

# Uji rencana tanpa mengambil frame
uv run capture_vision_corpus.py --dry-run --label blue --count 2

# Capture sesi biru: 40 frame, jeda 4 detik
uv run capture_vision_corpus.py --label blue --interval 4 --count 40

# Capture sesi merah, dengan serial & lokasi adb eksplisit
uv run capture_vision_corpus.py --label red --interval 4 --count 40 --serial <adb-serial> --device-dir C:\Users\Andndre\AppData\Local\Programs\scrcpy
```

### bash (Linux / macOS / Git Bash)

```bash
cd packages/ml-engine
uv run capture_vision_corpus.py --list-devices
uv run capture_vision_corpus.py --dry-run --label blue --count 2
uv run capture_vision_corpus.py --label blue --interval 4 --count 40
uv run capture_vision_corpus.py --label red --interval 4 --count 40 --serial <adb-serial> --device-dir /path/to/adb
```

Flag penting:

| Flag | Arti |
|---|---|
| `--label` | tag singkat untuk nama file (wajib untuk capture), mis. `blue`, `red`, `pick1` |
| `--interval` | detik antar frame (default `4.0`) |
| `--count` | jumlah frame; `0` = jalan sampai Ctrl-C (default) |
| `--serial` | serial adb; wajib bila >1 device terhubung |
| `--device-dir` | path binary adb alternatif (folder atau file) |
| `--out` | folder output (default: `<repo>/data/vision-corpus`) |
| `--list-devices` | cetak `adb devices -l` lalu keluar (exit 0) |
| `--dry-run` | cetak rencana (device, ukuran fisik, file target) tanpa capture |

Jika device tidak bisa ditentukan (tidak ada device / lebih dari satu tanpa
`--serial` / `--serial` tidak dikenal), script keluar dengan **exit code 3**.

## Konvensi Nama & Manifest

- Nama file: `{NNN}_{label}.png`, contoh `004_blue.png`, `005_blue.png`.
  Counter `NNN` **lanjut** dari index tertinggi yang sudah ada di folder, jadi
  beberapa sesi capture saling menambah, tidak pernah menimpa file lama.
- Setiap frame menambah satu baris JSON ke `manifest.jsonl` (skema, satu objek per baris):

```json
{
  "file": "004_blue.png",
  "index": 4,
  "label": "blue",
  "ts": "2026-11-12T08:15:32+00:00",
  "unix_ts": 1762937732,
  "serial": "10DF1F0E7R000PK",
  "resolution": "2800x1260",
  "device_physical_size": "1260x2800",
  "bytes": 214531
}
```

- `resolution` adalah **dimensi piksel asli PNG** (dibaca langsung dari chunk IHDR
  dengan `struct` — script tetap stdlib-only tanpa Pillow). Ini ruang koordinat
  yang dipakai region map: **semua koordinat slot ban/pick dinyatakan dalam ruang
  `resolution` (piksel PNG), bukan ukuran fisik device.** Karena framebuffer
  `screencap` otomatis mengikuti orientasi layar saat itu, `resolution` bisa
  berbeda dari `wm size` (contoh: device `1260x2800` → PNG landscape `2800x1260`).
- `device_physical_size` hanya **provenance**: nilai mentah `adb shell wm size`
  (field `Override size:` bila ada, selain itu `Physical size:`), yaitu ukuran
  fisik portrait device. Jangan dipakai untuk kalibrasi koordinat.

## Kontrak Pengumpulan (WAJIB diikuti agar korpus bisa dipakai)

1. **Satu device & satu resolusi saja.** Jangan ganti device di tengah korpus;
   kalibrasi koordinat hanya valid untuk satu pasangan device/resolusi. Cek
   `--dry-run` dan pastikan `resolution` konsisten di semua baris manifest
   (PNG selalu diorientasikan mengikuti layar saat capture, jadi `resolution`
   identik untuk semua frame yang diambil dalam orientasi yang sama).
2. **Orientasi landscape.** Mainkan HoK dalam mode landscape. Frame PNG dari
   `screencap` **selalu berada dalam orientasi layar saat itu**, jadi korpus harus
   diambil saat device benar-benar landscape dan pastikan `resolution` di manifest
   menunjukkan dimensi landscape (lebar > tinggi, mis. `2800x1260`). Catatan:
   `adb shell wm size` selalu melaporkan ukuran fisik portrait device
   (`device_physical_size`, mis. `1260x2800`) dan tidak pernah berubah dengan
   rotasi — itu bukan indikator orientasi frame. Bila rotasi berubah di tengah
   sesi, mulai label baru.
3. **Cakupan fase wajib** — korpus harus mencakup semua kondisi berikut:
   - **Fase ban 1** dengan tepat **0, 1, 2, dan 4 ban terisi** (4 state berbeda);
   - **Fase pick 1** dengan 1–2 pick per sisi;
   - **Fase ban 2**;
   - **Fase pick 2** hingga setiap slot terisi.
4. **Frame hero mirip / sering tertukar wajib ada.** Sertakan minimal satu frame
   saat hero yang mirip dengan hero lain (pasangan yang rawan tertukar pada
   potret kecil) tampil di layar. Ini yang menguji **abstention** — kemampuan
   advisor menolak menebak saat tidak yakin — bukan cuma akurasi menebak benar.
5. **`--label` menandai sisi/keadaan**, mis. `blue` (bermain di sisi biru),
   `red`, `pick1`, `pick2`. Konsisten: satu makna per label sepanjang korpus.
6. **Volume:** minimal **50 frame**, ideal **100**.

## Catatan Commit & Lisensi

File di folder ini **TIDAK di-commit** ke repository (sudah di-ignore lewat
`.gitignore`: `data/vision-corpus/`). Alasannya: screenshot berisi **art resmi
Tencent / Level Infinite** (potret hero, UI, aset game) yang dilindungi hak cipta
dan lisensi — tidak boleh didistribusikan di repo publik. Yang boleh masuk repo
hanyalah **fixture golden kecil yang sudah dianonimkan/dicrop** dengan syarat di
bawah.

## Memindahkan Frame ke Golden Fixture (opsional, nanti)

Bila pipeline pengenalan butuh test fixture, pindahkan subset frame ke
`apps/web/tests/fixtures/vision/` dengan syarat:

1. **Crop saja region minimal** yang diperlukan (slot hero tunggal atau strip
   ban/pick), bukan frame layar penuh — memperkecil payload art Tencent;
2. **Downscale** bila memungkinkan (mis. lebar ≤ 256px) agar payload kecil;
3. Sertakan **fixture manifest** JSON kecil berisi `{file, label, expected_slot,
   expected_hero_id, source_resolution, source_frame}` agar fixture bisa
   dipetakan balik ke baris `manifest.jsonl`;
4. Nama fixture mengikuti pola `slot{n}_hero{hero_id}_{label}.png`;
5. Pastikan lisensi/hak cipta Tencent tetap dihormati: fixture hanya untuk tes
   internal repo ini, bukan untuk didistribusikan sebagai aset game.
