"""Асуулгын хариултыг ML загварын шинж (feature) рүү хөрвүүлэх нийтлэг логик.

Энэ модулийг сургалтын скрипт (ai-model/train.py) болон бэкэнд хоёулаа ашигладаг,
ингэснээр сургалт ба inference үеийн хөрвүүлэлт хэзээ ч зөрөхгүй.
"""
from __future__ import annotations

import math
from typing import Any

# ---------------------------------------------------------------------------
# Загвар бүрийн оролтын шинжүүд (дараалал чухал — ONNX/joblib хоёуланд нь ижил)
# ---------------------------------------------------------------------------

# trestbps-ийг ML-д оруулаагүй: UCI (эмнэлгийн лавлагаа) өгөгдөлд нас/хүйсийг тооцсоны дараа
# коэффициент ≈0 болдог (referral bias). Даралтыг мета-шинжилгээний OR-оор тооцно (доор).
HEART_FEATURES = ["age", "male", "chol", "fbs", "exang"]

CANCER_FEATURES = [
    "Age", "Gender", "Air Pollution", "Alcohol use", "Genetic Risk", "Smoking",
    "Obesity", "Balanced Diet", "Chest Pain", "Coughing of Blood",
    "Shortness of Breath", "Fatigue", "Weight Loss", "Swallowing Difficulty",
]

# CDC BRFSS 2015 (UCI #891) — асуулгаас гаргаж болох шинжүүд, бүгд "эрсдэлийн чиглэлтэй" (1 = муу).
# HvyAlcoholConsump-ийг оруулаагүй: BRFSS-д "хамгаалдаг" мэт харагддаг (confounding).
DIABETES_FEATURES = [
    "age_cat", "male", "bmi", "high_bp", "high_chol", "ever_smoker", "inactive", "no_fruits", "no_veggies",
]
# Синтетик когорт (BRFSS байхгүй үеийн fallback)
DIABETES_SYNTH_FEATURES = [
    "age", "male", "bmi", "sys_bp", "family_diabetes", "inactive",
    "low_fruit_veg", "smoker", "thirst",
]

FEATURE_LABELS_MN: dict[str, str] = {
    # heart
    "age": "Нас", "male": "Эрэгтэй хүйс", "trestbps": "Систолын даралт",
    "chol": "Холестерин", "fbs": "Цусан дахь сахар өндөр", "exang": "Цээжний өвдөлт",
    "ca": "Будагдсан судасны тоо (ca)", "thalch": "Хамгийн их зүрхний цохилт",
    "oldpeak": "ST сегментийн бууралт", "thal": "Таллиумын сорил", "slope": "ST налуу",
    "restecg": "Тайван үеийн ЭКГ", "target": "Өвчин",
    # cancer
    "Age": "Нас", "Gender": "Хүйс", "Air Pollution": "Агаарын бохирдол",
    "Alcohol use": "Архины хэрэглээ", "Genetic Risk": "Удамшлын эрсдэл",
    "Smoking": "Тамхидалт", "Obesity": "Илүүдэл жин", "Balanced Diet": "Хооллолтын эрсдэл",
    "Chest Pain": "Цээжний өвдөлт", "Coughing of Blood": "Цустай ханиалга",
    "Shortness of Breath": "Амьсгаадалт", "Fatigue": "Ядаргаа", "Dust Allergy": "Тоосны харшил",
    "OccuPational Hazards": "Мэргэжлийн хортой нөхцөл", "chronic Lung Disease": "Уушгины архаг өвчин",
    "Passive Smoker": "Идэвхгүй тамхидалт", "Wheezing": "Хэржигнэх амьсгал", "Clubbing of Finger Nails": "Хурууны үзүүр өргөсөх",
    "Frequent Cold": "Байнга ханиад хүрэх", "Dry Cough": "Хуурай ханиалга", "Snoring": "Хурхирах",
    "Weight Loss": "Шалтгаангүй турах", "Swallowing Difficulty": "Залгихад хүндрэлтэй",
    # diabetes
    "bmi": "Биеийн жингийн индекс (BMI)", "sys_bp": "Систолын даралт",
    "family_diabetes": "Гэр бүлд чихрийн шижин", "inactive": "Хөдөлгөөний дутагдал",
    "low_fruit_veg": "Жимс ногоо бага", "smoker": "Тамхидалт", "thirst": "Их цангах / шээх",
    # lifestyle offsets
    "lifestyle_smoking": "Тамхидалт", "lifestyle_salt": "Давсны өндөр хэрэглээ",
    "lifestyle_alcohol": "Архины тогтмол хэрэглээ", "lifestyle_inactive": "Хөдөлгөөний дутагдал",
    "lifestyle_diet": "Жимс ногоо бага", "lifestyle_family": "Гэр бүлийн зүрхний өвчин",
    "lifestyle_obesity": "Таргалалт (BMI ≥ 30)",
    "lifestyle_bp": "Систолын даралт",
    # diabetes (BRFSS)
    "age_cat": "Нас", "high_bp": "Даралт ихсэлт (≥140)", "high_chol": "Холестерин өндөр",
    "ever_smoker": "Тамхидалт (одоо/өмнө)", "no_fruits": "Жимс өдөр бүр иддэггүй",
    "no_veggies": "Ногоо өдөр бүр иддэггүй",
    "diab_family": "Гэр бүлд чихрийн шижин", "diab_thirst": "Их цангах / шээх",
}

