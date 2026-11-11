"""STEPS 2013 (Монгол) статистикт тохируулсан чихрийн шижингийн синтетик когорт.

Монголын чихрийн шижингийн нээлттэй, бодит хувь хүний түвшний өгөгдөл байхгүй тул
хүн амын тархалтыг STEPS-ээс, хүчин зүйлсийн нөлөөг хэвлэгдсэн odds ratio-оос авч
"мэдлэгт суурилсан" синтетик өгөгдөл үүсгэнэ. Энэ нь бодит клиник өгөгдлийг орлохгүй;
бодит өгөгдөл (жишээ нь CDC BRFSS, Pima) нэмэгдвэл тэр дээр дахин сургана.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# log-odds коэффициентууд (FINDRISC, ADA эрсдэлийн тест, мета-шинжилгээнүүдээс)
COEF = {
    "age_per_year": 0.055,
    "bmi_per_unit": 0.11,
    "family_diabetes": np.log(2.3),
    "inactive": np.log(1.4),
    "low_fruit_veg": np.log(1.15),
    "hypertension": np.log(1.4),
    "smoker": np.log(1.3),
}
TARGET_PREVALENCE = 0.069  # STEPS 2013: чихрийн шижингийн тархалт 6.9%


def _logit(df: pd.DataFrame, b0: float) -> np.ndarray:
    return (
        b0
        + COEF["age_per_year"] * (df.age - 40)
        + COEF["bmi_per_unit"] * (df.bmi - 25)
        + COEF["family_diabetes"] * df.family_diabetes
        + COEF["inactive"] * df.inactive
        + COEF["low_fruit_veg"] * df.low_fruit_veg
        + COEF["hypertension"] * (df.sys_bp >= 140)
        + COEF["smoker"] * df.smoker
    )


def generate_diabetes_cohort(n: int = 20000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    age = rng.integers(15, 65, n)
    male = rng.binomial(1, 0.5, n)
    bmi = np.clip(rng.normal(23.5 + 0.08 * (age - 15) + 0.5 * (1 - male), 4.5), 15, 50)
    sys_bp = np.clip(
        rng.normal(112 + 0.5 * (age - 15) + 5 * male + 0.6 * (bmi - 25), 14), 85, 210)
    df = pd.DataFrame({
        "age": age.astype(float),
        "male": male.astype(float),
        "bmi": bmi,
        "sys_bp": sys_bp,
        "family_diabetes": rng.binomial(1, 0.15, n).astype(float),
        "inactive": rng.binomial(1, 0.22, n).astype(float),
        "low_fruit_veg": rng.binomial(1, 0.35, n).astype(float),
        "smoker": np.where(male == 1, rng.binomial(1, 0.491, n), rng.binomial(1, 0.05, n)).astype(float),
    })
    noise = rng.normal(0, 0.5, n)

    # b0-г хоёртын хайлтаар олж нийт тархалтыг STEPS-тэй тэнцүүлнэ
    lo, hi = -10.0, 2.0
    for _ in range(60):
        mid = (lo + hi) / 2
        p = 1 / (1 + np.exp(-(_logit(df, mid) + noise)))
        lo, hi = (mid, hi) if p.mean() < TARGET_PREVALENCE else (lo, mid)
    p = 1 / (1 + np.exp(-(_logit(df, lo) + noise)))
    y = rng.binomial(1, p)
    df["thirst"] = np.where(y == 1, rng.binomial(1, 0.35, n), rng.binomial(1, 0.07, n)).astype(float)
    df["diabetes"] = y
    return df
