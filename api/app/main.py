"""
SENTINEL-X : API centrale.

- Reçoit les alertes de la caméra et du module ML : POST /api/v1/alerts
- S'abonne au broker MQTT pour la télémétrie et les événements de l'ESP8266
- Stocke tout dans PostgreSQL
- Pousse les nouvelles données au dashboard en WebSocket (/ws)
- Allume les LEDs du boîtier selon l'état de la caméra (rouge pendant une intrusion, verte sinon)
- Transmet les commandes du dashboard (LEDs) à l'ESP8266 via MQTT
"""

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import aiomqtt
import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DATABASE_URL = os.environ["DATABASE_URL"]
MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "8883"))
MQTT_USER = os.getenv("MQTT_API_USER", "api")
MQTT_PASSWORD = os.environ["MQTT_API_PASSWORD"]
MQTT_CA = os.getenv("MQTT_CA", "/certs/ca.crt")
INGEST_TOKEN = os.environ["INGEST_TOKEN"]
DASHBOARD_TOKEN = os.environ["DASHBOARD_TOKEN"]
DEVICE_TIMEOUT = int(os.getenv("DEVICE_TIMEOUT", "30"))   # secondes sans télémétrie = hors ligne
ALARM_DEVICE = os.getenv("ALARM_DEVICE", "esp01")         # boîtier dont les LEDs suivent la caméra
SESSION_TTL = int(os.getenv("SESSION_TTL", str(8 * 3600)))  # durée d'une session du dashboard (secondes)
SESSION_COOKIE = "sentinel_session"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("sentinel-api")

DEVICE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def to_json(obj) -> str:
    return json.dumps(obj, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o))


# --------------------------------------------------------------------------
# Modèles de données (toute entrée est validée : types, bornes, champs inconnus refusés)
# --------------------------------------------------------------------------

class AlertIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["camera", "ml", "esp8266"]
    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    type: str = Field(min_length=1, max_length=40, pattern=r"^[a-z_]+$")
    severity: Literal["info", "warning", "critical"]
    zone: str | None = Field(default=None, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")
    persons: int | None = Field(default=None, ge=0, le=50)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    score: float | None = Field(default=None, ge=-1000, le=1000, allow_inf_nan=False)
    message: str | None = Field(default=None, max_length=200)
    timestamp: datetime | None = None
    snapshot: str | None = Field(default=None, max_length=300_000)

    @field_validator("snapshot")
    @classmethod
    def check_snapshot(cls, v):
        prefix = "data:image/jpeg;base64,"
        if v is None:
            return v
        if not v.startswith(prefix):
            raise ValueError("snapshot doit être une image JPEG en data URI")
        try:
            raw = base64.b64decode(v[len(prefix):], validate=True)
        except binascii.Error:
            raise ValueError("snapshot : base64 invalide")
        if not raw.startswith(b"\xff\xd8"):
            raise ValueError("snapshot : ce n'est pas un JPEG")
        return v


class TelemetryIn(BaseModel):
    """Message publié par l'ESP8266 sur sentinel/<device>/telemetry."""
    model_config = ConfigDict(extra="ignore")

    t: float | None = Field(default=None, ge=-40, le=125, allow_inf_nan=False)    # DHT22, °C
    h: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)      # DHT22, %
    gas: int | None = Field(default=None, ge=0, le=1023)                           # MQ-2, ADC 10 bits
    pir: bool | None = None                                                        # HC-SR501
    rssi: int | None = Field(default=None, ge=-120, le=0)


EVENT_SEVERITY = {
    "boot": "info",
    "motion": "warning",
    "motion_end": "info",
    "gas_alarm": "critical",
    "sensor_error": "warning",
}


class EventIn(BaseModel):
    """Message publié par l'ESP8266 sur sentinel/<device>/event."""
    model_config = ConfigDict(extra="ignore")

    type: Literal["boot", "motion", "motion_end", "gas_alarm", "sensor_error"]
    value: float | None = Field(default=None, allow_inf_nan=False)
    message: str | None = Field(default=None, max_length=100)


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=200)


