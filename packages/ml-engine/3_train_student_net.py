"""3_train_student_net.py
Trains the PyTorch Set-Transformer Multi-Head Jev Decision Network:
- Head A: Choice logits over 120 heroes (with unavailable hero masking)
- Head B: 6-dimensional tactical vector [win_prob, early, cc, frontline, shutdown, flex] in [0, 1]
- Exports the trained model to PyTorch state dict: data/processed/student_net.pt
"""

import os
import json
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
DATASET_PATH = PROCESSED_DIR / "teacher_draft_dataset.npz"
MODEL_SAVE_PATH = PROCESSED_DIR / "student_net.pt"

class JevStudentNet(nn.Module):
    def __init__(self, num_heroes: int = 120, embed_dim: int = 64, hidden_dim: int = 128):
        super().__init__()
        self.num_heroes = num_heroes
        self.pad_idx = num_heroes # index 120 is <PAD>
        
        # Hero embedding (120 heroes + 1 padding token)
        self.hero_embed = nn.Embedding(num_heroes + 1, embed_dim, padding_idx=self.pad_idx)
        
        # Role/Type positional encodings:
        # 0: our_pick, 1: enemy_pick, 2: ban
        self.type_embed = nn.Embedding(3, embed_dim)
        
        # Self-attention set transformer block
        self.mha = nn.MultiheadAttention(embed_dim=embed_dim, num_heads=4, batch_first=True)
        self.norm1 = nn.LayerNorm(embed_dim)
        
        # Meta embeddings: phase (0/1), side (0/1), pick_idx (0..5)
        self.phase_embed = nn.Embedding(2, 16)
        self.side_embed = nn.Embedding(2, 16)
        self.pick_embed = nn.Embedding(6, 16)
        
        # Mask projection
        self.mask_proj = nn.Linear(num_heroes, 32)
        
        # Fusion MLP
        in_dim = embed_dim + 16 + 16 + 16 + 32
        self.fusion = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU()
        )
        
        # Head A: Choice logits over 120 heroes
        self.head_choice = nn.Linear(hidden_dim, num_heroes)
        
        # Head B: 6 tactical score dimensions in [0, 1]
        self.head_scores = nn.Sequential(
            nn.Linear(hidden_dim, 6),
            nn.Sigmoid()
        )

    def forward(
        self, 
        our_picks: torch.Tensor, 
        enemy_picks: torch.Tensor, 
        bans: torch.Tensor, 
        unavailable_mask: torch.Tensor, 
        meta_info: torch.Tensor
    ):
        # our_picks: [B, 5], enemy_picks: [B, 5], bans: [B, 10]
        # Replace -1 with pad_idx
        our_p = torch.where(our_picks < 0, self.pad_idx, our_picks)
        enemy_p = torch.where(enemy_picks < 0, self.pad_idx, enemy_picks)
        ban_p = torch.where(bans < 0, self.pad_idx, bans)
        
        e_our = self.hero_embed(our_p) + self.type_embed.weight[0]
        e_enemy = self.hero_embed(enemy_p) + self.type_embed.weight[1]
        e_bans = self.hero_embed(ban_p) + self.type_embed.weight[2]
        
        # Concatenate tokens into draft sequence: [B, 20, embed_dim]
        tokens = torch.cat([e_our, e_enemy, e_bans], dim=1)
        
        # Self-attention set encoding
        attn_out, _ = self.mha(tokens, tokens, tokens)
        set_repr = self.norm1(tokens + attn_out).mean(dim=1) # [B, embed_dim]
        
        # Meta features
        phase_feat = self.phase_embed(meta_info[:, 0].clamp(0, 1))
        side_feat = self.side_embed(meta_info[:, 1].clamp(0, 1))
        pick_feat = self.pick_embed(meta_info[:, 2].clamp(0, 5))
        mask_feat = torch.relu(self.mask_proj(unavailable_mask))
        
        # Fusion
        fused = torch.cat([set_repr, phase_feat, side_feat, pick_feat, mask_feat], dim=-1)
        latent = self.fusion(fused)
        
        raw_logits = self.head_choice(latent)
        # Mask out unavailable heroes with large negative penalty
        masked_logits = raw_logits - (unavailable_mask * 10000.0)
        
        tactical_scores = self.head_scores(latent)
        
        return masked_logits, tactical_scores

