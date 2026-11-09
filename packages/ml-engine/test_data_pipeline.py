import copy
import json
import tempfile
import unittest
import sqlite3
from pathlib import Path
from publish_data import build_package, publish_package, write_package
from tactical_profiles import TAGS, approved_profiles, create_proposal, validate_proposal
from export_draft_benchmark import export, SEQUENCE
from publish_data import MAPPINGS


class DataPipelineTests(unittest.TestCase):
    def setUp(self):
        self.hero = {"hero_id": 556, "name": "Ata", "abilities": [{"name": "Fixture", "desc": "Dash"}], "counters": [{"target_id": 123}], "is_global_released": True}
        self.response = {"model": "jev-test-fixture", "answers": {tag: {"choice": "tidak_diketahui", "confidence": 0.8} for tag in TAGS}}
        self.response["answers"]["mobility"]["choice"] = "ya"
        self.releases = {"556": {"released": True}, "511": {"released": False, "alias_of": 556}}

    def test_only_reviewed_proposals_reach_metadata_without_overwriting_domain_data(self):
        proposal = create_proposal(self.hero, self.response)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ata.json"
            path.write_text(json.dumps(proposal), encoding="utf-8")
            self.assertEqual(approved_profiles(Path(directory), [self.hero]), {})
            proposal["review"] = {"status": "approved", "reviewed_by": "Fixture reviewer"}
            path.write_text(json.dumps(proposal), encoding="utf-8")
            profiles = approved_profiles(Path(directory), [self.hero])
            manifest, texts = build_package([self.hero], {}, self.releases, profiles)
            result = json.loads(texts["heroes"])[0]
            self.assertEqual(result["tactical_profile"]["tags"], {"mobility": True})
            self.assertEqual(result["counters"], self.hero["counters"])
            self.assertTrue(result["is_global_released"])
            self.assertEqual(manifest["hero_count"], 1)

    def test_changed_sources_and_invalid_answers_reject_review(self):
        proposal = create_proposal(self.hero, self.response)
        updated = copy.deepcopy(self.hero)
        updated["abilities"][0]["desc"] = "Changed after patch"
        with self.assertRaises(ValueError):
            validate_proposal(proposal, updated)
        self.response["answers"]["mobility"]["choice"] = "maybe"
        with self.assertRaises(ValueError):
            create_proposal(self.hero, self.response)

    def test_manifest_last_and_failed_artifact_never_publishes_pointer(self):
        manifest, texts = build_package([self.hero], {}, self.releases)
        with tempfile.TemporaryDirectory() as directory:
            write_package(Path(directory), manifest, texts)
            calls = []
            class FakeStorage:
                def upload_file(self, file, bucket, key, **kwargs):
                    calls.append(key)
            publish_package(FakeStorage(), "fixture", Path(directory), manifest)
            self.assertEqual(calls[-1], "data_manifest.json")
            calls.clear()
            class BrokenStorage:
                def upload_file(self, file, bucket, key, **kwargs):
                    calls.append(key)
                    raise OSError("Fixture upload interrupted")
            with self.assertRaises(OSError):
                publish_package(BrokenStorage(), "fixture", Path(directory), manifest)
            self.assertNotIn("data_manifest.json", calls)

    def test_new_hero_requires_reviewed_release_and_no_fixed_roster_size(self):
        new_hero = {**self.hero, "hero_id": 9000, "name": "New fixture"}
        with self.assertRaises(ValueError):
            build_package([self.hero, new_hero], {}, self.releases)
        self.releases["9000"] = {"released": True}
        manifest, _ = build_package([self.hero, new_hero], {}, self.releases)
        self.assertEqual(manifest["hero_count"], 2)

    def test_historical_priors_do_not_include_holdout_games(self):
        releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
        ids = [int(key) for key, value in releases.items() if value["released"]][:18]
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "benchmark.db"
            connection = sqlite3.connect(database)
            connection.executescript("CREATE TABLE matches(match_id TEXT,date TEXT); CREATE TABLE battles(battle_id TEXT,match_id TEXT,winner_side TEXT,is_complete INTEGER); CREATE TABLE draft_actions(battle_id TEXT,ord INTEGER,side TEXT,action TEXT,global_hero_id INTEGER);")
            for match_id, date in (("train", "2023-12-01"), ("heldout", "2024-02-01")):
                connection.execute("INSERT INTO matches VALUES (?,?)", (match_id, date))
                connection.execute("INSERT INTO battles VALUES (?,?,?,1)", (match_id, match_id, "blue"))
                connection.executemany("INSERT INTO draft_actions VALUES (?,?,?,?,?)", [(match_id, index, side, action, ids[index]) for index, (side, action) in enumerate(SEQUENCE)])
            connection.commit()
            connection.close()
            result = export(database, "2024-01-01", 10)
            self.assertEqual(result["training_battles"], 1)
            self.assertEqual(result["eligible_holdout_battles"], 1)
            self.assertEqual(result["synergy"]["b1_openers"][str(ids[4])]["b1_picks"], 1)
            self.assertTrue(all(sample["date"] >= "2024-01-01" for sample in result["positions"]))


if __name__ == "__main__":
    unittest.main()
