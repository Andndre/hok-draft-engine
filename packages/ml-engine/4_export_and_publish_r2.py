"""4_export_and_publish_r2.py
Exports the PyTorch JevStudentNet model to ONNX, verifies with onnxruntime,
generates manifest.json & hero_metadata.json, and publishes to Cloudflare R2
(or syncs to apps/web/public/ for local instant development).
"""

import os
import json
import hashlib
import shutil
import datetime
from pathlib import Path
import numpy as np
import torch
import onnx
import onnxruntime as ort
from dotenv import load_dotenv

import importlib
_train_module = importlib.import_module("3_train_student_net")
JevStudentNet = _train_module.JevStudentNet

ROOT_DIR = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
HERO_ASSETS_DIR = ROOT_DIR / "data" / "assets" / "heroes"
MODEL_WEIGHTS_PATH = PROCESSED_DIR / "student_net.pt"
ONNX_OUTPUT_PATH = PROCESSED_DIR / "hok_jev_student.onnx"
MANIFEST_PATH = PROCESSED_DIR / "manifest.json"
HERO_METADATA_PATH = PROCESSED_DIR / "hero_metadata.json"

WEB_PUBLIC_DIR = PROCESSED_DIR / "experimental-model"
WEB_HERO_ASSETS = WEB_PUBLIC_DIR / "assets" / "heroes"

load_dotenv()

def compute_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def export_onnx():
    print("\n=== [1/4] EXPORTING PYTORCH STUDENT NET TO ONNX ===")
    with open(MAPPINGS_FILE, "r", encoding="utf-8") as f:
        master_heroes = json.load(f)
    num_heroes = len(master_heroes)

    model = JevStudentNet(num_heroes=num_heroes, embed_dim=64, hidden_dim=128)
    if MODEL_WEIGHTS_PATH.exists():
        model.load_state_dict(torch.load(MODEL_WEIGHTS_PATH, map_location="cpu", weights_only=True))
        print(f" Loaded weights from {MODEL_WEIGHTS_PATH}")
    else:
        print(" Warning: Model weights not found. Exporting initialized architecture...")

    model.eval()

    # Dummy inputs for tracing
    batch_size = 1
    dummy_our = torch.full((batch_size, 5), 120, dtype=torch.long)
    dummy_enemy = torch.full((batch_size, 5), 120, dtype=torch.long)
    dummy_bans = torch.full((batch_size, 10), 120, dtype=torch.long)
    dummy_mask = torch.zeros((batch_size, num_heroes), dtype=torch.float32)
    dummy_meta = torch.tensor([[1, 0, 0]], dtype=torch.long)

    input_names = ["our_picks", "enemy_picks", "bans", "unavailable_mask", "meta_info"]
    output_names = ["choice_logits", "tactical_scores"]

    dynamic_axes = {
        "our_picks": {0: "batch_size"},
        "enemy_picks": {0: "batch_size"},
        "bans": {0: "batch_size"},
        "unavailable_mask": {0: "batch_size"},
        "meta_info": {0: "batch_size"},
        "choice_logits": {0: "batch_size"},
        "tactical_scores": {0: "batch_size"},
    }

    torch.onnx.export(
        model,
        (dummy_our, dummy_enemy, dummy_bans, dummy_mask, dummy_meta),
        str(ONNX_OUTPUT_PATH),
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes
    )

    onnx_size_mb = ONNX_OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f" Exported ONNX model to {ONNX_OUTPUT_PATH} ({onnx_size_mb:.2f} MB)")

    # Validate ONNX model integrity
    print("\n=== [2/4] VALIDATING ONNX INTEGRITY WITH ONNXRUNTIME ===")
    onnx_model = onnx.load(str(ONNX_OUTPUT_PATH))
    onnx.checker.check_model(onnx_model)
    print(" ONNX graph validation passed.")

    # Run inference test
    ort_session = ort.InferenceSession(str(ONNX_OUTPUT_PATH))
    ort_inputs = {
        "our_picks": dummy_our.numpy(),
        "enemy_picks": dummy_enemy.numpy(),
        "bans": dummy_bans.numpy(),
        "unavailable_mask": dummy_mask.numpy(),
        "meta_info": dummy_meta.numpy()
    }
    ort_outs = ort_session.run(None, ort_inputs)
    logits, scores = ort_outs
    print(f" Test inference success! Output shapes: logits={logits.shape}, scores={scores.shape}")
    print(f" Sample tactical scores: {scores[0].round(3).tolist()}")

