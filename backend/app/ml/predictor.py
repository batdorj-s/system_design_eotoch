"""Эрсдэлийн тооцооллын үйлчилгээ (inference + тайлбар)."""
from __future__ import annotations

import json
import math
import threading
from typing import Any

import joblib
import pandas as pd

from ..config import get_settings
from . import features as F
from .explain import make_explainer, shap_values

DISEASE_LABELS = {"heart": "Зүрх судас", "diabetes": "Чихрийн шижин", "cancer": "Хавдар (уушги)"}
DEFAULT_PRIOR = {"heart": {"train": F.HEART_TRAIN_PREVALENCE, "population": F.HEART_POPULATION_PREVALENCE}}
LEVEL_LABELS = {"low": "Бага", "moderate": "Дунд", "high": "Өндөр"}
URGENT_THRESHOLD = 85


def _logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def _prior_shift(p: float, prior: dict) -> float:
    """Сургалтын өгөгдлийн суурь тархалтыг хүн амын тархалт руу шилжүүлэх (Saerens et al., 2002)."""
    return _sigmoid(_logit(p) - _logit(prior["train"]) + _logit(prior["population"]))


_SYMPTOM_SCALE = {"Chest Pain", "Coughing of Blood", "Shortness of Breath", "Fatigue", "Weight Loss",
                  "Swallowing Difficulty"}


def factor_label(feature: str, value: float | None) -> str:
    """Шинж байхгүй үед ойлгомжтой нэр: 'Их цангах: үгүй', хүйс → 'Эмэгтэй хүйс'."""
    base = F.FEATURE_LABELS_MN.get(feature, feature)
    if value is None or feature.startswith("lifestyle_"):
        return base
    if feature == "male":
        return "Эрэгтэй хүйс" if value == 1 else "Эмэгтэй хүйс"
    if feature == "Gender":
        return "Эрэгтэй хүйс" if value == 1 else "Эмэгтэй хүйс"
    if feature in ("Genetic Risk", "Air Pollution", "Balanced Diet") and value <= 3:
        return f"{base}: бага"
    if feature == "Obesity" and value <= 2:
        return "Хэвийн жин"
    if feature in ("Smoking", "Alcohol use") and value <= 1:
        return f"{base}: үгүй"
    if (feature in _SYMPTOM_SCALE and value <= 2) or (value == 0 and feature in (
            "exang", "fbs", "family_diabetes", "inactive", "low_fruit_veg", "smoker", "thirst",
            "high_bp", "high_chol", "ever_smoker", "no_fruits", "no_veggies")):
        return f"{base}: үгүй"
    return base


def level_of(pct: float) -> str:
    return "high" if pct >= 50 else "moderate" if pct >= 20 else "low"


class RiskEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.load()

    def load(self) -> None:
        d = get_settings().artifacts_dir
        with self._lock:
            self.models = {k: joblib.load(d / f"{k}.joblib") for k in ("heart", "cancer", "diabetes")}
            self.card = json.loads((d / "model_card.json").read_text())
            self.explainers = {
                k: make_explainer(m["model"], m["features"], m["background"].head(40), m["multiclass"])
                for k, m in self.models.items()
            }

    @property
    def version(self) -> str:
        return self.card.get("version", "unknown")

    # -----------------------------------------------------------------------
    def _raw(self, key: str, vec: dict[str, float]) -> tuple[float, float, list[dict]]:
        """(эрсдэл, суурь утга, SHAP хувь нэмэр) — 0..1 масштабаар."""
        m = self.models[key]
        X = pd.DataFrame([[vec[f] for f in m["features"]]], columns=m["features"], dtype=float)
        proba = m["model"].predict_proba(X)[0]
        risk = float(proba[2] + 0.5 * proba[1]) if m["multiclass"] else float(proba[1])
        ex = self.explainers[key](X.to_numpy(dtype=float), max_evals=2 * X.shape[1] + 1, silent=True)
        base = float(ex.base_values[0])
        contrib = [{"feature": f, "impact": float(v), "value": vec[f]}
                   for f, v in zip(m["features"], ex.values[0])]
        return risk, base, contrib

    def _adjusted(self, key: str, vec: dict, log_odds: dict[str, float]) -> dict:
        risk, base, contrib = self._raw(key, vec)
        # 1) prior shift: сургалтын өгөгдлийн тархалтаас Монголын хүн амын түвшин рүү
        prior = self.models[key].get("prior") or DEFAULT_PRIOR.get(key)
        if prior:
            p_ml, b_ml = _prior_shift(risk, prior), _prior_shift(base, prior)
            scale = (p_ml - b_ml) / (risk - base) if abs(risk - base) > 1e-9 else 0.0
            for c in contrib:
                c["impact"] *= scale
        else:
            p_ml, b_ml = risk, base
        # 2) өгөгдөлд байхгүй хүчин зүйлс (хэвлэгдсэн odds ratio), хувь нэмрийг дарааллаар нь тооцно
        z = _logit(p_ml)
        p_prev = p_ml
        for k, lo in log_odds.items():
            z += lo
            p_new = _sigmoid(z)
            contrib.append({"feature": k, "impact": p_new - p_prev, "value": 1.0, "source": "odds_ratio"})
            p_prev = p_new
        return {"risk": p_prev, "base": b_ml, "contrib": contrib}

    def _heart(self, answers: dict) -> dict:
        return self._adjusted("heart", F.heart_vector(answers), F.heart_lifestyle_log_odds(answers))

    def _diabetes(self, answers: dict) -> dict:
        if self.models["diabetes"]["features"] == F.DIABETES_FEATURES:  # CDC BRFSS загвар
            return self._adjusted("diabetes", F.diabetes_vector(answers), F.diabetes_extra_log_odds(answers))
        return self._simple("diabetes", F.diabetes_synth_vector(answers))  # синтетик fallback

    def _simple(self, key: str, vec: dict) -> dict:
        risk, base, contrib = self._raw(key, vec)
        return {"risk": risk, "base": base, "contrib": contrib}

    # -----------------------------------------------------------------------
    def predict(self, answers: dict[str, Any]) -> dict[str, Any]:
        age = F._num(answers, "age", 30) or 30
        bmi = F.bmi_of(answers)
        result: dict[str, Any] = {
            "model_version": self.version,
            "bmi": round(bmi, 1),
            "bmi_category": F.bmi_category(bmi),
            "in_scope": 15 <= age <= 65,
            "red_flags": F.red_flags(answers),
        }
        if not result["in_scope"]:
            result["scope_message"] = ("Энэ насны хүрээнд хамаарахгүй: загварууд 15–65 насны хүмүүсийн өгөгдлөөр "
                                       "сургагдсан тул эрсдэлийн оноо тооцоогүй. Эмчид хандана уу.")
            result["urgent"] = bool(result["red_flags"])
            return result

        raw = {
            "heart": self._heart(answers),
            "diabetes": self._diabetes(answers),
            "cancer": self._simple("cancer", F.cancer_vector(answers)),
        }
        risks = {}
        for key, r in raw.items():
            pct = round(100 * r["risk"], 1)
            factors = sorted(
                ({"feature": c["feature"], "label": factor_label(c["feature"], c.get("value")),
                  "impact": round(100 * c["impact"], 1), "source": c.get("source", "ml")}
                 for c in r["contrib"] if abs(c["impact"]) >= 0.002),
                key=lambda c: -abs(c["impact"]))
            risks[key] = {
                "label": DISEASE_LABELS[key], "value": pct, "baseline": round(100 * r["base"], 1),
                "level": level_of(pct), "level_label": LEVEL_LABELS[level_of(pct)],
                "factors": factors[:6],
                "algorithm": self.models[key]["algorithm"],
                "kind": "relative_index" if key == "cancer" else "probability",
            }
        vals = [r["value"] for r in risks.values()]
        overall = round(0.6 * max(vals) + 0.4 * sum(vals) / len(vals), 1)
        result.update({
            "risks": risks,
            "overall": {"value": overall, "level": level_of(overall), "level_label": LEVEL_LABELS[level_of(overall)]},
            "radar": self._radar(answers, risks, bmi),
            "reasons": self._reasons(risks),
            "specialties": self._specialties(answers, risks),
        })
        result["urgent"] = (risks["heart"]["value"] >= URGENT_THRESHOLD
                            or risks["cancer"]["value"] >= URGENT_THRESHOLD or bool(result["red_flags"]))
        return result

    @staticmethod
    def _radar(answers: dict, risks: dict, bmi: float) -> list[dict]:
        life = 0
        life += {"current": 30, "former": 10}.get(answers.get("smoking"), 0)
        life += {"daily": 25, "often": 15, "seldom": 5}.get(answers.get("alcohol_freq"), 0)
        life += max(0, ((F._num(answers, "salt_intake", 5) or 5) - 4) * 4)
        life += 15 if answers.get("activity") == "low" else 0
        life += 10 if answers.get("fruit_veg") == "rare" else 0
        weight = min(100, max(0, (bmi - 22) * 8)) if bmi >= 22 else min(100, (22 - bmi) * 10)
        return [
            {"axis": "Зүрх судас", "value": risks["heart"]["value"]},
            {"axis": "Чихрийн шижин", "value": risks["diabetes"]["value"]},
            {"axis": "Хавдар", "value": risks["cancer"]["value"]},
            {"axis": "Жин (BMI)", "value": round(weight, 1)},
            {"axis": "Амьдралын хэв маяг", "value": min(100, life)},
        ]

    @staticmethod
    def _reasons(risks: dict) -> list[str]:
        out = []
        for r in risks.values():
            for f in r["factors"]:
                if f["impact"] > 1.0:
                    out.append(f"{f['label']} → {r['label']} эрсдэлийг +{f['impact']:.1f}%")
        return out[:8] or ["Таны үзүүлэлтүүд одоогоор эрсдэл багатай байна."]

    @staticmethod
    def _specialties(answers: dict, risks: dict) -> list[str]:
        ranked = sorted(risks.items(), key=lambda kv: -kv[1]["value"])
        mapping = {"heart": "Зүрх судас", "diabetes": "Дотоод шүүрэл", "cancer": "Хавдар судлал"}
        out = [mapping[k] for k, r in ranked if r["level"] != "low"]
        if answers.get("smoking") == "current" or (F._num(answers, "air_pollution", 5) or 5) >= 7:
            out.append("Уушги, амьсгалын зам")
        return list(dict.fromkeys(out))


_engine: RiskEngine | None = None


def get_engine() -> RiskEngine:
    global _engine
    if _engine is None:
        _engine = RiskEngine()
    return _engine
