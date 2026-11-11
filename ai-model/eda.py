"""Өгөгдлийн судалгаа (Exploratory Data Analysis).

Гаралт:
  ai-model/reports/eda.json      — вэб дээрх "Өгөгдлийн судалгаа" хуудсанд харагдана
  ai-model/reports/*.png         — тайланд оруулах графикууд

Ажиллуулах:  python3 ai-model/eda.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from synthetic import generate_diabetes_cohort

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
REPORTS.mkdir(exist_ok=True)


def histogram(df: pd.DataFrame, col: str, target: str, bins: int = 10) -> list[dict]:
    s = df[[col, target]].dropna()
    edges = np.histogram_bin_edges(s[col], bins=bins)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (s[col] >= a) & ((s[col] < b) | (b == edges[-1]))
        sub = s[m]
        out.append({
            "bin": f"{a:.0f}–{b:.0f}",
            "negative": int((sub[target] == 0).sum()),
            "positive": int((sub[target] == 1).sum()),
            "rate": round(float(sub[target].mean()), 3) if len(sub) else None,
        })
    return out


def summary(df: pd.DataFrame, cols: list[str]) -> dict:
    d = df[cols].describe().T
    return {
        c: {k: round(float(d.loc[c, k]), 2) for k in ["mean", "std", "min", "50%", "max"]}
        for c in cols
    }


def correlations(df: pd.DataFrame, target: str) -> list[dict]:
    num = df.select_dtypes(include=[np.number])
    corr = num.corr()[target].drop(target).dropna().sort_values(key=abs, ascending=False)
    return [{"feature": k, "corr": round(float(v), 3)} for k, v in corr.items()]


def save_heatmap(df: pd.DataFrame, name: str, title: str) -> None:
    plt.figure(figsize=(10, 8))
    sns.heatmap(df.select_dtypes(include=[np.number]).corr(), cmap="coolwarm", center=0,
                annot=df.shape[1] <= 12, fmt=".2f")
    plt.title(title)
    plt.tight_layout()
    plt.savefig(REPORTS / name, dpi=120)
    plt.close()


# ---------------------------------------------------------------------------
def eda_heart() -> dict:
    raw = pd.read_csv(DATA / "heart_disease_uci.csv")
    df = raw.copy()
    zeros = {"trestbps": int((df.trestbps == 0).sum()), "chol": int((df.chol == 0).sum())}
    df.loc[df.trestbps == 0, "trestbps"] = np.nan
    df.loc[df.chol == 0, "chol"] = np.nan
    df["target"] = (df.num > 0).astype(int)
    df["male"] = (df.sex == "Male").astype(int)
    for c in ["fbs", "exang"]:
        df[c] = df[c].map({True: 1, False: 0, "TRUE": 1, "FALSE": 0})

    by_source = (df.groupby("dataset").agg(rows=("id", "size"), disease_rate=("target", "mean"),
                                           chol_missing=("chol", lambda s: s.isna().mean()))
                 .round(3).reset_index().to_dict("records"))
    cp = (df.groupby("cp").target.agg(["size", "mean"]).round(3).reset_index()
          .rename(columns={"size": "rows", "mean": "disease_rate"}).to_dict("records"))
    save_heatmap(df.drop(columns=["id", "num"]), "heart_corr.png", "UCI Heart — хамаарлын матриц")

    corr = correlations(df.drop(columns=["id", "num"]), "target")
    return {
        "key": "heart",
        "title": "Зүрх судасны өвчин (UCI Heart Disease)",
        "source": "UCI Machine Learning Repository / Kaggle — Cleveland, Hungary, Switzerland, VA Long Beach",
        "rows": int(len(df)), "columns": int(raw.shape[1]),
        "target": "num > 0 (зүрхний титэм судасны өвчин оношлогдсон)",
        "class_balance": {"negative": int((df.target == 0).sum()), "positive": int((df.target == 1).sum())},
        "missing": {k: int(v) for k, v in raw.isna().sum().items() if v > 0},
        "zero_as_missing": zeros,
        "by_source": by_source,
        "chest_pain_types": cp,
        "summary": summary(df, ["age", "trestbps", "chol", "thalch", "oldpeak"]),
        "histograms": {"age": histogram(df, "age", "target"), "trestbps": histogram(df, "trestbps", "target")},
        "correlations": corr,
        "findings": [
            f"Нийт {len(df)} өвчтөн, {df.target.mean():.0%} нь өвчтэй — энэ нь эмнэлэгт хандсан хүмүүсийн өгөгдөл тул нийт хүн амаас хамаагүй өндөр. Иймд загварын магадлалыг хүн амын түвшинд (≈15%) шилжүүлж тохируулсан.",
            f"Холестерин {zeros['chol']} мөрөнд 0 гэж бичигдсэн (ихэнх нь Switzerland) — энэ нь бодит утга биш, дутуу өгөгдөл. NaN болгож медианаар нөхсөн.",
            "Цээжний өвдөлтийн 'asymptomatic' ангилалд өвчлөл хамгийн өндөр (≈79%) — эмнэлгийн сонголтын хазайлт (selection bias). Иймээс cp шинжийг асуулгын загварт ашиглаагүй.",
            f"Зорилтот хувьсагчтай хамгийн хүчтэй хамааралтай шинж: {corr[0]['feature']} ({corr[0]['corr']}), {corr[1]['feature']} ({corr[1]['corr']}).",
            "Систолын даралт (trestbps) дангаараа өвчлөлтэй эерэг хамааралтай (≤120: 48% → >160: 72%), гэвч нас, хүйсийг тооцсоны дараа логистик регрессийн коэффициент ≈0 болдог — эмнэлэгт хандсан хүмүүсийн өгөгдлийн хазайлт. Иймээс даралтын нөлөөг мета-шинжилгээний OR (20 ммМУБ тутамд ×1.5)-оор тооцсон.",
            "ca, thal, slope баганууд 30–66% дутуу — асуулгаар цуглуулах боломжгүй тул загварт оруулаагүй.",
        ],
    }


def eda_cancer() -> dict:
    raw = pd.read_csv(DATA / "cancer patient data sets.csv")
    df = raw.drop(columns=["index", "Patient Id"])
    dups = int(df.duplicated().sum())
    uniq = df.drop_duplicates()
    level_map = {"Low": 0, "Medium": 1, "High": 2}
    u = uniq.assign(level=uniq.Level.map(level_map)).drop(columns=["Level"])
    corr = correlations(u, "level")
    save_heatmap(u, "cancer_corr.png", "Lung cancer — хамаарлын матриц (давхардалгүй)")
    hist = []
    for col in ["Smoking", "Air Pollution", "Coughing of Blood"]:
        g = u.groupby(col)["level"].apply(lambda s: (s == 2).mean()).round(3)
        hist.append({"feature": col, "points": [{"value": int(k), "high_rate": float(v)} for k, v in g.items()]})
    return {
        "key": "cancer",
        "title": "Уушгины хавдрын эрсдэл (Cancer Patient Data Sets)",
        "source": "Kaggle — Lung cancer prediction dataset (1000 өвчтөн, 23 шинж)",
        "rows": int(len(df)), "unique_rows": int(len(uniq)), "duplicates": dups, "columns": int(raw.shape[1]),
        "target": "Level (Low / Medium / High) → загвар: High эсэх",
        "class_balance": {k: int(v) for k, v in uniq.Level.value_counts().items()},
        "class_balance_raw": {k: int(v) for k, v in df.Level.value_counts().items()},
        "summary": summary(u, ["Age", "Air Pollution", "Smoking", "Alcohol use", "Genetic Risk"]),
        "correlations": corr,
        "level_by_feature": hist,
        "findings": [
            f"1000 мөрөөс {dups} нь бүрэн давхардал — давтагдашгүй ердөө {len(uniq)} мөр. Давхардлыг арилгалгүй сургавал тест өгөгдөлд сургалтын хуулбар орж, нарийвчлал хиймлээр ~100% гарна (data leakage).",
            "Бүх шинж 1–9 оноон шкал дээр, Level-тэй маш өндөр хамааралтай — энэ өгөгдөл бодит клиник бус, хялбаршуулсан шинжтэй. Иймээс гаралтыг 'харьцангуй эрсдэлийн индекс' гэж тайлбарлана.",
            f"Хамгийн хүчтэй хамааралтай шинжүүд: {', '.join(c['feature'] for c in corr[:4])}.",
            "Монголд агаарын бохирдол болон эрэгтэйчүүдийн тамхидалт (49.1%) өндөр тул эдгээр шинж загварт чухал үүрэгтэй.",
        ],
    }


BRFSS = DATA / "brfss" / "cdc_diabetes_health_indicators.csv"
AGE_BANDS = {1: "18–24", 2: "25–29", 3: "30–34", 4: "35–39", 5: "40–44", 6: "45–49", 7: "50–54",
             8: "55–59", 9: "60–64", 10: "65–69", 11: "70–74", 12: "75–79", 13: "80+"}


def eda_brfss() -> dict:
    raw = pd.read_csv(BRFSS)
    df = raw.drop(columns=["ID"])
    y = "Diabetes_binary"
    rate = lambda col: {str(k): round(float(v), 3) for k, v in df.groupby(col)[y].mean().items()}
    alc = rate("HvyAlcoholConsump")
    save_heatmap(df[[y, "HighBP", "HighChol", "BMI", "Smoker", "PhysActivity", "Fruits", "Veggies",
                     "HvyAlcoholConsump", "Sex", "Age", "GenHlth"]], "diabetes_corr.png",
                 "CDC BRFSS 2015 — хамаарлын матриц")
    by_age = df.groupby("Age")[y].agg(["size", "sum"])
    age_hist = [{"bin": AGE_BANDS[int(a)], "negative": int(r["size"] - r["sum"]), "positive": int(r["sum"]),
                 "rate": round(float(r["sum"] / r["size"]), 3)} for a, r in by_age.iterrows()]
    corr = correlations(df, y)
    return {
        "key": "diabetes",
        "title": "Чихрийн шижин / урьдал шижин (CDC BRFSS 2015)",
        "source": "UCI ML Repository #891 — CDC Diabetes Health Indicators (АНУ-ын BRFSS 2015 судалгаа)",
        "rows": int(len(df)), "columns": int(raw.shape[1]),
        "duplicates": int(df.duplicated().sum()),
        "target": "Diabetes_binary (0 = үгүй, 1 = чихрийн шижин эсвэл урьдал шижин)",
        "class_balance": {"negative": int((df[y] == 0).sum()), "positive": int((df[y] == 1).sum())},
        "summary": summary(df, ["BMI", "Age", "GenHlth", "MentHlth", "PhysHlth"]),
        "histograms": {"age": age_hist},
        "correlations": corr,
        "findings": [
            f"{len(df):,} хүний бодит судалгааны өгөгдөл; тархалт {df[y].mean():.1%}. Монголын STEPS 2013-д чихрийн шижин 6.9% + өлөн үеийн глюкозын өөрчлөлт 8.3% = 15.2% тул зорилтын тодорхойлолт ойролцоо.",
            f"Нас ахих тусам эрсдэл огцом өснө: 18–24 насанд {age_hist[0]['rate']:.1%} → 65–69 насанд {age_hist[9]['rate']:.1%}.",
            f"BMI ≥ 35 бүлэгт {df[df.BMI >= 35][y].mean():.0%}, BMI < 25 бүлэгт {df[df.BMI < 25][y].mean():.0%} — таргалалт хамгийн хүчтэй өөрчлөгдөх хүчин зүйл.",
            f"Их архи уудаг хүмүүст тархалт бага ({alc['1']:.1%} vs {alc['0']:.1%}) — энэ нь шалтгаан биш, confounding (жишээ нь өвчтэй хүмүүс архинаас татгалздаг). Иймээс загварт оруулаагүй.",
            "Гэр бүлийн түүх, цангах шинж тэмдэг BRFSS-д байхгүй тул хэвлэгдсэн OR-оор (×2.3, ×3.0) нэмж тооцсон.",
            f"{int(df.duplicated().sum()):,} мөр давхцдаг — бүх шинж хоёртын/ангиллын тул өөр хүмүүсийн хариулт адил байх нь хэвийн (ID өөр); leakage биш.",
            "Хязгаарлалт: АНУ-ын хүн ам — Монголд хэрэглэхдээ суурь тархалтыг STEPS-ийн 15.2%-д шилжүүлж калибровк хийсэн.",
        ],
    }


def eda_diabetes() -> dict:
    if BRFSS.exists():
        return eda_brfss()
    df = generate_diabetes_cohort()
    save_heatmap(df, "diabetes_corr.png", "Чихрийн шижин (синтетик, STEPS) — хамаарлын матриц")
    return {
        "key": "diabetes",
        "title": "Чихрийн шижин (STEPS 2013-д тохируулсан синтетик когорт)",
        "source": "ДЭМБ STEPS 2013 Монгол тархалт + FINDRISC/ADA odds ratio — мэдлэгт суурилсан симуляци",
        "rows": int(len(df)), "columns": int(df.shape[1]),
        "target": "diabetes (0/1)",
        "class_balance": {"negative": int((df.diabetes == 0).sum()), "positive": int((df.diabetes == 1).sum())},
        "summary": summary(df, ["age", "bmi", "sys_bp"]),
        "histograms": {"age": histogram(df, "age", "diabetes"), "bmi": histogram(df, "bmi", "diabetes")},
        "correlations": correlations(df, "diabetes"),
        "findings": [
            f"Монголын бодит хувь хүний түвшний нээлттэй өгөгдөл байхгүй тул {len(df):,} хүний синтетик когорт үүсгэсэн; тархалт {df.diabetes.mean():.1%} (STEPS: 6.9%).",
            "Анги тэнцвэргүй (≈7% эерэг) — accuracy бус ROC-AUC, PR-AUC, Brier оноогоор үнэлсэн.",
            "Нас болон BMI нь хамгийн хүчтэй хүчин зүйл; гэр бүлийн түүх эрсдэлийг ≈2.3 дахин нэмнэ.",
            "Хязгаарлалт: загвар нь өгөгдөл үүсгэсэн дүрмийг 'дахин сурдаг' — бодит өгөгдөл нэмэгдэхэд дахин сургах шаардлагатай.",
        ],
    }


def main() -> None:
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "datasets": [eda_heart(), eda_cancer(), eda_diabetes()],
        "steps_reference": [
            {"indicator": "Артерийн даралт ихсэлт", "value": 27.5, "unit": "%"},
            {"indicator": "Илүүдэл жин / таргалалт", "value": 54.4, "unit": "%"},
            {"indicator": "Чихрийн шижин", "value": 6.9, "unit": "%"},
            {"indicator": "Эрэгтэйчүүдийн тамхидалт", "value": 49.1, "unit": "%"},
            {"indicator": "Хэвлийн таргалалт", "value": 56.8, "unit": "%"},
            {"indicator": "Хэт их архидалт (эрэгтэй)", "value": 37.5, "unit": "%"},
        ],
    }
    out = REPORTS / "eda.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"EDA тайлан: {out}")
    for d in report["datasets"]:
        print(f"\n== {d['title']} ==")
        for f in d["findings"]:
            print(" -", f)


if __name__ == "__main__":
    main()
