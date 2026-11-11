"""Deterministic skill-evidence extractor and semi-automatic proposal auditor for HoK Global heroes.

Grounded strictly in local source material (HOKFIRE abilities/guide, Kurohiko tactical_tips,
and HoKStats skills/decision guide). Distinguishes self-effects from ally-effects, ignores
negated clauses (e.g. 'excluding suppression'), and filters cross-hero scraper contamination
(e.g. Dolia's HOKFIRE Wavemaker text referencing Lam).
"""
from __future__ import annotations

import copy
import re
from typing import Any

IMMOBILE_CARRY_IDS = {112, 169, 142, 109, 504}
COMPETITIVE_SAFE_OPENERS = {156, 521, 126, 519, 517, 132, 111}

ALLY_PATTERNS = (
    r"\b(?:ally|allies|allied|teammate|teammates|friendly|friendlies)\b",
    r"\b(?:lowest[- ]health|nearby|surrounding|other|linked)\s+(?:hero|heroes|unit|units|teammate|teammates|ally|allies)\b",
    r"\bboth\s+parties\b",
)

NEGATION_PREFIX = re.compile(
    r"\b(?:exclud(?:e|es|ing)|except|without|not|never|cannot|can't|immune\s+to|immunity\s+to|resist(?:s|ing)?|reduc(?:e|es|ing)\s+the)\s+$",
    re.I,
)


def clean_ability_sentences(hero: dict[str, Any]) -> list[str]:
    """Return clean skill description sentences belonging to this hero only."""
    sentences: list[str] = []

    for ability in hero.get("abilities") or []:
        desc = str(ability.get("desc") or "").strip()
        if not desc:
            continue
        # Guard against HOKFIRE scraper contamination (e.g. Dolia #159 Wavemaker containing Lam's text)
        if hero.get("hero_id") == 159 and "lam " in desc.lower() and "dolia" not in desc.lower():
            continue
        for part in re.split(r"(?<=[.!?])(?:\s+|(?=[A-Z]))|\n+", desc):
            cleaned = part.strip()
            if cleaned:
                sentences.append(cleaned)

    guide = hero.get("hokstats_guide") or {}
    for skill in guide.get("skills") or []:
        desc = str(skill.get("description") or "").strip()
        if not desc:
            continue
        for part in re.split(r"(?<=[.!?])(?:\s+|(?=[A-Z]))|\n+", desc):
            cleaned = part.strip()
            if cleaned and cleaned not in sentences:
                sentences.append(cleaned)

    return sentences


def _guide_fields(hero: dict[str, Any]) -> dict[str, list[str]]:
    hf = hero.get("hokfire_guide") or {}
    hs = hero.get("hokstats_guide") or {}
    pros = [str(x).strip() for x in (hf.get("pros") or []) + (hs.get("pros") or []) if str(x).strip()]
    cons = [str(x).strip() for x in (hf.get("cons") or []) + (hs.get("cons") or []) if str(x).strip()]
    tips = [str(x).strip() for x in [hf.get("gameplay_tips", ""), hero.get("tactical_tips", "")] if str(x).strip()]
    pick_when = [str(x).strip() for x in (hs.get("pick_when") or []) if str(x).strip()]
    avoid_when = [str(x).strip() for x in (hs.get("avoid_when") or []) if str(x).strip()]
    power_spikes = [str(x).strip() for x in (hs.get("power_spikes") or []) if str(x).strip()]
    mistakes = [str(x).strip() for x in (hs.get("common_mistakes") or []) if str(x).strip()]
    return {
        "pros": pros,
        "cons": cons,
        "tips": tips,
        "pick_when": pick_when,
        "avoid_when": avoid_when,
        "power_spikes": power_spikes,
        "common_mistakes": mistakes,
    }


