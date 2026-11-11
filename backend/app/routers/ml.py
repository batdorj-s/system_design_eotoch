from __future__ import annotations

import json

from fastapi import APIRouter

from ..config import get_settings
from ..ml.features import DIABETES_EXTRA_OR, FEATURE_LABELS_MN, HEART_BP_OR_PER_20, HEART_LIFESTYLE_OR
from ..ml.predictor import get_engine

router = APIRouter(prefix="/api/ml", tags=["ml"])


@router.get("/model-card")
def model_card():
    """Загварын карт: харьцуулалт, тестийн үр дүн, шинжийн ач холбогдол (ил тод байдлын шаардлага)."""
    card = get_engine().card
    return {**card, "feature_labels": FEATURE_LABELS_MN,
            "lifestyle_odds_ratios": HEART_LIFESTYLE_OR, "bp_odds_ratio_per_20mmHg": HEART_BP_OR_PER_20,
            "diabetes_extra_odds_ratios": DIABETES_EXTRA_OR}


@router.get("/insights")
def insights():
    """EDA тайлан (ai-model/eda.py)."""
    p = get_settings().artifacts_dir / "eda.json"
    return json.loads(p.read_text()) if p.exists() else {"datasets": []}
