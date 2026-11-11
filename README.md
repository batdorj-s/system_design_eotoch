# Eotoch 2.0 — Монголын эрүүл мэндийн AI туслах

Халдварт бус өвчний (зүрх судас, чихрийн шижин, хавдар) эрсдэлийг машин сургалтаар тооцоолж,
**яагаад** ийм дүн гарсныг SHAP-аар тайлбарлан, хувь хүнд тохирсон зөвлөгөө өгч, ойрын эмнэлэгт
цаг захиалах боломжтой веб систем. F.ITM311 — Team 12.

> ⚕️ Энэ систем нь эмнэлгийн онош биш, эрсдэлийн урьдчилсан тооцоо гаргадаг. Эмчтэй зөвлөлдөнө үү.

## Архитектур

```
┌───────────────────────┐   /api    ┌───────────────────────────┐     ┌──────────┐
│ React 18 + Vite       │ ────────▶ │ FastAPI (Python)          │ ──▶ │ MongoDB  │
│ Tailwind, Recharts    │           │ • JWT нэвтрэлт, 3 эрх     │     └──────────┘
│ • 15 асуулттай wizard │           │ • AES-256-GCM шифрлэлт    │
│ • SHAP тайлбар, радар │           │ • ML inference + SHAP     │ ──▶ Gemini / Ollama
│ • Дуут чат туслах     │           │ • RAG мэдлэгийн сан       │     (зөвлөгөө, fallback-тай)
│ • Оффлайн ONNX        │           │ • Захиалга, аудит, limit  │
└───────────────────────┘           └───────────────────────────┘
          ▲                                       ▲
          │ public/models/*.onnx                  │ backend/app/ml/artifacts/*.joblib
          └───────────── ai-model/train.py ───────┘  (EDA → сургалт → харьцуулалт → экспорт)
```

```
E-otoch-main/
├── src/app/              # Frontend
│   ├── pages/            # Home, Assessment, Result, Hospitals, MyHealth, Insights, Login, Privacy
│   │   ├── staff/        # Эмнэлгийн ажилтны самбар
│   │   └── admin/        # Админ: статистик, эмнэлэг, мэдлэгийн сан, ML дахин сургах, аудит
│   ├── components/       # AppShell, ChatAssistant (дуут), RiskVisuals, BookingDialog, BodyMap, SOS
│   └── lib/              # API клиент, auth, offline ONNX inference
├── backend/
│   ├── app/
│   │   ├── routers/      # auth, assessments (+chat), hospitals (+bookings, staff), admin, ml
│   │   ├── ml/           # features.py (нийтлэг хөрвүүлэлт), predictor.py, explain.py, artifacts/
│   │   ├── services/     # advice.py (Gemini→Ollama→загвар), knowledge.py (TF-IDF RAG)
│   │   └── data/         # hospitals.json, knowledge.json (seed)
│   └── tests/            # pytest — 10 тест
└── ai-model/
    ├── data/             # UCI Heart Disease, Cancer Patient Data Sets, brfss/ (CDC BRFSS 2015)
    ├── eda.py            # Өгөгдлийн судалгаа → reports/eda.json, *.png
    ├── synthetic.py      # BRFSS байхгүй үеийн fallback (STEPS-д тохируулсан синтетик когорт)
    └── train.py          # 7 алгоритмын харьцуулалт, сонголт, SHAP, ONNX экспорт
```

## Ажиллуулах

Шаардлага: Node 20+, Python 3.11+, MongoDB 6+ (эсвэл Docker). MongoDB байхгүй бол бэкэнд
автоматаар санах ойн DB ашиглана (`DB_MODE=auto`, өгөгдөл хадгалагдахгүй).

```bash
# 1. MongoDB (Docker-оор)
docker compose up -d mongo

# 2. Backend
cd backend
pip install -r requirements.txt
cp .env.example .env        # JWT_SECRET, DATA_ENCRYPTION_KEY, GEMINI_API_KEY-г бөглөнө
uvicorn app.main:app --reload --port 8000

# 3. Frontend (өөр терминалд)
npm install
npm run dev                 # http://localhost:5173 (/api → :8000 руу proxy)
```

Хөгжүүлэлтийн туршилтын эрхүүд (`backend/.env`-ээр өөрчилнө):

| Эрх | Имэйл | Нууц үг |
|---|---|---|
| Админ | `admin@eotoch.mn` | `Admin@2026` |
| Эмнэлгийн ажилтан (Сонгдо) | `staff@songdo.mn` | `Staff@2026` |

