"""run_full_sync.py
Master synchronization pipeline orchestrator for hok-draft-engine.

Executes all 4 phases:
1. HoK Camp Global synchronization (120 heroes, official skills, patch adjustments)
2. Tencent China pvp.qq.com ingestion (items, summoner spells, arcana, CN-exclusive heroes)
3. Visual asset mirroring to apps/web/public/assets/
4. Re-running tactical audit & publishing immutable SHA-256 verified dataset package.
"""

import argparse
import logging
import subprocess
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ENGINE_DIR = Path(__file__).resolve().parent


def run_step(step_name: str, cmd: list[str]) -> bool:
    logger.info(f"=== Starting Step: {step_name} ===")
    res = subprocess.run([sys.executable] + cmd, cwd=ENGINE_DIR)
    if res.returncode != 0:
        logger.error(f"Step '{step_name}' failed with exit code {res.returncode}")
        return False
    logger.info(f"=== Completed Step: {step_name} ===")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-assets", action="store_true", help="Skip downloading visual assets")
    parser.add_argument("--skip-camp", action="store_true", help="Skip HoK Camp API fetch")
    parser.add_argument("--skip-cn", action="store_true", help="Skip Tencent pvp.qq.com fetch")
    args = parser.parse_args()

    # Step 1: HoK Camp Global
    if not args.skip_camp:
        if not run_step("HoK Camp API Sync", ["camp_source.py"]):
            sys.exit(1)

    # Step 2: Tencent CN Portal
    if not args.skip_cn:
        if not run_step("Tencent CN pvp.qq.com Sync", ["cn_pvp_source.py"]):
            sys.exit(1)
        if not run_step("Extract Official Builds & Arcana", ["extract_official_builds.py"]):
            sys.exit(1)

    # Step 3: Asset Mirror
    if not args.skip_assets:
        if not run_step("Visual Asset Mirroring", ["asset_mirror.py"]):
            sys.exit(1)

    # Step 4: Tactical Audit & Publish Package
    if not run_step("Tactical Profiles Audit", ["tactical_profiles.py", "audit-batch"]):
        sys.exit(1)

    if not run_step("Dataset Publisher", ["publish_data.py"]):
        sys.exit(1)

    logger.info("🎉 Full synchronization pipeline completed successfully!")


if __name__ == "__main__":
    main()
