from __future__ import annotations

import base64
import json
import os
from datetime import timedelta
from typing import Any

import bcrypt
import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings
from .db import get_db, now

bearer = HTTPBearer(auto_error=False)


# --- Нууц үг -----------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


# --- JWT ---------------------------------------------------------------------
def create_token(user: dict) -> str:
    s = get_settings()
    payload = {"sub": user["_id"], "role": user["role"], "exp": now() + timedelta(hours=s.jwt_hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Нэвтрэлтийн хугацаа дууссан эсвэл буруу токен")


def optional_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict | None:
    if not cred:
        return None
    payload = _decode(cred.credentials)
    user = get_db().users.find_one({"_id": payload["sub"], "active": {"$ne": False}})
    if not user:
        raise HTTPException(401, "Хэрэглэгч олдсонгүй")
    return user


def current_user(user: dict | None = Depends(optional_user)) -> dict:
    if not user:
        raise HTTPException(401, "Нэвтрэх шаардлагатай")
    return user


def require_role(*roles: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Энэ үйлдлийг хийх эрхгүй")
        return user
    return dep


# --- AES-256-GCM шифрлэлт (хадгалах үеийн) ------------------------------------
def encrypt(data: Any) -> str:
    aes = AESGCM(get_settings().data_key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, json.dumps(data, ensure_ascii=False).encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(blob: str | None) -> Any:
    if not blob:
        return None
    raw = base64.b64decode(blob)
    aes = AESGCM(get_settings().data_key)
    return json.loads(aes.decrypt(raw[:12], raw[12:], None))


# --- Аудит -------------------------------------------------------------------
def audit(action: str, actor: dict | None = None, target: str | None = None,
          request: Request | None = None, **meta: Any) -> None:
    get_db().audit.insert_one({
        "ts": now(),
        "action": action,
        "actor_id": actor["_id"] if actor else None,
        "actor_role": actor["role"] if actor else "anonymous",
        "target": target,
        "ip": request.client.host if request and request.client else None,
        "meta": meta,
    })


def public_user(u: dict) -> dict:
    return {"id": u["_id"], "email": u["email"], "name": u.get("name"), "phone": u.get("phone"),
            "role": u["role"], "hospital_id": u.get("hospital_id"),
            "created_at": u.get("created_at")}
