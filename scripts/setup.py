"""Cross-platform contributor bootstrapper for hok-draft-engine."""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "apps" / "web"
ML_DIR = ROOT / "packages" / "ml-engine"
KPL_RAW_DIR = ROOT / "data" / "raw" / "kpl-bp-dataset"
KPL_BATTLES_CSV = KPL_RAW_DIR / "data" / "battles.csv"
KPL_DB_PATH = ROOT / "data" / "processed" / "hok_drafts.db"
MIN_NODE_MAJOR = 24


def _resolve_tool(name: str, windows_candidates: tuple[str, ...] = ()) -> str | None:
    """Resolve an executable path without needing shell=True on Windows."""
    for candidate in (*windows_candidates, name):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def _run(cmd: list[str], cwd: Path = ROOT, label: str = "") -> None:
    if label:
        print(f"\n==> {label}")
    subprocess.run(cmd, cwd=cwd, check=True)


def _require_tool(name: str, windows_candidates: tuple[str, ...] = (), hint: str = "") -> str:
    tool = _resolve_tool(name, windows_candidates)
    if not tool:
        suffix = f" {hint}" if hint else ""
        raise SystemExit(f"Missing required tool '{name}'.{suffix}")
    return tool


def _check_node_version(node_bin: str) -> None:
    result = subprocess.run([node_bin, "--version"], capture_output=True, text=True, check=True)
    raw = result.stdout.strip()
    match = re.match(r"v?(\d+)", raw)
    major = int(match.group(1)) if match else 0
    if major < MIN_NODE_MAJOR:
        raise SystemExit(f"Node.js {MIN_NODE_MAJOR}+ is required (found {raw}).")
    print(f"Node.js: {raw}")


def _ensure_kpl_submodule(git_bin: str) -> None:
    if KPL_BATTLES_CSV.is_file():
        print(f"KPL raw dataset ready: {KPL_RAW_DIR.relative_to(ROOT)}")
        return
    _run(
        [git_bin, "submodule", "update", "--init", "--depth", "1", "data/raw/kpl-bp-dataset"],
        cwd=ROOT,
        label="Initializing Fire-Phoenixs/kpl-bp-dataset submodule (shallow)",
    )
    if not KPL_BATTLES_CSV.is_file():
        raise SystemExit(
            f"Submodule initialized, but {KPL_BATTLES_CSV} is still missing. "
            "Verify network access and .gitmodules."
        )


def setup_data(rebuild_db: bool) -> None:
    git_bin = _require_tool("git")
    uv_bin = _require_tool("uv", hint="Install from https://docs.astral.sh/uv/")
    _ensure_kpl_submodule(git_bin)
    _run([uv_bin, "sync", "--locked"], cwd=ML_DIR, label="Syncing Python pipeline environment (uv)")
    if rebuild_db or not KPL_DB_PATH.is_file():
        _run(
            [uv_bin, "run", "1_ingest_kpl.py"],
            cwd=ML_DIR,
            label="Ingesting KPL draft records into data/processed/hok_drafts.db",
        )
    else:
        print(f"SQLite database ready: {KPL_DB_PATH.relative_to(ROOT)} (use --rebuild-db to re-ingest)")


def setup_web() -> None:
    node_bin = _require_tool("node")
    _check_node_version(node_bin)
    npm_bin = _require_tool("npm", windows_candidates=("npm.cmd",))
    _run([npm_bin, "ci"], cwd=WEB_DIR, label="Installing frontend dependencies (apps/web)")


def verify_workspace(web_only: bool, data_only: bool) -> None:
    if not data_only:
        npm_bin = _require_tool("npm", windows_candidates=("npm.cmd",))
        _run([npm_bin, "test"], cwd=WEB_DIR, label="Running frontend unit tests")
        _run([npm_bin, "run", "benchmark"], cwd=WEB_DIR, label="Running frontend deterministic benchmark")
        _run([npm_bin, "run", "build"], cwd=WEB_DIR, label="Building & verifying frontend dist")
    if not web_only:
        uv_bin = _require_tool("uv")
        _run(
            [uv_bin, "run", "python", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"],
            cwd=ML_DIR,
            label="Running Python pipeline unit tests",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--web-only", action="store_true", help="Only install/verify apps/web without Python or KPL raw data.")
    scope.add_argument("--data-only", action="store_true", help="Only init kpl-bp-dataset, sync uv, and build hok_drafts.db.")
    parser.add_argument("--rebuild-db", action="store_true", help="Force re-ingesting data/processed/hok_drafts.db from raw CSVs.")
    parser.add_argument("--verify", action="store_true", help="Run test suites and production build checks after setup.")
    args = parser.parse_args()

    if not args.web_only:
        setup_data(rebuild_db=args.rebuild_db)
    if not args.data_only:
        setup_web()
    if args.verify:
        verify_workspace(web_only=args.web_only, data_only=args.data_only)

    print("\nSetup complete. Next steps:")
    if not args.data_only:
        print("  cd apps/web && npm run dev")
    if not args.web_only:
        print("  cd packages/ml-engine && uv run extract_kpl_synergy.py && uv run publish_data.py")


if __name__ == "__main__":
    main()
