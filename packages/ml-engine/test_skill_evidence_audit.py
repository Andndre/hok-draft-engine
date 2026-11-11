import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from dataset_sources import load_source_heroes
from skill_evidence_audit import compact_state_for_prompt, evaluate_hero_evidence
from tactical_profiles import TAGS, approved_profiles, audit_batch_proposals, global_released_heroes, make_request


class TacticalEvidenceTests(unittest.TestCase):
    def test_cli_fixture_default_provider_needs_no_api_key_or_model(self):
        script = Path(__file__).parent / "tactical_profiles.py"
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "response.json"
            output = Path(directory) / "proposal.json"
            fixture.write_text(json.dumps({"model": "Evidence:fixture-only", "answers": {tag: {"choice": "tidak_diketahui", "confidence": None} for tag in TAGS}}), encoding="utf-8")
            result = subprocess.run([sys.executable, str(script), "propose", "--hero-id", "156", "--output", str(output), "--response-fixture", str(fixture)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            proposal = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(proposal["provider"], "evidence")
            self.assertEqual(proposal["review"]["status"], "pending")

    def test_batch_cli_generates_pending_proposals_for_all_released_global_heroes_offline(self):
        script = Path(__file__).parent / "tactical_profiles.py"
        root = script.parents[2]
        heroes = load_source_heroes()
        releases = json.loads((root / "data/mappings/hero_release_status.json").read_text(encoding="utf-8"))
        targets = global_released_heroes(heroes, releases)
        fixture = {"model": "Evidence:fixture", "answers": {tag: {"choice": "tidak_diketahui", "confidence": None} for tag in TAGS}}

        with tempfile.TemporaryDirectory() as directory:
            fixture_dir = Path(directory) / "fixtures"
            output_dir = Path(directory) / "proposals"
            report_path = Path(directory) / "coverage.json"
            fixture_dir.mkdir()
            for hero in targets:
                (fixture_dir / f"{hero['hero_id']}.json").write_text(json.dumps(fixture), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(script), "propose-batch", "--response-fixtures-dir", str(fixture_dir), "--output-dir", str(output_dir), "--report", str(report_path)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["target_global_released_count"], 120)
            self.assertEqual(report["summary"], {"generated": 120, "already_present": 0, "skipped_no_source": 0, "failed": 0})
            self.assertEqual(len(list(output_dir.glob("*-*.json"))), 120)
            guided_hero = next(hero for hero in targets if hero.get("hokstats_guide"))
            generated = next(item for item in report["generated"] if item["hero_id"] == guided_hero["hero_id"])
            proposal = json.loads((output_dir / generated["file"]).read_text(encoding="utf-8"))
            self.assertIn("HoKStats", [source["source"] for source in proposal["sources"]])
            self.assertEqual(proposal["review"]["status"], "pending")

    def test_skill_evidence_auditor_filters_negations_contamination_and_populates_120_profiles(self):
        heroes = load_source_heroes()
        by_id = {hero["hero_id"]: hero for hero in heroes}
        # Yaria (505) passive says 'excluding suppression' — must NOT be tagged suppress=ya
        yaria_ev = evaluate_hero_evidence(by_id[505])
        self.assertEqual(yaria_ev["suppress"]["choice"], "tidak")
        self.assertEqual(yaria_ev["ally_shield"]["choice"], "ya")
        # Liang (156) and Donghuang (187) must be tagged suppress=ya, and Liang must not be dive_vulnerable
        liang_ev = evaluate_hero_evidence(by_id[156])
        self.assertEqual(liang_ev["suppress"]["choice"], "ya")
        self.assertEqual(liang_ev["dive_vulnerable"]["choice"], "tidak")
        # Bai Qi (120) Skill 3 has Taunt -> cc_taunt=ya, while Liang (156) does not -> cc_taunt=tidak
        baiqi_ev = evaluate_hero_evidence(by_id[120])
        self.assertEqual(baiqi_ev["cc_taunt"]["choice"], "ya")
        self.assertEqual(liang_ev["cc_taunt"]["choice"], "tidak")
        # Dolia (159) HOKFIRE ability contamination ('Lam enters Submerged state') must be filtered out
        dolia_ev = evaluate_hero_evidence(by_id[159])
        self.assertEqual(dolia_ev["leap"]["choice"], "tidak")
        self.assertEqual(dolia_ev["ally_heal"]["choice"], "ya")
        # compact_state_for_prompt strips SHA-256 hashes from matchups/partners
        compacted = compact_state_for_prompt(make_request(by_id[105], "test")["state"])
        hokstats_src = next(s for s in compacted["sources"] if s["source"] == "HoKStats")
        self.assertNotIn("partners", hokstats_src["content"])
        self.assertTrue(all("source_hash" not in m for m in hokstats_src["content"].get("matchups", [])))

        releases = json.loads((Path(__file__).parents[2] / "data/mappings/hero_release_status.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory) / "proposals"
            report = audit_batch_proposals(heroes, releases, out_dir, reviewer="Unit-Test-Auditor", auto_approve=True)
            self.assertEqual(report["summary"]["audited"], 120)
            self.assertEqual(report["summary"]["approved"], 120)
            profiles = approved_profiles(out_dir, heroes)
            self.assertEqual(len(profiles), 120)
            self.assertTrue(profiles[156]["tags"].get("suppress"))
            self.assertTrue(profiles[191]["tags"].get("teleport"))
            self.assertTrue(profiles[113]["tags"].get("ally_cleanse"))


if __name__ == "__main__":
    unittest.main()
