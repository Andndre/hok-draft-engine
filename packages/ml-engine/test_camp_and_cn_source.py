"""test_camp_and_cn_source.py
Unit tests for HoK Camp Global and Tencent China ingestion pipeline modules.
"""

import json
import unittest
from pathlib import Path
from camp_source import update_release_status, update_master_heroes_abilities
from cn_pvp_source import clean_html

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"


class TestCampAndCnSource(unittest.TestCase):
    def test_clean_html(self):
        raw = "<p>+20物理攻击</p><br/><span>Extra text</span>"
        cleaned = clean_html(raw)
        self.assertEqual(cleaned, "+20物理攻击 Extra text")

    def test_camp_heroes_mapping_exists_and_valid(self):
        camp_heroes_file = MAPPINGS / "camp_heroes.json"
        self.assertTrue(camp_heroes_file.exists(), "camp_heroes.json must exist")
        data = json.loads(camp_heroes_file.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(data), 120, "Should have at least 120 Global heroes")
        sample = data[0]
        self.assertIn("hero_id", sample)
        self.assertIn("name", sample)

    def test_camp_skills_mapping_exists_and_valid(self):
        camp_skills_file = MAPPINGS / "camp_skills.json"
        self.assertTrue(camp_skills_file.exists(), "camp_skills.json must exist")
        data = json.loads(camp_skills_file.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(data), 119, "Should have at least 119 skillsets")
        # Butterfly 646 should have skills
        self.assertIn("646", data)
        bf_skills = data["646"]
        self.assertGreaterEqual(len(bf_skills), 4)

    def test_cn_dictionaries_exist_and_valid(self):
        items_file = MAPPINGS / "cn_items.json"
        spells_file = MAPPINGS / "cn_spells.json"
        arcana_file = MAPPINGS / "cn_arcana.json"
        cn_heroes_file = MAPPINGS / "cn_heroes.json"

        self.assertTrue(items_file.exists(), "cn_items.json must exist")
        self.assertTrue(spells_file.exists(), "cn_spells.json must exist")
        self.assertTrue(arcana_file.exists(), "cn_arcana.json must exist")
        self.assertTrue(cn_heroes_file.exists(), "cn_heroes.json must exist")

        items = json.loads(items_file.read_text(encoding="utf-8"))
        spells = json.loads(spells_file.read_text(encoding="utf-8"))
        arcana = json.loads(arcana_file.read_text(encoding="utf-8"))
        cn_heroes = json.loads(cn_heroes_file.read_text(encoding="utf-8"))

        self.assertGreaterEqual(len(items), 115)
        self.assertGreaterEqual(len(spells), 12)
        self.assertGreaterEqual(len(arcana), 93)
        self.assertGreaterEqual(len(cn_heroes), 10)

        # Check Master Luban 525 in CN heroes
        luban = next((h for h in cn_heroes if h.get("hero_id") == 525), None)
        self.assertIsNotNone(luban, "Master Luban 525 must be present in CN heroes")
        self.assertGreaterEqual(len(luban.get("skills", [])), 4)

    def test_alias_511_protection(self):
        releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
        self.assertEqual(releases.get("511"), {"released": False, "alias_of": 556})


if __name__ == "__main__":
    unittest.main()
