"""Загвараас үл хамаарах SHAP тайлбар.

Эрсдэлийн функц f(x) нь:
  * хоёртын загварт  P(өвчтэй)
  * олон ангилалд     P(High) + 0.5·P(Medium)   (харьцангуй эрсдэлийн индекс)
Pipeline-ийг бүхэлд нь (imputer, scaler орно) тайлбарлах тул дутуу утгатай оролт ч ажиллана.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd
import shap


def risk_function(model, features: list[str], multiclass: bool) -> Callable[[np.ndarray], np.ndarray]:
    def f(x: np.ndarray) -> np.ndarray:
        p = model.predict_proba(pd.DataFrame(np.asarray(x, dtype=float), columns=features))
        return p[:, 2] + 0.5 * p[:, 1] if multiclass else p[:, 1]
    return f


def make_explainer(model, features: list[str], background: pd.DataFrame, multiclass: bool):
    masker = shap.maskers.Independent(background.to_numpy(dtype=float), max_samples=40)
    return shap.explainers.Permutation(risk_function(model, features, multiclass), masker)


def shap_values(explainer, X: pd.DataFrame) -> np.ndarray:
    n = X.shape[1]
    return explainer(X.to_numpy(dtype=float), max_evals=2 * n + 1, silent=True).values


def global_importance(model, features, background, multiclass, X: pd.DataFrame) -> list[dict]:
    ex = make_explainer(model, features, background, multiclass)
    sv = shap_values(ex, X)
    imp = np.abs(sv).mean(axis=0)
    total = float(imp.sum()) or 1.0
    return sorted(({"feature": f, "importance": round(float(v) / total, 4)} for f, v in zip(features, imp)),
                  key=lambda d: -d["importance"])
