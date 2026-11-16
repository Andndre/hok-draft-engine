import copy
import json
import tempfile
import unittest
import sqlite3
from pathlib import Path
from publish_data import build_package, write_package
from dataset_sources import apply_counter_overrides, apply_measured_matchups, load_source_heroes
from extract_kpl_matchups import extract_measured_matchups
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
            return {"model": "Skill-Evidence:fixture", "answers": {tag: {"choice": "tidak_diketahui", "confidence": None} for tag in TAGS}}

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

    def test_curated_counter_overrides_merge_both_directions_once(self):
        heroes = [
            {"hero_id": 519, "name": "Ao'yin", "counters": [], "countered_by": []},
            {"hero_id": 132, "name": "Marco Polo", "counters": [], "countered_by": []},
        ]
        relation = {
            "counter_id": 519,
            "target_id": 132,
            "severity": "hard",
            "reason": "Knockback skill 3 memutus ultimate.",
            "reviewed_by": "Draft engine curation",
            "reviewed_at": "2026-11-16",
        }
        merged = apply_counter_overrides(heroes, [relation])
        provenance = {"source": "curation", "reviewed_by": "Draft engine curation", "reviewed_at": "2026-11-16"}
        self.assertEqual(
            merged[0]["counters"],
            [{"target_id": 132, "target_name": "Marco Polo", "severity": "hard", "reason": relation["reason"], **provenance}],
        )
        self.assertEqual(
            merged[1]["countered_by"],
            [{"counter_id": 519, "counter_name": "Ao'yin", "severity": "hard", "reason": relation["reason"], **provenance}],
        )
        self.assertEqual(heroes[0]["counters"], [], "kurasi tidak boleh memutasi roster sumber")
        again = apply_counter_overrides(merged, [relation])
        self.assertEqual(len(again[0]["counters"]), 1)
        self.assertEqual(len(again[1]["countered_by"]), 1)
        with self.assertRaises(ValueError):
            apply_counter_overrides(heroes, [{**relation, "target_id": 9999}])

    def test_scraped_counters_are_labelled_kurohiko_not_curation(self):
        """Relasi dari artikel Kurohiko tidak bolehclaimed sebagai kurasi manual."""
        heroes = [
            {
                "hero_id": 132,
                "name": "Marco Polo",
                "counters": [{"target_id": 199, "target_name": "Arli", "severity": "hard", "reason": "Dash."}],
                "countered_by": [],
            },
            {"hero_id": 199, "name": "Arli", "counters": [], "countered_by": [{"counter_id": 132, "counter_name": "Marco Polo", "severity": "hard", "reason": "Dash."}]},
        ]
        merged = apply_counter_overrides(heroes, [])
        self.assertEqual(merged[0]["counters"][0]["source"], "kurohiko")
        self.assertEqual(merged[1]["countered_by"][0]["source"], "kurohiko")

    def test_master_counter_relations_are_mirrored_in_both_directions(self):
        """Invarian arah counter: h.counters[x] harus berpasangan dengan x.countered_by[h]."""
        master = json.loads((MAPPINGS / "master_heroes_global.json").read_text(encoding="utf-8"))
        by_id = {hero["hero_id"]: hero for hero in master}
        for hero in master:
            for entry in hero.get("counters") or []:
                target = by_id.get(entry["target_id"])
                self.assertIsNotNone(target, f"{hero['name']} menunjuk target tak dikenal")
                mirror = [x for x in (target.get("countered_by") or []) if x["counter_id"] == hero["hero_id"]]
                self.assertTrue(mirror, f"relasi {hero['name']} -> {target['name']} tidak punya cermin")
                self.assertEqual(mirror[0]["reason"], entry["reason"], "alasan harus sama di kedua arah")

    def test_immutable_collision_leaves_existing_manifest_intact(self):
        manifest_v1, texts_v1 = build_package([self.hero], {}, self.releases)
        manifest_v2, texts_v2 = build_package([{**self.hero, "name": "Ata v2"}], {}, self.releases)
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory)
            write_package(dest, manifest_v1, texts_v1)
            original_manifest = (dest / "data_manifest.json").read_bytes()
            # Simulate hash/content collision on an immutable artifact before manifest update.
            artifact_path = dest / manifest_v2["artifacts"]["heroes"]["file"]
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            artifact_path.write_bytes(b"corrupted-existing-artifact")
            with self.assertRaises(ValueError):
                write_package(dest, manifest_v2, texts_v2)
            self.assertEqual((dest / "data_manifest.json").read_bytes(), original_manifest)

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


    def test_measured_matchups_attach_with_sign_convention(self):
        """Bukti terukur KPL hanya boleh terbit dengan tanda yang benar dan sampel memadai."""
        measured_path = MAPPINGS / "hero_measured_matchups.json"
        self.assertTrue(measured_path.exists(), "jalankan extract_kpl_matchups.py lebih dulu")
        measured = json.loads(measured_path.read_text(encoding="utf-8"))
        master = json.loads((MAPPINGS / "master_heroes_global.json").read_text(encoding="utf-8"))
        names = {hero["hero_id"]: hero["name"] for hero in master}

        heroes = load_source_heroes()
        with_measured = [hero for hero in heroes if hero.get("measured_counters") or hero.get("measured_countered_by")]
        self.assertTrue(with_measured, "tidak ada hero dengan matchup terukur")
        self.assertEqual(sorted(int(key) for key in measured["heroes"]), sorted(hero["hero_id"] for hero in with_measured))

        for hero in with_measured:
            self.assertIn("measured_meta", hero)
            self.assertEqual(hero["measured_meta"]["measured_model"], "kpl-measured-matchup-v1")
            self.assertEqual(len(hero["measured_counters"]), len({entry["target_id"] for entry in hero["measured_counters"]}))
            for entry in hero["measured_counters"]:
                self.assertGreater(entry["delta"], 0, f"{hero['name']} vs {entry['target_name']} harus menguntungkan")
                self.assertGreaterEqual(entry["n"], 30)
                self.assertIn("weighted_delta", entry)
                self.assertIn("n_eff", entry)
                self.assertEqual(entry["source"], "kpl_measured")
                self.assertEqual(names[entry["target_id"]], entry["target_name"])
            for entry in hero["measured_countered_by"]:
                self.assertLess(entry["delta"], 0, f"{hero['name']} vs {entry['counter_name']} harus merugikan")
                self.assertGreaterEqual(entry["n"], 30)
                self.assertEqual(entry["source"], "kpl_measured")
                self.assertEqual(names[entry["counter_id"]], entry["counter_name"])
            self.assertLessEqual(len(hero["measured_counters"]), 8)
            self.assertLessEqual(len(hero["measured_countered_by"]), 8)
            deltas = [entry["delta"] for entry in hero["measured_counters"]]
            self.assertEqual(deltas, sorted(deltas, reverse=True))
            penalties = [entry["delta"] for entry in hero["measured_countered_by"]]
            self.assertEqual(penalties, sorted(penalties))

    def test_measured_delta_uses_absent_from_draft_baseline(self):
        """Spot-check Liang: kalah saat Guan Yu melawan, menang saat Lady Zhen melawan.

        Angka nyata KPL (as_of 2026-10-22): Liang vs Guan Yu delta -0.0699 (n=117) dan
        Liang vs Lady Zhen +0.1089 (n=28, di bawah min_sample 30 sehingga artefak produksi
        memangkasnya). Fixture di bawah mengunci SEMANTIK-nya pada jalur kode asli: baseline
        wajib "lawan itu absen dari seluruh draft". Baseline "satu tim" akan membalik tanda
        Guan Yu menjadi positif karena pertandingan satu tim di fixture dimenangkan.
        """
        liang, guan_yu, lady_zhen = 156, 140, 127
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "matchups.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE matches(match_id TEXT PRIMARY KEY, date TEXT);
                CREATE TABLE battles(battle_id TEXT PRIMARY KEY, match_id TEXT, winner_side TEXT, is_complete INTEGER);
                CREATE TABLE draft_actions(battle_id TEXT, ord INTEGER, side TEXT, action TEXT, global_hero_id INTEGER);
                """
            )
            connection.execute("INSERT INTO matches VALUES ('fixture', '2026-01-01')")
            rows = []
            index = 0

            def add_battle(blue_pick, red_pick, winner):
                nonlocal index
                battle_id = f"b{index}"
                index += 1
                connection.execute("INSERT INTO battles VALUES (?, 'fixture', ?, 1)", (battle_id, winner))
                rows.append((battle_id, 5, "blue", "pick", blue_pick))
                rows.append((battle_id, 6, "red", "pick", red_pick))

            for _ in range(32):
                add_battle(liang, guan_yu, "red")          # Liang biru kalah saat Guan Yu melawan
                add_battle(guan_yu, liang, "blue")         # Liang merah kalah saat Guan Yu melawan
                add_battle(liang, lady_zhen, "blue")       # Liang biru menang saat Lady Zhen melawan
                add_battle(lady_zhen, liang, "red")        # Liang merah menang saat Lady Zhen melawan
            connection.executemany("INSERT INTO draft_actions VALUES (?,?,?,?,?)", rows)
            connection.commit()
            connection.close()

            payload, _ = extract_measured_matchups(database)

        entry = payload["heroes"][str(liang)]
        by_target = {row["target_id"]: row for row in entry["measured_counters"]}
        by_source = {row["counter_id"]: row for row in entry["measured_countered_by"]}
        self.assertIn(guan_yu, by_source, "Guan Yu harus terukur sebagai ancaman Liang")
        self.assertNotIn(guan_yu, by_target)
        self.assertLess(by_source[guan_yu]["delta"], 0)
        self.assertIn(lady_zhen, by_target, "Lady Zhen harus terukur sebagai target empuk Liang")
        self.assertNotIn(lady_zhen, by_source)
        self.assertGreater(by_target[lady_zhen]["delta"], 0)

    def test_inactive_alias_511_has_no_measured_matchups(self):
        measured = json.loads((MAPPINGS / "hero_measured_matchups.json").read_text(encoding="utf-8"))
        self.assertNotIn("511", measured["heroes"])
        heroes = load_source_heroes()
        self.assertNotIn(511, [hero["hero_id"] for hero in heroes], "511 adalah alias tidak aktif Ata 556")
        self.assertNotIn(511, [hero["hero_id"] for hero in heroes if hero.get("measured_counters") or hero.get("measured_countered_by")])

    def test_apply_measured_matchups_labels_provenance_without_mutating(self):
        heroes = [
            {"hero_id": 156, "name": "Liang", "counters": [], "countered_by": []},
            {"hero_id": 140, "name": "Guan Yu", "counters": [], "countered_by": []},
        ]
        measured = {
            "heroes": {
                "156": {
                    "measured_counters": [{"target_id": 140, "target_name": "Guan Yu", "delta": 0.05, "weighted_delta": 0.04, "n": 40, "n_eff": 12.5}],
                    "measured_countered_by": [{"counter_id": 999, "counter_name": "Ghost", "delta": -0.03, "weighted_delta": -0.02, "n": 31, "n_eff": 9.0}],
                    "measured_meta": {"measured_model": "kpl-measured-matchup-v1", "measured_games": 60},
                }
            }
        }
        merged = apply_measured_matchups(heroes, measured)
        self.assertEqual([entry["source"] for entry in merged[0]["measured_counters"]], ["kpl_measured"])
        self.assertEqual([entry["source"] for entry in merged[0]["measured_countered_by"]], ["kpl_measured"])
        self.assertEqual(merged[0]["measured_meta"]["measured_games"], 60)
        self.assertNotIn("measured_counters", merged[1])
        self.assertNotIn("measured_counters", heroes[0], "pelabelan tidak boleh memutasi roster sumber")
        self.assertNotIn("source", heroes[0]["counters"])

    def test_load_source_heroes_survives_missing_measured_file(self):
        with tempfile.TemporaryDirectory() as directory:
            mappings = Path(directory)
            (mappings / "master_heroes_global.json").write_text(
                (MAPPINGS / "master_heroes_global.json").read_text(encoding="utf-8"), encoding="utf-8"
            )
            heroes = load_source_heroes(mappings)
            self.assertTrue(heroes)
            self.assertFalse(any("measured_counters" in hero or "measured_meta" in hero for hero in heroes))


if __name__ == "__main__":
    unittest.main()
