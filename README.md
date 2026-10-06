# SENTINEL-X

Prototype de boîtier de surveillance (ESP8266 + capteurs) relié à un PC serveur local qui centralise les mesures, analyse la webcam avec YOLOv8 et affiche le tout sur un dashboard.

Serveur : portable Windows avec Docker Desktop (option B du sujet).

## Architecture

```
ESP8266 (DHT22, MQ-2, PIR, OLED, buzzer, LEDs)
   │  MQTTS 8883, compte "esp01"
   ▼
┌──────────────────────── PC serveur (Windows) ─────────────────────────┐
│  Docker Compose                                                       │
│    mosquitto   broker MQTT, TLS uniquement, ACL par boîtier           │
│    api         FastAPI : alertes, télémétrie, commandes, WebSocket    │
│    db          PostgreSQL (réseau interne, aucun port exposé)         │
│    nginx       HTTPS 443 : dashboard, /api, /ws, /camera              │
│                                                                       │
│  Hors Docker (accès à la webcam USB impossible depuis Docker Desktop) │
│    vision/sentinel_vision.py   YOLOv8n, stream MJPEG sur le port 8000 │
└───────────────────────────────────────────────────────────────────────┘
   ▲
   │  HTTPS 443
Navigateur (dashboard)
```

Ports ouverts vers le Wi-Fi de table : 443 (HTTPS), 80 (redirection vers 443) et 8883 (MQTTS). Le port 8000 du script vision doit être bloqué dans le pare-feu Windows : le dashboard passe par Nginx (`/camera/`).

## Contrat d'interface

### MQTT (topics publiés par le boîtier `esp01`)

`sentinel/esp01/telemetry`, toutes les 2 secondes, QoS 0 :

```json
{"t": 22.4, "h": 45.1, "gas": 182, "pir": 0, "rssi": -60}
```

`t` en °C (DHT22), `h` en % (DHT22), `gas` valeur brute de l'ADC 0 à 1023 (MQ-2), `pir` 0 ou 1, `rssi` en dBm. Une mesure en échec (DHT22 qui renvoie NaN) est envoyée à `null`.

`sentinel/esp01/event`, sur changement d'état, QoS 1 :

```json
{"type": "motion"}
{"type": "gas_alarm", "value": 612}
```

Types acceptés : `boot`, `motion`, `motion_end`, `gas_alarm`, `sensor_error`.

`sentinel/esp01/status`, retenu, QoS 1 : `online` à la connexion, `offline` en dernière volonté (LWT).

`sentinel/esp01/cmd`, envoyé par l'API, lu par le boîtier :

```json
{"target": "buzzer", "action": "on", "duration_ms": 2000}
```

`target` : `buzzer`, `led_alert`, `led_status`. `action` : `on`, `off`, `blink`.

Les ACL de Mosquitto limitent chaque boîtier à ses propres topics : `esp01` ne peut ni publier pour un autre boîtier ni envoyer de commandes.

### API REST (via `https://<IP>/api/v1/`)

| Méthode et route | Jeton | Rôle |
| --- | --- | --- |
| `GET /health` | aucun | état de la base et de la connexion MQTT |
| `POST /alerts` | INGEST | alerte de la caméra ou du module ML |
| `GET /alerts?limit=50&unacked=true` | DASHBOARD | historique des alertes |
| `GET /alerts/{id}/snapshot` | DASHBOARD | image JPEG associée à une alerte caméra |
| `POST /alerts/{id}/ack` | DASHBOARD | acquittement |
| `GET /telemetry?device_id=esp01&minutes=10` | DASHBOARD ou INGEST | historique des mesures |
| `GET /devices` | DASHBOARD | état des boîtiers (en ligne, dernière mesure) |
| `POST /commands` | DASHBOARD | commande buzzer ou LED |

Les jetons s'envoient en en-tête : `Authorization: Bearer <jeton>`.

Corps de `POST /alerts` (les champs inconnus sont refusés) :

```json
{
  "source": "camera",
  "device_id": "sentinel-x-cam-01",
  "type": "intrusion",
  "severity": "critical",
  "zone": "A",
  "persons": 1,
  "confidence": 0.88,
  "timestamp": "2026-10-07T09:12:44+00:00",
  "snapshot": "data:image/jpeg;base64,..."
}
```