def generate_manifest_and_metadata():
    print("\n=== [3/4] GENERATING MANIFEST & OPTIMIZED METADATA ===")
    with open(MAPPINGS_FILE, "r", encoding="utf-8") as f:
        master_heroes = json.load(f)

    sha = compute_sha256(ONNX_OUTPUT_PATH)
    file_size = ONNX_OUTPUT_PATH.stat().st_size

    manifest = {
        "model_version": "1.0.0",
        "model_name": "hok_jev_student",
        "model_file": "hok_jev_student.onnx",
        "model_size_bytes": file_size,
        "sha256": sha,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "hero_count": len(master_heroes),
        "tactical_dimensions": [
            "win_probability",
            "early_game_pressure",
            "cc_chain_lockdown",
            "frontline_durability",
            "enemy_carry_shutdown",
            "draft_flexibility"
        ],
        "inputs": [
            {"name": "our_picks", "shape": [1, 5], "type": "int64"},
            {"name": "enemy_picks", "shape": [1, 5], "type": "int64"},
            {"name": "bans", "shape": [1, 10], "type": "int64"},
            {"name": "unavailable_mask", "shape": [1, len(master_heroes)], "type": "float32"},
            {"name": "meta_info", "shape": [1, 3], "type": "int64"}
        ],
        "outputs": [
            {"name": "choice_logits", "shape": [1, len(master_heroes)], "type": "float32"},
            {"name": "tactical_scores", "shape": [1, 6], "type": "float32"}
        ]
    }

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f" Created {MANIFEST_PATH}")

    # Copy clean metadata
    with open(HERO_METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(master_heroes, f, indent=2, ensure_ascii=False)
    print(f" Created {HERO_METADATA_PATH}")

def publish_artifacts():
    print("\n=== [4/4] PUBLISHING / SYNCING ARTIFACTS ===")
    
    # Always sync to apps/web/public/ so static app works instantly in local dev & fallback
    WEB_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    WEB_HERO_ASSETS.mkdir(parents=True, exist_ok=True)

    shutil.copy(ONNX_OUTPUT_PATH, WEB_PUBLIC_DIR / "hok_jev_student.onnx")
    shutil.copy(MANIFEST_PATH, WEB_PUBLIC_DIR / "manifest.json")
    shutil.copy(HERO_METADATA_PATH, WEB_PUBLIC_DIR / "hero_metadata.json")

    # Copy webp assets to web/public/assets/heroes/
    copied_count = 0
    for img_file in HERO_ASSETS_DIR.glob("*.webp"):
        shutil.copy(img_file, WEB_HERO_ASSETS / img_file.name)
        copied_count += 1
    print(f" Synced {copied_count} hero portraits + ONNX + manifest to apps/web/public/")

    # Check Cloudflare R2 credentials
    endpoint = os.getenv("R2_ENDPOINT_URL")
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("EXPERIMENTAL_MODEL_BUCKET")
    if bucket_name and bucket_name == os.getenv("R2_BUCKET_NAME"):
        raise ValueError("EXPERIMENTAL_MODEL_BUCKET harus berbeda dari bucket data produksi.")

    if endpoint and access_key and secret_key and bucket_name and "your_" not in access_key:
        print(f" Uploading artifacts to S3 / RustFS / R2 storage (Bucket: {bucket_name}) ...")
        try:
            import boto3
            from botocore.config import Config

            is_r2 = "r2.cloudflarestorage.com" in endpoint
            region = "auto" if is_r2 else "us-east-1"

            s3 = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                config=Config(signature_version="s3v4"),
                region_name=region
            )

            # Ensure bucket exists
            existing_buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
            if bucket_name not in existing_buckets:
                print(f" Creating bucket '{bucket_name}'...")
                s3.create_bucket(Bucket=bucket_name)

            # Upload ONNX model
            s3.upload_file(str(ONNX_OUTPUT_PATH), bucket_name, "hok_jev_student.onnx")
            print(" -> Uploaded hok_jev_student.onnx")

            # Upload manifest & metadata
            s3.upload_file(str(MANIFEST_PATH), bucket_name, "manifest.json", ExtraArgs={"ContentType": "application/json"})
            s3.upload_file(str(HERO_METADATA_PATH), bucket_name, "hero_metadata.json", ExtraArgs={"ContentType": "application/json"})
            print(" -> Uploaded manifest.json and hero_metadata.json")

            # Upload hero portraits
            for img_file in HERO_ASSETS_DIR.glob("*.webp"):
                s3.upload_file(
                    str(img_file), 
                    bucket_name, 
                    f"assets/heroes/{img_file.name}", 
                    ExtraArgs={"ContentType": "image/webp"}
                )
            print(f" -> Uploaded all {copied_count} hero assets to bucket '{bucket_name}'.")
        except Exception as e:
            print(f" Storage upload failed: {e}")
    else:
        print(" [INFO] Cloudflare R2 credentials not configured or set to placeholder in .env.")
        print("        Artifacts are staged in apps/web/public/ for direct static hosting.")

if __name__ == "__main__":
    export_onnx()
    generate_manifest_and_metadata()
    publish_artifacts()
