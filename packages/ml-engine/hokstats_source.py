"""Offline HoKStats importer. Fetching is maintainer-invoked; the web app never calls this source."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup, Tag

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"
BASE_URL = "https://hokstats.gg/"
SOURCE = "HoKStats"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_hash(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def norm(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char.lower() for char in value if char.isalnum())


def provenance(url, fetched_at=None, patch_version=None, source_hash=None):
    return {
        "source": SOURCE,
        "url": url,
        "fetched_at": fetched_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "patch_version": patch_version,
        "review_status": "pending",
        **({"source_hash": source_hash} if source_hash else {}),
    }


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _page_text(soup):
    for node in soup.select("script,style,noscript,svg"):
        node.decompose()
    return "\n".join(_clean(s) for s in soup.stripped_strings if _clean(s))


def _patch_version(text):
    match = re.search(r"\b(?:patch|version|season)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+){1,2})\b", text, re.I)
    return match.group(1) if match else None


def _name_index(heroes, aliases=None):
    aliases = aliases or {}
    index = {}
    by_id = {int(hero["hero_id"]): hero for hero in heroes}
    for hero in heroes:
        for value in (hero.get("name"), hero.get("slug"), hero.get("chinese_name")):
            if value:
                index[norm(value)] = int(hero["hero_id"])
    for alias, hero_id in aliases.items():
        if int(hero_id) in by_id:
            index[norm(alias)] = int(hero_id)
    return index, by_id


def resolve_hero(value, index):
    return index.get(norm(value))


def _sections(soup):
    """Return explicit data-section blocks plus heading-delimited page sections."""
    result = {}
    for section in soup.select("[data-hokstats-section], section[aria-label]"):
        key = _clean(section.get("data-hokstats-section") or section.get("aria-label"))
        if key:
            result.setdefault(norm(key), section)
    headings = soup.find_all(re.compile(r"^h[1-6]$"))
    for heading in headings:
        key = norm(heading.get_text(" ", strip=True))
        if not key or key in result:
            continue
        block = []
        level = int(heading.name[1])
        for sibling in heading.next_elements:
            if isinstance(sibling, Tag) and re.fullmatch(r"h[1-6]", sibling.name or "") and int(sibling.name[1]) <= level:
                break
            if isinstance(sibling, Tag) and sibling.name in ("p", "li", "a", "dd", "dt"):
                text = _clean(sibling.get_text(" ", strip=True))
                if text and text not in block:
                    block.append(text)
        if block:
            result[key] = block
    return result


def _section_text(sections, *terms):
    for key, value in sections.items():
        if any(norm(term) in key for term in terms):
            if isinstance(value, Tag):
                return _clean(value.get_text(" ", strip=True))
            return _clean(" ".join(value))
    return ""


def _section_list(sections, *terms):
    for key, value in sections.items():
        if any(norm(term) in key for term in terms):
            if isinstance(value, Tag):
                values = [_clean(x.get_text(" ", strip=True)) for x in value.select("li, p")]
                if not values:
                    values = [_clean(x.get_text(" ", strip=True)) for x in value.select('a[href*="/heroes/"]')]
                return list(dict.fromkeys(x for x in values if x))
            return list(dict.fromkeys(x for x in value if x))
    return []


def _section_list_where(sections, predicate):
    for key, value in sections.items():
        if predicate(key):
            if isinstance(value, Tag):
                values = [_clean(x.get_text(" ", strip=True)) for x in value.select("li, p")]
                if not values:
                    values = [_clean(x.get_text(" ", strip=True)) for x in value.select('a[href*="/heroes/"]')]
                return list(dict.fromkeys(x for x in values if x))
            return list(dict.fromkeys(x for x in value if x))
    return []


def _heading_list(soup, predicate):
    values = []
    for heading in soup.find_all(re.compile(r"^h[1-6]$")):
        if not predicate(norm(heading.get_text(" ", strip=True))):
            continue
        sibling = heading.find_next_sibling()
        if not isinstance(sibling, Tag):
            continue
        candidates = [sibling] if sibling.name in ("p", "li", "blockquote") else sibling.select("li, p, blockquote, .bg-elevated")
        for candidate in candidates:
            value = _clean(candidate.get_text(" ", strip=True))
            if value and value not in values:
                values.append(value)
    return values


def _hero_label_id(label, index, by_id):
    hero_id = resolve_hero(label, index)
    if hero_id is not None:
        return hero_id
    normalized = norm(label)
    candidates = [
        (len(norm(hero.get("name", ""))), hero_id)
        for hero_id, hero in by_id.items()
        if norm(hero.get("name", "")) and norm(hero["name"]) in normalized
    ]
    if not candidates:
        return None
    candidates.sort(reverse=True)
    longest = candidates[0][0]
    matches = {hero_id for length, hero_id in candidates if length == longest}
    return next(iter(matches)) if len(matches) == 1 else None


def parse_hero_index(html, base_url, heroes, aliases=None):
    """Map canonical hero IDs to the slugs currently linked from HoKStats."""
    soup = BeautifulSoup(html, "html.parser")
    index, by_id = _name_index(heroes, aliases)
    slugs, unmatched = {}, []
    for link in soup.select('a[href]'):
        path = urlparse(urljoin(base_url, link.get("href", ""))).path
        match = re.fullmatch(r"/heroes/([^/]+)/?", path)
        if not match:
            continue
        slug = match.group(1)
        label = _clean(link.get_text(" ", strip=True))
        hero_id = resolve_hero(slug, index) or _hero_label_id(label, index, by_id)
        if hero_id is None:
            unmatched.append({"slug": slug, "name": label, "reason": "unmatched_hero_index_entry"})
            continue
        slugs.setdefault(hero_id, slug)
    return slugs, unmatched


def _hero_matchup_links(soup, url, fetched_at, patch, index, by_id):
    records, unresolved = [], []
    labels = {
        "strongvs": "strong_against",
        "strongagainst": "strong_against",
        "strugglesagainst": "countered_by",
        "counteredby": "countered_by",
        "weakagainst": "countered_by",
    }
    for label in soup.find_all(["p", "h3", "h4"]):
        relation = labels.get(norm(label.get_text(" ", strip=True)))
        if not relation:
            continue
        container = label.find_next_sibling()
        links = container.select('a[href*="/heroes/"]') if isinstance(container, Tag) else []
        for link in links:
            target_name = _clean(link.get_text(" ", strip=True))
            target_slug = urlparse(urljoin(url, link.get("href", ""))).path.rstrip("/").split("/")[-1]
            target_id = resolve_hero(target_slug, index) or resolve_hero(target_name, index)
            spans = [_clean(span.get_text(" ", strip=True)) for span in link.select("span")]
            evidence = next((span for span in reversed(spans) if span and norm(span) != norm(target_name) and norm(span) != "editorialpick"), "")
            if target_id is None:
                unresolved.append({"relation": relation, "name": target_name or target_slug, "source_url": url})
                continue
            if target_id not in by_id:
                continue
            records.append({
                "relation": relation,
                "hero_id": target_id,
                "hero_name": by_id[target_id]["name"],
                "evidence": evidence or _clean(label.get_text(" ", strip=True)),
                "source": provenance(url, fetched_at, patch, stable_hash({"relation": relation, "target_id": target_id, "evidence": evidence, "url": url})),
            })
    return records, unresolved


def _build_variants(soup):
    builds = []
    build_section = next((
        heading.find_parent("section") or heading.parent
        for heading in soup.find_all(["h2", "h3"])
        if norm(heading.get_text(" ", strip=True)) in ("build", "builds", "equipment")
    ), None)
    nodes = []
    if isinstance(build_section, Tag):
        nodes.extend(build_section.select("div.bg-card.border.border-border.rounded-lg.p-4"))
    nodes.extend(soup.select("[data-build], .build-card, article.build"))
    seen_nodes = set()
    for idx, node in enumerate(nodes, 1):
        if id(node) in seen_nodes:
            continue
        seen_nodes.add(id(node))
        item_links = []
        for link in node.select('a[href*="/items/"]'):
            path = urlparse(link.get("href", "")).path
            if not re.fullmatch(r"/items/\d+/?", path):
                continue
            item_name = _item_link_label(link)
            if item_name and norm(item_name) not in {norm(value) for value in item_links}:
                item_links.append(item_name)
        if not item_links:
            continue
        heading = node.select_one("h2,h3,h4,strong")
        name = _clean(heading.get_text(" ", strip=True)) if heading else f"Build {idx}"
        paragraphs = [
            _clean(paragraph.get_text(" ", strip=True))
            for paragraph in node.select("p")
            if not paragraph.find_parent("a") and _clean(paragraph.get_text(" ", strip=True)) and norm(paragraph.get_text(" ", strip=True)) != "presets"
        ]
        use_case = " ".join(paragraphs)
        builds.append({"id": f"hokstats-{len(builds) + 1}", "name": name, "use_case": use_case, "items": item_links})
    return builds


def _item_link_label(link):
    name_node = link.select_one("span.text-sm")
    if not name_node:
        name_node = next((span for span in link.find_all("span") if "data-num" not in span.get("class", [])), None)
    value = _clean(name_node.get_text(" ", strip=True)) if name_node else _clean(link.get_text(" ", strip=True))
    return re.sub(r"\s+\d{3,}$", "", value).strip()


def _cards(soup, selector, name_selectors=("h2", "h3", "h4", "strong")):
    cards = []
    for card in soup.select(selector):
        heading = next((card.select_one(sel) for sel in name_selectors if card.select_one(sel)), None)
        name = _clean(heading.get_text(" ", strip=True)) if heading else ""
        if not name:
            continue
        text = _clean(card.get_text(" ", strip=True))
        description = text.replace(name, "", 1).strip(" :-–")
        cards.append((name, description, card))
    return cards


def parse_hero_page(html, url, heroes, aliases=None, fetched_at=None):
    soup = BeautifulSoup(html, "html.parser")
    index, by_id = _name_index(heroes, aliases)
    slug = urlparse(url).path.rstrip("/").split("/")[-1]
    hero_id = resolve_hero(slug, index)
    title = soup.find("h1")
    if hero_id is None and title:
        hero_id = resolve_hero(title.get_text(" ", strip=True), index)
    if hero_id is None:
        return None, {"url": url, "slug": slug, "title": _clean(title.get_text(" ", strip=True)) if title else "", "reason": "unmatched_hero"}
    text = _page_text(soup)
    sections = _sections(soup)
    patch = _patch_version(text)
    skills = []
    skill_section = next((
        heading.find_parent("section") or heading.parent
        for heading in soup.find_all(["h2", "h3"])
        if norm(heading.get_text(" ", strip=True)) in ("skill", "skills", "ability", "abilities")
    ), None)
    skill_cards = skill_section.select("div.bg-card.border.border-border.rounded-lg") if isinstance(skill_section, Tag) else []
    for card in skill_cards:
        title_row = card.select_one("div.flex.items-center.gap-2")
        labels = [_clean(span.get_text(" ", strip=True)) for span in title_row.select("span")] if title_row else []
        description_node = card.find("p")
        description = _clean(description_node.get_text(" ", strip=True)) if description_node else ""
        name = labels[1] if len(labels) > 1 else labels[0] if labels else ""
        if name or description:
            skills.append({"name": name, "description": description, **({"type": labels[0]} if len(labels) > 1 else {})})
    if not skills:
        for name, description, card in _cards(soup, "[data-skill], .skill-card, article.skill"):
            skills.append({"name": name, "description": description})
    if not skills:
        skill_block = next((value for key, value in sections.items() if "skill" in key or "ability" in key), None)
        if isinstance(skill_block, Tag):
            skills = [{"name": _clean(h.get_text(" ", strip=True)), "description": _clean(h.find_next("p").get_text(" ", strip=True)) if h.find_next("p") else ""} for h in skill_block.select("h3, h4")]
        elif skill_block:
            skills = [{"name": "", "description": item} for item in skill_block]
    builds = _build_variants(soup)
    if not builds:
        # Some pages publish item names as a comma-separated build line.
        for idx, line in enumerate(_section_list(sections, "build", "equipment"), 1):
            items = [part.strip() for part in re.split(r"[,|›>]​?", line) if part.strip()]
            if len(items) >= 3:
                builds.append({"id": f"hokstats-{idx}", "name": f"Build {idx}", "use_case": "", "items": items})
    matchup_records, unresolved_matchups = _hero_matchup_links(soup, url, fetched_at, patch, index, by_id)
    if not matchup_records:
        strong_raw = _section_list(sections, "strong against", "strong vs", "favorable matchup", "good matchup")
        countered_raw = _section_list(sections, "countered by", "struggles against", "weak against", "bad matchup")
        for relation, names in (("strong_against", strong_raw), ("countered_by", countered_raw)):
            for raw in names:
                target_id = resolve_hero(raw, index)
                record = {"relation": relation, "hero_id": target_id, "hero_name": by_id[target_id]["name"] if target_id else raw, "evidence": raw}
                record["source"] = provenance(url, fetched_at, patch, stable_hash({"relation": relation, "target": raw, "url": url}))
                matchup_records.append(record)
    partner_records = []
    for label in soup.find_all(["p", "h3", "h4"]):
        if norm(label.get_text(" ", strip=True)) not in ("partners", "partner", "synergy"):
            continue
        container = label.find_next_sibling()
        links = container.select('a[href*="/heroes/"]') if isinstance(container, Tag) else []
        for link in links:
            partner_name = _clean(link.get_text(" ", strip=True))
            partner_slug = urlparse(urljoin(url, link.get("href", ""))).path.rstrip("/").split("/")[-1]
            partner_id = resolve_hero(partner_slug, index) or _hero_label_id(partner_name, index, by_id)
            partner_records.append({"hero_id": partner_id, "hero_name": by_id[partner_id]["name"] if partner_id else partner_name, "source": None})
    partners_raw = _section_list_where(sections, lambda key: "partner" in key or "synergy" in key)
    for raw in partners_raw:
        if not any(norm(partner["hero_name"]) == norm(raw) for partner in partner_records):
            partner_id = resolve_hero(raw, index) or _hero_label_id(raw, index, by_id)
            partner_records.append({"hero_id": partner_id, "hero_name": by_id[partner_id]["name"] if partner_id else raw, "source": None})
    source = provenance(url, fetched_at, patch, stable_hash({"html_text": text, "url": url}))
    for partner in partner_records:
        if partner["source"] is None:
            partner["source"] = source
    pick_when = _section_list_where(sections, lambda key: key.startswith(("pick", "choose")) and (key.endswith("when") or key.endswith("if")))
    if not pick_when:
        pick_when = _heading_list(soup, lambda key: key.startswith(("pick", "choose")) and (key.endswith("when") or key.endswith("if")))
    avoid_when = _section_list_where(sections, lambda key: key.startswith(("avoid", "donotpick")) and (key.endswith("when") or key.endswith("if") or key == "donotpick"))
    if not avoid_when:
        avoid_when = _heading_list(soup, lambda key: key.startswith(("avoid", "donotpick")) and (key.endswith("when") or key.endswith("if") or key == "donotpick"))
    power_spikes = _section_list(sections, "power spike") or _heading_list(soup, lambda key: "powerspike" in key)
    common_mistakes = _section_list(sections, "common mistake", "mistakes") or _heading_list(soup, lambda key: "commonmistake" in key or key.endswith("mistakes"))
    guide = {
        "skills": skills,
        "pick_when": pick_when,
        "avoid_when": avoid_when,
        "power_spikes": power_spikes,
        "common_mistakes": common_mistakes,
        "pros": _section_list(sections, "pros", "strengths"),
        "cons": _section_list(sections, "cons", "weaknesses"),
        "matchups": matchup_records,
        "partners": partner_records,
        "build_variants": builds,
        "source": source,
    }
    unresolved = unresolved_matchups + [{"relation": item["relation"], "name": item["hero_name"], "source_url": url} for item in matchup_records if item["hero_id"] is None]
    return {"hero_id": hero_id, "guide": guide}, {"unmatched_relations": unresolved}


def parse_item_page(html, url, fetched_at=None):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.find("h1")
    name = _clean(title.get_text(" ", strip=True)) if title else ""
    name = re.sub(r"\s+Honor of Kings Item$", "", name, flags=re.I).strip()
    if not name:
        return None
    sections = _sections(soup)
    text = _page_text(soup)
    patch = _patch_version(text)
    stats = {}
    passive = ""
    active = ""
    build_path = []
    for key, value in sections.items():
        body = _clean(value.get_text(" ", strip=True)) if isinstance(value, Tag) else _clean(" ".join(value))
        if "stat" in key:
            stats[key] = body
        elif "passive" in key or "unique effect" in key:
            passive = body
        elif "buildpath" in key or "components" in key:
            build_path = [_item_link_label(a) for a in value.select('a[href*="/items/"]')] if isinstance(value, Tag) else [item for item in value if norm(item) != "builtfrom"]
    for card in soup.select("[data-skill-kind]"):
        kind = norm(card.get("data-skill-kind"))
        paragraphs = card.find_all("p")
        detail = next((p for p in reversed(paragraphs) if norm(p.get_text(" ", strip=True)) != kind), None)
        detail_text = _clean(detail.get_text(" ", strip=True)) if detail else ""
        if kind == "passive" and not passive:
            passive = detail_text
        elif kind == "active" and not active:
            active = detail_text
    heading = next((h for h in soup.find_all(["h2", "h3"]) if norm(h.get_text(" ", strip=True)) in ("buildpath", "components")), None)
    if heading:
        section = heading.find_parent("section") or heading.parent
        parsed_build_path = [_item_link_label(a) for a in section.select('a[href*="/items/"]')]
        if parsed_build_path:
            build_path = parsed_build_path
    build_path = [item for item in dict.fromkeys(build_path) if item and norm(item) not in ("builtfrom", norm(name))]
    if not stats:
        stats = {"summary": _section_text(sections, "attributes", "stats")}
        stats = {k: v for k, v in stats.items() if v}
    item_id_match = re.search(r"/items/(\d+)(?:/|$)", urlparse(url).path)
    return {"id": int(item_id_match.group(1)) if item_id_match else None, "name": name, "stats": stats, "passive": passive, "active": active, "build_path": build_path, "source": provenance(url, fetched_at, patch, stable_hash({"text": text, "url": url}))}


def parse_item_index(html, base_url=BASE_URL):
    soup = BeautifulSoup(html, "html.parser")
    entries = []
    for link in soup.select('a[href*="/items/"]'):
        href = urljoin(base_url, link.get("href", ""))
        path = urlparse(href).path
        match = re.fullmatch(r"/items/(\d+)/?", path)
        if not match:
            continue
        name = _item_link_label(link)
        if not name:
            continue
        entries.append({"id": int(match.group(1)), "name": name, "url": href})
    return list({(item["id"], norm(item["name"])): item for item in entries}.values())


def parse_spell_page(html, url, fetched_at=None):
    soup = BeautifulSoup(html, "html.parser")
    text = _page_text(soup)
    patch = _patch_version(text)
    entries = []
    cards = soup.select("[data-spell], [data-spell-id], .spell-card, article.spell")
    for idx, card in enumerate(cards):
        heading = card.select_one("h2,h3,h4,strong")
        name = _clean(heading.get_text(" ", strip=True)) if heading else ""
        if not name:
            continue
        values = _clean(card.get_text(" ", strip=True))
        cooldown = ""
        effect = ""
        best_for = []
        for label in card.select("dt, strong, b"):
            key = norm(label.get_text(" ", strip=True))
            value = _clean(label.find_next("dd").get_text(" ", strip=True)) if label.find_next("dd") else ""
            if "cooldown" in key:
                cooldown = value
            elif "effect" in key or "description" in key:
                effect = value
            elif "bestfor" in key or "best" in key:
                best_for = [x.strip() for x in re.split(r"[,;]", value) if x.strip()]
        if not cooldown:
            cooldown_node = next((p for p in card.find_all("p") if norm(p.get_text(" ", strip=True)).startswith("cooldown")), None)
            if cooldown_node:
                cooldown = re.sub(r"^\s*Cooldown\s*", "", _clean(cooldown_node.get_text(" ", strip=True)), flags=re.I)
        if not effect:
            effect_node = card.select_one("p.mb-4")
            if effect_node and norm(effect_node.get_text(" ", strip=True)) != "bestfor":
                effect = _clean(effect_node.get_text(" ", strip=True))
        if not best_for:
            for best_label in card.find_all("p"):
                if norm(best_label.get_text(" ", strip=True)) == "bestfor":
                    next_text = best_label.find_next_sibling("p")
                    if next_text:
                        value = _clean(next_text.get_text(" ", strip=True))
                        best_for = [part.strip() for part in re.split(r"[,;]", value) if part.strip()] or ([value] if value else [])
                    break
        if not effect:
            effect = values.replace(name, "", 1).strip(" :-–")
        entries.append({"id": norm(name), "name": name, "effect": effect, "cooldown": cooldown, "best_for": best_for, "source": provenance(url, fetched_at, patch, stable_hash({"name": name, "text": values, "url": url}))})
    return entries


def parse_counters_page(html, url, heroes, aliases=None, fetched_at=None):
    """Extract only explicitly labeled relations; absence is never a negative matchup."""
    soup = BeautifulSoup(html, "html.parser")
    index, by_id = _name_index(heroes, aliases)
    by_hero, seen, unresolved = {}, set(), []
    indexed_cards = soup.select("article[data-counter-hero]")
    if indexed_cards:
        page_patch = _patch_version(_page_text(soup))
        for card in indexed_cards:
            owner = _clean(card.get("data-counter-hero", ""))
            hero_id = resolve_hero(owner, index)
            if hero_id is None:
                owner_link = card.select_one('h1 a[href*="/heroes/"],h2 a[href*="/heroes/"],h3 a[href*="/heroes/"]')
                if owner_link:
                    owner_slug = urlparse(urljoin(url, owner_link.get("href", ""))).path.rstrip("/").split("/")[-1]
                    hero_id = resolve_hero(owner_slug, index) or _hero_label_id(owner_link.get_text(" ", strip=True), index, by_id)
            if hero_id is None:
                unresolved.append({"name": owner or _clean(card.get("data-name", "")), "source_url": url, "reason": "unmatched_matchup_owner"})
                continue
            for heading in card.find_all(["h3", "h4"]):
                label = norm(heading.get_text(" ", strip=True))
                relation = "strong_against" if label in ("strongagainst", "strongvs") else "countered_by" if label in ("counteredby", "weakagainst", "strugglesagainst") else None
                if not relation:
                    continue
                group = heading.parent
                links = group.select('a[href*="/heroes/"]') if isinstance(group, Tag) else []
                if not links:
                    next_list = heading.find_next_sibling("ul")
                    links = next_list.select('a[href*="/heroes/"]') if next_list else []
                for target_link in links:
                    target_name = _clean(target_link.get_text(" ", strip=True))
                    target_slug = urlparse(urljoin(url, target_link.get("href", ""))).path.rstrip("/").split("/")[-1]
                    target_id = resolve_hero(target_slug, index) or resolve_hero(target_name, index)
                    if target_id is None:
                        unresolved.append({"hero_id": hero_id, "relation": relation, "name": target_name, "source_url": url, "reason": "unmatched_matchup_target"})
                        continue
                    if target_id == hero_id:
                        continue
                    key = (hero_id, relation, target_id)
                    if key in seen:
                        continue
                    seen.add(key)
                    evidence = f"HoKStats counter index: {_clean(heading.get_text(' ', strip=True))}"
                    by_hero.setdefault(hero_id, []).append({
                        "relation": relation,
                        "hero_id": target_id,
                        "hero_name": by_id[target_id]["name"],
                        "evidence": evidence,
                        "source": provenance(url, fetched_at, page_patch, stable_hash({"relation": relation, "target_id": target_id, "evidence": evidence, "url": url})),
                    })
        return by_hero, unresolved
    cards = soup.select("article, tr, li, [data-counter-row], [data-hero]")
    processed = set()
    for card in cards:
        if any(isinstance(parent, Tag) and parent in cards for parent in card.parents):
            continue
        if id(card) in processed:
            continue
        owner_link = card.select_one("h1 a[href*='/heroes/'],h2 a[href*='/heroes/'],h3 a[href*='/heroes/'],h4 a[href*='/heroes/']")
        if not owner_link:
            owner_link = card.select_one('a[href*="/heroes/"]')
        owner_value = card.get("data-hero")
        if owner_value and str(owner_value).isdigit():
            hero_id = int(owner_value) if int(owner_value) in by_id else None
        else:
            slug = urlparse(urljoin(url, owner_link.get("href", ""))).path.rstrip("/").split("/")[-1] if owner_link else ""
            hero_id = resolve_hero(owner_value or slug, index) or (resolve_hero(_clean(owner_link.get_text(" ", strip=True)), index) if owner_link else None)
        if hero_id is None:
            continue
        processed.add(id(card))
        relation_blocks = card.select("[data-relation], [class*='strong'], [class*='countered'], [class*='weak']")
        for block in relation_blocks:
            classes = block.get("class", [])
            if not isinstance(classes, str):
                classes = " ".join(classes)
            label = norm(" ".join([_clean(block.get("data-relation", "")), classes, _clean(block.get_text(" ", strip=True))]))
            if "strongagainst" in label or "favorable" in label or "kuatmelawan" in label:
                relation = "strong_against"
            elif "counteredby" in label or "weakagainst" in label or "lemahmelawan" in label:
                relation = "countered_by"
            else:
                continue
            evidence = _clean(block.get_text(" ", strip=True))
            for target_link in block.select('a[href*="/heroes/"]'):
                target_slug = urlparse(urljoin(url, target_link.get("href", ""))).path.rstrip("/").split("/")[-1]
                target_id = resolve_hero(target_slug, index) or resolve_hero(_clean(target_link.get_text(" ", strip=True)), index)
                if target_id is None:
                    unresolved.append({"hero_id": hero_id, "relation": relation, "name": _clean(target_link.get_text(" ", strip=True)), "source_url": url, "reason": "unmatched_matchup_target"})
                    continue
                if target_id == hero_id:
                    continue
                key = (hero_id, relation, target_id)
                if key in seen:
                    continue
                seen.add(key)
                by_hero.setdefault(hero_id, []).append({
                    "relation": relation, "hero_id": target_id, "hero_name": by_id[target_id]["name"], "evidence": evidence,
                    "source": provenance(url, fetched_at, _patch_version(_page_text(soup)), stable_hash({"relation": relation, "target_id": target_id, "evidence": evidence, "url": url})),
                })
    return by_hero, unresolved


def resolve_catalog_item(item, local_items, aliases=None):
    index, by_id = {}, {}
    for entry in local_items:
        if entry.get("id") is not None:
            by_id[str(entry["id"])] = entry
        for value in (entry.get("name"), *(entry.get("aliases") or [])):
            if value:
                index[norm(value)] = entry
    for alias, item_id in (aliases or {}).items():
        if str(item_id) in by_id:
            index[norm(alias)] = by_id[str(item_id)]
    return index.get(norm(item.get("name"))) or by_id.get(str(item.get("id")))


def _alias_maps():
    path = MAPPINGS / "hokstats_aliases.json"
    if not path.exists():
        return {"heroes": {}, "items": {}, "spells": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_page(client, url):
    response = client.get(url)
    response.raise_for_status()
    return response.text


def sync(output_dir=MAPPINGS, base_url=BASE_URL, limit=None, delay=0.15):
    heroes = json.loads((MAPPINGS / "master_heroes_global.json").read_text(encoding="utf-8"))
    aliases = _alias_maps()
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    host = urlparse(base_url).netloc
    if host != "hokstats.gg":
        raise ValueError("Host sumber harus hokstats.gg.")
    results, unmatched, fetch_errors = [], [], []
    items, spells, item_unmatched = [], [], []
    source_hero_slugs = {}
    index_unmatched = []
    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": "HoK-Draft-Engine-data-import/1.0"}) as client:
        heroes_url = urljoin(base_url, "heroes/")
        try:
            source_hero_slugs, index_unmatched = parse_hero_index(fetch_page(client, heroes_url), base_url, heroes, aliases.get("heroes"))
            unmatched.extend(index_unmatched)
        except httpx.HTTPError as error:
            fetch_errors.append({"url": heroes_url, "error": str(error)})
        available_heroes = [hero for hero in heroes if int(hero["hero_id"]) in source_hero_slugs]
        for hero in available_heroes[:limit]:
            url = urljoin(base_url, f"heroes/{source_hero_slugs[int(hero['hero_id'])]}/")
            try:
                record, coverage = parse_hero_page(fetch_page(client, url), url, heroes, aliases.get("heroes"), fetched_at)
                if record:
                    results.append(record)
                    unmatched.extend(coverage.get("unmatched_relations", []))
                else:
                    unmatched.append(coverage)
            except (httpx.HTTPError, ValueError) as error:
                fetch_errors.append({"url": url, "error": str(error)})
            time.sleep(delay)
        items_url = urljoin(base_url, "items/")
        try:
            item_index = parse_item_index(fetch_page(client, items_url), base_url)
            local_items = json.loads((MAPPINGS / "items_hokfire_full.json").read_text(encoding="utf-8"))
            for entry in item_index:
                try:
                    detail = parse_item_page(fetch_page(client, entry["url"]), entry["url"], fetched_at)
                    if detail:
                        local_match = resolve_catalog_item(detail, local_items, aliases.get("items"))
                        detail["local_id"] = local_match.get("id") if local_match else None
                        if not local_match:
                            item_unmatched.append({"name": detail["name"], "url": entry["url"], "reason": "unmatched_local_item"})
                        items.append(detail)
                except httpx.HTTPError as error:
                    item_unmatched.append({"name": entry["name"], "url": entry["url"], "reason": str(error)})
                time.sleep(delay)
        except httpx.HTTPError as error:
            fetch_errors.append({"url": items_url, "error": str(error)})
        spells_url = urljoin(base_url, "spells/")
        try:
            spells = parse_spell_page(fetch_page(client, spells_url), spells_url, fetched_at)
        except httpx.HTTPError as error:
            fetch_errors.append({"url": spells_url, "error": str(error)})
        counters_url = urljoin(base_url, "counters/")
        try:
            counters_html = fetch_page(client, counters_url)
            counter_records, unresolved_counters = parse_counters_page(counters_html, counters_url, heroes, aliases.get("heroes"), fetched_at)
            by_hero = {int(row["hero_id"]): row for row in results}
            for hero_id, matchups in counter_records.items():
                if hero_id not in by_hero:
                    continue
                existing = {(x["relation"], x.get("hero_id")) for x in by_hero[hero_id]["guide"].get("matchups", [])}
                by_hero[hero_id]["guide"].setdefault("matchups", []).extend(x for x in matchups if (x["relation"], x["hero_id"]) not in existing)
            unmatched.extend(unresolved_counters)
        except httpx.HTTPError as error:
            fetch_errors.append({"url": counters_url, "error": str(error)})
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "hokstats_heroes.json", results)
    _write_json(output_dir / "hokstats_items.json", items)
    _write_json(output_dir / "hokstats_spells.json", spells)
    report = {
        "source": SOURCE, "fetched_at": fetched_at,
        "heroes_expected": len(heroes), "heroes_listed_in_source": len(source_hero_slugs) + len(index_unmatched), "heroes_matched_to_catalog": len(source_hero_slugs),
        "heroes_not_listed": [{"hero_id": int(hero["hero_id"]), "name": hero["name"]} for hero in heroes if int(hero["hero_id"]) not in source_hero_slugs],
        "heroes_imported": len(results),
        "items_imported": len(items), "spells_imported": len(spells),
        "unmatched_heroes_or_matchups": unmatched, "unmatched_items": item_unmatched,
        "fetch_errors": fetch_errors,
    }
    _write_json(output_dir / "hokstats_coverage.json", report)
    return report


def _write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def review_matchup(hero_id, relation, target_id, reviewer, status, directory=MAPPINGS):
    if relation not in ("strong_against", "countered_by") or status not in ("approved", "rejected") or not reviewer.strip():
        raise ValueError("Relasi, status, dan reviewer wajib valid.")
    heroes_path = directory / "hokstats_heroes.json"
    records = json.loads(heroes_path.read_text(encoding="utf-8")) if heroes_path.exists() else []
    hero = next((x for x in records if int(x["hero_id"]) == int(hero_id)), None)
    if not hero:
        raise ValueError("Hero HoKStats tidak ditemukan.")
    matchup = next((x for x in hero["guide"].get("matchups", []) if x["relation"] == relation and x.get("hero_id") == int(target_id)), None)
    if not matchup:
        raise ValueError("Matchup tidak ditemukan atau belum dapat dicocokkan.")
    reviews_path = directory / "hokstats_matchup_reviews.json"
    reviews = json.loads(reviews_path.read_text(encoding="utf-8")) if reviews_path.exists() else []
    item = {"hero_id": int(hero_id), "relation": relation, "target_id": int(target_id), "source_hash": matchup["source"]["source_hash"], "status": status, "reviewed_by": reviewer.strip()}
    reviews = [x for x in reviews if not (x["hero_id"] == item["hero_id"] and x["relation"] == relation and x["target_id"] == item["target_id"])]
    reviews.append(item)
    _write_json(reviews_path, reviews)
    return item


def review_guide(hero_id, reviewer, status, directory=MAPPINGS):
    if status not in ("approved", "rejected") or not reviewer.strip():
        raise ValueError("Status dan reviewer wajib valid.")
    heroes_path = directory / "hokstats_heroes.json"
    records = json.loads(heroes_path.read_text(encoding="utf-8")) if heroes_path.exists() else []
    hero = next((x for x in records if int(x["hero_id"]) == int(hero_id)), None)
    if not hero:
        raise ValueError("Hero HoKStats tidak ditemukan.")
    source_hash = hero["guide"]["source"]["source_hash"]
    reviews_path = directory / "hokstats_guide_reviews.json"
    reviews = json.loads(reviews_path.read_text(encoding="utf-8")) if reviews_path.exists() else []
    item = {"hero_id": int(hero_id), "source_hash": source_hash, "status": status, "reviewed_by": reviewer.strip()}
    reviews = [x for x in reviews if not (x["hero_id"] == item["hero_id"] and x["source_hash"] == source_hash)]
    reviews.append(item)
    _write_json(reviews_path, reviews)
    return item


def review_catalog_record(kind, record_id, reviewer, status, directory=MAPPINGS):
    if kind not in ("item", "spell") or status not in ("approved", "rejected") or not reviewer.strip():
        raise ValueError("Jenis data, status, dan reviewer wajib valid.")
    filename = "hokstats_items.json" if kind == "item" else "hokstats_spells.json"
    records_path = directory / filename
    records = json.loads(records_path.read_text(encoding="utf-8")) if records_path.exists() else []
    match = next((record for record in records if str(record.get("local_id") or record.get("id")) == str(record_id) or norm(record.get("name")) == norm(record_id)), None)
    if not match:
        raise ValueError(f"Record HoKStats {kind} tidak ditemukan.")
    stable_id = match.get("local_id") or match.get("id") or norm(match.get("name"))
    source_hash = match["source"]["source_hash"]
    reviews_path = directory / "hokstats_catalog_reviews.json"
    reviews = json.loads(reviews_path.read_text(encoding="utf-8")) if reviews_path.exists() else []
    item = {"kind": kind, "record_id": str(stable_id), "source_hash": source_hash, "status": status, "reviewed_by": reviewer.strip()}
    reviews = [x for x in reviews if not (x["kind"] == kind and x["record_id"] == item["record_id"] and x["source_hash"] == source_hash)]
    reviews.append(item)
    _write_json(reviews_path, reviews)
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("sync")
    run.add_argument("--output-dir", type=Path, default=MAPPINGS)
    run.add_argument("--base-url", default=BASE_URL)
    run.add_argument("--limit", type=int)
    run.add_argument("--delay", type=float, default=0.15)
    review = sub.add_parser("review-matchup")
    review.add_argument("--hero-id", type=int, required=True)
    review.add_argument("--relation", choices=("strong_against", "countered_by"), required=True)
    review.add_argument("--target-id", type=int, required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--status", choices=("approved", "rejected"), required=True)
    guide_review = sub.add_parser("review-guide")
    guide_review.add_argument("--hero-id", type=int, required=True)
    guide_review.add_argument("--reviewer", required=True)
    guide_review.add_argument("--status", choices=("approved", "rejected"), required=True)
    catalog_review = sub.add_parser("review-catalog")
    catalog_review.add_argument("--kind", choices=("item", "spell"), required=True)
    catalog_review.add_argument("--record-id", required=True)
    catalog_review.add_argument("--reviewer", required=True)
    catalog_review.add_argument("--status", choices=("approved", "rejected"), required=True)
    args = parser.parse_args()
    if args.command == "sync":
        report = sync(args.output_dir, args.base_url, args.limit, args.delay)
        print(f"HoKStats: {report['heroes_imported']} heroes, {report['items_imported']} items, {report['spells_imported']} spells; coverage saved.")
    elif args.command == "review-matchup":
        result = review_matchup(args.hero_id, args.relation, args.target_id, args.reviewer, args.status)
        print(f"Matchup review saved: {result['status']}")
    elif args.command == "review-guide":
        result = review_guide(args.hero_id, args.reviewer, args.status)
        print(f"Hero source review saved: {result['status']}")
    else:
        result = review_catalog_record(args.kind, args.record_id, args.reviewer, args.status)
        print(f"Catalog source review saved: {result['status']}")


if __name__ == "__main__":
    main()