class CommandIn(BaseModel):
    """Commande envoyée par le dashboard.

    alarm      : état complet (on = rouge allumée et verte éteinte, off = l'inverse)
    led_alert  : LED rouge seule
    led_status : LED verte seule
    """
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(default="esp01", pattern=r"^[A-Za-z0-9_.-]{1,64}$")
    target: Literal["alarm", "led_alert", "led_status"]
    action: Literal["on", "off"]


# --------------------------------------------------------------------------
# Authentification
#
# - Scripts (caméra, ML, tests) : en-tête "Authorization: Bearer <jeton>"
# - Dashboard : le jeton est saisi une fois dans l'écran de connexion, l'API répond par un
#   cookie de session aléatoire (HttpOnly, Secure, SameSite=Strict). Le jeton n'est jamais
#   stocké dans le navigateur ni dans le code de la page.
# --------------------------------------------------------------------------

sessions: dict[str, datetime] = {}   # identifiant de session -> date d'expiration


def _same(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode(), b.encode())


def _bearer_value(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def session_valid(sid: str | None) -> bool:
    if not sid:
        return False
    expires = sessions.get(sid)
    if expires is None:
        return False
    if expires < datetime.now(timezone.utc):
        sessions.pop(sid, None)
        return False
    return True


def bearer(authorization: str | None = Header(default=None)) -> str:
    token = _bearer_value(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail="jeton manquant")
    return token


def require_ingest(token: str = Depends(bearer)):
    if not _same(token, INGEST_TOKEN):
        raise HTTPException(status_code=401, detail="jeton invalide")


def require_dashboard(request: Request, authorization: str | None = Header(default=None)):
    if session_valid(request.cookies.get(SESSION_COOKIE)):
        return
    token = _bearer_value(authorization)
    if token is not None and _same(token, DASHBOARD_TOKEN):
        return
    raise HTTPException(status_code=401, detail="authentification requise")


def require_any(request: Request, authorization: str | None = Header(default=None)):
    if session_valid(request.cookies.get(SESSION_COOKIE)):
        return
    token = _bearer_value(authorization)
    if token is not None and (_same(token, DASHBOARD_TOKEN) or _same(token, INGEST_TOKEN)):
        return
    raise HTTPException(status_code=401, detail="authentification requise")


# --------------------------------------------------------------------------
# WebSocket : diffusion vers les dashboards connectés
# --------------------------------------------------------------------------

class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def broadcast(self, kind: str, data):
        if not self.clients:
            return
        msg = to_json({"kind": kind, "data": data})
        dead = []
        for ws in list(self.clients):
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=2)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()
devices: dict[str, dict] = {}     # état courant de chaque boîtier
mqtt_client: aiomqtt.Client | None = None


def device_view(device_id: str) -> dict:
    d = devices.get(device_id, {})
    last_seen = d.get("last_seen")
    fresh = last_seen is not None and datetime.now(timezone.utc) - last_seen < timedelta(seconds=DEVICE_TIMEOUT)
    return {
        "device_id": device_id,
        "online": fresh and d.get("status") != "offline",
        "last_seen": last_seen,
        "telemetry": d.get("telemetry"),
    }


# --------------------------------------------------------------------------
# Base de données
# --------------------------------------------------------------------------

async def init_connection(conn):
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def insert_alert(pool, *, source, device_id, type_, severity, zone=None, details=None, snapshot=None):
    row = await pool.fetchrow(
        """INSERT INTO alerts (source, device_id, type, severity, zone, details, snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, ts, source, device_id, type, severity, zone, details, acknowledged""",
        source, device_id, type_, severity, zone, details or {}, snapshot,
    )
    alert = dict(row)
    alert["has_snapshot"] = snapshot is not None
    await hub.broadcast("alert", alert)
    log.info("Alerte %s/%s/%s (%s)", source, device_id, type_, severity)
    return alert


# --------------------------------------------------------------------------
# MQTT
# --------------------------------------------------------------------------