# Зүрх судасны UCI өгөгдөлд байхгүй амьдралын хэв маягийн хүчин зүйлсийг
# хэвлэгдсэн харьцангуй эрсдэлээр (odds ratio) log-odds дээр нэмж тооцно.
# Эх сурвалж: INTERHEART (Yusuf et al., Lancet 2004), ДЭМБ-ын давсны зөвлөмж.
HEART_LIFESTYLE_OR = {
    "lifestyle_smoking": 2.0,   # одоо татдаг (INTERHEART OR≈2.87, консерватив)
    "lifestyle_salt": 1.3,      # давс ≥ 8/10
    "lifestyle_alcohol": 1.3,   # өдөр бүр
    "lifestyle_inactive": 1.3,  # хөдөлгөөн бага
    "lifestyle_diet": 1.2,      # жимс ногоо бараг иддэггүй
    "lifestyle_family": 1.5,    # гэр бүлд зүрхний өвчин
    "lifestyle_obesity": 1.4,   # BMI ≥ 30
}
# Систолын даралт 120-оос дээш 20 ммМУБ тутамд OR 1.5 (Prospective Studies Collaboration,
# Lancet 2002: 20 ммМУБ тутамд ЗСӨ-ий нас баралт ~2 дахин; консерватив утга)
HEART_BP_OR_PER_20 = 1.5

# Эмнэлгийн лавлагаа хүн амын (UCI, ~55% өвчтэй) суурь давтамжийг
# нийт хүн амын түвшинд шилжүүлэх (prior-shift calibration).
HEART_TRAIN_PREVALENCE = 0.553
HEART_POPULATION_PREVALENCE = 0.15

# STEPS 2013: чихрийн шижин 6.9% + өлөн үеийн глюкозын өөрчлөлт 8.3% (BRFSS-ийн зорилт мөн
# "чихрийн шижин эсвэл урьдал шижин" тул ижил тодорхойлолт)
DIABETES_POPULATION_PREVALENCE = 0.152
# BRFSS-д байхгүй хүчин зүйлс: гэр бүлийн түүх (ADA/FINDRISC, OR≈2.3),
# их цангах/шээх шинж (polydipsia: LR+≈5 → консерватив OR 3.0)
DIABETES_EXTRA_OR = {"diab_family": 2.3, "diab_thirst": 3.0}


# Клиник логик: эдгээр шинж өсөхөд эрсдэл буурах ёсгүй (сургалтад загвар сонгоход шалгана)
MONOTONE_FEATURES = {
    "heart": ["age", "chol", "fbs", "exang"],
    "cancer": [f for f in CANCER_FEATURES if f not in ("Age", "Gender")],
    "diabetes": [f for f in DIABETES_FEATURES if f != "male"],
}


