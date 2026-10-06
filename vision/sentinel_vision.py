"""
SENTINEL-X : détection d'intrusion par webcam USB (YOLOv8n).

Le script lit la webcam, détecte les personnes, décide si la présence est
suspecte (zone interdite + durée minimale), envoie les alertes à l'API
(POST /api/v1/alerts) et diffuse l'image annotée en MJPEG pour le dashboard.

Toute la configuration passe par des variables d'environnement (voir .env.example).
"""

import base64
import csv
import json
import logging
import os
import queue
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ultralytics import YOLO

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def load_dotenv(path: Path):
    """Charge vision/.env sans écraser les variables déjà définies dans le terminal."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_dotenv(Path(__file__).resolve().parent / ".env")

CAMERA = os.getenv("CAMERA", "0")                    # index (0) ou chemin (/dev/video0)
CAP_W = int(os.getenv("CAP_WIDTH", "640"))
CAP_H = int(os.getenv("CAP_HEIGHT", "480"))

MODEL_PATH = os.getenv("MODEL_PATH", "yolov8n.pt")   # ou yolov8n_ncnn_model sur Raspberry Pi
IMGSZ = int(os.getenv("IMGSZ", "640"))               # 320 sur Raspberry Pi
CONF = float(os.getenv("CONF", "0.5"))

# Zone interdite : polygone en coordonnées normalisées (0..1), origine en haut à gauche
ZONE = json.loads(os.getenv("ZONE", "[[0.30,0.15],[0.95,0.15],[0.95,1.0],[0.30,1.0]]"))
ZONE_NAME = os.getenv("ZONE_NAME", "A")
MIN_FRAMES = int(os.getenv("MIN_FRAMES", "10"))      # images consécutives avant alerte
CLEAR_FRAMES = int(os.getenv("CLEAR_FRAMES", "15"))  # images sans intrus avant fin d'alerte
COOLDOWN = float(os.getenv("COOLDOWN", "10"))        # secondes entre deux alertes

DEVICE_ID = os.getenv("DEVICE_ID", "sentinel-x-cam-01")
API_URL = os.getenv("API_URL", "")                   # ex: https://api:3000/api/v1/alerts
API_TOKEN = os.getenv("API_TOKEN", "")
CA_CERT = os.getenv("CA_CERT", "")                   # chemin du certificat de l'AC du groupe
SNAPSHOT_IN_ALERT = os.getenv("SNAPSHOT_IN_ALERT", "1") == "1"

STREAM_PORT = int(os.getenv("STREAM_PORT", "8000"))
STREAM_TOKEN = os.getenv("STREAM_TOKEN", "")
TLS_CERT = os.getenv("TLS_CERT", "")
TLS_KEY = os.getenv("TLS_KEY", "")
CORS_ORIGINS = [o for o in os.getenv("CORS_ORIGINS", "").split(",") if o]
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "70"))

LOG_DIR = Path(os.getenv("LOG_DIR", "logs"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("sentinel-vision")


# --------------------------------------------------------------------------
# Capture webcam dans un thread séparé (on garde uniquement la dernière image)
# --------------------------------------------------------------------------

class Camera:
    def __init__(self, src: str):
        self.src = int(src) if src.isdigit() else src
        self.lock = threading.Lock()
        self.frame = None
        self.frame_id = 0
        self.cap = self._open()
        threading.Thread(target=self._loop, daemon=True, name="capture").start()

    def _open(self):
        backends = {"dshow": cv2.CAP_DSHOW, "msmf": cv2.CAP_MSMF, "any": cv2.CAP_ANY}
        default = "dshow" if os.name == "nt" else "any"
        backend = backends.get(os.getenv("CAMERA_BACKEND", default).lower(), cv2.CAP_ANY)
        if isinstance(self.src, int):
            cap = cv2.VideoCapture(self.src, backend)
        else:
            cap = cv2.VideoCapture(self.src)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAP_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAP_H)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            log.error("Impossible d'ouvrir la webcam %s", self.src)
        return cap

    def _loop(self):
        while True:
            ok, frame = self.cap.read()
            if not ok:
                if isinstance(self.src, str) and Path(self.src).is_file():
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)   # fichier vidéo de test : on boucle
                    continue
                log.warning("Lecture webcam impossible, nouvelle tentative dans 2 s")
                self.cap.release()
                time.sleep(2)
                self.cap = self._open()
                continue
            if frame.shape[1] != CAP_W or frame.shape[0] != CAP_H:
                frame = cv2.resize(frame, (CAP_W, CAP_H))
            with self.lock:
                self.frame = frame
                self.frame_id += 1
            if isinstance(self.src, str) and Path(self.src).is_file():
                time.sleep(1 / 30)   # fichier vidéo de test : lecture au rythme réel

    def read(self):
        with self.lock:
            if self.frame is None:
                return self.frame_id, None
            return self.frame_id, self.frame.copy()


# --------------------------------------------------------------------------
# État partagé entre la détection et le serveur de stream
# --------------------------------------------------------------------------

class SharedState:
    def __init__(self):
        self.cond = threading.Condition()
        self.jpeg = None
        self.jpeg_id = 0
        self.stats = {"status": "DEMARRAGE"}

    def publish(self, jpeg: bytes, stats: dict):
        with self.cond:
            self.jpeg = jpeg
            self.jpeg_id += 1
            self.stats = stats
            self.cond.notify_all()


state = SharedState()
alert_queue: "queue.Queue[dict]" = queue.Queue(maxsize=20)


# --------------------------------------------------------------------------
# Envoi des alertes à l'API (thread séparé : le réseau ne ralentit pas l'IA)
# --------------------------------------------------------------------------

def alert_worker():
    session = requests.Session()
    headers = {"Content-Type": "application/json"}
    if API_TOKEN:
        headers["Authorization"] = f"Bearer {API_TOKEN}"
    verify = CA_CERT if CA_CERT else True   # jamais verify=False

    while True:
        payload = alert_queue.get()
        summary = {k: v for k, v in payload.items() if k != "snapshot"}
        if not API_URL:
            log.info("Alerte (API_URL non définie) : %s", summary)
            continue
        for attempt in range(1, 4):
            try:
                r = session.post(API_URL, json=payload, headers=headers, timeout=3, verify=verify)
                r.raise_for_status()
                log.info("Alerte envoyée : %s", summary)
                break
            except requests.RequestException as exc:
                log.warning("Envoi alerte échoué (essai %d/3) : %s", attempt, exc)
                time.sleep(1)


def queue_alert(payload: dict):
    try:
        alert_queue.put_nowait(payload)
    except queue.Full:
        log.warning("File d'alertes pleine, alerte ignorée")


def make_snapshot(frame) -> str:
    small = cv2.resize(frame, (320, int(320 * frame.shape[0] / frame.shape[1])))
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 60])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else ""


# --------------------------------------------------------------------------
# Boucle de détection
# --------------------------------------------------------------------------

def draw_overlay(frame, zone_px, persons, status, fps, inf_ms):
    color_zone = (0, 200, 255)
    cv2.polylines(frame, [zone_px], True, color_zone, 2)
    cv2.putText(frame, f"ZONE {ZONE_NAME}", tuple(zone_px[0] + [5, 20]),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_zone, 2)

    for x1, y1, x2, y2, conf, inside in persons:
        color = (0, 0, 255) if inside else (0, 200, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(frame, f"personne {conf:.2f}", (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    status_color = {"RAS": (0, 200, 0), "SUSPECT": (0, 200, 255), "INTRUSION": (0, 0, 255)}[status]
    cv2.rectangle(frame, (0, 0), (frame.shape[1], 28), (0, 0, 0), -1)
    cv2.putText(frame, f"{fps:5.1f} FPS | inference {inf_ms:5.1f} ms | {status}", (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)


def detection_loop(cam: Camera):
    log.info("Chargement du modèle %s (imgsz=%d)", MODEL_PATH, IMGSZ)
    model = YOLO(MODEL_PATH, task="detect")
    zone_px = np.array([[x * CAP_W, y * CAP_H] for x, y in ZONE], dtype=np.int32)

    present = 0          # images consécutives (avec tolérance) où un intrus est dans la zone
    absent = 0           # images consécutives sans intrus
    in_alert = False
    last_alert = 0.0
    last_id = -1
    fps = 0.0
    last_t = time.perf_counter()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = LOG_DIR / "latences.csv"
    new_file = not csv_path.exists()
    with open(csv_path, "a", newline="") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["timestamp", "inference_ms", "total_ms", "personnes", "dans_zone", "statut"])
        rows = 0

        while True:
            fid, frame = cam.read()
            if frame is None or fid == last_id:
                time.sleep(0.003)
                continue
            last_id = fid
            t0 = time.perf_counter()

            result = model.predict(frame, imgsz=IMGSZ, conf=CONF, classes=[0], verbose=False)[0]
            inf_ms = (time.perf_counter() - t0) * 1000

            persons = []
            boxes = result.boxes
            if boxes is not None and len(boxes):
                for (x1, y1, x2, y2), conf in zip(boxes.xyxy.cpu().numpy().astype(int),
                                                   boxes.conf.cpu().numpy()):
                    # Point de référence : bas du cadre (les pieds), plus fiable que le centre
                    foot = (float((x1 + x2) / 2), float(y2))
                    inside = cv2.pointPolygonTest(zone_px, foot, False) >= 0
                    persons.append((int(x1), int(y1), int(x2), int(y2), float(conf), inside))
            intruders = [p for p in persons if p[5]]

            now = time.time()
            if intruders:
                present += 1
                absent = 0
            else:
                absent += 1
                if absent >= CLEAR_FRAMES:
                    present = 0
                    if in_alert:
                        in_alert = False
                        queue_alert({
                            "source": "camera", "device_id": DEVICE_ID,
                            "type": "intrusion_terminee", "severity": "info",
                            "zone": ZONE_NAME,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })

            status = "INTRUSION" if in_alert else ("SUSPECT" if present > 0 else "RAS")

            dt = time.perf_counter() - last_t
            last_t = time.perf_counter()
            fps = 0.9 * fps + 0.1 * (1 / dt) if fps else 1 / dt

            draw_overlay(frame, zone_px, persons, status, fps, inf_ms)

            if present >= MIN_FRAMES and now - last_alert >= COOLDOWN:
                in_alert = True
                last_alert = now
                payload = {
                    "source": "camera",
                    "device_id": DEVICE_ID,
                    "type": "intrusion",
                    "severity": "critical",
                    "zone": ZONE_NAME,
                    "persons": len(intruders),
                    "confidence": round(max(p[4] for p in intruders), 2) if intruders else None,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                if SNAPSHOT_IN_ALERT:
                    payload["snapshot"] = make_snapshot(frame)
                queue_alert(payload)

            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            total_ms = (time.perf_counter() - t0) * 1000
            if ok:
                state.publish(buf.tobytes(), {
                    "status": status, "fps": round(fps, 1),
                    "inference_ms": round(inf_ms, 1), "total_ms": round(total_ms, 1),
                    "persons": len(persons), "intruders": len(intruders),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            writer.writerow([datetime.now(timezone.utc).isoformat(), f"{inf_ms:.1f}",
                             f"{total_ms:.1f}", len(persons), len(intruders), status])
            rows += 1
            if rows % 30 == 0:
                f.flush()


def detection_thread(cam: Camera):
    try:
        detection_loop(cam)
    except Exception:
        log.exception("La boucle de détection a planté, arrêt du processus")
        os._exit(1)   # Docker (restart: unless-stopped) relance le conteneur


# --------------------------------------------------------------------------
# Serveur HTTP : stream MJPEG + statut
# --------------------------------------------------------------------------

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
if CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"])


def check_token(token: str | None):
    if STREAM_TOKEN and not secrets.compare_digest(token or "", STREAM_TOKEN):
        raise HTTPException(status_code=401, detail="token invalide")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status(token: str | None = Query(default=None)):
    check_token(token)
    with state.cond:
        return state.stats


@app.get("/stream")
def stream(token: str | None = Query(default=None)):
    # La balise <img> ne peut pas envoyer d'en-tête, d'où le token en paramètre d'URL
    check_token(token)

    def frames():
        last = -1
        while True:
            with state.cond:
                state.cond.wait_for(lambda: state.jpeg_id != last, timeout=2)
                jid, jpg = state.jpeg_id, state.jpeg
            if jpg is None or jid == last:
                continue
            last = jid
            yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                   + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


# --------------------------------------------------------------------------

def main():
    if not STREAM_TOKEN:
        log.warning("STREAM_TOKEN vide : le flux vidéo est accessible sans authentification")
    if API_URL.startswith("http://"):
        log.warning("API_URL en HTTP : les alertes circulent en clair")

    cam = Camera(CAMERA)
    threading.Thread(target=alert_worker, daemon=True, name="alerts").start()
    threading.Thread(target=detection_thread, args=(cam,), daemon=True, name="detection").start()

    ssl_args = {}
    if TLS_CERT and TLS_KEY:
        ssl_args = {"ssl_certfile": TLS_CERT, "ssl_keyfile": TLS_KEY}
    log.info("Stream sur %s://0.0.0.0:%d/stream", "https" if ssl_args else "http", STREAM_PORT)
    uvicorn.run(app, host="0.0.0.0", port=STREAM_PORT, log_level="warning", **ssl_args)


if __name__ == "__main__":
    main()