async def handle_mqtt_message(pool, msg: aiomqtt.Message):
    parts = str(msg.topic).split("/")
    if len(parts) != 3 or parts[0] != "sentinel" or not DEVICE_RE.match(parts[1]):
        return
    device_id, kind = parts[1], parts[2]
    payload = bytes(msg.payload or b"")
    if len(payload) > 2048:
        log.warning("Message MQTT trop long ignoré (%s)", msg.topic)
        return

    if kind == "status":
        status = payload.decode(errors="replace").strip()
        if status not in ("online", "offline"):
            return
        previous = devices.setdefault(device_id, {}).get("status")
        devices[device_id]["status"] = status
        if status == "online":
            devices[device_id]["last_seen"] = datetime.now(timezone.utc)
        await hub.broadcast("device", device_view(device_id))
        if status == "offline" and previous == "online":
            await insert_alert(pool, source="esp8266", device_id=device_id,
                               type_="device_offline", severity="warning")
        return

    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("JSON invalide sur %s", msg.topic)
        return

    try:
        if kind == "telemetry":
            t = TelemetryIn.model_validate(data)
            row = await pool.fetchrow(
                """INSERT INTO telemetry (device_id, temperature, humidity, gas, motion, rssi)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   RETURNING ts, temperature, humidity, gas, motion, rssi""",
                device_id, t.t, t.h, t.gas, t.pir, t.rssi,
            )
            tele = dict(row)
            d = devices.setdefault(device_id, {})
            d.update(last_seen=tele["ts"], telemetry=tele, status="online")
            await hub.broadcast("telemetry", {"device_id": device_id, **tele})

        elif kind == "event":
            e = EventIn.model_validate(data)
            details = {k: v for k, v in (("value", e.value), ("message", e.message)) if v is not None}
            await insert_alert(pool, source="esp8266", device_id=device_id, type_=e.type,
                               severity=EVENT_SEVERITY[e.type], details=details)
    except ValidationError as exc:
        log.warning("Message refusé sur %s : %s", msg.topic, exc.errors()[0]["msg"])


async def mqtt_loop(pool):
    global mqtt_client
    tls = aiomqtt.TLSParameters(ca_certs=MQTT_CA)
    while True:
        try:
            async with aiomqtt.Client(
                hostname=MQTT_HOST, port=MQTT_PORT, username=MQTT_USER, password=MQTT_PASSWORD,
                identifier="sentinel-api", tls_params=tls, keepalive=30,
            ) as client:
                mqtt_client = client
                await client.subscribe("sentinel/+/telemetry", qos=0)
                await client.subscribe("sentinel/+/event", qos=1)
                await client.subscribe("sentinel/+/status", qos=1)
                log.info("Connecté au broker MQTT %s:%d", MQTT_HOST, MQTT_PORT)
                async for msg in client.messages:
                    try:
                        await handle_mqtt_message(pool, msg)
                    except Exception:
                        log.exception("Erreur de traitement du message %s", msg.topic)
        except aiomqtt.MqttError as exc:
            mqtt_client = None
            log.warning("Connexion MQTT perdue (%s), nouvelle tentative dans 3 s", exc)
            await asyncio.sleep(3)


async def publish_command(pool, device_id: str, target: str, action: str, retain: bool = False) -> dict | None:
    """Publie une commande sur sentinel/<device>/cmd et l'enregistre. Renvoie None si le broker est absent."""
    if mqtt_client is None:
        log.warning("Commande %s/%s non envoyée à %s : broker MQTT indisponible", target, action, device_id)
        return None
    payload = {"target": target, "action": action}
    # Format compact, sans espaces : le firmware compare le texte tel quel
    await mqtt_client.publish(f"sentinel/{device_id}/cmd", json.dumps(payload, separators=(",", ":")),
                              qos=1, retain=retain)
    await pool.execute(
        "INSERT INTO commands (device_id, target, action, params) VALUES ($1, $2, $3, $4)",
        device_id, target, action, {},
    )
    log.info("Commande envoyée à %s : %s", device_id, payload)
    return payload


