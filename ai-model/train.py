"""EOTOCH ML сургалтын pipeline.

3 загвар (зүрх судас, хавдар, чихрийн шижин) тус бүрд:
  1. Өгөгдөл цэвэрлэх (0 → NaN, давхардал арилгах)
  2. LogisticRegression / RandomForest / GradientBoosting / XGBoost-ыг
     Repeated Stratified K-Fold CV-ээр харьцуулах
  3. Шилдэг (ONNX-д хөрвүүлэгдэх) загварыг сонгож, held-out тест дээр
     ROC, calibration, confusion matrix тооцох
  4. SHAP-аар глобал шинжийн ач холбогдол тооцох
  5. joblib (бэкэнд) болон ONNX (браузер дахь оффлайн горим) хэлбэрээр хадгалах

Ажиллуулах:  python3 ai-model/train.py [--version v2]
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss,
                             confusion_matrix, f1_score, roc_auc_score, roc_curve)
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
sys.path.insert(0, str(PROJECT / "backend"))
from app.ml.explain import global_importance  # noqa: E402
from app.ml.features import (CANCER_FEATURES, DIABETES_FEATURES, DIABETES_POPULATION_PREVALENCE,  # noqa: E402
                             DIABETES_SYNTH_FEATURES, HEART_FEATURES, HEART_POPULATION_PREVALENCE,
                             MONOTONE_FEATURES)

from synthetic import generate_diabetes_cohort  # noqa: E402

DATA = ROOT / "data"
ARTIFACTS = PROJECT / "backend" / "app" / "ml" / "artifacts"
ONNX_DIR = PROJECT / "public" / "models"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
ONNX_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42


def candidates(n_classes: int, monotone: list[int] | None = None, impute: str = "median") -> dict[str, Pipeline]:
    def pipe(clf, scale=False):
        steps = [("impute", SimpleImputer(strategy=impute))]
        if scale:
            steps.append(("scale", StandardScaler()))
        steps.append(("clf", clf))
        return Pipeline(steps)

    return {
        "LogisticRegression": pipe(LogisticRegression(max_iter=2000, C=1.0), scale=True),
        "LogisticRegression-L2": pipe(LogisticRegression(max_iter=2000, C=0.1), scale=True),
        "LogisticRegression-Strong": pipe(LogisticRegression(max_iter=3000, C=0.01), scale=True),
        "RandomForest": pipe(RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=5,
                                                    random_state=SEED, n_jobs=-1)),
        # Клиник логикийг (эрсдэлт хүчин зүйл ↑ → эрсдэл ↓ болохгүй) бүтцээр нь баталгаажуулна
        **({"RandomForest-Monotone": pipe(RandomForestClassifier(
            n_estimators=300, max_depth=6, min_samples_leaf=3, monotonic_cst=monotone,
            random_state=SEED, n_jobs=-1))} if monotone and n_classes == 2 else {}),
        "GradientBoosting": pipe(GradientBoostingClassifier(n_estimators=150, max_depth=3,
                                                            learning_rate=0.05, random_state=SEED)),
        "XGBoost": pipe(XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.9,
                                      eval_metric="logloss" if n_classes == 2 else "mlogloss",
                                      random_state=SEED, n_jobs=-1)),
    }


PROBE: dict[str, pd.DataFrame] = {}
EXPORTABLE = {"LogisticRegression", "LogisticRegression-L2", "LogisticRegression-Strong", "RandomForest",
              "RandomForest-Monotone",
              "GradientBoosting"}


def monotonic_violations(model: Pipeline, X: pd.DataFrame, feats: list[str], multiclass: bool) -> float:
    """Эрсдэлт хүчин зүйлийг доод → дээд квантил руу шилжүүлэхэд эрсдэл буурч буй тохиолдлын хувь."""
    probes = X.sample(min(len(X), 30), random_state=SEED).reset_index(drop=True)
    f = lambda D: (lambda p: p[:, 2] + 0.5 * p[:, 1] if multiclass else p[:, 1])(model.predict_proba(D))
    bad = total = 0
    for feat in (f for f in feats if f in X.columns):
        lo_v, hi_v = X[feat].quantile(0.1), X[feat].quantile(0.9)
        if lo_v == hi_v:
            lo_v, hi_v = X[feat].min(), X[feat].max()
        lo, hi = probes.copy(), probes.copy()
        lo[feat], hi[feat] = lo_v, hi_v
        d = f(hi) - f(lo)
        bad += int((d < -0.005).sum())
        total += len(d)
    return round(bad / total, 4) if total else 0.0


def monotone_cst(X: pd.DataFrame, mono: list[str]) -> list[int]:
    return [1 if c in mono else 0 for c in X.columns]


def compare(X: pd.DataFrame, y: pd.Series, multiclass: bool, repeats: int, mono: list[str],
            impute: str = "median") -> list[dict]:
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=repeats, random_state=SEED)
    scoring = ({"auc": "roc_auc_ovr", "accuracy": "accuracy", "f1": "f1_macro"} if multiclass
               else {"auc": "roc_auc", "accuracy": "accuracy", "f1": "f1", "ap": "average_precision",
                     "brier": "neg_brier_score"})
    rows = []
    cst = monotone_cst(X, mono)
    for name, model in candidates(y.nunique(), cst, impute).items():
        r = cross_validate(model, X, y, cv=cv, scoring=scoring, n_jobs=1)
        row = {"model": name, "exportable": name in EXPORTABLE}
        for k in scoring:
            v = r[f"test_{k}"]
            if k == "brier":
                v = -v
            row[k] = round(float(v.mean()), 4)
            row[f"{k}_std"] = round(float(v.std()), 4)
        row["monotonic_violations"] = monotonic_violations(
            candidates(y.nunique(), cst, impute)[name].fit(X, y), X, mono, multiclass)
        rows.append(row)
        print(f"  {name:22s} AUC={row['auc']:.3f}±{row['auc_std']:.3f}  acc={row['accuracy']:.3f}"
              f"  mono-viol={row['monotonic_violations']:.1%}")
    return rows


def pick(rows: list[dict], calibrated: bool = True) -> str:
    """1) ONNX-д экспортлогдох, 2) клиник логик зөрчил ≤ 2% загваруудаас AUC-аар шилдгийг сонгоно.
    Шилдэгтэй 0.01-ээс бага зөрүүтэй логистик регресс байвал хамгийн их regularization-тэйг нь
    сонгоно (one-standard-error дүрэм): жижиг/бараг тусгаарлагдах өгөгдөл дээр хэт итгэлтэй
    (0% эсвэл 100%) таамаглалаас сэргийлнэ. Магадлал гаргадаг загварт (calibrated=True)
    Brier оноо 0.005-аас илүү муудах regularization-ыг сонгохгүй."""
    ok = [r for r in rows if r["exportable"] and r["monotonic_violations"] <= 0.02]
    if not ok:
        ok = [min((r for r in rows if r["exportable"]), key=lambda r: r["monotonic_violations"])]
    best = max(ok, key=lambda r: r["auc"])
    linear = [r for r in ok if r["model"].startswith("LogisticRegression") and best["auc"] - r["auc"] < 0.01]
    if calibrated and linear:
        best_brier = min(r["brier"] for r in linear)
        linear = [r for r in linear if r["brier"] - best_brier <= 0.005]
    order = ["LogisticRegression-Strong", "LogisticRegression-L2", "LogisticRegression"]
    return min(linear, key=lambda r: order.index(r["model"]))["model"] if linear else best["model"]


def evaluate(model: Pipeline, X_te, y_te, multiclass: bool) -> dict:
    proba = model.predict_proba(X_te)
    pred = model.predict(X_te)
    out = {
        "accuracy": round(float(accuracy_score(y_te, pred)), 4),
        "f1": round(float(f1_score(y_te, pred, average="macro" if multiclass else "binary")), 4),
        "confusion_matrix": confusion_matrix(y_te, pred).tolist(),
    }
    if multiclass:
        out["auc"] = round(float(roc_auc_score(y_te, proba, multi_class="ovr")), 4)
        p = proba[:, 2]
        yb = (np.asarray(y_te) == 2).astype(int)
    else:
        p = proba[:, 1]
        yb = np.asarray(y_te)
        out["auc"] = round(float(roc_auc_score(yb, p)), 4)
        out["ap"] = round(float(average_precision_score(yb, p)), 4)
        out["brier"] = round(float(brier_score_loss(yb, p)), 4)
    fpr, tpr, _ = roc_curve(yb, p)
    idx = np.linspace(0, len(fpr) - 1, min(len(fpr), 30)).astype(int)
    out["roc"] = [{"fpr": round(float(fpr[i]), 3), "tpr": round(float(tpr[i]), 3)} for i in idx]
    pt, pp = calibration_curve(yb, p, n_bins=8, strategy="quantile")
    out["calibration"] = [{"predicted": round(float(a), 3), "observed": round(float(b), 3)} for a, b in zip(pp, pt)]
    return out


def export_onnx(model: Pipeline, name: str, n_features: int) -> str | None:
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType
        onx = convert_sklearn(model, initial_types=[("float_input", FloatTensorType([None, n_features]))],
                              options={id(model[-1]): {"zipmap": False}}, target_opset=15)
        # Паритет шалгалт: ONNX ба sklearn-ийн эерэг ангиллын магадлал таарах ёстой
        import onnxruntime as rt
        sess = rt.InferenceSession(onx.SerializeToString())
        probe = PROBE[name].to_numpy(np.float32)
        got = sess.run(None, {"float_input": probe})[1]
        want = model.predict_proba(PROBE[name])
        cols = slice(1, None)  # skl2onnx хоёртын RF-ийн 0-р баганыг буруу гаргадаг тул 1-ээс хойш шалгана
        if np.abs(got[:, cols] - want[:, cols]).max() > 1e-4:
            raise ValueError("ONNX паритет зөрсөн")
        path = ONNX_DIR / f"{name}.onnx"
        path.write_bytes(onx.SerializeToString())
        return f"/models/{name}.onnx"
    except Exception as e:  # ONNX хөрвүүлэлт амжилтгүй бол бэкэнд ажилласаар байна
        print(f"  ! ONNX export failed for {name}: {e}")
        return None


def train_one(key: str, title: str, X: pd.DataFrame, y: pd.Series, *, multiclass=False, repeats=3,
              calibrated: bool = True, impute: str = "median", cv_sample: int | None = None,
              population_prevalence: float | None = None, extra: dict | None = None) -> dict:
    print(f"\n=== {title} ({len(X)} мөр) ===")
    Xc, yc = X, y
    if cv_sample and len(X) > cv_sample:
        # Том өгөгдөлд алгоритм харьцуулалтыг давхаргалсан дэд түүвэр дээр хийнэ (хурд)
        Xc, _, yc, _ = train_test_split(X, y, train_size=cv_sample, stratify=y, random_state=SEED)
        print(f"  (харьцуулалт {cv_sample:,} мөрийн дэд түүвэр дээр)")
    rows = compare(Xc, yc, multiclass, repeats, MONOTONE_FEATURES[key], impute)
    chosen = pick(rows, calibrated)
    print(f"  → сонгосон: {chosen}")
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    cst = monotone_cst(X, MONOTONE_FEATURES[key])
    model = candidates(y.nunique(), cst, impute)[chosen]
    model.fit(X_tr, y_tr)
    test = evaluate(model, X_te, y_te, multiclass)
    print(f"  тест: AUC={test['auc']:.3f} acc={test['accuracy']:.3f}")

    final = candidates(y.nunique(), cst, impute)[chosen].fit(X, y)  # бүх өгөгдөл дээр эцсийн загвар
    background = X.sample(min(len(X), 100), random_state=SEED)
    importance = global_importance(final, list(X.columns), background, multiclass,
                                   X.sample(min(len(X), 150), random_state=SEED + 1))
    prior = ({"train": round(float(y.mean()), 4), "population": population_prevalence}
             if population_prevalence else None)
    joblib.dump({"model": final, "features": list(X.columns), "background": background,
                 "algorithm": chosen, "multiclass": multiclass, "prior": prior},
                ARTIFACTS / f"{key}.joblib")
    PROBE[key] = X.head(20)
    onnx = export_onnx(final, key, X.shape[1])
    return {
        "key": key, "title": title, "algorithm": chosen, "rows": int(len(X)),
        "features": list(X.columns), "comparison": rows, "test": test,
        "importance": importance, "onnx": onnx, "medians": X.median().round(3).to_dict(),
        "prior": prior, "cv_rows": int(len(Xc)),
        **(extra or {}),
    }


# ---------------------------------------------------------------------------
def heart_data() -> tuple[pd.DataFrame, pd.Series, dict]:
    df = pd.read_csv(DATA / "heart_disease_uci.csv")
    df.loc[df.trestbps == 0, "trestbps"] = np.nan
    df.loc[df.chol == 0, "chol"] = np.nan
    df["male"] = (df.sex == "Male").astype(float)
    for c in ["fbs", "exang"]:
        df[c] = df[c].map({True: 1.0, False: 0.0, "TRUE": 1.0, "FALSE": 0.0})
    y = (df.num > 0).astype(int)

    # Бүх клиник шинжтэй загвартай харьцуулж, асуулгаар хязгаарлагдсанаас алдагдах мэдээллийг харуулна
    full = df[["age", "male", "trestbps", "chol", "fbs", "exang", "thalch", "oldpeak"]].copy()
    full = pd.concat([full, pd.get_dummies(df.cp, prefix="cp", dtype=float)], axis=1)
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=3, random_state=SEED)
    auc_full = cross_validate(candidates(2)["LogisticRegression"], full, y, cv=cv, scoring="roc_auc")["test_score"].mean()
    # Даралтын нөхцөлт нөлөө: нас/хүйсийг тооцсоны дараах стандартчилсан коэффициент
    with_bp = candidates(2)["LogisticRegression"].fit(df[HEART_FEATURES + ["trestbps"]], y)
    bp_coef = float(with_bp[-1].coef_[0][-1])
    return df[HEART_FEATURES], y, {"full_clinical_auc": round(float(auc_full), 4),
                                   "bp_conditional_coef": round(bp_coef, 4)}


def cancer_data() -> tuple[pd.DataFrame, pd.Series, dict]:
    df = pd.read_csv(DATA / "cancer patient data sets.csv").drop(columns=["index", "Patient Id"])
    y_raw = df.Level.map({"Low": 0, "Medium": 1, "High": 2})
    # Leakage демо: давхардалтай өгөгдөл дээрх "хуурамч" нарийвчлал
    X_raw = df[CANCER_FEATURES].astype(float)
    Xa, Xb, ya, yb = train_test_split(X_raw, y_raw, test_size=0.2, random_state=SEED, stratify=y_raw)
    leaky = RandomForestClassifier(n_estimators=200, random_state=SEED).fit(Xa, ya).score(Xb, yb)
    overlap = int(Xb.merge(Xa.drop_duplicates(), how="inner").shape[0])
    u = df.drop_duplicates()
    # Зорилт: High түвшин эсэх (хоёртын) — монотон хязгаарлалт ашиглах боломжтой болно
    return (u[CANCER_FEATURES].astype(float), (u.Level == "High").astype(int),
            {"leakage_demo": {"accuracy_with_duplicates": round(float(leaky), 4),
                              "test_rows_also_in_train": overlap, "test_rows": int(len(Xb))}})


BRFSS = DATA / "brfss" / "cdc_diabetes_health_indicators.csv"


def brfss_frame() -> pd.DataFrame:
    """CDC BRFSS 2015 → асуулгын шинжүүд (эрсдэлийн чиглэлтэй). 70+ насныг хасна (систем 15–65)."""
    df = pd.read_csv(BRFSS)
    df = df[df.Age <= 10]
    return pd.DataFrame({
        "age_cat": df.Age.astype(float), "male": df.Sex.astype(float), "bmi": df.BMI.astype(float),
        "high_bp": df.HighBP.astype(float), "high_chol": df.HighChol.astype(float),
        "ever_smoker": df.Smoker.astype(float), "inactive": 1.0 - df.PhysActivity,
        "no_fruits": 1.0 - df.Fruits, "no_veggies": 1.0 - df.Veggies,
        "diabetes": df.Diabetes_binary.astype(int),
    })


def diabetes_data() -> tuple[pd.DataFrame, pd.Series, dict]:
    if BRFSS.exists():
        df = brfss_frame()
        return df[DIABETES_FEATURES], df.diabetes, {"synthetic": False, "source": "CDC BRFSS 2015 (UCI #891)"}
    df = generate_diabetes_cohort()
    return df[DIABETES_SYNTH_FEATURES], df.diabetes, {"synthetic": True}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=None)
    args = ap.parse_args()
    version = args.version or datetime.now().strftime("v%Y%m%d-%H%M")

    Xh, yh, eh = heart_data()
    Xc, yc, ec = cancer_data()
    Xd, yd, ed = diabetes_data()
    models = [
        train_one("heart", "Зүрх судасны өвчин", Xh, yh, population_prevalence=HEART_POPULATION_PREVALENCE, extra=eh),
        # Харьцангуй индекс тул калибровкоос илүү хэт итгэлгүй, жигд шатлал чухал
        train_one("cancer", "Уушгины хавдрын эрсдэл (High түвшин)", Xc, yc, repeats=5, calibrated=False,
                  extra=ec),
        train_one("diabetes", "Чихрийн шижин / урьдал шижин", Xd, yd, repeats=1, impute="mean", cv_sample=40_000,
                  population_prevalence=DIABETES_POPULATION_PREVALENCE, extra=ed),
    ]
    card = {"version": version, "trained_at": datetime.now(timezone.utc).isoformat(), "models": models}
    (ARTIFACTS / "model_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2))
    (ONNX_DIR / "manifest.json").write_text(json.dumps(
        {"version": version, "models": {m["key"]: {"path": m["onnx"], "features": m["features"],
                                                   "multiclass": False, "prior": m["prior"]} for m in models}},
        ensure_ascii=False, indent=2))

    eda = ROOT / "reports" / "eda.json"
    if eda.exists():
        (ARTIFACTS / "eda.json").write_text(eda.read_text())
    print(f"\n✓ Загварууд хадгалагдлаа: {ARTIFACTS}  (хувилбар {version})")


if __name__ == "__main__":
    main()