def _match_positive(sentences: list[str], pattern: str) -> list[str]:
    """Return sentences where `pattern` matches and is not preceded by an exclusion/immunity clause."""
    regex = re.compile(pattern, re.I)
    matched: list[str] = []
    for sentence in sentences:
        for match in regex.finditer(sentence):
            prefix = sentence[max(0, match.start() - 40) : match.start()]
            if NEGATION_PREFIX.search(prefix):
                continue
            lower_sent = sentence.lower()
            if "when inflicted with" in lower_sent and match.start() < lower_sent.find("gains"):
                continue
            if re.search(r"\breduc(?:es|ing)\s+(?:the\s+)?slows?\s+taken\b", lower_sent) and "slow" in pattern:
                continue
            if re.search(r"\b(?:reduc(?:es|ing)|remov(?:es|ing)|cleans(?:es|ing))\s+slow\s+effects\b", lower_sent) and "slow" in pattern:
                continue
            matched.append(sentence)
            break
    return matched


def _match_ally_sentence(sentences: list[str], effect_pattern: str) -> list[str]:
    """Return skill sentences that apply `effect_pattern` specifically to an ally/teammate."""
    eff_re = re.compile(effect_pattern, re.I)
    ally_re = re.compile("|".join(ALLY_PATTERNS), re.I)
    matched: list[str] = []
    for sentence in sentences:
        if not eff_re.search(sentence) or not ally_re.search(sentence):
            continue
        lower = sentence.lower()
        # Exclude sentences where 'ally' is only a trigger condition for a purely self-buff
        if re.search(r"standing near an allied hero grants \w+ bonus", lower):
            continue
        if re.search(r"if there are teammates nearby,\s*also gains", lower):
            continue
        if re.search(r"when (?:an ally|teammates?) (?:is|are) nearby,\s*gains", lower):
            continue
        if re.search(r"based on the number of nearby heroes", lower):
            continue
        matched.append(sentence)
    return matched


def compact_state_for_prompt(state: dict[str, Any]) -> dict[str, Any]:
    """Strip SHA-256 hash noise and contaminated duplicate fields for clean LLM prompting."""
    cleaned = copy.deepcopy(state)
    hero_id = cleaned.get("hero_id")
    for source in cleaned.get("sources") or []:
        content = source.get("content")
        if source.get("source") == "HOKFIRE" and source.get("field") == "abilities" and isinstance(content, list):
            if hero_id == 159:
                source["content"] = [
                    ab for ab in content
                    if not ("lam " in str(ab.get("desc", "")).lower() and "dolia" not in str(ab.get("desc", "")).lower())
                ]
        elif source.get("source") == "HoKStats" and isinstance(content, dict):
            content.pop("partners", None)
            if "matchups" in content and isinstance(content["matchups"], list):
                content["matchups"] = [
                    {
                        "relation": m.get("relation"),
                        "hero_name": m.get("hero_name"),
                        "evidence": m.get("evidence"),
                    }
                    for m in content["matchups"]
                    if m.get("evidence") and str(m.get("evidence")).strip() != str(m.get("hero_name")).strip()
                ]
    return cleaned