# --------------------------------------------------------------------------
# Application
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    for attempt in range(30):
        try:
            app.state.pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5, init=init_connection)
            break
        except (OSError, asyncpg.PostgresError) as exc:
            log.warning("Base indisponible (%s), nouvelle tentative", exc)
            await asyncio.sleep(2)
    else:
        raise RuntimeError("Impossible de se connecter à la base")
    task = asyncio.create_task(mqtt_loop(app.state.pool))
    yield
    task.cancel()
    await app.state.pool.close()


app = FastAPI(title="SENTINEL-X API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.post("/api/v1/login")
async def login(body: LoginIn):
    if not _same(body.token, DASHBOARD_TOKEN):
        await asyncio.sleep(1)   # ralentit les essais de jetons en série
        log.warning("Échec de connexion au dashboard")
        raise HTTPException(status_code=401, detail="jeton invalide")
    sid = secrets.token_urlsafe(32)
    sessions[sid] = datetime.now(timezone.utc) + timedelta(seconds=SESSION_TTL)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(SESSION_COOKIE, sid, max_age=SESSION_TTL, path="/",
                    httponly=True, secure=True, samesite="strict")
    log.info("Connexion au dashboard ouverte")
    return resp


@app.post("/api/v1/logout")
async def logout(request: Request):
    sessions.pop(request.cookies.get(SESSION_COOKIE, ""), None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@app.get("/api/v1/session", dependencies=[Depends(require_dashboard)])
async def session_check():
    return {"ok": True}


@app.get("/api/v1/health")
async def health():
    db_ok = True
    try:
        await app.state.pool.fetchval("SELECT 1")
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok and mqtt_client else "degraded", "db": db_ok, "mqtt": mqtt_client is not None}


@app.post("/api/v1/alerts", status_code=201, dependencies=[Depends(require_ingest)])
async def create_alert(alert: AlertIn):
    details = alert.model_dump(include={"persons", "confidence", "score", "message", "timestamp"},
                               exclude_none=True, mode="json")
    created = await insert_alert(
        app.state.pool, source=alert.source, device_id=alert.device_id, type_=alert.type,
        severity=alert.severity, zone=alert.zone, details=details, snapshot=alert.snapshot,
    )
    # Les LEDs du boîtier suivent l'état de la caméra : rouge pendant une intrusion, verte sinon.
    # Message retenu : l'ESP retrouve le bon état s'il redémarre pendant une intrusion.
    if alert.source == "camera" and alert.type in ("intrusion", "intrusion_terminee"):
        action = "on" if alert.type == "intrusion" else "off"
        try:
            await publish_command(app.state.pool, ALARM_DEVICE, "alarm", action, retain=True)
        except Exception:
            # Un problème MQTT ne doit jamais empêcher l'enregistrement de l'alerte
            log.exception("Échec de l'envoi de la commande d'alarme")
    return {"id": created["id"]}


@app.get("/api/v1/alerts", dependencies=[Depends(require_dashboard)])
async def list_alerts(limit: int = Query(50, ge=1, le=500), unacked: bool = False):
    rows = await app.state.pool.fetch(
        """SELECT id, ts, source, device_id, type, severity, zone, details, acknowledged,
                  acknowledged_at, snapshot IS NOT NULL AS has_snapshot
           FROM alerts WHERE ($2 = FALSE OR acknowledged = FALSE)
           ORDER BY ts DESC LIMIT $1""",
        limit, unacked,
    )
    return [dict(r) for r in rows]


@app.get("/api/v1/alerts/{alert_id}/snapshot", dependencies=[Depends(require_dashboard)])
async def alert_snapshot(alert_id: int):
    snap = await app.state.pool.fetchval("SELECT snapshot FROM alerts WHERE id = $1", alert_id)
    if not snap:
        raise HTTPException(status_code=404, detail="pas d'image pour cette alerte")
    raw = base64.b64decode(snap.split(",", 1)[1])
    return Response(content=raw, media_type="image/jpeg")


@app.post("/api/v1/alerts/{alert_id}/ack", dependencies=[Depends(require_dashboard)])
async def ack_alert(alert_id: int):
    row = await app.state.pool.fetchrow(
        """UPDATE alerts SET acknowledged = TRUE, acknowledged_at = now()
           WHERE id = $1 AND acknowledged = FALSE RETURNING id, acknowledged_at""",
        alert_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="alerte inconnue ou déjà acquittée")
    await hub.broadcast("ack", dict(row))
    return dict(row)


@app.get("/api/v1/telemetry", dependencies=[Depends(require_any)])
async def telemetry(device_id: str = Query("esp01", pattern=r"^[A-Za-z0-9_.-]{1,64}$"),
                    minutes: int = Query(10, ge=1, le=1440),
                    limit: int = Query(5000, ge=1, le=50_000)):
    rows = await app.state.pool.fetch(
        """SELECT ts, temperature, humidity, gas, motion, rssi FROM (
               SELECT * FROM telemetry
               WHERE device_id = $1 AND ts > now() - make_interval(mins => $2)
               ORDER BY ts DESC LIMIT $3
           ) t ORDER BY ts""",
        device_id, minutes, limit,
    )
    return [dict(r) for r in rows]


# Historique regroupé par tranches de temps : environ 180 à 360 points quelle que soit la période,
# pour que les courbes restent fluides même sur 30 jours (une mesure toutes les 2,5 s sinon).
HISTORY_RANGES = {
    #       période                      taille d'une tranche
    "15m": (timedelta(minutes=15), timedelta(seconds=5)),
    "1h":  (timedelta(hours=1),    timedelta(seconds=15)),
    "6h":  (timedelta(hours=6),    timedelta(minutes=1)),
    "24h": (timedelta(hours=24),   timedelta(minutes=5)),
    "7d":  (timedelta(days=7),     timedelta(minutes=30)),
    "30d": (timedelta(days=30),    timedelta(hours=2)),
}


@app.get("/api/v1/telemetry/history", dependencies=[Depends(require_any)])
async def telemetry_history(device_id: str = Query("esp01", pattern=r"^[A-Za-z0-9_.-]{1,64}$"),
                            range: Literal["15m", "1h", "6h", "24h", "7d", "30d"] = "1h"):
    period, bucket = HISTORY_RANGES[range]
    rows = await app.state.pool.fetch(
        """SELECT date_bin($3::interval, ts, TIMESTAMPTZ '2000-01-01') AS ts,
                  round(avg(temperature)::numeric, 2) AS temperature,
                  round(avg(humidity)::numeric, 1)    AS humidity,
                  round(avg(gas)::numeric, 0)         AS gas,
                  max(gas)                            AS gas_max,
                  bool_or(motion)                     AS motion
           FROM telemetry
           WHERE device_id = $1 AND ts > now() - $2::interval
           GROUP BY 1 ORDER BY 1""",
        device_id, period, bucket,
    )
    points = [{"ts": r["ts"],
               "temperature": float(r["temperature"]) if r["temperature"] is not None else None,
               "humidity": float(r["humidity"]) if r["humidity"] is not None else None,
               "gas": int(r["gas"]) if r["gas"] is not None else None,
               "gas_max": r["gas_max"], "motion": r["motion"]} for r in rows]
    return {"range": range, "bucket_seconds": int(bucket.total_seconds()), "points": points}


@app.get("/api/v1/devices", dependencies=[Depends(require_dashboard)])
async def list_devices():
    return [device_view(d) for d in devices]


@app.post("/api/v1/commands", status_code=202, dependencies=[Depends(require_dashboard)])
async def send_command(cmd: CommandIn):
    sent = await publish_command(app.state.pool, cmd.device_id, cmd.target, cmd.action,
                                 retain=(cmd.target == "alarm"))
    if sent is None:
        raise HTTPException(status_code=503, detail="broker MQTT indisponible")
    return {"sent": sent}


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    # Le navigateur envoie le cookie de session avec la demande de connexion WebSocket
    if not session_valid(ws.cookies.get(SESSION_COOKIE)):
        await ws.close(code=1008)
        return
    await ws.accept()
    hub.clients.add(ws)
    await ws.send_text(to_json({"kind": "devices", "data": [device_view(d) for d in devices]}))
    try:
        while True:
            await ws.receive_text()   # le dashboard n'envoie rien, on garde juste la connexion
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)
