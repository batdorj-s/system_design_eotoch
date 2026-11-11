from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import db as dbmod
from app.config import get_settings

HIGH = {"age": 58, "gender": "male", "height": 170, "weight": 95, "bp_systolic": 165, "smoking": "current",
        "alcohol_freq": "daily", "salt_intake": 9, "air_pollution": 9, "activity": "low", "fruit_veg": "rare",
        "family_history": ["diabetes", "heart"], "symptoms": ["chest_pain", "thirst"], "cholesterol": "high"}
LOW = {"age": 28, "gender": "female", "height": 165, "weight": 58, "bp_systolic": 112, "smoking": "never",
       "alcohol_freq": "never", "salt_intake": 3, "air_pollution": 3, "activity": "high", "fruit_veg": "daily"}


@pytest.fixture()
def client(monkeypatch):
    dbmod.reset_db_for_tests()
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", "")  # тест үед гадаад API дуудахгүй
    monkeypatch.setattr(s, "ollama_url", "")
    monkeypatch.setattr(s, "rate_per_minute", 10_000)
    from app.main import app
    with TestClient(app) as c:
        yield c


def login(c, email, pw):
    r = c.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_assessment_low_vs_high(client):
    lo = client.post("/api/assessments", json={"answers": LOW, "consent": True}).json()
    hi = client.post("/api/assessments", json={"answers": HIGH, "consent": True}).json()
    assert lo["result"]["overall"]["level"] == "low"
    assert hi["result"]["overall"]["level"] == "high"
    for k in ("heart", "diabetes", "cancer"):
        assert hi["result"]["risks"][k]["value"] > lo["result"]["risks"][k]["value"]
    assert hi["result"]["urgent"] is True
    assert hi["advice"]["provider"] == "template" and "Эмчтэй" in hi["advice"]["disclaimer"]
    assert len(hi["result"]["radar"]) == 5


def test_consent_and_validation(client):
    assert client.post("/api/assessments", json={"answers": LOW, "consent": False}).status_code == 400
    bad = {**LOW, "bp_systolic": 500}
    assert client.post("/api/assessments", json={"answers": bad, "consent": True}).status_code == 422


def test_out_of_scope_age(client):
    r = client.post("/api/assessments", json={"answers": {**LOW, "age": 80}, "consent": True}).json()
    assert r["result"]["in_scope"] is False and "risks" not in r["result"]


def test_answers_encrypted_at_rest(client):
    r = client.post("/api/assessments", json={"answers": LOW, "consent": True}).json()
    doc = dbmod.get_db().assessments.find_one({"_id": r["id"]})
    assert "answers" not in doc and "female" not in doc["answers_enc"]


def test_user_history_and_delete(client):
    r = client.post("/api/auth/register", json={"email": "bat@example.mn", "password": "Secret123",
                                                "name": "Бат", "consent": True})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    client.post("/api/assessments", json={"answers": LOW, "consent": True}, headers=h)
    client.post("/api/assessments", json={"answers": HIGH, "consent": True}, headers=h)
    hist = client.get("/api/me/assessments", headers=h).json()
    assert len(hist) == 2
    other = client.post("/api/auth/register", json={"email": "x@example.mn", "password": "Secret123",
                                                    "name": "X", "consent": True}).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/api/assessments/{hist[0]['id']}", headers=oh).status_code == 403
    assert client.delete("/api/me/data?scope=assessments", headers=h).json()["deleted"]["assessments"] == 2


def test_hospitals_sorted_by_distance(client):
    r = client.get("/api/hospitals", params={"lat": 47.9131, "lng": 106.9175}).json()
    assert r["hospitals"][0]["id"] == "songdo"
    d = [h["distance_km"] for h in r["hospitals"]]
    assert d == sorted(d)
    onc = client.get("/api/hospitals", params={"specialty": "Хавдар судлал"}).json()["hospitals"]
    assert all("Хавдар судлал" in h["specialties"] for h in onc)


