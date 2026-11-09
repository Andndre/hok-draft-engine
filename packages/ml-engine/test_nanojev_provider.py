import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch
from nanojev_provider import normalize_chunks, request_nanojev
from tactical_profiles import TAGS, create_proposal, make_request, validate_proposal
from nanojev_provider import split_state


def response(questions, choice="ya"):
    probabilities = {key: 0.05 for key in ("ya", "tidak", "tidak_diketahui")}
    probabilities[choice] = 0.9
    return {"states": [{"id": "fixture", "answers": {tag: {"type": "choice", "choice": choice, "probabilities": dict(probabilities)} for tag in questions}}]}


class WordTokenizer:
    def encode(self, text, **kwargs):
        return text.split()
    def decode(self, tokens, **kwargs):
        return " ".join(tokens)


class NanoJevTests(unittest.TestCase):
    def test_local_adapter_processes_all_source_chunks_without_network_or_api_key(self):
        hero = {"hero_id": 556, "name": "Ata", "abilities": [{"desc": " ".join(f"word{index}" for index in range(1000))}]}
        requests = []
        class Predictor:
            tokenizer = WordTokenizer()
            limit = 256
            def predict(self, payload, **kwargs):
                requests.append(payload)
                self_test.assertEqual(kwargs["batch_questions"], 1)
                return response(TAGS)
        self_test = self
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory)
            (checkpoint / "best.safetensors").write_bytes(b"fixture weights, not a real model")
            with patch("urllib.request.urlopen", side_effect=AssertionError("No HTTP calls allowed")):
                result = request_nanojev(make_request(hero, "ignored"), checkpoint, predictor_factory=Predictor)
            self.assertGreater(len(requests), 1)
            all_chunks = " ".join(request["states"][0]["state"] for request in requests)
            for index in range(1000):
                self.assertIn(f"word{index}", all_chunks)
            proposal = create_proposal(hero, result, "nanojev")
            validate_proposal(proposal, hero)
            self.assertEqual(proposal["review"]["status"], "pending")
            self.assertIsNone(proposal["tags"]["mobility"]["confidence"])
            self.assertFalse(proposal["model_info"]["probabilities_calibrated_for_hok"])
            self.assertEqual(proposal["model_info"]["network_model_calls"], 0)
            self.assertEqual(proposal["model_info"]["checkpoint_sha256"], hashlib.sha256((checkpoint / "best.safetensors").read_bytes()).hexdigest())

    def test_conflicting_or_weak_local_evidence_stays_unknown(self):
        answers = normalize_chunks([response(TAGS, "ya"), response(TAGS, "tidak")], TAGS, 0.7)
        self.assertTrue(all(answer["choice"] == "tidak_diketahui" for answer in answers.values()))
        weak = response(TAGS)
        for answer in weak["states"][0]["answers"].values():
            answer["probabilities"] = {"ya": 0.4, "tidak": 0.3, "tidak_diketahui": 0.3}
        self.assertTrue(all(answer["choice"] == "tidak_diketahui" for answer in normalize_chunks([weak], TAGS, 0.7).values()))

    def test_invalid_probability_or_missing_question_rejects_the_entire_proposal(self):
        invalid = response(TAGS)
        invalid["states"][0]["answers"]["mobility"]["probabilities"]["ya"] = float("nan")
        with self.assertRaises(ValueError):
            normalize_chunks([invalid], TAGS, 0.7)
        with self.assertRaises(ValueError):
            normalize_chunks([response({})], TAGS, 0.7)

    def test_cpu_only_environment_does_not_fall_back_to_the_cloud(self):
        from nanojev_provider import load_predictor
        with patch("torch.cuda.is_available", return_value=False), patch("urllib.request.urlopen", side_effect=AssertionError("No cloud fallback")):
            with self.assertRaisesRegex(ValueError, "hanya CPU"):
                load_predictor(Path("nonexistent-checkpoint"))

    def test_unicode_sources_are_preserved_exactly_between_chunks(self):
        payload = {"state": {"hero_id": 556, "description": "抑制 機動性 éfek " * 100}, "questions": make_request({"hero_id": 556, "name": "Ata"}, "ignored")["questions"]}
        class Predictor:
            tokenizer = WordTokenizer()
            limit = 256
        chunks = split_state(payload, Predictor())
        self.assertGreater(len(chunks), 1)
        self.assertEqual("".join(chunks), json.dumps(payload["state"], ensure_ascii=False, sort_keys=True))

    def test_cli_fixture_default_provider_needs_no_api_key_or_model(self):
        script = Path(__file__).parent / "tactical_profiles.py"
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "response.json"
            output = Path(directory) / "proposal.json"
            fixture.write_text(json.dumps({"model": "NanoJev:fixture-only", "answers": {tag: {"choice": "tidak_diketahui", "confidence": None} for tag in TAGS}}), encoding="utf-8")
            result = subprocess.run([sys.executable, str(script), "propose", "--hero-id", "156", "--output", str(output), "--response-fixture", str(fixture)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            proposal = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(proposal["provider"], "nanojev")
            self.assertEqual(proposal["review"]["status"], "pending")


if __name__ == "__main__":
    unittest.main()