class DraftDataset(Dataset):
    def __init__(self, data_file: Path, id_to_idx: dict):
        data = np.load(data_file)
        
        # Map raw hero IDs in the dataset to [0..119] range indices
        def map_ids(arr):
            mapped = np.full_like(arr, 120)
            for i in range(arr.shape[0]):
                for j in range(arr.shape[1]):
                    val = int(arr[i, j])
                    if val in id_to_idx:
                        mapped[i, j] = id_to_idx[val]
            return mapped

        self.our_picks = torch.tensor(map_ids(data["our_picks"]), dtype=torch.long)
        self.enemy_picks = torch.tensor(map_ids(data["enemy_picks"]), dtype=torch.long)
        self.bans = torch.tensor(map_ids(data["bans"]), dtype=torch.long)
        self.fearless_masks = torch.tensor(data["fearless_masks"], dtype=torch.float32)
        self.meta_info = torch.tensor(data["meta_info"], dtype=torch.long)
        self.target_choices = torch.tensor(data["target_choices"], dtype=torch.float32)
        self.target_scores = torch.tensor(data["target_scores"], dtype=torch.float32)

    def __len__(self):
        return len(self.our_picks)

    def __getitem__(self, idx):
        return (
            self.our_picks[idx],
            self.enemy_picks[idx],
            self.bans[idx],
            self.fearless_masks[idx],
            self.meta_info[idx],
            self.target_choices[idx],
            self.target_scores[idx]
        )

def train_student_model():
    print("\n=== STARTING JEV STUDENT SET-TRANSFORMER TRAINING ===")
    with open(MAPPINGS_FILE, "r", encoding="utf-8") as f:
        master_heroes = json.load(f)
    num_heroes = len(master_heroes)
    id_to_idx = {h["hero_id"]: idx for idx, h in enumerate(master_heroes)}

    dataset = DraftDataset(DATASET_PATH, id_to_idx)
    dataloader = DataLoader(dataset, batch_size=64, shuffle=True)
    print(f" Loaded {len(dataset)} training samples.")

    device = torch.device("cpu")
    model = JevStudentNet(num_heroes=num_heroes, embed_dim=64, hidden_dim=128).to(device)

    choice_criterion = nn.CrossEntropyLoss()
    scores_criterion = nn.MSELoss()
    optimizer = optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)

    epochs = 4
    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        total_choice_loss = 0.0
        total_score_loss = 0.0
        batches = 0
        
        for our_p, enemy_p, b, mask, meta, target_c, target_s in dataloader:
            optimizer.zero_grad()
            
            logits, scores = model(our_p, enemy_p, b, mask, meta)
            
            # Choice loss
            target_labels = torch.argmax(target_c, dim=-1)
            loss_choice = choice_criterion(logits, target_labels)
            
            # Tactical score regression loss
            loss_score = scores_criterion(scores, target_s)
            
            loss = loss_choice + 2.5 * loss_score
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            total_choice_loss += loss_choice.item()
            total_score_loss += loss_score.item()
            batches += 1
            
        print(f" Epoch [{epoch+1}/{epochs}] - Total Loss: {total_loss/batches:.4f} | Choice Loss: {total_choice_loss/batches:.4f} | Score MSE: {total_score_loss/batches:.4f}")

    torch.save(model.state_dict(), MODEL_SAVE_PATH)
    print(f" Saved trained PyTorch student weights to {MODEL_SAVE_PATH}")

if __name__ == "__main__":
    train_student_model()
