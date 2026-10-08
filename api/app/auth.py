"""
Authentification et gestion des sessions SENTINEL-X.

- Authentification des utilisateurs par username/password
- Hash des mots de passe avec Argon2
- Sessions serveur stockées en mémoire
- Cookie de session HttpOnly / Secure / SameSite=Strict
- Dépendances FastAPI pour utilisateur connecté et administrateur
"""

import secrets
import os
from datetime import datetime, timedelta, timezone

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Cookie, HTTPException, Request


SESSION_TTL = int(
    __import__("os").getenv(
        "SESSION_TTL",
        str(8 * 3600),
    )
)

SESSION_COOKIE = "sentinel_session"


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """
    Génère un hash Argon2 du mot de passe.
    """
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """
    Vérifie un mot de passe contre son hash Argon2.
    """
    try:
        return password_hasher.verify(
            password_hash,
            password,
        )
    except (
        VerifyMismatchError,
        VerificationError,
        InvalidHashError,
    ):
        return False


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

# session_id -> informations de session
sessions: dict[str, dict] = {}


def create_session(user: dict) -> tuple[str, datetime]:
    """
    Crée une session pour un utilisateur.

    Retourne :
        session_id
        date d'expiration
    """

    session_id = secrets.token_urlsafe(32)

    expires = (
        datetime.now(timezone.utc)
        + timedelta(seconds=SESSION_TTL)
    )

    sessions[session_id] = {
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "expires": expires,
    }

    return session_id, expires


def get_session(session_id: str | None) -> dict | None:
    """
    Retourne la session si elle existe et n'est pas expirée.
    """

    if not session_id:
        return None

    session = sessions.get(session_id)

    if session is None:
        return None

    expires = session.get("expires")

    if not isinstance(expires, datetime):
        sessions.pop(session_id, None)
        return None

    if expires <= datetime.now(timezone.utc):
        sessions.pop(session_id, None)
        return None

    return session


def destroy_session(session_id: str | None) -> None:
    """
    Supprime une session.
    """

    if session_id:
        sessions.pop(session_id, None)


# --------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------

async def authenticate_user(
    pool: asyncpg.Pool,
    username: str,
    password: str,
) -> dict | None:
    """
    Vérifie username/password et retourne les informations utilisateur.
    """

    row = await pool.fetchrow(
        """
        SELECT id, username, password_hash, role
        FROM users
        WHERE username = $1
        """,
        username,
    )

    if row is None:
        return None

    if not verify_password(
        password,
        row["password_hash"],
    ):
        return None

    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
    }


# --------------------------------------------------------------------------
# FastAPI dependencies
# --------------------------------------------------------------------------

async def require_session(
    request: Request,
) -> dict:
    """
    Autorise uniquement un utilisateur connecté.
    """

    session_id = request.cookies.get(
        SESSION_COOKIE
    )

    session = get_session(session_id)

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="authentification requise",
        )

    return session


async def require_admin(
    request: Request,
) -> dict:
    """
    Autorise uniquement un administrateur connecté.
    """

    session = await require_session(request)

    if session.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="droits administrateur requis",
        )

    return session

async def ensure_admin(pool):
    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD")

    if not admin_password:
        raise RuntimeError(
            "ADMIN_PASSWORD doit être défini "
            "si aucun administrateur n'existe."
        )

    async with pool.acquire() as conn:
        admin_exists = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM users
                WHERE role = 'admin'
            )
            """
        )

        if admin_exists:
            return False

        password_hash = password_hasher.hash(admin_password)

        await conn.execute(
            """
            INSERT INTO users (username, password_hash, role)
            VALUES ($1, $2, 'admin')
            """,
            admin_username,
            password_hash,
        )

        print(
            f"[AUTH] Aucun administrateur trouvé. "
            f"Compte admin '{admin_username}' créé."
        )

        return True
# --------------------------------------------------------------------------
# Session cookie
# --------------------------------------------------------------------------

def set_session_cookie(
    response,
    session_id: str,
) -> None:
    """
    Configure le cookie de session sécurisé.
    """

    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        max_age=SESSION_TTL,
        path="/",
        httponly=True,
        secure=True,
        samesite="strict",
    )


def delete_session_cookie(response) -> None:
    """
    Supprime le cookie de session.
    """

    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
    )
