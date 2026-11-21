"""Translate Chinese text in CN-exclusive heroes and official build tips to English.

Pipeline:
1. Heroes with is_global_released == True retain official HoK Camp Global English skills intact.
2. Only CN-exclusive heroes (not on Global) have their skill names and descriptions translated from Chinese to English.
3. Official build execution tips (from pvp.qq.com) for both Global & CN heroes are translated to English.
4. Uses local persistent cache (data/mappings/translation_cache.json) to eliminate redundant requests.
5. Employs direct Google GTX endpoint with browser headers and MyMemory fallback.
"""

import json
import re
import sys
import time
from pathlib import Path
import httpx

ROOT_DIR = Path(__file__).resolve().parents[2]
MASTER_HEROES_PATH = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
CACHE_PATH = ROOT_DIR / "data" / "mappings" / "translation_cache.json"

CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")

GLOSSARY = {
    "法术攻击": "Magical Attack",
    "物理攻击": "Physical Attack",
    "法术防御": "Magical Defense",
    "物理防御": "Physical Defense",
    "最大生命": "Max HP",
    "最大法力": "Max Mana",
    "冷却缩减": "Cooldown Reduction",
    "移动速度": "Movement Speed",
    "攻击速度": "Attack Speed",
    "暴击率": "Critical Rate",
    "暴击效果": "Critical Damage",
    "物理穿透": "Physical Pierce",
    "法术穿透": "Magical Pierce",
    "物理吸血": "Physical Lifesteal",
    "法术吸血": "Magical Lifesteal",
    "真实伤害": "True Damage",
    "霸体": "Crowd Control Immunity",
    "击飞": "Knockup",
    "击退": "Knockback",
    "眩晕": "Stun",
    "减速": "Slow",
    "沉默": "Silence",
    "压制": "Suppression",
    "嘲讽": "Taunt",
    "定身": "Root",
    "位移": "Dash",
    "被动": "Passive",
    "普攻": "Basic Attack",
    "大招": "Ultimate",
    "护盾": "Shield",
    "野怪": "Jungle Creeps",
    "射手": "Marksman",
    "法师": "Mage",
    "坦克": "Tank",
    "战士": "Fighter",
    "刺客": "Assassin",
    "辅助": "Support",
}

POST_PROCESS_TERMS = [
    (r"\bspell attack\b", "Magical Attack"),
    (r"\bmagic attack\b", "Magical Attack"),
    (r"\bmaximum health\b", "Max HP"),
    (r"\bmax health\b", "Max HP"),
    (r"\bmaximum mana\b", "Max Mana"),
    (r"\bwild monsters\b", "Jungle Creeps"),
    (r"\btyrant body\b", "Crowd Control Immunity"),
    (r"\bknocked into the air\b", "Knocked Up"),
    (r"\bhit into the air\b", "Knocked Up"),
    (r"\bhit fly\b", "Knockup"),
]


def has_chinese(text: str) -> bool:
    if not isinstance(text, str):
        return False
    return bool(CHINESE_RE.search(text))


class RobustTranslator:
    def __init__(self):
        self.cache = {}
        if CACHE_PATH.exists():
            try:
                with open(CACHE_PATH, "r", encoding="utf-8") as f:
                    self.cache = json.load(f)
                print(f"[Init] Loaded {len(self.cache)} cached translations.")
            except Exception as e:
                print(f"[Warn] Failed to load cache: {e}")
        self.client = httpx.Client(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=15.0,
        )

    def save_cache(self):
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False, indent=2)

    def _translate_gtx(self, text: str) -> str:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "zh-CN",
            "tl": "en",
            "dt": "t",
            "q": text,
        }
        res = self.client.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            if data and data[0]:
                return "".join([part[0] for part in data[0] if part and part[0]])
        elif res.status_code == 429:
            raise RuntimeError("GTX 429 Rate Limit")
        return ""

    def _translate_mymemory(self, text: str) -> str:
        url = "https://api.mymemory.translated.net/get"
        params = {
            "q": text,
            "langpair": "zh-CN|en-US",
            "de": "hok_project_maintainer@gmail.com",
        }
        res = self.client.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            translated = data.get("responseData", {}).get("translatedText")
            if translated and not has_chinese(translated):
                return translated
        return ""

    def translate(self, text: str) -> str:
        if not text or not has_chinese(text):
            return text

        cleaned = text.strip()
        if cleaned in self.cache:
            return self.cache[cleaned]

        if cleaned in GLOSSARY:
            translated = GLOSSARY[cleaned]
            self.cache[cleaned] = translated
            self.save_cache()
            return translated

        # Attempt translation with retries
        result = ""
        for attempt in range(3):
            try:
                result = self._translate_gtx(cleaned)
                if result:
                    break
            except Exception as e:
                # Fallback to MyMemory
                try:
                    result = self._translate_mymemory(cleaned)
                    if result:
                        break
                except Exception:
                    pass
                time.sleep(1.0 * (attempt + 1))

        if result and not has_chinese(result):
            # Apply MOBA terminology post-processing
            for pattern, rep in POST_PROCESS_TERMS:
                result = re.sub(pattern, rep, result, flags=re.IGNORECASE)
            self.cache[cleaned] = result
            self.save_cache()
            print(f"  [OK] '{cleaned[:24]}...' -> '{result[:30]}...'")
            time.sleep(0.3)
            return result
        else:
            print(f"  [Skip] Could not translate '{cleaned[:30]}'")
            return cleaned


def main():
    with open(MASTER_HEROES_PATH, "r", encoding="utf-8") as f:
        heroes = json.load(f)

    translator = RobustTranslator()
    total_translated = 0

    try:
        for hero in heroes:
            hero_name = hero.get("name", "Unknown")
            is_global = hero.get("is_global_released", False)

            # 1. Abilities: ONLY translate for CN-exclusive heroes (not released on Global)
            # Global heroes retain official HoK Camp Global skill texts in English!
            if not is_global:
                for ab in hero.get("abilities", []):
                    if ab.get("name") and has_chinese(ab["name"]):
                        original = ab["name"]
                        ab["name"] = translator.translate(original)
                        if ab["name"] != original:
                            total_translated += 1

                    if ab.get("desc") and has_chinese(ab["desc"]):
                        original = ab["desc"]
                        ab["desc"] = translator.translate(original)
                        if ab["desc"] != original:
                            total_translated += 1

                    if ab.get("cost") and isinstance(ab["cost"], str) and has_chinese(ab["cost"]):
                        original = ab["cost"]
                        ab["cost"] = translator.translate(original)
                        if ab["cost"] != original:
                            total_translated += 1

            # 2. Official Build tips (from pvp.qq.com) for ALL heroes
            build = hero.get("official_build")
            if build:
                for key in ("build_1", "build_2"):
                    variant = build.get(key)
                    if variant and variant.get("tips") and has_chinese(variant["tips"]):
                        original = variant["tips"]
                        variant["tips"] = translator.translate(original)
                        if variant["tips"] != original:
                            total_translated += 1

            # 3. Tactical tips if any contain Chinese
            tactical = hero.get("tactical_tips")
            if tactical and has_chinese(tactical):
                hero["tactical_tips"] = re.sub(r"\(古彩戏法\)", "(ancient illusion trick)", tactical)

    finally:
        translator.save_cache()

    print(f"\n[Done] Total strings updated: {total_translated}")
    with open(MASTER_HEROES_PATH, "w", encoding="utf-8") as f:
        json.dump(heroes, f, ensure_ascii=False, indent=2)
    print(f"[Done] Saved updated master_heroes_global.json")


if __name__ == "__main__":
    main()
