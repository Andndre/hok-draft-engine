"""Capture a ground-truth corpus of HoK Global Ban&Pick screenshots via adb.

Captures the DEVICE's native-resolution frame using `adb exec-out screencap -p`
(raw PNG bytes on stdout, captured as bytes — never a screenshot of the scrcpy
window, which would break pixel-coordinate calibration). Frames are appended to
data/vision-corpus/ with an incrementing counter and one JSON line per frame in
manifest.jsonl. PNG dimensions are parsed from the IHDR chunk with `struct` — the
real capture resolution depends on the current screen orientation, NOT on `wm
size` (which always reports the portrait physical size). Stdlib only: no Pillow,
no requests, no shell=True.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "data" / "vision-corpus"

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 1.0
EXIT_DEVICE_ERROR = 3  # device could not be determined (none / several / adb missing at select time)


def _run(args, timeout=None):
    """Run a subprocess with an argument list (never shell=True), returning bytes."""
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)


def adb_binary(device_dir):
    """Resolve the adb executable: --device-dir may be the binary itself or its folder."""
    if not device_dir:
        return "adb"
    path = Path(device_dir)
    if path.is_dir():
        candidate = path / ("adb.exe" if sys.platform == "win32" else "adb")
        return str(candidate)
    return str(path)


def _adb_lines(output):
    return [line.strip() for line in output.decode("utf-8", "replace").splitlines() if line.strip()]


def _is_missing_adb(exc, adb):
    """True only when the FileNotFoundError refers to the adb binary itself.

    Windows often omits `filename` on a failed CreateProcess, so fall back to
    resolving the adb path; unrelated missing files must propagate untouched.
    """
    if exc.filename:
        return Path(exc.filename).name == Path(adb).name
    if Path(adb).is_file():
        return False
    return shutil.which(adb) is None


def list_devices(adb):
    """Print `adb devices -l` raw output; returns (ready_serials, all_lines)."""
    result = _run([adb, "devices", "-l"], timeout=15)
    lines = _adb_lines(result.stdout)
    ready = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            ready.append(parts[0])
    return ready, lines


def resolve_serial(ready, lines):
    """Pick the adb serial from an already-fetched device list; None if ambiguous."""
    if not ready:
        print("ERROR: tidak ada device adb dengan status 'device' (cek kabel/USB debugging, atau device 'unauthorized').", file=sys.stderr)
        for line in lines:
            print(f"  {line}", file=sys.stderr)
        return None
    if len(ready) > 1:
        print("ERROR: lebih dari satu device adb terhubung; pilih satu dengan --serial <serial>.", file=sys.stderr)
        for line in lines:
            print(f"  {line}", file=sys.stderr)
        return None
    return ready[0]


def device_resolution(adb, serial):
    """Parse `adb shell wm size`; Override size wins over Physical size."""
    result = _run([adb, "-s", serial, "shell", "wm", "size"], timeout=15)
    text = result.stdout.decode("utf-8", "replace")
    physical = override = None
    for line in text.splitlines():
        match = re.search(r"(Physical|Override) size:\s*(\d+)x(\d+)", line)
        if match:
            value = f"{match.group(2)}x{match.group(3)}"
            if match.group(1) == "Physical":
                physical = value
            else:
                override = value
    return override or physical


def next_index(out_dir):
    """Continue the zero-padded counter from the highest existing index in out_dir."""
    highest = 0
    if out_dir.exists():
        for path in out_dir.iterdir():
            match = re.match(r"^(\d+)_", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def png_dimensions(data):
    """Parse (width, height) from the PNG IHDR chunk (bytes 16-23, big-endian); None if not a valid PNG."""
    if len(data) < 24 or not data.startswith(PNG_MAGIC):
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def capture_frame(adb, serial):
    """Stream `exec-out screencap -p` as raw PNG bytes with retries; (None, None) if all fail.

    A frame only counts as captured when the payload is a valid PNG whose IHDR
    dimensions parse — a broken/truncated stream must never reach the manifest.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            result = _run([adb, "-s", serial, "exec-out", "screencap", "-p"], timeout=30)
        except FileNotFoundError:
            raise
        except subprocess.TimeoutExpired:
            result = None
        data = result.stdout if result is not None else b""
        dims = png_dimensions(data)
        if dims is not None:
            return data, dims
        if attempt < MAX_ATTEMPTS:
            print(f"  capture attempt {attempt} failed ({len(data)} bytes, no valid PNG), retrying in {RETRY_BACKOFF_SECONDS:.0f}s...", file=sys.stderr)
            time.sleep(RETRY_BACKOFF_SECONDS)
    return None, None