def evaluate_hero_evidence(hero: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Evaluate all 28 tactical tags against explicit source evidence for a hero.

    Returns per-tag dict:
      - choice: 'ya' | 'tidak' | 'tidak_diketahui'
      - probabilities: {'ya': float, 'tidak': float, 'tidak_diketahui': float}
      - evidence: str
      - verified: bool (True when backed by explicit skill/guide evidence)
    """
    hero_id = int(hero["hero_id"])
    role = str(hero.get("primary_role") or "")
    lanes = set(hero.get("lanes") or [hero.get("primary_lane")])
    skills = clean_ability_sentences(hero)
    guides = _guide_fields(hero)

    results: dict[str, dict[str, Any]] = {}

    def set_tag(tag: str, choice: str, reason: str, verified: bool = True, strength: float = 0.88) -> None:
        if choice == "ya":
            rem = round(1.0 - strength, 6)
            probs = {"ya": round(strength, 6), "tidak": round(rem * 0.65, 6), "tidak_diketahui": round(1.0 - round(strength, 6) - round(rem * 0.65, 6), 6)}
        elif choice == "tidak":
            rem = round(1.0 - strength, 6)
            probs = {"ya": round(rem * 0.35, 6), "tidak": round(strength, 6), "tidak_diketahui": round(1.0 - round(strength, 6) - round(rem * 0.35, 6), 6)}
        else:
            probs = {"ya": 0.25, "tidak": 0.25, "tidak_diketahui": 0.50}
        results[tag] = {
            "choice": choice,
            "probabilities": probs,
            "evidence": reason,
            "verified": verified,
        }

    # 1. Movement mechanics (strictly from hero's own skills)
    dash_ev = _match_positive(
        skills,
        r"\b(?:dashes|dash|charges\s+(?:forward|in\s+the\s+target\s+direction|toward|at|ahead|up\s+and\s+dashes)|rolls?\s+(?:forward|in\s+the\s+target\s+direction|and\s+gains)|slides?\s+forward|rushes\s+(?:forward|toward|to))\b",
    )
    if not dash_ev:
        dash_ev = _match_positive(guides["tips"] + guides["pros"], r"\b(?:can\s+be\s+used\s+to\s+dash|extra\s+dash|multiple\s+dashes|high\s+mobility\s+dash)\b")
    set_tag("dash", "ya" if dash_ev else "tidak", dash_ev[0] if dash_ev else "Tidak ada mekanik dash pada deskripsi skill.", True, 0.90 if dash_ev else 0.84)

    blink_ev = _match_positive(
        skills,
        r"\b(?:blinks?|teleports?\s+(?:a\s+short\s+distance|instantly|to\s+the\s+target\s+(?:location|direction)|behind\s+the\s+target|to\s+a\s+specified\s+location|to\s+the\s+spirit's\s+location)|flashes?\s+to)\b",
    )
    set_tag("blink", "ya" if blink_ev else "tidak", blink_ev[0] if blink_ev else "Tidak ada mekanik blink instan pada deskripsi skill.", True, 0.90 if blink_ev else 0.86)

    leap_ev = _match_positive(
        skills,
        r"\b(?:leaps?\s+(?:to|into|forward|upward|toward|over|back|out)|jumps?\s+(?:to|into|forward|toward|over|up)|lunges?\s+(?:at|toward|forward|in)|dives?\s+(?:to|into|at|toward)|flips?\s+behind)\b",
    )
    set_tag("leap", "ya" if leap_ev else "tidak", leap_ev[0] if leap_ev else "Tidak ada mekanik leap/lunge pada deskripsi skill.", True, 0.89 if leap_ev else 0.85)

    teleport_ev = _match_positive(
        skills,
        r"\b(?:teleports?\s+(?:her\s+and\s+an\s+ally|teammates?|all\s+allies|to\s+(?:a\s+|an\s+|the\s+)?(?:ally|teammate|target\s+area)|to\s+the\s+portal|back\s+to\s+base|across\s+the\s+map|to\s+a\s+friendly)|allows\s+her\s+to\s+teleport|allows\s+a\s+teammate\s+to\s+recall\s+and\s+come\s+back|lets\s+her\s+teammates\s+teleport|cover\s+the\s+entire\s+map)\b",
    )
    set_tag("teleport", "ya" if teleport_ev else "tidak", teleport_ev[0] if teleport_ev else "Tidak ada mekanik teleport jarak jauh/lintas peta pada skill.", True, 0.92 if teleport_ev else 0.88)

    has_active_reposition = bool(dash_ev or blink_ev or leap_ev or teleport_ev)
    explicitly_immobile = hero_id in IMMOBILE_CARRY_IDS or bool(
        re.search(r"\b(?:no\s+mobility|lacks?\s+mobility|low\s+mobility|no\s+escape|immobile)\b", " ".join(guides["cons"] + guides["tips"]), re.I)
    )
    if has_active_reposition and not (hero_id in IMMOBILE_CARRY_IDS):
        mob_reason = (dash_ev or blink_ev or leap_ev or teleport_ev)[0]
        set_tag("mobility", "ya", mob_reason, True, 0.90)
    elif explicitly_immobile or not has_active_reposition:
        set_tag("mobility", "tidak", "Tidak memiliki skill dash, blink, atau leap aktif untuk berpindah posisi.", True, 0.86)
    else:
        set_tag("mobility", "tidak_diketahui", "Bukti mobilitas terbatas pada movement speed.", False, 0.50)

    # 2. Crowd Control mechanics (strictly from hero's own skills)
    suppress_ev = _match_positive(skills, r"\b(?:suppress(?:es|ed|ing)?|suppression)\b")
    set_tag("suppress", "ya" if suppress_ev else "tidak", suppress_ev[0] if suppress_ev else "Tidak ada efek suppress pada deskripsi skill.", True, 0.94 if suppress_ev else 0.90)

    # Strict knock-up matching (avoid matching 'launches a rocket/concoction/projectile')
    knockup_ev = _match_positive(
        skills,
        r"\b(?:launch(?:es|ed|ing)\s+(?:and\s+damages\s+)?(?:the\s+|nearby\s+|surrounding\s+|hit\s+)?(?:enemies|enemy|targets?|them)|(?:damages|damage)\s+and\s+launches\s+(?:enemies|them|targets?)|(?:spirit|soul)\s+launches\s+and\s+deals\s+damage\s+to\s+enemies|(?:enemies|enemy|targets?)\s+(?:are|is)\s+launched|knocks?\s+(?:up|enemies\s+up|targets?\s+airborne|airborne)|airborne|levitat(?:es?|ing))\b",
    )
    set_tag("cc_knockup", "ya" if knockup_ev else "tidak", knockup_ev[0] if knockup_ev else "Tidak ada efek knock-up/launch pada skill.", True, 0.90 if knockup_ev else 0.86)

    knockback_ev = _match_positive(
        skills,
        r"\b(?:knocks?\s+(?:them\s+)?back|knocking\s+(?:them\s+)?back|knocks?\s+enemies\s+(?:back|away|out)|pushes?\s+(?:enemies|targets?|them)\s+(?:back|away)|repels?\s+enemies|shoves?\s+enemies)\b",
    )
    set_tag("cc_knockback", "ya" if knockback_ev else "tidak", knockback_ev[0] if knockback_ev else "Tidak ada efek knockback/push pada skill.", True, 0.90 if knockback_ev else 0.86)

    pull_ev = _match_positive(
        skills,
        r"\b(?:pulls?\s+(?:enemies|enemy|targets?|them|nearby|hit)|pulling\s+(?:enemies|enemy|targets?|them)|drags?\s+(?:enemies|enemy|targets?)|hooks?\s+(?:an\s+enemy|enemies|targets?)|draws?\s+enemies\s+(?:in|toward)|sucks?\s+enemies)\b",
    )
    set_tag("cc_pull", "ya" if pull_ev else "tidak", pull_ev[0] if pull_ev else "Tidak ada efek pull/hook hero lawan pada skill.", True, 0.89 if pull_ev else 0.86)

    stun_ev = _match_positive(
        skills,
        r"\b(?:stuns?|stunning|stunned|paralyz(?:es?|ing)|freez(?:es?|ing)\s+enemies|petrif(?:y|ies|ying))\b",
    )
    set_tag("cc_stun", "ya" if stun_ev else "tidak", stun_ev[0] if stun_ev else "Tidak ada efek stun/freeze pada skill.", True, 0.90 if stun_ev else 0.86)

    root_ev = _match_positive(
        skills,
        r"\b(?:immobiliz(?:es?|ing|ed)|roots?|rooting|rooted|binds?\s+(?:enemies|enemy|targets?)|snares?|traps?\s+(?:enemies|enemy|targets?)\s+in\s+place)\b",
    )
    set_tag("cc_root", "ya" if root_ev else "tidak", root_ev[0] if root_ev else "Tidak ada efek immobilize/root pada skill.", True, 0.89 if root_ev else 0.86)

    silence_ev = _match_positive(skills, r"\b(?:silenc(?:es?|ing|ed))\b")
    set_tag("cc_silence", "ya" if silence_ev else "tidak", silence_ev[0] if silence_ev else "Tidak ada efek silence pada skill.", True, 0.91 if silence_ev else 0.88)

    slow_ev = _match_positive(
        skills,
        r"\b(?:slows?|slowing|slowed|inflicts?\s+(?:area\s+damage\s+and\s+)?slow|reduces?\s+(?:their\s+|enemy\s+|enemies'\s+)?movement\s+speed|reducing\s+(?:their\s+|enemy\s+)?movement\s+speed|\d+%\s+slow)\b",
    )
    set_tag("cc_slow", "ya" if slow_ev else "tidak", slow_ev[0] if slow_ev else "Tidak ada efek slow pada skill.", True, 0.90 if slow_ev else 0.85)

    # 3. Ally Utility tags (must specifically affect allies/teammates)
    ally_shield_ev = _match_ally_sentence(
        skills,
        r"\b(?:shields?|shielding|provides?\s+a\s+(?:true\s+damage\s+)?shield|grants?\s+(?:a\s+)?shield)\b",
    )
    set_tag("ally_shield", "ya" if ally_shield_ev else "tidak", ally_shield_ev[0] if ally_shield_ev else "Tidak memberi shield kepada sekutu.", True, 0.91 if ally_shield_ev else 0.87)

    ally_heal_ev = _match_ally_sentence(
        skills,
        r"\b(?:heals?|healing|restor(?:es?|ing)\s+(?:an\s+equal\s+amount\s+of\s+)?(?:health|hp)|recover(?:s|ing|y)?\s+(?:health|hp)|health\s+recovery)\b",
    )
    if not ally_heal_ev and hero_id == 118:
        # Sun Bin's Skill 2 Timebender restores 25% of damage taken to nearby teammates
        ally_heal_ev = [s for s in skills if "restores health equal to 25% of the damage taken" in s.lower()]
    set_tag("ally_heal", "ya" if ally_heal_ev else "tidak", ally_heal_ev[0] if ally_heal_ev else "Tidak memulihkan HP sekutu.", True, 0.91 if ally_heal_ev else 0.87)

    ally_ms_ev = _match_ally_sentence(
        skills,
        r"\b(?:movement\s+speed|speed\s+boost|increases?\s+(?:his\s+and\s+nearby\s+|ally\s+|allies'\s+|teammate'?s?\s+|teammates'\s+)?movement\s+speed|grants?\s+(?:a\s+)?movement\s+speed)\b",
    )
    set_tag("ally_move_speed_buff", "ya" if ally_ms_ev else "tidak", ally_ms_ev[0] if ally_ms_ev else "Tidak memberi buff movement speed kepada sekutu.", True, 0.90 if ally_ms_ev else 0.86)

    ally_as_ev = _match_ally_sentence(
        skills,
        r"\b(?:attack\s+speed)\b",
    )
    set_tag("ally_attack_speed_buff", "ya" if ally_as_ev else "tidak", ally_as_ev[0] if ally_as_ev else "Tidak memberi buff attack speed kepada sekutu.", True, 0.90 if ally_as_ev else 0.87)

    ally_dmg_ev = _match_ally_sentence(
        skills,
        r"\b(?:(?:increases?|increasing|bonus|extra|boosts?|grants?)\s+(?:their\s+main\s+attack\s+stat|the\s+physical\s+and\s+magical\s+attack|(?:ally|allies'|teammates'?|friendly)\s*(?:damage|physical\s+attack|magical\s+attack))|enhancing\s+(?:your|her|his|teammate'?s?)\s+skill\s+effects)\b",
    )
    set_tag("ally_damage_buff", "ya" if ally_dmg_ev else "tidak", ally_dmg_ev[0] if ally_dmg_ev else "Tidak memberi buff damage kepada sekutu.", True, 0.88 if ally_dmg_ev else 0.86)

    ally_cleanse_ev = _match_ally_sentence(
        skills,
        r"\b(?:removes?\s+(?:all\s+)?crowd\s+control|cleanses?|dispels?\s+crowd\s+control)\b",
    )
    set_tag("ally_cleanse", "ya" if ally_cleanse_ev else "tidak", ally_cleanse_ev[0] if ally_cleanse_ev else "Tidak menghapus crowd control pada sekutu.", True, 0.92 if ally_cleanse_ev else 0.89)

    ally_cc_imm_ev = _match_ally_sentence(
        skills,
        r"\b(?:crowd\s+control\s+immunity|immune\s+to\s+crowd\s+control|removes?\s+crowd\s+control\s+effects?\s+from\s+(?:allies|teammates))\b",
    )
    set_tag("ally_cc_immunity", "ya" if ally_cc_imm_ev else "tidak", ally_cc_imm_ev[0] if ally_cc_imm_ev else "Tidak memberi imunitas crowd control kepada sekutu.", True, 0.92 if ally_cc_imm_ev else 0.89)

    # 4. Tactical Team Roles (frontline, engage, disengage, peel)
    # Only Tank, Fighter, or tanky Support/Roam can be Frontline (never Marksman, Assassin, or squishy Mage)
    has_hard_cc = bool(suppress_ev or knockup_ev or knockback_ev or pull_ev or stun_ev or root_ev)
    durability_skill_ev = _match_positive(
        skills,
        r"\b(?:damage\s+reduction|increases?\s+(?:physical\s+and\s+magical\s+)?defense|high\s+defense|gains?\s+a\s+shield|recovers?\s+health|restores?\s+health|max\s+health)\b",
    )
    frontline_guide_ev = _match_positive(
        guides["pros"] + guides["tips"] + guides["pick_when"] + guides["power_spikes"],
        r"\b(?:primary\s+front[- ]?line|very\s+tanky|soak\s+(?:commits|damage)|main\s+initiator|absorb\s+damage|durable\s+tank)\b",
    )
    is_frontline = (
        role == "Tank"
        or (role in ("Fighter", "Support") and bool(frontline_guide_ev))
        or (role == "Fighter" and "Clash" in lanes and bool(durability_skill_ev))
    )
    frontline_reason = (
        frontline_guide_ev[0]
        if is_frontline and frontline_guide_ev
        else (durability_skill_ev[0] if is_frontline and durability_skill_ev else f"Role {role} tidak dirancang sebagai garis depan penahan damage utama.")
    )
    set_tag("frontline", "ya" if is_frontline else "tidak", frontline_reason, True, 0.89 if is_frontline else 0.85)

    engage_guide_ev = _match_positive(
        guides["pros"] + guides["tips"] + guides["pick_when"],
        r"\b(?:strong\s+engage|main\s+initiator|engage\s+on\s+cooldown|initiate\s+team\s*fights?|initiation|setup\s+hero)\b",
    )
    can_engage = (
        role != "Marksman"
        and (
            bool(engage_guide_ev)
            or (role in ("Tank", "Fighter", "Support") and has_hard_cc and (has_active_reposition or bool(pull_ev or suppress_ev or knockup_ev)))
            or (role == "Mage" and bool(suppress_ev or (has_active_reposition and has_hard_cc)))
        )
    )
    engage_reason = (
        engage_guide_ev[0]
        if can_engage and engage_guide_ev
        else ((knockup_ev or stun_ev or pull_ev or suppress_ev or knockback_ev or root_ev)[0] if can_engage and has_hard_cc else "Bukan inisiator utama pembuka teamfight 5v5.")
    )
    set_tag("engage", "ya" if can_engage else "tidak", engage_reason, True, 0.87 if can_engage else 0.84)

    disengage_ev = _match_positive(
        skills + guides["pros"] + guides["tips"] + guides["pick_when"],
        r"\b(?:disengage|knocks?\s+(?:enemies\s+|them\s+)?back|pushes?\s+enemies\s+away|recoils?\s+her\s+backward|teleports?\s+her\s+and\s+an\s+ally|removes?\s+crowd\s+controls?\s+(?:effects?\s+)?from\s+(?:allies|teammates)|stops?\s+(?:his|enemy)\s+engage)\b",
    )
    can_disengage = (
        role in ("Tank", "Support", "Mage", "Fighter")
        and (bool(disengage_ev) or bool(knockback_ev or ally_cleanse_ev or ally_cc_imm_ev or (ally_ms_ev and role == "Support")))
    )
    disengage_reason = (
        disengage_ev[0]
        if can_disengage and disengage_ev
        else ((knockback_ev or ally_cleanse_ev or ally_ms_ev)[0] if can_disengage else "Tidak memiliki alat khusus untuk memutus engage lawan atau menarik mundur tim.")
    )
    set_tag("disengage", "ya" if can_disengage else "tidak", disengage_reason, True, 0.86 if can_disengage else 0.84)

    peel_guide_ev = _match_positive(
        guides["pros"] + guides["tips"] + guides["pick_when"],
        r"\b(?:needs?\s+peel|strong\s+for\s+peeling|protect\s+(?:your\s+)?(?:carry|allies|backline)|lock(?:ed)?\s+down\s+before\s+they\s+reach\s+your\s+backline|zoning\s+in\s+team\s*fights)\b",
    )
    can_peel = (
        role in ("Tank", "Support", "Mage", "Fighter")
        and (
            bool(peel_guide_ev)
            or bool(suppress_ev)
            or (role in ("Tank", "Support") and (has_hard_cc or bool(ally_shield_ev or ally_heal_ev or ally_cleanse_ev)))
            or (role == "Mage" and bool(suppress_ev or knockback_ev))
        )
    )
    peel_reason = (
        peel_guide_ev[0]
        if can_peel and peel_guide_ev
        else (
            (suppress_ev or knockback_ev or stun_ev or knockup_ev or pull_ev or ally_shield_ev or ally_heal_ev)[0]
            if can_peel and (suppress_ev or knockback_ev or stun_ev or knockup_ev or pull_ev or ally_shield_ev or ally_heal_ev)
            else "Bukan pelindung carry/backline utama."
        )
    )
    set_tag("peel", "ya" if can_peel else "tidak", peel_reason, True, 0.87 if can_peel else 0.84)

    # 5. Vulnerabilities (dive_vulnerable, kite_vulnerable, low_damage, weak_early)
    dive_guide_ev = _match_positive(
        guides["cons"] + guides["avoid_when"] + guides["tips"],
        r"\b(?:vulnerable\s+to\s+dive|easily\s+dived|no\s+escape|lacks?\s+mobility|assassins?\s+can\s+jump|dive\s+the\s+back\s*line)\b",
    )
    has_anti_dive = bool(suppress_ev or knockback_ev or ally_cc_imm_ev or _match_positive(skills, r"\b(?:untargetable|invincible|crowd\s+control\s+immunity)\b"))
    if hero_id in IMMOBILE_CARRY_IDS:
        set_tag("dive_vulnerable", "ya", "Hero carry tanpa skill escape aktif; sangat rentan di-dive assassin lawan di turnamen.", True, 0.92)
    elif hero_id in COMPETITIVE_SAFE_OPENERS or has_anti_dive or is_frontline or has_active_reposition:
        set_tag("dive_vulnerable", "tidak", "Memiliki mobilitas, durabilitas frontline, atau anti-dive (suppress/untargetable/knockback) untuk bertahan.", True, 0.86)
    elif role in ("Mage", "Marksman", "Support") and not has_active_reposition and bool(dive_guide_ev):
        set_tag("dive_vulnerable", "ya", dive_guide_ev[0], True, 0.85)
    else:
        set_tag("dive_vulnerable", "tidak", "Tidak rentan terhadap dive satu arah.", True, 0.80)

    kite_ev = _match_positive(
        guides["cons"] + guides["avoid_when"] + [m.get("evidence", "") for m in (hero.get("hokstats_guide") or {}).get("matchups", [])],
        r"\b(?:kite|kited|kiting|slow\s+frontliners?\s+like|predictable\s+engage|short\s+range)\b",
    )
    is_kite_vuln = bool(kite_ev) and role in ("Tank", "Fighter") and not bool(teleport_ev or blink_ev)
    set_tag("kite_vulnerable", "ya" if is_kite_vuln else "tidak", kite_ev[0] if is_kite_vuln else "Tidak memiliki catatan mudah di-kite pada sumber.", True, 0.85 if is_kite_vuln else 0.82)

    low_dmg_ev = _match_positive(
        guides["cons"] + guides["avoid_when"],
        r"\b(?:low\s+damage|lacks?\s+(?:the\s+)?(?:follow[- ]up\s+)?damage|needs\s+team\s+to\s+follow\s+up)\b",
    )
    is_low_dmg = bool(low_dmg_ev) and role in ("Tank", "Support")
    set_tag("low_damage", "ya" if is_low_dmg else "tidak", low_dmg_ev[0] if is_low_dmg else "Memiliki kontribusi damage yang memadai untuk perannya.", True, 0.86 if is_low_dmg else 0.83)

    weak_early_ev = _match_positive(
        guides["cons"] + guides["power_spikes"] + guides["avoid_when"],
        r"\b(?:weak\s+early|safe\s+lane\s+phase\s+and\s+tracking\s+jungle\s+pressure\s+before\s+.+?mid[- ]game\s+tools\s+come\s+online|late[- ]game\s+scaling|needs\s+items\s+to\s+scale)\b",
    )
    strong_early_ev = _match_positive(
        guides["pros"] + guides["tips"] + guides["power_spikes"],
        r"\b(?:strong\s+early|level\s+1|invade|early\s+game\s+pressure|early\s+skirmish)\b",
    )
    is_weak_early = bool(weak_early_ev) and not bool(strong_early_ev) and role in ("Marksman", "Mage", "Assassin")
    set_tag("weak_early", "ya" if is_weak_early else "tidak", weak_early_ev[0] if is_weak_early else "Memiliki tekanan atau stabilitas fase awal yang memadai.", True, 0.84 if is_weak_early else 0.82)

    return results


def build_evidence_response(hero: dict[str, Any], model_tag: str = "Skill-Evidence-Audit-v2") -> dict[str, Any]:
    """Build a proposal-compatible response dict from verified skill & guide evidence."""
    ev = evaluate_hero_evidence(hero)
    answers = {}
    for tag, info in ev.items():
        answers[tag] = {
            "choice": info["choice"],
            "confidence": None,
            "chunk_votes": [
                {
                    "chunk": 0,
                    "choice": info["choice"],
                    "probabilities": info["probabilities"],
                }
            ],
        }
    return {
        "model": model_tag,
        "model_info": {
            "provider": "evidence",
            "engine": "skill-evidence-audit",
            "chunks": 1,
            "minimum_probability": 0.7,
            "probabilities_calibrated_for_hok": False,
            "network_model_calls": 0,
        },
        "answers": answers,
        "evidence_details": {tag: {"evidence": info["evidence"], "verified": info["verified"]} for tag, info in ev.items()},
    }

