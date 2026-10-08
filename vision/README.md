# SENTINEL-X : module vision

Détection d'intrusion sur la webcam USB du PC Serveur Local avec YOLOv8n (classe COCO "person").

Le script fait quatre choses :

1. Il lit la webcam en 640x480 dans un thread à part et ne garde que la dernière image.
2. Il détecte les personnes et teste si le bas de leur cadre (les pieds) est dans la zone interdite.
3. Il envoie une alerte `intrusion` à `POST /api/v1/alerts` après `MIN_FRAMES` images consécutives dans la zone. Une alerte `intrusion_terminee` part quand la zone est vide depuis `CLEAR_FRAMES` images. Deux alertes sont espacées d'au moins `COOLDOWN` secondes.
4. Il diffuse l'image annotée (cadres, zone, FPS, latence) en MJPEG pour le dashboard.

## Lancement sans Docker (Windows, macOS, ou pour développer)

```
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # Linux / macOS
pip install -r requirements.txt
```

Les variables se passent par l'environnement. Sous PowerShell :

```
$env:CAMERA="0"; $env:STREAM_TOKEN="test"; python sentinel_vision.py
```

Le flux est alors sur `http://localhost:8000/stream?token=test`.

## Lancement dans Docker (configuration de l'équipe)

Docker Desktop sous Windows tourne dans une machine virtuelle qui ne voit pas les périphériques USB. La webcam est donc lue sous Windows par ffmpeg (`tools/start_camera.ps1`), qui diffuse l'image en MPEG-TS sur `tcp://127.0.0.1:1235`. Le service `vision` du `docker-compose.yml` s'y connecte avec `CAMERA=tcp://host.docker.internal:1235`.

Le service est activé par `COMPOSE_PROFILES=vision` dans le `.env` principal, et ses réglages sont dans le `docker-compose.yml` : `IMGSZ=320` (environ 18 ms d'inférence par image sur le processeur), `JPEG_QUALITY=60`, alertes envoyées à `https://nginx:8443/api/v1/alerts`, flux en HTTPS avec le certificat du projet. Le port 8000 n'est publié que sur `127.0.0.1` : depuis le réseau, le flux passe par nginx (`/camera/stream`), réservé aux utilisateurs connectés au dashboard.

Sur un hôte Linux, la webcam peut être donnée directement au conteneur (`devices: ["/dev/video0"]`, `CAMERA=0`).

## Raspberry Pi 5 (option A)

PyTorch sur le CPU du Pi est trop lent pour tenir 100 ms par image. Exporter le modèle en NCNN :

```
pip install ultralytics ncnn
yolo export model=yolov8n.pt format=ncnn imgsz=320
```

Puis dans `.env` : `MODEL_PATH=yolov8n_ncnn_model` et `IMGSZ=320`. Le dossier `yolov8n_ncnn_model` doit être copié dans l'image Docker ou monté en volume.

## Endpoints

| Route | Token | Contenu |
| --- | --- | --- |
| `/health` | non | `{"status": "ok"}` pour le healthcheck |
| `/status?token=...` | oui | statut (RAS / SUSPECT / INTRUSION), FPS, latences, nombre de personnes |
| `/stream?token=...` | oui | flux MJPEG, à mettre dans une balise `<img src="...">` |

Le token passe dans l'URL parce qu'une balise `<img>` ne peut pas envoyer d'en-tête `Authorization`. Il faut donc servir le stream en HTTPS, sinon le token circule en clair sur le Wi-Fi de table.

## Format des alertes

```json
{
  "source": "camera",
  "device_id": "sentinel-x-cam-01",
  "type": "intrusion",
  "severity": "critical",
  "zone": "A",
  "persons": 1,
  "confidence": 0.88,
  "timestamp": "2026-10-07T09:12:44.512+00:00",
  "snapshot": "data:image/jpeg;base64,..."
}
```

`snapshot` est une image 320 px de large (environ 15 à 25 Ko). `SNAPSHOT_IN_ALERT=0` la désactive.

L'envoi utilise `Authorization: Bearer <API_TOKEN>` et vérifie le certificat de l'API avec `CA_CERT`. La vérification TLS n'est jamais désactivée : si l'API a un certificat autosigné, il faut fournir le certificat de l'autorité qui l'a signé, et le nom d'hôte de `API_URL` (par exemple `api`) doit figurer dans le certificat.

## Réglages

La zone est un polygone en coordonnées normalisées : `[0,0]` est le coin haut gauche, `[1,1]` le coin bas droit. Pour la calibrer, placer la caméra, ouvrir le stream et ajuster `ZONE` jusqu'à ce que le cadre jaune couvre la bonne surface.

Si des détections parasites apparaissent (poster, reflet), monter `CONF` à 0,6. Si l'alerte est trop lente à se déclencher, baisser `MIN_FRAMES`.

## Mesures pour le rapport

Chaque image traitée ajoute une ligne à `logs/latences.csv` : horodatage, temps d'inférence, temps total (inférence + dessin + encodage JPEG), nombre de personnes, statut. Ce fichier sert à calculer la latence moyenne et le 95e centile pour la documentation IA du dossier.
