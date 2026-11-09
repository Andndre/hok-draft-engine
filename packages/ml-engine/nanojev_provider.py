"""Local adapter for TianyuCodings/NanoJev's released DecisionPredictor.

No model-service HTTP calls. Checkpoint download is an explicit, separate command.
Upstream: https://github.com/TianyuCodings/NanoJev (MIT source; checkpoint retains base licence).
"""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path

DEFAULT_REPO = "C-Tianyu/NanoJev"
DEFAULT_REVISION = "unified-games-v1"
DEFAULT_WEIGHT_SHA256 = "f68c47d66998231b86b7e91b4ed5e82ae23acf104c8b7cd6d165c3ac7b7ffe1b"


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_checkpoint(destination):
    """One-time public weight/source download; never called by inference."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        raise ValueError("Jalankan download dengan uv run --with huggingface-hub tactical_profiles.py download.") from None
    snapshot_download(
        repo_id=DEFAULT_REPO, revision=DEFAULT_REVISION, local_dir=str(destination), token=False,
        allow_patterns=["best.safetensors", "config.json", "backbone_config/*", "tokenizer/*", "source/*", "SHA256_MANIFEST.json", "LICENSE*"],
    )
    if file_sha256(destination / "best.safetensors") != DEFAULT_WEIGHT_SHA256:
        raise ValueError("Checksum bobot rilis NanoJev tidak cocok; checkpoint tidak diaktifkan.")
    (destination / "hok_checkpoint.json").write_text(json.dumps({"repository": DEFAULT_REPO, "revision": DEFAULT_REVISION, "sha256": DEFAULT_WEIGHT_SHA256}, indent=2) + "\n", encoding="utf-8")


class CpuDecisionPredictor:
    """CPU implementation using NanoJev's local model helpers and checkpoint format."""

    def __init__(self, module, checkpoint, precision="fp32", max_length=None, cpu_threads=6):
        if precision != "fp32":
            raise ValueError("Inference CPU hanya mendukung precision fp32.")
        if type(cpu_threads) is not int or cpu_threads < 1:
            raise ValueError("cpu-threads harus berupa bilangan bulat positif.")
        try:
            import torch
            from safetensors import safe_open
            from transformers import AutoConfig, AutoModel, AutoTokenizer
        except ImportError:
            raise ValueError("Dependensi CPU NanoJev belum lengkap. Jalankan dengan --with transformers==5.17.0 --with safetensors==0.8.0.") from None

        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        torch.set_num_threads(cpu_threads)

        root, paths = module.local_checkpoint_files(checkpoint)
        run_config = module.read_json(paths["run_config"])
        if not isinstance(run_config, dict) or run_config.get("set_head") not in {"none", "attention"}:
            raise ValueError("checkpoint config tidak memiliki set_head yang didukung.")

        tokenizer = AutoTokenizer.from_pretrained(str(paths["tokenizer"]), local_files_only=True, trust_remote_code=False)
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        body_config = AutoConfig.from_pretrained(str(paths["body_config"]), local_files_only=True, trust_remote_code=False)
        body_config.use_cache = False
        limit = run_config.get("max_length", 512) if max_length is None else max_length
        if type(limit) is not int or limit <= 0:
            raise ValueError("max-length harus berupa bilangan bulat positif.")
        context_limit = getattr(body_config, "max_position_embeddings", None)
        if isinstance(context_limit, int) and limit > context_limit:
            raise ValueError("max-length melebihi batas konteks backbone.")

        body = AutoModel.from_config(body_config, attn_implementation="sdpa", trust_remote_code=False).float()
        model = module.load_decision_model_class()(body, run_config["set_head"])
        expected_keys = set(model.state_dict())
        # Assign one safetensors tensor at a time to avoid holding a second full 2.38 GB copy.
        with safe_open(str(paths["weights"]), framework="pt", device="cpu") as weight_file:
            weight_keys = set(weight_file.keys())
            if weight_keys != expected_keys:
                missing = sorted(expected_keys - weight_keys)
                unexpected = sorted(weight_keys - expected_keys)
                raise ValueError(f"Bobot checkpoint tidak cocok; missing={missing[:3]}, unexpected={unexpected[:3]}.")
            for key in sorted(expected_keys):
                tensor = weight_file.get_tensor(key)
                model.load_state_dict({key: tensor}, strict=False, assign=True)
                del tensor

        model.eval()
        self.model = model
        self.tokenizer = tokenizer
        self.root = root
        self.run_config = run_config
        self.limit = limit
        self.device = torch.device("cpu")
        self.precision = "fp32"
        self.inference_calls = 0
        self._torch = torch
        self._module = module

    def predict(self, payload, batch_questions=0, temperature=1.0):
        module = self._module
        states = module.validate_request(payload)
        if not isinstance(temperature, (int, float)) or isinstance(temperature, bool) or not math.isfinite(temperature) or temperature <= 0:
            raise ValueError("temperature harus berupa bilangan positif hingga.")
        torch = self._torch
        examples = module.prepare_examples(payload, self.tokenizer, self.limit)
        batches = module.complete_question_batches(examples, batch_questions)
        self.inference_calls += 1
        outputs = {state["id"]: {"id": state["id"], "answers": {}} for state in states}
        with torch.inference_mode():
            for batch in batches:
                logits, _ = self.model(batch, self.tokenizer.pad_token_id)
                for example, values in zip(batch, logits):
                    count = len(example["candidate_ids"])
                    scores = values[:count].float()
                    if not torch.isfinite(scores).all():
                        raise ValueError("Model menghasilkan logits non-finite; prediksi tidak disimpan.")
                    probabilities = (scores / temperature).softmax(-1).tolist()
                    outputs[example["state_id"]]["answers"][example["qid"]] = module.answer_from_probabilities(example, probabilities)

        return {
            "schema_version": "openjev-toy-inference-v1",
            "checkpoint": {"directory": str(self.root), "base_model": self.run_config.get("model"), "base_revision": self.run_config.get("resolved_model_revision"), "set_head": self.run_config["set_head"]},
            "temperature": {"value": float(temperature), "fitted_by_this_command": False},
            "execution": {"device": "cpu", "parameter_storage": "float32", "precision": "fp32", "forward_autocast": "disabled",
                          "states": len(states), "questions": len(examples), "candidate_paths": sum(len(example["leaf_tokens"]) for example in examples),
                          "forward_passes": len(batches), "batch_questions_limit": batch_questions or "all", "max_length": self.limit,
                          "network_model_calls": 0, "persistent_model_load_count": 1, "inference_call_index": self.inference_calls},
            "states": list(outputs.values()),
        }