def _num(answers: dict[str, Any], key: str, default: float | None) -> float | None:
    v = answers.get(key)
    if v is None or v == "" or v == "unknown":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _symptoms(answers: dict[str, Any]) -> set[str]:
    s = answers.get("symptoms") or []
    if isinstance(s, str):
        s = [x for x in s.split(",") if x]
    # хуучин нэг сонголттой талбартай нийцтэй байлгах
    legacy = answers.get("specific_symptoms")
    if legacy and legacy != "none":
        s = list(s) + [legacy]
    return {x for x in s if x != "none"}


def _family(answers: dict[str, Any]) -> set[str]:
    f = answers.get("family_history") or []
    if isinstance(f, str):
        f = [x for x in f.split(",") if x]
    if answers.get("genetic_risk") == "yes":
        f = list(f) + ["diabetes", "cancer"]
    return {x for x in f if x != "none"}


def bmi_of(answers: dict[str, Any]) -> float:
    h = _num(answers, "height", 170.0) or 170.0
    w = _num(answers, "weight", 65.0) or 65.0
    return w / ((h / 100) ** 2)


def bmi_category(bmi: float) -> dict[str, str]:
    if bmi < 18.5:
        return {"key": "under", "label": "Жингийн дутагдалтай"}
    if bmi < 25:
        return {"key": "normal", "label": "Хэвийн жинтэй"}
    if bmi < 30:
        return {"key": "over", "label": "Илүүдэл жинтэй"}
    return {"key": "obese", "label": "Таргалалттай"}


def heart_vector(answers: dict[str, Any]) -> dict[str, float]:
    sym = _symptoms(answers)
    chol_choice = answers.get("cholesterol")
    chol = {"normal": 190.0, "borderline": 220.0, "high": 260.0}.get(str(chol_choice), math.nan)
    sugar = answers.get("blood_sugar")
    fbs = {"normal": 0.0, "high": 1.0}.get(str(sugar), math.nan)
    return {
        "age": _num(answers, "age", 40.0),
        "male": 1.0 if answers.get("gender") == "male" else 0.0,
        "chol": chol,
        "fbs": fbs,
        "exang": 1.0 if "chest_pain" in sym else 0.0,
    }


def heart_lifestyle_log_odds(answers: dict[str, Any]) -> dict[str, float]:
    """Идэвхтэй хүчин зүйл бүрийн log-odds нэмэгдэл."""
    out = {k: math.log(HEART_LIFESTYLE_OR[k]) for k, on in _heart_flags(answers).items() if on}
    sbp = _num(answers, "bp_systolic", 120.0) or 120.0
    if sbp > 120:
        out = {"lifestyle_bp": math.log(HEART_BP_OR_PER_20) * (sbp - 120) / 20, **out}
    return out


def _heart_flags(answers: dict[str, Any]) -> dict[str, bool]:
    fam = _family(answers)
    return {
        "lifestyle_smoking": answers.get("smoking") == "current",
        "lifestyle_salt": (_num(answers, "salt_intake", 5) or 5) >= 8,
        "lifestyle_alcohol": answers.get("alcohol_freq") == "daily",
        "lifestyle_inactive": answers.get("activity") == "low",
        "lifestyle_diet": answers.get("fruit_veg") == "rare",
        "lifestyle_family": "heart" in fam,
        "lifestyle_obesity": bmi_of(answers) >= 30,
    }


def _scale(x: float, lo: float, hi: float, out_lo: float, out_hi: float) -> float:
    x = min(max(x, lo), hi)
    return out_lo + (x - lo) * (out_hi - out_lo) / (hi - lo)


