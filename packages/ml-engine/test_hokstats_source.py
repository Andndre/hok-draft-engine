import json
import tempfile
import unittest
from pathlib import Path

from hokstats_source import parse_counters_page, parse_hero_index, parse_hero_page, parse_item_index, parse_item_page, parse_spell_page, resolve_catalog_item, review_catalog_record, review_guide, review_matchup
from publish_data import attach_hokstats, build_catalogs


HEROES = [
    {"hero_id": 640, "name": "Annette", "slug": "annette", "chinese_name": "安奈特"},
    {"hero_id": 126, "name": "Dun", "slug": "dun", "chinese_name": "夏侯惇"},
    {"hero_id": 193, "name": "Zhang Fei", "slug": "zhang-fei", "chinese_name": "张飞"},
]


class HoKStatsImporterTests(unittest.TestCase):
    def test_annette_skill_pick_guide_and_matchup_direction(self):
        html = """<html><h1>Annette</h1>
        <section data-hokstats-section="Skills"><article data-skill><h3>Whirlwind</h3><p>Pushes enemies away and protects allies.</p></article></section>
        <section data-hokstats-section="Pick when"><ul><li>Your team needs peel.</li></ul></section>
        <section data-hokstats-section="Avoid when"><ul><li>Enemies can dive the back line.</li></ul></section>
        <section data-hokstats-section="Power spikes"><ul><li>Level 4 teamfight.</li></ul></section>
        <section data-hokstats-section="Strong against"><ul><li><a href="/heroes/dun/">Dun</a></li></ul></section>
        <section data-hokstats-section="Countered by"><ul><li><a href="/heroes/zhang-fei/">Zhang Fei</a></li></ul></section>
        <section data-hokstats-section="Partners"><ul><li><a href="/heroes/dun/">Dun</a></li></ul></section>
        <article data-build><h3>Peel Setup</h3><p>Against dive.</p><a href="/items/1127/">Guardian Armor</a><a href="/items/1222/">Boots</a><a href="/items/1233/">Cloak</a></article>
        </html>"""
        record, coverage = parse_hero_page(html, "https://hokstats.gg/heroes/annette/", HEROES, fetched_at="2026-11-09T00:00:00+00:00")
        guide = record["guide"]
        self.assertEqual(record["hero_id"], 640)
        self.assertEqual(guide["skills"][0], {"name": "Whirlwind", "description": "Pushes enemies away and protects allies."})
        self.assertEqual(guide["pick_when"], ["Your team needs peel."])
        self.assertEqual(guide["avoid_when"], ["Enemies can dive the back line."])
        self.assertEqual(guide["matchups"][0]["relation"], "strong_against")
        self.assertEqual(guide["matchups"][0]["hero_id"], 126)
        self.assertEqual(guide["matchups"][1]["relation"], "countered_by")
        self.assertEqual(guide["matchups"][1]["hero_id"], 193)
        self.assertEqual(guide["build_variants"][0]["items"], ["Guardian Armor", "Boots", "Cloak"])
        self.assertEqual(coverage["unmatched_relations"], [])

    def test_angela_five_build_presets_and_aliases(self):
        builds = "".join(f'<article data-build><h3>Preset {i}</h3><a href="/items/{1100+i}/">Item {i}</a><a href="/items/{1200+i}/">Item B{i}</a><a href="/items/{1300+i}/">Item C{i}</a></article>' for i in range(1, 6))
        html = f"<h1>Angela</h1>{builds}"
        aliases = {"annette": 640, "angela": 142}
        heroes = HEROES + [{"hero_id": 142, "name": "Angela", "slug": "angela-global", "chinese_name": "安琪拉"}]
        record, _ = parse_hero_page(html, "https://hokstats.gg/heroes/angela/", heroes, aliases)
        self.assertEqual(record["hero_id"], 142)
        self.assertEqual(len(record["guide"]["build_variants"]), 5)
        local = [{"id": 9, "name": "Guardian Mail"}]
        self.assertEqual(resolve_catalog_item({"id": 777, "name": "Guardian Plating"}, local, {"Guardian Plating": 9})["id"], 9)
        self.assertIsNone(resolve_catalog_item({"id": 888, "name": "Unmapped Orb"}, local, {}))

    def test_current_hero_markup_parses_skills_decision_guide_matchups_and_five_builds(self):
        annette_html = """<h1>Annette</h1>
        <section><h2>Skills</h2><div class="space-y-1.5">
          <div class="bg-card border border-border rounded-lg"><div class="flex items-center gap-2"><span>passive</span><span>Whisperwind</span></div><p>Gains Mana while moving.</p></div>
          <div class="bg-card border border-border rounded-lg"><div class="flex items-center gap-2"><span>ultimate</span><span>Hurricane Wall</span></div><p>Knocks enemies back and shields allies.</p></div>
        </div></section>
        <section><h2>Current patch decision guide</h2>
          <div><h3>Pick Annette when</h3><div><ul><li>Your team needs peel.</li></ul></div></div>
          <div><h3>Avoid Annette when</h3><div><ul><li>Your team lacks damage.</li></ul></div></div>
          <div><h3>Power spikes</h3><div><div class="bg-elevated">Level 4 teamfight.</div></div></div>
        </section>
        <section><h2>Matchups</h2><div><p>Strong vs</p><div><a href="/heroes/dun/"><span>Dun</span><span>Editorial pick</span><span>Hurricane Wall stops his engage.</span></a></div>
          <p>Struggles against</p><div><a href="/heroes/zhang-fei/"><span>Zhang Fei</span><span>He can interrupt her setup.</span></a></div></div></section>"""
        record, _ = parse_hero_page(annette_html, "https://hokstats.gg/heroes/annette/", HEROES)
        guide = record["guide"]
        self.assertEqual(guide["skills"][0], {"name": "Whisperwind", "description": "Gains Mana while moving.", "type": "passive"})
        self.assertEqual(guide["pick_when"], ["Your team needs peel."])
        self.assertEqual(guide["avoid_when"], ["Your team lacks damage."])
        self.assertEqual(guide["power_spikes"], ["Level 4 teamfight."])
        self.assertEqual(guide["matchups"][0]["relation"], "strong_against")
        self.assertEqual(guide["matchups"][0]["hero_id"], 126)
        self.assertEqual(guide["matchups"][0]["evidence"], "Hurricane Wall stops his engage.")
        self.assertEqual(guide["matchups"][1]["relation"], "countered_by")
        self.assertEqual(guide["matchups"][1]["hero_id"], 193)

        cards = "".join(
            f'<div class="bg-card border border-border rounded-lg p-4"><h3>Preset {i}</h3><p>Use case {i}</p>'
            f'<a href="/items/{1100+i}/"><span class="text-sm">Item {i}A</span></a>'
            f'<a href="/items/{1200+i}/"><span class="text-sm">Item {i}B</span></a>'
            f'<a href="/items/{1300+i}/"><span class="text-sm">Item {i}C</span></a></div>'
            for i in range(1, 6)
        )
        heroes = HEROES + [{"hero_id": 142, "name": "Angela", "slug": "angela", "chinese_name": "Angela"}]
        angela, _ = parse_hero_page(f'<h1>Angela</h1><section><h2>Build</h2>{cards}</section>', "https://hokstats.gg/heroes/angela/", heroes)
        self.assertEqual(len(angela["guide"]["build_variants"]), 5)
        self.assertEqual(angela["guide"]["build_variants"][0]["items"], ["Item 1A", "Item 1B", "Item 1C"])

    def test_hero_index_uses_link_slug_and_visible_name_alias_and_reports_unknown(self):
        html = """<a href="/heroes/dun/">D Dun A Clash Lane</a>
        <a href="/heroes/zhang-fei-v2/">Z Zhang Fei B Roam</a>
        <a href="/heroes/mystery-hero/">Mystery Hero</a>"""
        slugs, unmatched = parse_hero_index(html, "https://hokstats.gg/", HEROES)
        self.assertEqual(slugs, {126: "dun", 193: "zhang-fei-v2"})
        self.assertEqual(unmatched[0]["reason"], "unmatched_hero_index_entry")

    def test_item_and_spell_detail_fields_keep_provenance(self):
        item = parse_item_page("""<h1>Guardian Armor</h1><section data-hokstats-section="Stats"><p>+240 Physical Defense</p></section><section data-hokstats-section="Passive"><p>Reduces damage from basic attacks.</p></section><section data-hokstats-section="Build path"><a href="/items/1111/">Iron Sword</a></section>""", "https://hokstats.gg/items/1127/")
        self.assertEqual(item["id"], 1127)
        self.assertIn("240", item["stats"]["stats"])
        self.assertIn("basic attacks", item["passive"])
        self.assertEqual(item["build_path"], ["Iron Sword"])
        self.assertEqual(item["source"]["review_status"], "pending")

        spells = parse_spell_page("""<article data-spell><h3>Purify</h3><dl><dt>Cooldown</dt><dd>120s</dd><dt>Effect</dt><dd>Cleanse crowd control from the hero.</dd><dt>Best for</dt><dd>Control, burst</dd></dl></article>""", "https://hokstats.gg/spells/")
        self.assertEqual(spells[0]["name"], "Purify")
        self.assertEqual(spells[0]["cooldown"], "120s")
        self.assertIn("Cleanse", spells[0]["effect"])
        self.assertEqual(spells[0]["best_for"], ["Control", "burst"])

    def test_current_item_spell_and_catalog_index_markup(self):
        item_html = """<h1>Amble - Winter Honor of Kings Item</h1>
        <section><h2>Base stats</h2><div>Cooldown Reduction +7.5% Physical Defense +150 Health +900</div></section>
        <section><h2>Item skills</h2><div data-skill-kind="passive"><p>Passive</p><p>Ice Armor Resistance +10%.</p></div>
          <div data-skill-kind="active"><p>Active</p><p>Impact Freezes enemies.</p></div></section>
        <section><h2>Build Path</h2><p>Built from</p><a href="/items/1341/"><span class="text-sm">Frigid Charge</span><span class="data-num">2030</span></a></section>"""
        item = parse_item_page(item_html, "https://hokstats.gg/items/1351/")
        self.assertEqual(item["name"], "Amble - Winter")
        self.assertIn("Ice Armor", item["passive"])
        self.assertIn("Impact", item["active"])
        self.assertEqual(item["build_path"], ["Frigid Charge"])

        spell_html = """<article id="spell-flash" data-spell-id="80110"><h2>Flash</h2>
        <p>Cooldown <span>120</span><span>seconds</span></p><p class="mb-4 text-sm">Instantly teleports a short distance.</p>
        <div><p>Best for</p><p>Escaping danger and repositioning.</p></div></article>"""
        spell = parse_spell_page(spell_html, "https://hokstats.gg/spells/")[0]
        self.assertEqual(spell["cooldown"], "120 seconds")
        self.assertEqual(spell["effect"], "Instantly teleports a short distance.")
        self.assertEqual(spell["best_for"], ["Escaping danger and repositioning."])

        index_html = """<a href="/pt-br/items/">Itens</a><a href="/id/items/">Item</a>
        <a href="/items/1351/"><span class="text-sm">Amble - Winter</span><span class="data-num">5220</span></a>"""
        entries = parse_item_index(index_html)
        self.assertEqual(entries, [{"id": 1351, "name": "Amble - Winter", "url": "https://hokstats.gg/items/1351/"}])

    def test_counters_page_keeps_relation_orientation_and_reports_unmatched_targets(self):
        html = """<article><h3><a href="/heroes/annette/">Annette</a></h3>
        <div data-relation="strong_against"><a href="/heroes/dun/">Dun</a></div>
        <div data-relation="countered_by"><a href="/heroes/zhang-fei/">Zhang Fei</a></div>
        <div data-relation="strong_against"><a href="/heroes/unknown/">Unknown Hero</a></div></article>"""
        result, unmatched = parse_counters_page(html, "https://hokstats.gg/counters/", HEROES)
        self.assertEqual(result[640][0]["relation"], "strong_against")
        self.assertEqual(result[640][0]["hero_id"], 126)
        self.assertEqual(result[640][1]["relation"], "countered_by")
        self.assertEqual(result[640][1]["hero_id"], 193)
        self.assertEqual(unmatched[0]["reason"], "unmatched_matchup_target")

    def test_current_counter_index_markup_keeps_relation_orientation(self):
        html = """<article data-counter-hero="annette"><h2><a href="/heroes/annette/">Annette</a></h2>
        <div><h3>Strong against</h3><ul><li><a href="/heroes/dun/">Dun</a></li></ul></div>
        <div><h3>Countered by</h3><ul><li><a href="/heroes/zhang-fei/">Zhang Fei</a></li></ul></div></article>"""
        result, unmatched = parse_counters_page(html, "https://hokstats.gg/counters/", HEROES)
        self.assertEqual([x["relation"] for x in result[640]], ["strong_against", "countered_by"])
        self.assertEqual([x["hero_id"] for x in result[640]], [126, 193])
        self.assertEqual(unmatched, [])

    def test_unmatched_hero_is_not_published_and_text_change_changes_source_hash(self):
        missing, report = parse_hero_page("<h1>Unknown</h1>", "https://hokstats.gg/heroes/unknown/", HEROES)
        self.assertIsNone(missing)
        self.assertEqual(report["reason"], "unmatched_hero")
        html = '<h1>Annette</h1><section data-hokstats-section="Skills"><p>Version A</p></section>'
        first, _ = parse_hero_page(html, "https://hokstats.gg/heroes/annette/", HEROES)
        second, _ = parse_hero_page(html.replace("Version A", "Version B"), "https://hokstats.gg/heroes/annette/", HEROES)
        self.assertNotEqual(first["guide"]["source"]["source_hash"], second["guide"]["source"]["source_hash"])

    def test_catalogs_keep_hokfire_and_hokstats_source_records_separate(self):
        items, spells = build_catalogs(
            [{"id": 1, "name": "Iron Sword", "type": "Attack", "desc": "Local description"}],
            {"Flash": "Local spell description"},
            [{"id": 800, "local_id": 1, "name": "Iron Sword", "stats": {"Attack": "+20"}, "passive": "None", "build_path": [], "source": {"source": "HoKStats", "review_status": "pending"}}],
            [{"id": "flash", "name": "Flash", "effect": "Source effect", "cooldown": "120s", "best_for": [], "source": {"source": "HoKStats", "review_status": "pending"}}],
        )
        self.assertEqual(items[0]["sources"]["hokfire"]["description"], "Local description")
        self.assertIn("stats", items[0]["sources"]["hokstats"])
        self.assertEqual(spells[0]["sources"]["hokfire"]["effect"], "Local spell description")
        self.assertEqual(spells[0]["sources"]["hokstats"]["cooldown"], "120s")

    def test_reviews_bind_to_source_hash_and_expire_when_imported_content_changes(self):
        html = """<h1>Annette</h1><section data-hokstats-section="Strong against"><ul><li><a href="/heroes/dun/">Dun</a></li></ul></section>"""
        record, _ = parse_hero_page(html, "https://hokstats.gg/heroes/annette/", HEROES)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "hokstats_heroes.json").write_text(json.dumps([record]), encoding="utf-8")
            guide_review = review_guide(640, "Reviewer", "approved", root)
            matchup_review = review_matchup(640, "strong_against", 126, "Reviewer", "approved", root)
            attached = attach_hokstats([HEROES[0]], [record], [matchup_review], [guide_review])[0]["hokstats_guide"]
            self.assertEqual(attached["source"]["review_status"], "approved")
            self.assertEqual(attached["matchups"][0]["source"]["review_status"], "approved")
            updated = json.loads(json.dumps(record))
            updated["guide"]["source"]["source_hash"] = "changed-content"
            updated["guide"]["matchups"][0]["source"]["source_hash"] = "changed-content"
            stale = attach_hokstats([HEROES[0]], [updated], [matchup_review], [guide_review])[0]["hokstats_guide"]
            self.assertEqual(stale["source"]["review_status"], "pending")
            self.assertEqual(stale["matchups"][0]["source"]["review_status"], "pending")

            item = {"id": 1127, "local_id": 1127, "name": "Guardian Armor", "source": {"source_hash": "item-hash"}}
            (root / "hokstats_items.json").write_text(json.dumps([item]), encoding="utf-8")
            review_catalog_record("item", "1127", "Reviewer", "approved", root)
            item_review = json.loads((root / "hokstats_catalog_reviews.json").read_text(encoding="utf-8"))[0]
            self.assertEqual(item_review["status"], "approved")
            reviewed, _ = build_catalogs([], {}, [item], [], [item_review])
            self.assertEqual(reviewed[0]["sources"]["hokstats"]["source"]["review_status"], "approved")
            updated_item = {**item, "source": {"source_hash": "new-item-hash"}}
            stale, _ = build_catalogs([], {}, [updated_item], [], [item_review])
            self.assertEqual(stale[0]["sources"]["hokstats"]["source"]["review_status"], "pending")


if __name__ == "__main__":
    unittest.main()