def test_booking_duplicate_and_staff_flow(client):
    day = (date.today() + timedelta(days=2)).isoformat()
    body = {"hospital_id": "songdo", "specialty": "Зүрх судас", "date": day, "time": "10:00",
            "name": "Дорж", "phone": "99112233"}
    b = client.post("/api/bookings", json=body)
    assert b.status_code == 200 and b.json()["code"].startswith("ТЗ-")
    assert client.post("/api/bookings", json={**body, "phone": "88112233"}).status_code == 409
    assert client.post("/api/bookings", json={**body, "time": "11:00"}).status_code == 409
    slots = client.get("/api/hospitals/songdo/slots", params={"day": day, "specialty": "Зүрх судас"}).json()
    assert not next(s for s in slots if s["time"] == "10:00")["available"]

    sh = login(client, "staff@songdo.mn", "Staff@2026")
    rows = client.get("/api/staff/bookings", params={"day": day}, headers=sh).json()
    assert len(rows) == 1
    ok = client.patch(f"/api/staff/bookings/{rows[0]['id']}", json={"status": "confirmed"}, headers=sh)
    assert ok.json()["status"] == "confirmed"
    assert client.get("/api/staff/load", params={"day": day}, headers=sh).json()["by_status"]["confirmed"] == 1
    assert client.get("/api/admin/stats", headers=sh).status_code == 403


def test_admin(client):
    ah = login(client, "admin@eotoch.mn", "Admin@2026")
    client.post("/api/assessments", json={"answers": HIGH, "consent": True})
    s = client.get("/api/admin/stats", headers=ah).json()
    assert s["assessments_total"] == 1 and s["risk_levels"]["high"] == 1
    assert len(client.get("/api/admin/knowledge", headers=ah).json()) >= 30
    assert client.get("/api/admin/audit", headers=ah).json()[0]["action"]
    card = client.get("/api/ml/model-card").json()
    assert {m["key"] for m in card["models"]} == {"heart", "cancer", "diabetes"}
    assert client.get("/api/ml/insights").json()["datasets"]


def test_chat_recompute(client):
    a = client.post("/api/assessments", json={"answers": LOW, "consent": True}).json()
    r = client.post("/api/chat", json={"message": "Миний даралт 170 болсон", "assessment_id": a["id"]}).json()
    assert r["reply"]
    assert r["updated"]["changes"]["bp_systolic"] == "170"
    assert r["updated"]["result"]["risks"]["heart"]["value"] > a["result"]["risks"]["heart"]["value"]


def test_monotonic_risk_factors():
    from app.ml.predictor import get_engine
    e = get_engine()
    base = {**LOW, "age": 50, "gender": "male"}
    heart = [e.predict({**base, "bp_systolic": bp})["risks"]["heart"]["value"] for bp in (110, 140, 170)]
    assert heart == sorted(heart) and heart[-1] > heart[0]
    smoke = [e.predict({**base, "smoking": s})["risks"]["cancer"]["value"] for s in ("never", "current")]
    assert smoke[1] > smoke[0]
    bmi = [e.predict({**base, "weight": w})["risks"]["diabetes"]["value"] for w in (65, 85, 105)]
    assert bmi == sorted(bmi)


def test_anonymous_cancel_by_code(client):
    day = (date.today() + timedelta(days=3)).isoformat()
    b = client.post("/api/bookings", json={"hospital_id": "songdo", "specialty": "Зүрх судас", "date": day,
                                           "time": "11:00", "name": "Нэргүй", "phone": "99887766"}).json()
    assert client.post("/api/bookings/cancel", json={"code": b["code"], "phone": "11112222"}).status_code == 404
    assert client.post("/api/bookings/cancel", json={"code": b["code"], "phone": "99887766"}).json()["ok"]
    assert client.post("/api/bookings/cancel", json={"code": b["code"], "phone": "99887766"}).status_code == 404
    slots = client.get("/api/hospitals/songdo/slots", params={"day": day, "specialty": "Зүрх судас"}).json()
    assert next(s for s in slots if s["time"] == "11:00")["available"]


def test_assessment_exposes_owner(client):
    r = client.post("/api/auth/register", json={"email": "own@example.mn", "password": "Secret123",
                                                "name": "Own", "consent": True}).json()
    h = {"Authorization": f"Bearer {r['token']}"}
    a = client.post("/api/assessments", json={"answers": LOW, "consent": True}, headers=h).json()
    assert a["user_id"] == r["user"]["id"]
    assert client.get(f"/api/assessments/{a['id']}", headers=h).json()["user_id"] == r["user"]["id"]
    anon = client.post("/api/assessments", json={"answers": LOW, "consent": True}).json()
    assert anon["user_id"] is None
