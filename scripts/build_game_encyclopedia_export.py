"""
build_game_encyclopedia_export.py
Ekstraksi data murni GAME HONOR OF KINGS (Gameplay, Hero, Skill, Item, Arcana, Spell, Counter)
untuk diimpor ke Google NotebookLM. Nol informasi arsitektur kode/aplikasi.
"""

import json
from pathlib import Path

ROOT = Path("D:/hok-draft-engine")
EXPORT_DIR = ROOT / "notebooklm-export"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

def load_json(rel_path):
    p = ROOT / rel_path
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def write_export(filename, content):
    dest = EXPORT_DIR / filename
    with open(dest, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")
    size_kb = dest.stat().st_size / 1024
    print(f"Generated: {filename} ({size_kb:.1f} KB)")

# Load core datasets
master_heroes = load_json("data/mappings/master_heroes_global.json") or []
hokstats_heroes = load_json("data/mappings/hokstats_heroes.json") or []
items_raw = load_json("data/mappings/hokstats_items.json") or []
arcana_raw = load_json("data/mappings/arcana_hokfire_full.json") or {}
spells_raw = load_json("data/mappings/hokstats_spells.json") or []

# Build lookup maps
hs_map = {h["hero_id"]: h.get("guide", {}) for h in hokstats_heroes if "hero_id" in h}
# Filter to 120 global released heroes (exclude #511 alias)
global_heroes = [
    h for h in master_heroes 
    if h.get("is_global_released", True) and h.get("hero_id") != 511
]
global_heroes.sort(key=lambda h: h.get("name", ""))

print(f"Loaded {len(global_heroes)} released global heroes.")

# ==============================================================================
# 00. MASTER INDEX
# ==============================================================================
def generate_00_index():
    content = """# Honor of Kings (HoK) — Master Encyclopedia & Teori Gameplay

Dokumen ini adalah indeks navigasi untuk kumpulan berkas pengetahuan resmi game **Honor of Kings (HoK Global)**. Seluruh materi di dalam direktori ini berfokus 100% pada **mekanik game, data hero, deskripsi skill, itemisasi, konfigurasi arcana, battle spells, serta relasi counter dan sinergi taktis**.

---

## Daftar Berkas Pengetahuan Game (Siap Impor ke NotebookLM)

| Berkas | Kategori | Ringkasan Isi |
|---|---|---|
| **`01_ENCYCLOPEDIA_ITEM_DAN_EQUIPMENT.md`** | Equipment | 107 Item Honor of Kings lengkap: Physical Attack, Magical, Defense, Jungling, Roaming, dan Movement Boots (Base stats, pasif unik, skill aktif, harga, & build path). |
| **`02_ENCYCLOPEDIA_ARCANA_DAN_BATTLE_SPELLS.md`** | Arcana & Spells | 46 Arcana Level 5 (Merah, Biru, Hijau) + 10 Battle Spells (Flash, Smite, Purify, Execute, Frenzy, Disrupt, Intimidate, Sprint, Heal, Daze) beserta efek dan kegunaan taktisnya. |
| **`03_KATALOG_120_HERO_DAN_GAYA_MAIN.md`** | Profil Hero | Direktori komprehensif 120 Hero Global: Role, Lane primer/flex, status popularitas, winrate kompetitif KPL vs Ranked, kondisi pick/avoid, power spikes (early/mid/late), dan kesalahan umum. |
| **`04_SKILL_HERO_CLASH_LANE.md`** | Skill & Mekanik | Detail seluruh skill (Pasif, Skill 1, 2, Ultimate) untuk 30 Hero Clash Lane (Fighter & Tank solo). |
| **`05_SKILL_HERO_JUNGLE_LANE.md`** | Skill & Mekanik | Detail seluruh skill (Pasif, Skill 1, 2, Ultimate) untuk 27 Hero Jungle Lane (Assassin & Jungler). |
| **`06_SKILL_HERO_MID_LANE.md`** | Skill & Mekanik | Detail seluruh skill (Pasif, Skill 1, 2, Ultimate) untuk 27 Hero Mid Lane (Mage kontrol & burst). |
| **`07_SKILL_HERO_FARM_LANE.md`** | Skill & Mekanik | Detail seluruh skill (Pasif, Skill 1, 2, Ultimate) untuk 18 Hero Farm Lane (Marksman / ADC). |
| **`08_SKILL_HERO_ROAMING_LANE.md`** | Skill & Mekanik | Detail seluruh skill (Pasif, Skill 1, 2, Ultimate) untuk 18 Hero Roaming Lane (Support & Tank peel/engage). |
| **`09_RELASI_COUNTER_DAN_MATCHUP_LENGKAP.md`** | Taktik & Matchup | Matriks relasi counter antar hero: siapa meng-counter siapa dengan alasan mekanik skill, tips mengalahkan masing-masing hero, item counter rekomendasi, dan duet sinergi terbaik. |

---

## Petunjuk Penggunaan untuk Pembelajaran di NotebookLM
1. Unggah ke-10 berkas ini ke dalam sumber Google NotebookLM Anda.
2. Anda dapat langsung menanyakan komparasi mekanik hero, simulasi matchup (misal: *"Bagaimana cara counter Liang jika musuh first pick?"*), rekomendasi build item untuk tipe musuh tertentu, atau perbandingan power spike antar lane.
"""
    write_export("00_PANDUAN_DAN_INDEKS_GAMEPLAY.md", content)

# ==============================================================================
# 01. ITEMS ENCYCLOPEDIA
# ==============================================================================
def generate_01_items():
    categories = {
        "11": "Physical Attack Equipment (Serangan Fisik)",
        "12": "Magical Attack Equipment (Serangan Magis)",
        "13": "Defense Equipment (Pertahanan Fisik, Magis, & HP)",
        "14": "Jungling Equipment (Perlengkapan Hutan)",
        "15": "Roaming / Support Equipment (Perlengkapan Support)",
        "17": "Movement Equipment / Boots (Sepatu & Mobilitas)"
    }

    # Group items by prefix
    grouped = {}
    for item in items_raw:
        item_id = str(item.get("id", ""))
        prefix = item_id[:2]
        grouped.setdefault(prefix, []).append(item)

    lines = [
        "# 01 — Ensiklopedia Item dan Equipment Honor of Kings",
        "",
        "Dokumen ini memuat daftar 107 Item Equipment resmi di Honor of Kings Global beserta atribut dasar (*base stats*), efek pasif unik, kemampuan aktif, dan jalur pembuatan (*build path*).",
        ""
    ]

    for prefix in ["11", "12", "13", "14", "15", "17"]:
        cat_name = categories.get(prefix, f"Category {prefix}")
        item_list = grouped.get(prefix, [])
        item_list.sort(key=lambda x: x.get("name", ""))

        lines.append(f"## {cat_name} (Total: {len(item_list)} Item)")
        lines.append("")

        for it in item_list:
            name = it.get("name", "Unknown Item")
            iid = it.get("id")
            stats = it.get("stats", {}).get("basestats", "None")
            passive = it.get("passive")
            active = it.get("active")
            build_path = ", ".join(it.get("build_path", [])) if it.get("build_path") else "-"

            lines.append(f"### {name} (ID: {iid})")
            lines.append(f"- **Atribut Dasar:** {stats}")
            if passive:
                lines.append(f"- **Efek Pasif Unik:** {passive}")
            if active:
                lines.append(f"- **Efek Aktif:** {active}")
            lines.append(f"- **Komponen / Build Path:** {build_path}")
            lines.append("")

    write_export("01_ENCYCLOPEDIA_ITEM_DAN_EQUIPMENT.md", "\n".join(lines))

# ==============================================================================
# 02. ARCANA & SPELLS
# ==============================================================================
def generate_02_arcana_spells():
    lines = [
        "# 02 — Ensiklopedia Arcana dan Battle Spells Honor of Kings",
        "",
        "## 1. Sistem Arcana Honor of Kings",
        "",
        "Arcana adalah sistem rune permanen di Honor of Kings yang memberikan atribut dasar tambahan sejak detik pertama pertandingan. Pemain membawa 30 slot Arcana (10 Merah, 10 Biru, 10 Hijau).",
        ""
    ]

    # Arcana groups
    color_names = {
        "R": "Arcana Merah (Fokus: Attack, Critical, Attack Speed, Physical/Magic Pierce)",
        "B": "Arcana Biru (Fokus: Movement Speed, Lifesteal, HP, Mana, Attack/Magic)",
        "G": "Arcana Hijau (Fokus: Physical/Magic Defense, Cooldown Reduction, HP, Pierce)"
    }

    # Group arcana by color
    arc_grouped = {"R": [], "B": [], "G": []}
    arc_items = arcana_raw.values() if isinstance(arcana_raw, dict) else arcana_raw
    for a in arc_items:
        c = a.get("color", "R")
        arc_grouped.setdefault(c, []).append(a)

    for c in ["R", "B", "G"]:
        c_title = color_names.get(c, f"Arcana {c}")
        arc_list = arc_grouped.get(c, [])
        arc_list.sort(key=lambda x: x.get("name", ""))

        lines.append(f"### {c_title} (Total: {len(arc_list)} Arcana)")
        lines.append("")
        lines.append("| ID | Nama Arcana | Warna | Efek / Atribut Kunci |")
        lines.append("|---|---|---|---|")
        for a in arc_list:
            aid = a.get("id")
            aname = a.get("name")
            adesc = a.get("desc", "-")
            lines.append(f"| {aid} | **{aname}** | {c} | {adesc} |")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 2. Ensiklopedia Battle Spells (10 Spell Resmi)")
    lines.append("")
    lines.append("Battle Spells adalah kemampuan aktif tambahan yang dipilih pemain sebelum pertandingan dimulai dengan cooldown bervariasi:")
    lines.append("")

    for s in spells_raw:
        sname = s.get("name")
        seffect = s.get("effect")
        scd = s.get("cooldown")
        sbest = ", ".join(s.get("best_for", []))

        lines.append(f"### {sname}")
        lines.append(f"- **Cooldown:** {scd}")
        lines.append(f"- **Efek Mekanik:** {seffect}")
        lines.append(f"- **Rekomendasi Penggunaan / Tipe Hero:** {sbest}")
        lines.append("")

    write_export("02_ENCYCLOPEDIA_ARCANA_DAN_BATTLE_SPELLS.md", "\n".join(lines))

# ==============================================================================
# 03. HEROES OVERVIEW & PLAYSTYLES
# ==============================================================================
def generate_03_hero_overview():
    lines = [
        "# 03 — Katalog 120 Hero Honor of Kings dan Gaya Bermain",
        "",
        "Dokumen ini menyajikan direktori taktis 120 Hero Global: penugasan lane, popularitas ladder vs kekuatan KPL, kondisi pick ideal, kondisi penghindaran, kurva power spike, serta kesalahan umum pemakaian.",
        ""
    ]

    for h in global_heroes:
        hid = h.get("hero_id")
        name = h.get("name")
        cname = h.get("chinese_name", "-")
        title = h.get("title", "-")
        role = h.get("primary_role", "-")
        plane = h.get("primary_lane", "-")
        lanes = ", ".join(h.get("lanes", []))
        pop = h.get("popularity_band", h.get("tier", "-"))
        wr_ranked = f"{h.get('win_rate', 0)*100:.1f}%" if h.get("win_rate") else "-"
        wr_kpl = f"{h.get('kpl_win_rate', 0)*100:.1f}%" if h.get("kpl_win_rate") else "-"

        guide = hs_map.get(hid, {})
        pick_when = guide.get("pick_when", [])
        avoid_when = guide.get("avoid_when", [])
        spikes = guide.get("power_spikes", [])
        mistakes = guide.get("common_mistakes", [])
        partners = [p.get("hero_name") for p in guide.get("partners", []) if p.get("hero_name")]

        lines.append(f"## {name} — {title} ({cname}) [ID: {hid}]")
        lines.append(f"- **Role / Lane:** {role} | Lane Primer: **{plane}** (Legal: {lanes})")
        lines.append(f"- **Statistik Meta:** Popularity Band: `{pop}` | Winrate Ranked: `{wr_ranked}` | Winrate KPL Pro: `{wr_kpl}`")
        
        if pick_when:
            lines.append("- **Kapan Harus Pick (Kondisi Ideal):**")
            for pw in pick_when:
                lines.append(f"  - {pw}")
        if avoid_when:
            lines.append("- **Kapan Harus Dihindari (Kondisi Buruk / Ter-counter):**")
            for aw in avoid_when:
                lines.append(f"  - {aw}")
        if spikes:
            lines.append("- **Kurva Kekuatan (Power Spikes):**")
            for sp in spikes:
                lines.append(f"  - {sp}")
        if mistakes:
            lines.append("- **Kesalahan Umum Pemain:**")
            for cm in mistakes:
                lines.append(f"  - {cm}")
        if partners:
            lines.append(f"- **Partner Sinergi Duet Terbaik:** {', '.join(partners)}")
        lines.append("")

    write_export("03_KATALOG_120_HERO_DAN_GAYA_MAIN.md", "\n".join(lines))

# ==============================================================================
# 04-08. HERO SKILLS & ABILITIES BY LANE
# ==============================================================================
def generate_lane_skills(lane_name, filename):
    heroes_in_lane = [h for h in global_heroes if h.get("primary_lane") == lane_name]
    heroes_in_lane.sort(key=lambda h: h.get("name", ""))

    lines = [
        f"# Ensiklopedia Skill Hero — {lane_name.upper()} LANE (Total: {len(heroes_in_lane)} Hero)",
        "",
        f"Dokumen ini memuat deskripsi lengkap seluruh skill resmi (Pasif, Skill 1, Skill 2, dan Ultimate) dari setiap hero yang menempati **{lane_name} Lane** di Honor of Kings Global.",
        ""
    ]

    for h in heroes_in_lane:
        hid = h.get("hero_id")
        name = h.get("name")
        cname = h.get("chinese_name", "-")
        title = h.get("title", "-")
        role = h.get("primary_role", "-")
        lanes = ", ".join(h.get("lanes", []))

        lines.append(f"## {name} ({cname}) — {title}")
        lines.append(f"- **ID:** {hid} | **Role:** {role} | **Lane:** {lanes}")
        lines.append("")

        # Skills from master_heroes_global or hokstats
        abilities = h.get("abilities", [])
        if not abilities:
            guide = hs_map.get(hid, {})
            abilities = guide.get("skills", [])

        if abilities:
            for ab in abilities:
                stype = ab.get("type", "Skill")
                sname = ab.get("name", "Ability")
                sdesc = ab.get("desc") or ab.get("description", "Tidak ada deskripsi.")
                lines.append(f"### [{stype}] {sname}")
                lines.append(f"{sdesc}")
                lines.append("")
        else:
            lines.append("_Informasi skill belum tersedia di repositori._\n")
        lines.append("---")
        lines.append("")

    write_export(filename, "\n".join(lines))

# ==============================================================================
# 09. COUNTERS, MATCHUPS, AND TACTICAL TIPS
# ==============================================================================
def generate_09_counters():
    lines = [
        "# 09 — Relasi Counter, Matchup Hero, dan Panduan Taktis Lengkap",
        "",
        "Dokumen ini menyajikan data relasi counter alami antar hero Honor of Kings Global, alasan mekanis mengapa suatu hero unggul/lemah terhadap hero lain, tips taktis cara mengalahkan masing-masing hero, serta rekomendasi item penangkal.",
        ""
    ]

    for h in global_heroes:
        hid = h.get("hero_id")
        name = h.get("name")
        cname = h.get("chinese_name", "-")
        plane = h.get("primary_lane", "-")

        counters = h.get("counters", [])
        countered_by = h.get("countered_by", [])
        tactical_tips = h.get("tactical_tips", "-")
        counter_items = h.get("counter_items", [])

        lines.append(f"## {name} ({cname}) [Lane: {plane}]")
        lines.append("")

        # Tips to beat
        lines.append("### 🎯 Cara Menghadapi / Tips Mengalahkan:")
        lines.append(f"> {tactical_tips}")
        lines.append("")

        # Counters (Unggul melawan)
        lines.append(f"### ⚔️ Hero yang DI-COUNTER oleh {name} (Kuat / Unggul Melawan):")
        if counters:
            for c in counters:
                tname = c.get("target_name", f"Hero {c.get('target_id')}")
                sev = c.get("severity", "normal").upper()
                reason = c.get("reason", "Alasan mekanis belum tercatat.")
                lines.append(f"- **{tname}** `[{sev} COUNTER]`: {reason}")
        else:
            lines.append("- _Belum ada data counter terdaftar._")
        lines.append("")

        # Countered By (Lemah melawan)
        lines.append(f"### 🛡️ Hero yang MENG-COUNTER {name} (Lemah / Terancam Oleh):")
        if countered_by:
            for cb in countered_by:
                cname_h = cb.get("counter_name", f"Hero {cb.get('counter_id')}")
                sev = cb.get("severity", "normal").upper()
                reason = cb.get("reason", "Alasan mekanis belum tercatat.")
                lines.append(f"- **{cname_h}** `[{sev} ANCAMAN]`: {reason}")
        else:
            lines.append("- _Belum ada data ancaman terdaftar._")
        lines.append("")

        # Counter Items
        if counter_items:
            lines.append("### 🛡️ Item Counter Rekomendasi:")
            for ci in counter_items:
                iname = ci.get("name")
                idesc = ci.get("description", "-")
                lines.append(f"- **{iname}**: {idesc}")
            lines.append("")

        lines.append("---")
        lines.append("")

    write_export("09_RELASI_COUNTER_DAN_MATCHUP_LENGKAP.md", "\n".join(lines))

if __name__ == "__main__":
    generate_00_index()
    generate_01_items()
    generate_02_arcana_spells()
    generate_03_hero_overview()
    generate_lane_skills("Clash", "04_SKILL_HERO_CLASH_LANE.md")
    generate_lane_skills("Jungle", "05_SKILL_HERO_JUNGLE_LANE.md")
    generate_lane_skills("Mid", "06_SKILL_HERO_MID_LANE.md")
    generate_lane_skills("Farm", "07_SKILL_HERO_FARM_LANE.md")
    generate_lane_skills("Roam", "08_SKILL_HERO_ROAMING_LANE.md")
    generate_09_counters()
    print("All 10 game encyclopedia dossiers generated successfully!")
