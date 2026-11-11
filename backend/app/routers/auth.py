from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from ..db import get_db, new_id, now
from ..security import audit, create_token, current_user, hash_password, public_user, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, pattern=r"^\+?\d{8,12}$")
    consent: bool = Field(description="Нууцлалын бодлого зөвшөөрсөн эсэх")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/register")
def register(body: RegisterIn, request: Request):
    if not body.consent:
        raise HTTPException(400, "Нууцлалын бодлогыг зөвшөөрөх шаардлагатай")
    db = get_db()
    email = body.email.lower()
    if db.users.find_one({"email": email}):
        raise HTTPException(409, "Энэ имэйлээр бүртгэл үүссэн байна")
    user = {"_id": new_id(), "email": email, "name": body.name, "phone": body.phone,
            "password": hash_password(body.password), "role": "user", "active": True,
            "created_at": now(), "consent": {"privacy_v": "1.0", "at": now()}}
    db.users.insert_one(user)
    audit("user.register", user, user["_id"], request)
    return {"token": create_token(user), "user": public_user(user)}


@router.post("/login")
def login(body: LoginIn, request: Request):
    user = get_db().users.find_one({"email": body.email.lower(), "active": {"$ne": False}})
    if not user or not verify_password(body.password, user["password"]):
        audit("user.login_failed", None, body.email.lower(), request)
        raise HTTPException(401, "Имэйл эсвэл нууц үг буруу")
    audit("user.login", user, user["_id"], request)
    return {"token": create_token(user), "user": public_user(user)}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public_user(user)