def write_manifest(out_dir, record):
    with (out_dir / "manifest.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _human_size(num_bytes):
    return f"{num_bytes / 1024:.0f}KB" if num_bytes < 1024 * 1024 else f"{num_bytes / (1024 * 1024):.2f}MB"


def run_capture(args, adb, serial, physical_size):
    """Capture loop; returns number of frames captured."""
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    index = next_index(out_dir)
    target = f"{args.count} frame" if args.count else "until Ctrl-C"
    print(f"Device {serial} @ {physical_size} (wm size) -> {out_dir} ({target})", file=sys.stderr)
    captured = 0
    try:
        while True:
            if args.count and captured >= args.count:
                break
            data, (png_width, png_height) = capture_frame(adb, serial)
            if data is None:
                print("ERROR: screencap gagal setelah 3 percobaan; frame tidak ditulis (jangan simpan file rusak).", file=sys.stderr)
                raise SystemExit(1)
            name = f"{index:03d}_{args.label}.png"
            (out_dir / name).write_bytes(data)
            now = datetime.now(timezone.utc)
            record = {
                "file": name,
                "index": index,
                "label": args.label,
                "ts": now.isoformat(timespec="seconds"),
                "unix_ts": int(now.timestamp()),
                "serial": serial,
                "resolution": f"{png_width}x{png_height}",
                "device_physical_size": physical_size,
                "bytes": len(data),
            }
            write_manifest(out_dir, record)
            captured += 1
            print(f"[{captured:02d}] {name} {png_width}x{png_height} {_human_size(len(data))}", file=sys.stderr)
            index += 1
            if args.count and captured >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    try:
        manifest_lines = sum(1 for _ in (out_dir / "manifest.jsonl").open(encoding="utf-8"))
    except FileNotFoundError:
        manifest_lines = 0  # zero-frame session (e.g. Ctrl-C before the first capture): no manifest yet
    print(f"Selesai: {captured} frame -> {out_dir} (manifest.jsonl: {manifest_lines} baris total).", file=sys.stderr)
    return captured


def run_dry_run(args, adb, serial, physical_size):
    """Print the capture plan without touching the screen."""
    out_dir = args.out.resolve()
    index = next_index(out_dir)
    print("DRY RUN — tidak ada frame yang diambil.")
    print(f"  device     : {serial}")
    print(f"  device size : {physical_size} (physical)")
    print(f"  capture    : rotated to current orientation, e.g. {physical_size.split('x')[1]}x{physical_size.split('x')[0]} in landscape")
    print(f"  out dir    : {out_dir}")
    print(f"  label      : {args.label}")
    print(f"  interval   : {args.interval}s")
    print(f"  count      : {args.count if args.count else 'until Ctrl-C'}")
    if args.count:
        for offset in range(args.count):
            print(f"  target file: {(out_dir / f'{index + offset:03d}_{args.label}.png').name}")
    else:
        print(f"  target file: {index:03d}_{args.label}.png, {index + 1:03d}_{args.label}.png, ... (counter lanjut dari index saat ini)")
    print(f"  manifest   : {out_dir / 'manifest.jsonl'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", help="tag singkat untuk nama file, mis. blue, red, pick1, pick2")
    parser.add_argument("--interval", type=float, default=4.0, help="detik antar capture (default: 4.0)")
    parser.add_argument("--count", type=int, default=0, help="jumlah frame; 0 = jalan sampai Ctrl-C (default: 0)")
    parser.add_argument("--serial", help="serial adb; wajib bila lebih dari satu device terhubung")
    parser.add_argument("--device-dir", help="path binary adb alternatif (folder atau file); default: adb dari PATH")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"folder output (default: {DEFAULT_OUT})")
    parser.add_argument("--list-devices", action="store_true", help="cetak output `adb devices -l` lalu keluar")
    parser.add_argument("--dry-run", action="store_true", help="cetak rencana capture (device, resolusi, file target) tanpa mengambil frame")
    args = parser.parse_args()

    if args.interval <= 0:
        parser.error("--interval harus > 0")
    if args.count < 0:
        parser.error("--count tidak boleh negatif")
    if not args.list_devices and not args.label:
        parser.error("--label wajib untuk mode capture (mis. --label blue)")

    adb = adb_binary(args.device_dir)

    try:
        if args.list_devices:
            _, lines = list_devices(adb)
            for line in lines:
                print(line)
            if not lines:
                print("(adb devices -l tidak mengembalikan output — device tidak terhubung?)")
            return
        ready, lines = list_devices(adb)
        if args.serial:
            if args.serial not in ready:
                print(f"ERROR: serial '{args.serial}' tidak ada di daftar device siap pakai.", file=sys.stderr)
                for line in lines:
                    print(f"  {line}", file=sys.stderr)
                raise SystemExit(EXIT_DEVICE_ERROR)
            serial = args.serial
        else:
            serial = resolve_serial(ready, lines)
            if serial is None:
                raise SystemExit(EXIT_DEVICE_ERROR)
        physical_size = device_resolution(adb, serial)
        if not physical_size:
            print(f"ERROR: gagal membaca resolusi dari `adb -s {serial} shell wm size`.", file=sys.stderr)
            raise SystemExit(EXIT_DEVICE_ERROR)
        if args.dry_run:
            run_dry_run(args, adb, serial, physical_size)
            return
        run_capture(args, adb, serial, physical_size)
    except FileNotFoundError as exc:
        if _is_missing_adb(exc, adb):
            print("ERROR: adb not found on PATH; install platform-tools or pass --device-dir <path-to-adb>.", file=sys.stderr)
            raise SystemExit(1)
        raise


if __name__ == "__main__":
    main()