def cancer_vector(answers: dict[str, Any]) -> dict[str, float]:
    sym = _symptoms(answers)
    fam = _family(answers)
    bmi = bmi_of(answers)

    def s(name: str) -> float:
        return 7.0 if name in sym else 2.0

    return {
        "Age": _num(answers, "age", 40.0),
        "Gender": 1.0 if answers.get("gender") == "male" else 2.0,
        "Air Pollution": round(_scale(_num(answers, "air_pollution", 5) or 5, 1, 10, 1, 8)),
        "Alcohol use": {"never": 1, "seldom": 3, "often": 6, "daily": 8}.get(
            str(answers.get("alcohol_freq")), 2),
        "Genetic Risk": 6.0 if "cancer" in fam else 2.0,
        "Smoking": {"never": 1, "former": 4, "current": 7}.get(str(answers.get("smoking")), 1),
        "Obesity": 2.0 if bmi < 25 else (4.0 if bmi < 30 else 6.0),
        # Энэ датасетэд "Balanced Diet" өндөр = хооллолтын эрсдэл өндөр (Level-тэй эерэг хамааралтай)
        "Balanced Diet": {"daily": 2, "some": 4, "rare": 6}.get(str(answers.get("fruit_veg")), 4),
        "Chest Pain": s("chest_pain"),
        "Coughing of Blood": s("coughing_blood"),
        "Shortness of Breath": s("short_breath"),
        "Fatigue": s("fatigue"),
        "Weight Loss": s("weight_loss"),
        "Swallowing Difficulty": s("swallow_diff"),
    }


def brfss_age_cat(age: float) -> float:
    """BRFSS насны ангилал: 1 = 18–24, 2 = 25–29, … 13 = 80+."""
    return 1.0 if age < 25 else float(min(13, 2 + int((age - 25) // 5)))


def diabetes_vector(answers: dict[str, Any]) -> dict[str, float]:
    fv = answers.get("fruit_veg")
    chol = answers.get("cholesterol")
    return {
        "age_cat": brfss_age_cat(_num(answers, "age", 40.0) or 40.0),
        "male": 1.0 if answers.get("gender") == "male" else 0.0,
        "bmi": bmi_of(answers),
        "high_bp": 1.0 if (_num(answers, "bp_systolic", 120.0) or 120.0) >= 140 else 0.0,
        # мэдэхгүй бол NaN → pipeline-ийн imputer BRFSS-ийн дундаж (≈0.42)-аар нөхнө
        "high_chol": {"high": 1.0, "normal": 0.0, "borderline": 0.0}.get(str(chol), math.nan),
        "ever_smoker": 1.0 if answers.get("smoking") in ("current", "former") else 0.0,
        "inactive": 1.0 if answers.get("activity") == "low" else 0.0,
        "no_fruits": 0.0 if fv == "daily" else 1.0,
        "no_veggies": 1.0 if fv == "rare" else 0.0,
    }


def diabetes_extra_log_odds(answers: dict[str, Any]) -> dict[str, float]:
    on = {"diab_family": "diabetes" in _family(answers), "diab_thirst": "thirst" in _symptoms(answers)}
    return {k: math.log(DIABETES_EXTRA_OR[k]) for k, v in on.items() if v}


def diabetes_synth_vector(answers: dict[str, Any]) -> dict[str, float]:
    sym = _symptoms(answers)
    fam = _family(answers)
    return {
        "age": _num(answers, "age", 40.0),
        "male": 1.0 if answers.get("gender") == "male" else 0.0,
        "bmi": bmi_of(answers),
        "sys_bp": _num(answers, "bp_systolic", 120.0),
        "family_diabetes": 1.0 if "diabetes" in fam else 0.0,
        "inactive": 1.0 if answers.get("activity") == "low" else 0.0,
        "low_fruit_veg": 1.0 if answers.get("fruit_veg") == "rare" else 0.0,
        "smoker": 1.0 if answers.get("smoking") == "current" else 0.0,
        "thirst": 1.0 if "thirst" in sym else 0.0,
    }


def red_flags(answers: dict[str, Any]) -> list[str]:
    """Яаралтай анхаарах шинж тэмдгүүд (ML-ээс үл хамааран дүрмээр)."""
    sym = _symptoms(answers)
    flags = []
    if "coughing_blood" in sym:
        flags.append("Цустай ханиалга — яаралтай эмчид үзүүлнэ үү.")
    sbp = _num(answers, "bp_systolic", 120) or 120
    if sbp >= 180:
        flags.append(f"Систолын даралт {int(sbp)} ммМУБ — гипертензийн хямралын түвшин.")
    if "chest_pain" in sym and "short_breath" in sym:
        flags.append("Цээжний өвдөлт + амьсгаадалт — зүрхний яаралтай тусламж шаардлагатай байж болзошгүй.")
    return flags