`source` : `camera`, `ml` ou `esp8266`. `severity` : `info`, `warning` ou `critical`. Le module ML utilise en plus `score` (score d'anomalie) et `message`.

### WebSocket (`wss://<IP>/ws?token=<DASHBOARD_TOKEN>`)

Chaque message a la forme `{"kind": ..., "data": ...}` :

- `devices` : envoyé à la connexion, état de tous les boîtiers ;
- `telemetry` : chaque nouvelle mesure ;
- `alert` : chaque nouvelle alerte (sans l'image, à récupérer via `/alerts/{id}/snapshot` si `has_snapshot` vaut true) ;
- `ack` : une alerte a été acquittée ;
- `device` : un boîtier passe en ligne ou hors ligne.

## Installation sur le PC serveur (Windows)

Prérequis : Docker Desktop démarré, Python 3.12.

1. Copier `.env.example` en `.env` et remplacer chaque `a_remplacer` par une valeur aléatoire. Générer une valeur sous PowerShell :

   ```
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
   ```

   Vérifier `SERVER_IP` : c'est l'adresse du PC sur le Wi-Fi de table (`ipconfig`).

2. Générer les certificats et les comptes MQTT :

   ```
   docker compose --profile setup run --rm setup
   ```

   À relancer si `SERVER_IP` ou un mot de passe MQTT change. L'autorité de certification (`certs/ca.crt`) est conservée d'une exécution à l'autre.

3. Démarrer la stack :

   ```
   docker compose up -d --build
   docker compose ps
   ```

4. Faire confiance à l'autorité de certification sur ce PC, pour que le navigateur accepte le HTTPS sans avertissement :

   ```
   Import-Certificate -FilePath certs\ca.crt -CertStoreLocation Cert:\CurrentUser\Root
   ```

   Puis ouvrir `https://localhost/api/v1/health` : la réponse attendue est `{"status":"ok","db":true,"mqtt":true}`.

5. Tester sans le boîtier, avec le simulateur :

   ```
   pip install paho-mqtt
   python tools\simulate_esp.py
   ```

   `--anomaly-after 120` déclenche une dérive lente de température et de gaz au bout de 2 minutes, pour tester la maintenance prédictive.

6. Lancer le module vision : copier `vision\.env.example` en `vision\.env`, y reporter `INGEST_TOKEN` dans `API_TOKEN`, puis depuis le dossier `vision` :

   ```
   .venv\Scripts\Activate.ps1
   python sentinel_vision.py
   ```

## Commandes utiles

```
docker compose logs -f api          journaux de l'API
docker compose logs -f mosquitto    connexions MQTT
docker compose down                 arrêt (les données sont conservées)
docker compose down -v              arrêt et suppression de la base
```

Le schéma SQL (`db/init/`) n'est appliqué qu'à la création du volume de la base. Après une modification du schéma : `docker compose down -v` puis `docker compose up -d`.

## Sécurité déjà en place

- MQTT uniquement en TLS (port 8883), sans accès anonyme, avec des ACL par boîtier.
- HTTPS uniquement : le port 80 redirige vers 443. En-têtes de sécurité (CSP, HSTS, X-Frame-Options), version de Nginx masquée.
- Certificats ECDSA P-256 signés par une autorité propre au groupe. Le certificat serveur couvre `localhost`, les noms des services et `SERVER_IP`.
- Toutes les entrées sont validées : types, bornes physiques des capteurs, champs inconnus refusés, image vérifiée comme un vrai JPEG, taille limitée (512 Ko par requête, 4 Ko par message MQTT).
- Base de données sans port exposé. L'API utilise un compte limité : lecture et insertion seulement, mise à jour réservée aux colonnes d'acquittement, aucune suppression.
- Conteneurs sans privilèges : utilisateurs non root pour l'API et Nginx, système de fichiers en lecture seule, capacités Linux retirées, `no-new-privileges`.
- Journaux Docker limités à 3 fichiers de 10 Mo par service.
- Aucun secret dans le dépôt : `.env`, `certs/` et `mosquitto/config/passwd` sont dans `.gitignore`.
