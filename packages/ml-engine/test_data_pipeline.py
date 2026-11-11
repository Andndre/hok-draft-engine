import copy
import json
import tempfile
import unittest
import sqlite3
from pathlib import Path
from publish_data import build_package, publish_package, write_package
from dataset_sources import load_source_heroes
from tactical_profiles import TAGS, approved_profiles, create_proposal, generate_batch_proposals, global_released_heroes, has_source_evidence, source_material, validate_proposal
from export_draft_benchmark import export, SEQUENCE
from extract_kpl_synergy import extract_lane_rates, extract_tempo_curves
from publish_data import MAPPINGS


class DataPipelineTests(unittest.TestCase):
    def setUp(self):
        self.hero = {"hero_id": 556, "name": "Ata", "abilities": [{"name": "Fixture", "desc": "Dash"}], "counters": [{"target_id": 123}], "is_global_released": True}
        self.response = {"model": "tactical-test-fixture", "answers": {tag: {"choice": "tidak_diketahui", "confidence": 0.8} for tag in TAGS}}
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
            self.assertEqual(manifest["schema_version"], 2)
            self.assertEqual(set(manifest["artifacts"]), {"heroes", "synergy", "releases", "items", "spells"})
            self.assertEqual(json.loads(texts["items"]), [])
            self.assertEqual(json.loads(texts["spells"]), [])

    def test_changed_sources_and_invalid_answers_reject_review(self):
        proposal = create_proposal(self.hero, self.response)
        updated = copy.deepcopy(self.hero)
        updated["abilities"][0]["desc"] = "Changed after patch"
        with self.assertRaises(ValueError):
            validate_proposal(proposal, updated)
        self.response["answers"]["mobility"]["choice"] = "maybe"
        with self.assertRaises(ValueError):
            create_proposal(self.hero, self.response)

    def test_hokstats_source_changes_expire_proposal_approval(self):
        proposal = create_proposal(self.hero, self.response)
        updated = copy.deepcopy(self.hero)
        updated["hokstats_guide"] = {"skills": [{"name": "New source text"}], "source": {"source_hash": "new"}}
        with self.assertRaises(ValueError):
            validate_proposal(proposal, updated)

    def test_expired_approval_is_ignored_when_source_changes(self):
        proposal = create_proposal(self.hero, self.response)
        proposal["review"] = {"status": "approved", "reviewed_by": "Fixture reviewer"}
        updated = copy.deepcopy(self.hero)
        updated["abilities"][0]["desc"] = "Changed after review"
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "ata-old-source.json").write_text(json.dumps(proposal), encoding="utf-8")
            self.assertEqual(approved_profiles(Path(directory), [updated]), {})

    def test_batch_proposals_use_only_released_heroes_and_skip_empty_sources(self):
        hokstats_hero = {
            "hero_id": 157, "name": "Fixture Support",
            "hokstats_guide": {"source": {"source_hash": "guide-hash", "url": "https://hokstats.gg/heroes/fixture/"}, "skills": [{"name": "Shield", "description": "Shields an ally."}]},
        }
        empty_hero = {"hero_id": 158, "name": "No Evidence"}
        unreleased_hero = {"hero_id": 159, "name": "Unreleased", "abilities": [{"description": "Dash"}]}
        heroes = [self.hero, hokstats_hero, empty_hero, unreleased_hero]
        releases = {"556": {"released": True}, "157": {"released": True}, "158": {"released": True}, "159": {"released": False}}
        calls = []

        def fixture_response(hero):
            calls.append(hero["hero_id"])
            return {"model": "NanoJev:fixture", "answers": {tag: {"choice": "tidak_diketahui", "confidence": None} for tag in TAGS}}

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "proposals"
            report_path = Path(directory) / "coverage.json"
            report = generate_batch_proposals(heroes, releases, output_dir, fixture_response, report_path)
            self.assertEqual(report["target_global_released_count"], 3)
            self.assertEqual(calls, [157, 556])
            self.assertEqual(report["summary"], {"generated": 2, "already_present": 0, "skipped_no_source": 1, "failed": 0})
            self.assertEqual([row["hero_id"] for row in report["skipped_no_source"]], [158])
            generated = next(row for row in report["generated"] if row["hero_id"] == 157)
            proposal = json.loads((output_dir / generated["file"]).read_text(encoding="utf-8"))
            self.assertEqual(proposal["review"]["status"], "pending")
            self.assertIn("HoKStats", [source["source"] for source in proposal["sources"]])
            self.assertTrue(all(answer["value"] == "tidak_diketahui" for answer in proposal["tags"].values()))
            second_report = generate_batch_proposals(heroes, releases, output_dir, lambda hero: self.fail("Existing proposal must be preserved"), report_path)
            self.assertEqual(second_report["summary"]["already_present"], 2)

    def test_current_global_roster_has_source_enriched_profiles_for_all_120_active_heroes(self):
        heroes = load_source_heroes()
        releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
        targets = global_released_heroes(heroes, releases)
        self.assertEqual(len(targets), 120)
        self.assertEqual(len({hero["hero_id"] for hero in targets}), 120)
        self.assertTrue(all(has_source_evidence(hero) for hero in targets))
        self.assertTrue(any("HoKStats" in [source["source"] for source in source_material(hero)] for hero in targets))

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

    def test_kpl_tempo_curves_and_clean_lane_rates_filter_anomalies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "kpl_fixture.db"
            players_path = root / "players.jsonl"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE matches(match_id TEXT PRIMARY KEY, year INTEGER);
                CREATE TABLE battles(battle_id TEXT PRIMARY KEY, match_id TEXT, winner_side TEXT, duration_sec INTEGER, is_complete INTEGER);
                CREATE TABLE draft_actions(battle_id TEXT, ord INTEGER, side TEXT, action TEXT, global_hero_id INTEGER, hero_cn TEXT);
                """
            )
            conn.execute("INSERT INTO matches VALUES ('m2023', 2023), ('m2025', 2025)")
            # 1 anomaly <300s (ignored), 12 early losses + 12 late wins for hero 556 (aliased from 511 on first pick)
            conn.execute("INSERT INTO battles VALUES ('short', 'm2025', 'blue', 240, 1)")
            conn.execute("INSERT INTO draft_actions VALUES ('short', 5, 'blue', 'pick', 556, '八戒')")
            rows = []
            for idx in range(12):
                bid_e = f"e{idx}"
                bid_l = f"l{idx}"
                conn.execute("INSERT INTO battles VALUES (?, 'm2025', 'red', 780, 1)", (bid_e,))
                conn.execute("INSERT INTO battles VALUES (?, 'm2025', 'blue', 1320, 1)", (bid_l,))
                rows.append((bid_e, 5, "blue", "pick", 511 if idx == 0 else 556, "猪八戒"))
                rows.append((bid_l, 5, "blue", "pick", 556, "猪八戒"))
            conn.execute("INSERT INTO battles VALUES ('dirty2025', 'm2025', 'blue', 950, 1)")
            conn.execute("INSERT INTO battles VALUES ('old2023', 'm2023', 'blue', 950, 1)")
            conn.executemany("INSERT INTO draft_actions VALUES (?,?,?,?,?,?)", rows)
            for hid, cn in ((101, "A"), (102, "B"), (103, "C"), (104, "D"), (105, "E")):
                conn.execute("INSERT INTO draft_actions VALUES ('old2023', ?, 'blue', 'pick', ?, ?)", (hid, hid, cn))

            # Clean 2025 team roster in e0..e4 (5 distinct lanes), dirty duplicate-Roam in dirty2025, old year in old2023
            jsonl_lines = []
            clean_blue = [
                ["blue", "猪八戒", "P1", "对抗路"],
                ["blue", "A", "P2", "打野"],
                ["blue", "B", "P3", "中路"],
                ["blue", "C", "P4", "发育路"],
                ["blue", "D", "P5", "游走"],
            ]
            for idx in range(5):
                jsonl_lines.append(json.dumps({"battle_id": f"l{idx}", "players": clean_blue}, ensure_ascii=False))
            dirty_blue = [
                ["blue", "A", "P1", "游走"],
                ["blue", "B", "P2", "游走"],
                ["blue", "C", "P3", "中路"],
                ["blue", "D", "P4", "打野"],
                ["blue", "猪八戒", "P5", "发育路"],
            ]
            for idx in range(6):
                jsonl_lines.append(json.dumps({"battle_id": "dirty2025" if idx == 0 else "old2023", "players": dirty_blue if idx == 0 else clean_blue}, ensure_ascii=False))
            players_path.write_text("\n".join(jsonl_lines) + "\n", encoding="utf-8")
            conn.commit()

            cursor = conn.cursor()
            curves = extract_tempo_curves(cursor, {556})
            self.assertIn("556", curves)
            self.assertEqual(curves["556"]["total_games"], 24)
            self.assertEqual(curves["556"]["early"], {"games": 12, "win_rate": 0.0})
            self.assertEqual(curves["556"]["late"], {"games": 12, "win_rate": 1.0})
            self.assertEqual(curves["556"]["profile"], "late")

            lane_rates = extract_lane_rates(cursor, players_path, {556, 101, 102, 103, 104}, min_year=2024, min_games=5)
            self.assertEqual(lane_rates["556"], {"Clash": {"games": 5, "share": 1.0, "win_rate": 1.0}})
            conn.close()


if __name__ == "__main__":
    unittest.main()
