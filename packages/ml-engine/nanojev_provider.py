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


def load_predictor(checkpoint, source_directory=None, precision="fp32", max_length=None):
    try:
        import torch
    except ImportError:
        raise ValueError("PyTorch belum tersedia pada environment uv pipeline.") from None
    if not torch.cuda.is_available():
        raise ValueError("NanoJev upstream memerlukan PyTorch CUDA dan GPU NVIDIA. Environment ini hanya CPU; tidak ada fallback API cloud. Proposal manual/fixture dan latihan browser tetap dapat digunakan.")
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
        return module.DecisionPredictor(str(root), precision=precision, max_length=max_length, disable_native_triton=True)
    except ImportError:
        raise ValueError("Dependensi NanoJev belum lengkap. Gunakan uv run --no-sync --with transformers==5.17.0 --with safetensors==0.8.0 tactical_profiles.py propose ... pada environment PyTorch CUDA.") from None


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


def request_nanojev(payload, checkpoint, source_directory=None, precision="fp32", max_length=None, minimum_probability=0.7, predictor_factory=None, checkpoint_sha256=None):
    if not math.isfinite(minimum_probability) or not 0 <= minimum_probability <= 1:
        raise ValueError("Minimum probability harus berada dalam rentang 0..1.")
    predictor = predictor_factory() if predictor_factory else load_predictor(checkpoint, source_directory, precision, max_length)
    chunks = split_state(payload, predictor)
    results = []
    for index, text in enumerate(chunks):
        results.append(predictor.predict({"states": [{"id": f"hero-{payload['state']['hero_id']}-chunk-{index}", "state": text, "questions": payload["questions"]}]}, batch_questions=1, temperature=1.0))
    digest = checkpoint_sha256 or file_sha256(Path(checkpoint) / "best.safetensors")
    return {
        "model": f"NanoJev:{digest}",
        "model_info": {"provider": "nanojev", "checkpoint_sha256": digest, "chunks": len(chunks), "minimum_probability": minimum_probability, "probabilities_calibrated_for_hok": False, "network_model_calls": 0},
        "answers": normalize_chunks(results, payload["questions"], minimum_probability),
    }