Чихрийн шижингийн өгөгдлийг (UCI #891, 13 MB) татах:

```bash
mkdir -p ai-model/data/brfss
curl -L -o ai-model/data/brfss/cdc_diabetes_health_indicators.csv https://archive.ics.uci.edu/static/public/891/data.csv
```

Тест, шалгалт:

```bash
cd backend && python3 -m pytest -q     # API + ML логикийн 10 тест
npm run typecheck && npm run build     # frontend
```

ML-ийг дахин сургах (эсвэл Админ → ML загвар → "Дахин сургах"):

```bash
python3 ai-model/eda.py
python3 ai-model/train.py --version v2.2
```

## Машин сургалт

### Өгөгдлийн судалгааны гол олдворууд

| Датасет | Олдвор | Шийдэл |
|---|---|---|
| UCI Heart (920) | 55% нь өвчтэй — эмнэлэгт хандсан хүмүүс | Prior-shift калибровк → хүн амын 15% |
| UCI Heart | Холестерин 172 мөрөнд **0** (дутуу утга) | NaN → медиан |
| UCI Heart | "Asymptomatic" цээжний өвдөлтөд өвчлөл 79% (selection bias) | `cp`-г загварт оруулаагүй |
| UCI Heart | Даралтын нөхцөлт коэффициент ≈ 0 (referral bias) | Мета-шинжилгээний OR: 20 ммМУБ тутамд ×1.5 |
| Cancer (1000) | **848 нь давхардал**, 152 л давтагдашгүй → 184/200 тест мөр сургалтад байсан, accuracy хуурамчаар 100% | Давхардал хасч, давтагдсан CV |
| Cancer | "Balanced Diet" өндөр = муу хооллолт (Level-тэй эерэг) | Mapping-ийг зассан |
| Cancer | Бараг тусгаарлагдах өгөгдөл → энгийн LogReg тамхичинд 0% гэж хэт итгэлтэй таамагладаг | Хүчтэй L2 regularization |
| BRFSS (253 680) | Тархалт 13.9% (шижин + урьдал шижин) ≈ STEPS-ийн 6.9% + 8.3% = 15.2% | Prior-shift 12.0% → 15.2% |
| BRFSS | Их архи уудаг хүмүүст тархалт бага (5.8% vs 14.4%) — confounding | Загварт оруулаагүй |
| BRFSS | Гэр бүлийн түүх, цангах шинж байхгүй | OR ×2.3, ×3.0 нэмсэн |

### Загвар сонголт

Өвчин бүрт 7 алгоритм (LogReg ×3, RandomForest, RandomForest-Monotone, GradientBoosting, XGBoost)-ыг
давтагдсан 5-fold CV-ээр харьцуулж, дараах дүрмээр сонгоно:

1. ONNX-д хөрвүүлэгдэх (браузерт оффлайн ажиллах)
2. **Клиник логик шалгалт**: эрсдэлт хүчин зүйл өсөхөд эрсдэл буурах тохиолдол ≤ 2%
   (RF/XGB-ийн зүрхний загварт 8–10% зөрчил илэрсэн)
3. AUC хамгийн өндөр; 0.01 дотор логистик регресс байвал хамгийн их regularization-тэйг
   (one-standard-error), гэхдээ магадлал гаргадаг загварт Brier 0.005-аас илүү муудахгүй

| Загвар | Сонгосон | Мөр | CV ROC-AUC | Гол хүчин зүйл (SHAP) |
|---|---|---|---|---|
| Зүрх судас | LogReg (L2) + OR тохируулга | 920 | 0.819 ± 0.026 | цээжний өвдөлт, хүйс, нас (+ даралт, тамхи OR) |
| Хавдар (High) | LogReg (хүчтэй L2) | 152 | 0.994 ± 0.009 | цустай ханиалга, жин, хооллолт |
| Чихрийн шижин / урьдал | LogReg (хүчтэй L2) + OR | 196 804 | 0.810 ± 0.005 | даралт, холестерин, нас, BMI (+ гэр бүл, цангах OR) |

Бүх клиник шинжтэй (ЭКГ, зүрхний цохилт г.м.) зүрхний загвар AUC 0.879 — асуулгаар хязгаарлагдсанаас
алдагдах мэдээллийг харуулдаг. Дэлгэрэнгүйг вэб дээрх **"Өгөгдөл ба ML"** хуудаснаас харна уу.

### Хязгаарлалт

- Хавдрын датасет жижиг, хялбаршуулсан тул гаралт нь **харьцангуй индекс**, клиник магадлал биш.
- Чихрийн шижингийн загвар АНУ-ын BRFSS өгөгдөл дээр сурсан — Монголын тархалтад калибровк хийсэн ч хүн амын ялгаа үлдэнэ.
- Амьдралын хэв маягийн OR-ууд олон улсын судалгаанаас; Монголын когорт судалгаагаар баталгаажуулах шаардлагатай.
- Нэмсэн 4 дүүргийн эмнэлгийн координат ойролцоо, утас баталгаажаагүй (`needs_verification`).

## Аюулгүй байдал ба нууцлал

- Асуулгын хариулт, зөвлөгөө, чатыг **AES-256-GCM**-ээр шифрлэж хадгална; нууц үг bcrypt.
- Gemini түлхүүр зөвхөн сервер талд (өмнө нь `VITE_` хувьсагчаар браузерт ил байсныг зассан).
- LLM руу зөвхөн нас, хүйс, BMI, эрсдэлийн дүн, гол хүчин зүйлс дамжина — нэр, утас, тайлбар үгүй.
- Rate limit (60/мин, 500/өдөр), оролтын баталгаажуулалт (pydantic), аудит лог 90 хоног (TTL).
- Хэрэглэгч өгөгдлөө тус бүрээр / бүгдийг устгах; эмнэлэгт эрсдэлийн хураангуйг зөвхөн зөвшөөрлөөр дамжуулна.
- 15–65 наснаас гадуур оноо тооцохгүй; цустай ханиалга, даралт ≥180 зэрэгт "яаралтай" дохио.

## API (товч)

| Метод | Зам | Тайлбар |
|---|---|---|
| POST | `/api/assessments` | Үнэлгээ (нэвтрээгүй ч болно) → эрсдэл + SHAP + зөвлөгөө |
| POST | `/api/chat` | Чат туслах; "даралт 150 болсон" гэвэл дахин тооцоолно |
| GET | `/api/hospitals?lat&lng&specialty` | Haversine зайгаар эрэмбэлсэн эмнэлэг |
| POST | `/api/bookings` | Цаг захиалга (давхардал шалгана, `ТЗ-XXXX`) |
| GET/PATCH | `/api/staff/bookings` | Ажилтан: захиалга харах, батлах/цуцлах |
| GET | `/api/admin/stats`, `/audit`, … | Админ |
| GET | `/api/ml/model-card`, `/api/ml/insights` | Загварын карт, EDA (нээлттэй) |

Бүрэн баримт: `http://localhost:8000/docs` (Swagger).
