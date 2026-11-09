import copy
import json
import tempfile
import unittest
from pathlib import Path
from publish_data import build_package, publish_package, write_package
from tactical_profiles import TAGS, approved_profiles, create_proposal, validate_proposal


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


if __name__ == "__main__":
    unittest.main()