def load_predictor(checkpoint, source_directory=None, precision="fp32", max_length=None, device="cuda", cpu_threads=6):
    if device not in {"cuda", "cpu"}:
        raise ValueError("device harus cuda atau cpu.")
    try:
        import torch
    except ImportError:
        raise ValueError("PyTorch belum tersedia pada environment uv pipeline.") from None
    if device == "cuda" and not torch.cuda.is_available():
        raise ValueError("NanoJev CUDA diminta tetapi PyTorch tidak menemukan GPU NVIDIA. Gunakan --device cpu untuk inference lokal CPU; tidak ada fallback API cloud.")
    root = Path(checkpoint).resolve()
    for relative in ("best.safetensors", "config.json", "backbone_config", "tokenizer"):
        if not (root / relative).exists():
            raise ValueError(f"Checkpoint lokal belum lengkap: {relative}. Jalankan subcommand download sekali pada mesin CUDA.")
    scripts = Path(source_directory).resolve() if source_directory else root / "source/scripts"
    entry = scripts / "predict_toy_decisions.py"
    if not entry.is_file() or not (scripts / "train_toy_decisions.py").is_file():
        raise ValueError("Source inferensi NanoJev belum tersedia. Sertakan source/scripts dari rilis model atau gunakan --nanojev-source.")
    # Keep all Transformers/HF loading strictly local, including upstream helper imports.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    spec = importlib.util.spec_from_file_location("hok_local_nanojev", entry)
    if spec is None or spec.loader is None:
        raise ValueError("Source inferensi NanoJev tidak dapat dimuat.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        if device == "cpu":
            return CpuDecisionPredictor(module, root, precision, max_length, cpu_threads)
        return module.DecisionPredictor(str(root), precision=precision, max_length=max_length, disable_native_triton=True)
    except ImportError:
        raise ValueError("Dependensi NanoJev belum lengkap. Gunakan uv run --no-sync --with transformers==5.17.0 --with safetensors==0.8.0 tactical_profiles.py propose ...") from None


def split_state(payload, predictor):
    """Process every source token in chunks rather than silently truncating skills."""
    tokenizer = predictor.tokenizer
    questions = payload["questions"]
    overhead = 0
    for question in questions.values():
        for key, text in question["criteria"].items():
            framing = f"State:\n\nQuestion type: choice\nQuestion:\n{question['instructions']}\nCandidate:\n{key}: {text}\nDecision:"
            overhead = max(overhead, len(tokenizer.encode(framing, add_special_tokens=False)) + 1)
    capacity = predictor.limit - overhead - 32
    if capacity < 16:
        raise ValueError("Batas token NanoJev terlalu kecil untuk pertanyaan taktis.")
    state = json.dumps(payload["state"], ensure_ascii=False, sort_keys=True)
    chunks = []
    offset = 0
    while offset < len(state):
        low, high, end = offset + 1, len(state), offset
        while low <= high:
            middle = (low + high) // 2
            if len(tokenizer.encode(state[offset:middle], add_special_tokens=False)) <= capacity:
                end = middle
                low = middle + 1
            else:
                high = middle - 1
        if end == offset:
            raise ValueError("Satu karakter sumber melebihi batas token model.")
        if end < len(state):
            boundary = state.rfind(" ", offset + (end - offset) // 2, end)
            if boundary > offset:
                end = boundary + 1
        chunks.append(state[offset:end])
        offset = end
    return chunks or [state]


def normalize_chunks(results, tags, minimum_probability):
    votes = {tag: [] for tag in tags}
    for chunk_index, response in enumerate(results):
        states = response.get("states", [])
        if len(states) != 1:
            raise ValueError("NanoJev tidak mengembalikan tepat satu state per chunk.")
        for tag in tags:
            answer = states[0].get("answers", {}).get(tag, {})
            probabilities = answer.get("probabilities", {})
            if set(probabilities) != {"ya", "tidak", "tidak_diketahui"} or any(not isinstance(p, (int, float)) or not math.isfinite(p) or p < 0 or p > 1 for p in probabilities.values()) or abs(sum(probabilities.values()) - 1) > 1e-4:
                raise ValueError("Distribusi label NanoJev tidak valid.")
            choice = answer.get("choice")
            if choice not in probabilities:
                raise ValueError("Pilihan label NanoJev tidak dikenal.")
            probability = probabilities[choice]
            votes[tag].append({"chunk": chunk_index, "choice": choice if probability >= minimum_probability else "tidak_diketahui", "probabilities": probabilities})
    answers = {}
    for tag, rows in votes.items():
        supported = {row["choice"] for row in rows if row["choice"] != "tidak_diketahui"}
        choice = next(iter(supported)) if len(supported) == 1 else "tidak_diketahui"
        # Upstream does not provide calibrated confidence for HoK. Do not invent it.
        answers[tag] = {"choice": choice, "confidence": None, "chunk_votes": rows}
    return answers


def request_nanojev(payload, checkpoint, source_directory=None, precision="fp32", max_length=None, minimum_probability=0.7, predictor_factory=None, checkpoint_sha256=None, device="cuda", cpu_threads=6):
    if not math.isfinite(minimum_probability) or not 0 <= minimum_probability <= 1:
        raise ValueError("Minimum probability harus berada dalam rentang 0..1.")
    predictor = predictor_factory() if predictor_factory else load_predictor(checkpoint, source_directory, precision, max_length, device, cpu_threads)
    chunks = split_state(payload, predictor)
    results = []
    for index, text in enumerate(chunks):
        results.append(predictor.predict({"states": [{"id": f"hero-{payload['state']['hero_id']}-chunk-{index}", "state": text, "questions": payload["questions"]}]}, batch_questions=1, temperature=1.0))
    digest = checkpoint_sha256 or file_sha256(Path(checkpoint) / "best.safetensors")
    return {
        "model": f"NanoJev:{digest}",
        "model_info": {"provider": "nanojev", "checkpoint_sha256": digest, "chunks": len(chunks), "minimum_probability": minimum_probability, "device": str(getattr(predictor, "device", device)), "probabilities_calibrated_for_hok": False, "network_model_calls": 0},
        "answers": normalize_chunks(results, payload["questions"], minimum_probability),
    }
