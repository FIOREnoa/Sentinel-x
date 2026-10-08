# SENTINEL-X

Prototype d'avant-poste de surveillance autonome (Workshop EPSI M1 2026). Un boîtier ESP8266 mesure la température, l'humidité, le gaz et les mouvements, et envoie ses mesures en MQTT chiffré à un PC serveur local. Le serveur enregistre les données, analyse une webcam USB avec YOLOv8n, et présente l'ensemble sur un dashboard web protégé par une connexion.

Serveur : PC portable Windows avec Docker Desktop (option B du sujet). Le PC sert aussi de point d'accès Wi-Fi pour la table.

## Architecture

```
ESP8266 (DHT22, MQ-2, PIR, OLED, 3 LEDs)
   │  MQTTS 8883, compte "esp01"
   ▼
┌──────────────────────────── PC serveur (Windows) ────────────────────────────┐
│  Point d'accès mobile Windows : 192.168.137.1/24, 2,4 GHz, WPA2              │
│                                                                              │
│  Docker Compose (réseau interne "backend")                                   │
│    mosquitto   broker MQTT, TLS uniquement, comptes et ACL par boîtier        │
│    api         FastAPI : alertes, télémétrie, commandes, sessions, WebSocket  │
│    db          PostgreSQL, aucun port exposé                                  │
│    nginx       HTTPS 443 : dashboard React, /api, /ws, /camera/stream         │
│    vision      YOLOv8n, alertes d'intrusion, flux vidéo annoté                │
│                                                                              │
│  Sous Windows                                                                │
│    tools/start_camera.ps1   ffmpeg lit la webcam USB et l'envoie au          │
│                             conteneur vision (TCP 127.0.0.1:1235)            │
└──────────────────────────────────────────────────────────────────────────────┘
   ▲
   │  HTTPS 443, cookie de session
Navigateur (dashboard)
```

Docker Desktop n'a pas accès aux périphériques USB : la webcam est lue sous Windows par ffmpeg, puis transmise au conteneur `vision` par une connexion locale.

Ports ouverts vers le Wi-Fi de table : 443 (HTTPS), 80 (redirection vers 443) et 8883 (MQTTS). Le pare-feu Windows (`tools/firewall.ps1`) les limite au sous-réseau du point d'accès. Le flux brut de la vision (8000) et ffmpeg (1235) n'écoutent que sur le PC lui-même.

## Arborescence

```
api/                 API FastAPI (app/main.py)
db/init/             schéma SQL et compte limité sentinel_app (appliqués à la création du volume)
firmware/sentinel_esp/
  sentinel_esp.ino   firmware de l'ESP8266
  secrets.example.h  modèle à copier en secrets.h (ignoré par Git)
frontend/            dashboard React (Vite, Recharts), compilé dans l'image nginx
mosquitto/config/    mosquitto.conf, acl (passwd généré par setup, ignoré par Git)
nginx/               Dockerfile, default.conf, modèle du jeton du flux caméra
tools/               scripts de lancement, de surveillance, pare-feu, setup, simulateur
vision/              module de détection (YOLOv8n)
certs/               certificats générés par setup (ignorés par Git)
docker-compose.yml
.env.example         modèle à copier en .env (ignoré par Git)
```

## Installation sur le PC serveur (Windows)

Prérequis : Docker Desktop, Windows Terminal (fourni avec Windows 11), ffmpeg (`winget install Gyan.FFmpeg`), et l'IDE Arduino avec le paquet de cartes ESP8266 pour le firmware.

1. Activer le point d'accès mobile Windows en 2,4 GHz, sécurité WPA2. Son adresse est 192.168.137.1.

2. Copier `.env.example` en `.env` et remplacer chaque `a_remplacer` par une valeur aléatoire. Générer une valeur sous PowerShell :

   ```
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
   ```

3. Générer l'autorité de certification, le certificat serveur et les comptes MQTT :

   ```
   docker compose --profile setup run --rm setup
   ```

   À relancer si `SERVER_IP` ou un mot de passe MQTT change. L'autorité de certification (`certs/ca.crt`) est conservée d'une exécution à l'autre : le firmware n'a pas besoin d'être modifié.

4. Faire confiance à l'autorité de certification sur ce PC, pour que le navigateur accepte le HTTPS sans avertissement :

   ```
   Import-Certificate -FilePath certs\ca.crt -CertStoreLocation Cert:\CurrentUser\Root
   ```

5. Configurer le pare-feu, une seule fois, dans un PowerShell ouvert en administrateur :

   ```
   powershell -ExecutionPolicy Bypass -File .\tools\firewall.ps1
   ```

6. Réserver le port 8883, pour que Windows ne le prenne pas au démarrage (voir « Dépannage »), en administrateur :

   ```
   net stop winnat
   netsh int ipv4 add excludedportrange protocol=tcp startport=8883 numberofports=1
   net start winnat
   ```

7. Construire et démarrer :

   ```
   docker compose up -d --build
   docker compose ps
   ```

   Les cinq services doivent être `Up`. `https://localhost/api/v1/health` doit répondre `{"status":"ok","db":true,"mqtt":true}`.

8. Firmware : copier `firmware/sentinel_esp/secrets.example.h` en `secrets.h` dans le même dossier, y mettre le nom et le mot de passe du point d'accès, le mot de passe de `esp01` (`MQTT_ESP_PASSWORD` du `.env`) et le contenu de `certs/ca.crt`. Téléverser `sentinel_esp.ino` avec l'IDE Arduino.

## Lancement au quotidien

```
powershell -ExecutionPolicy Bypass -File .\tools\start_all.ps1
```

Le script démarre Docker Desktop, attend le moteur, lance les conteneurs, puis ouvre une fenêtre Windows Terminal avec trois onglets :

| Onglet | Script | Contenu |
| --- | --- | --- |
| Diffusion camera | `tools/start_camera.ps1` | ffmpeg envoie la webcam au conteneur vision. Silencieux si tout va bien |
| Etat camera | `tools/watch_camera.ps1` | statut RAS / SUSPECT / INTRUSION en couleur, FPS, temps d'inférence ; ouvre aussi le flux dans le navigateur |
| Capteurs ESP | `tools/watch_esp.ps1` | messages MQTT des boîtiers en direct (télémétrie, événements, statut, commandes) |

Le dashboard est sur `https://localhost`, ou `https://192.168.137.1` depuis un appareil du point d'accès. Le jeton à saisir sur l'écran de connexion est la valeur de `DASHBOARD_TOKEN` :

```
(docker compose exec api printenv DASHBOARD_TOKEN).Trim()
```

Arrêt : `Ctrl+C` dans chaque onglet, puis `docker compose stop` (ou `docker compose down`, les données sont conservées).

Si le conteneur vision pose problème, mettre un `#` devant `COMPOSE_PROFILES=vision` dans `.env`, faire `docker compose rm -sf vision`, et lancer `python vision/sentinel_vision.py` sous Windows (voir `vision/README.md`).

## Contrat d'interface

### MQTT

| Topic | Sens | Contenu | Retenu |
| --- | --- | --- | --- |
| `sentinel/esp01/telemetry` | boîtier vers serveur | mesures toutes les 2,5 s | non |
| `sentinel/esp01/event` | boîtier vers serveur | `motion` / `motion_end` à chaque changement du détecteur | non |
| `sentinel/esp01/status` | boîtier vers serveur | `online` ; `offline` publié par le broker (Last Will) | oui |
| `sentinel/esp01/cmd` | serveur vers boîtier | commandes des LEDs | oui pour `alarm` |

Télémétrie :

```json
{"t": 26.30, "h": 55.3, "gas": 89, "pir": 0, "rssi": -62}
```

`t` en °C et `h` en % (DHT22), `gas` valeur brute du convertisseur 0 à 1023 (MQ-2, sans unité), `pir` 0 ou 1, `rssi` en dBm. Les mesures sont horodatées par la base à la réception.

Événements : `{"type": "motion"}`, `{"type": "motion_end"}`. L'API accepte aussi `boot`, `gas_alarm` et `sensor_error`.

Commandes :

```json
{"target": "alarm", "action": "on"}
```

| `target` | `action` | Effet sur le boîtier |
| --- | --- | --- |
| `alarm` | `on` / `off` | LED rouge allumée / LED verte allumée |
| `led_alert` | `on` / `off` | identique à `alarm` |
| `led_status` | `on` / `off` | `on` : verte ; `off` : rouge |

L'API envoie `alarm on` à chaque intrusion détectée par la caméra et `alarm off` à la fin, en message retenu : un boîtier qui redémarre retrouve l'état d'alarme. Le détecteur de mouvement allume aussi la LED rouge, directement dans le boîtier. La LED bleue est fixe quand le boîtier est connecté au broker, clignotante sinon.

Les ACL de Mosquitto limitent chaque boîtier à ses propres topics : `esp01` ne peut ni publier pour un autre boîtier ni envoyer de commandes. Seul le compte `api` écrit sur `sentinel/+/cmd`.

### API REST (`https://<IP>/api/v1/`)

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `GET /health` | libre | état de la base et de la connexion MQTT |
| `POST /login` | libre (5 essais par minute) | vérifie le jeton du dashboard, pose un cookie de session de 8 h |
| `POST /logout` | session | ferme la session |
| `GET /session` | session | vérifie la session (utilisé aussi par nginx pour le flux caméra) |
| `POST /alerts` | jeton INGEST | alerte de la caméra ou du module ML |
| `GET /alerts?limit=50&unacked=true` | session | historique des alertes |
| `GET /alerts/{id}/snapshot` | session | image JPEG d'une alerte caméra |
| `POST /alerts/{id}/ack` | session | acquittement |
| `GET /telemetry?device_id=esp01&minutes=10` | session ou jeton | mesures brutes |
| `GET /telemetry/history?device_id=esp01&range=24h` | session ou jeton | moyennes par tranche ; `range` : `15m`, `1h`, `6h`, `24h`, `7d`, `30d` |
| `GET /devices` | session | état des boîtiers (en ligne, dernière mesure) |
| `POST /commands` | session | commande d'un boîtier (`alarm`, `led_alert`, `led_status`) |

Les scripts envoient les jetons en en-tête : `Authorization: Bearer <jeton>`. Le dashboard n'utilise pas de jeton dans son code : il l'échange contre un cookie `HttpOnly`, `Secure`, `SameSite=Strict` à la connexion.

Corps de `POST /alerts` (les champs inconnus sont refusés) :

```json
{
  "source": "camera",
  "device_id": "sentinel-x-cam-01",
  "type": "intrusion",
  "severity": "critical",
  "zone": "A",
  "persons": 1,
  "confidence": 0.87,
  "timestamp": "2026-10-06T14:14:19+00:00",
  "snapshot": "data:image/jpeg;base64,..."
}
```

`source` : `camera`, `ml` ou `esp8266`. `severity` : `info`, `warning` ou `critical`. Le module ML utilise en plus `score` (score d'anomalie) et `message`.

### WebSocket (`wss://<IP>/ws`)

Authentifié par le cookie de session. Chaque message a la forme `{"kind": ..., "data": ...}` :

- `devices` : envoyé à la connexion, état de tous les boîtiers ;
- `telemetry` : chaque nouvelle mesure ;
- `alert` : chaque nouvelle alerte (sans l'image, à récupérer par `/alerts/{id}/snapshot` si `has_snapshot` vaut true) ;
- `ack` : une alerte a été acquittée ;
- `device` : un boîtier passe en ligne ou hors ligne (hors ligne après 30 s sans mesure).

## Commandes utiles

```
docker compose ps                     état des services
docker compose logs -f api            alertes, commandes, connexions au dashboard
docker compose logs -f mosquitto      connexions MQTT
docker compose logs -f vision         détection et envoi des alertes
docker stats                          CPU et mémoire de chaque conteneur
docker compose exec db psql -U sentinel_admin -d sentinel
docker compose down                   arrêt (les données sont conservées)
docker compose down -v                arrêt et suppression de la base
```

Le schéma SQL (`db/init/`) n'est appliqué qu'à la création du volume de la base. Après une modification du schéma : `docker compose down -v` puis `docker compose up -d`.

Tester sans le boîtier, avec le simulateur (`--anomaly-after 120` déclenche une dérive lente de température et de gaz au bout de 2 minutes) :

```
pip install paho-mqtt
python tools\simulate_esp.py
```

## Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| `ports are not available ... 8883 ... forbidden by its access permissions` | Windows a réservé une plage de ports contenant 8883 au démarrage (service WinNAT) | En administrateur : `net stop winnat`, `docker compose up -d`, `net start winnat`. Pour éviter que ça recommence : étape 6 de l'installation |
| LED bleue du boîtier qui clignote, écran `IP MQTT..` | l'ESP est sur le Wi-Fi mais pas sur le broker | `docker compose logs mosquitto` ; moniteur série à 115200 bauds (ligne `échec, état MQTT`) |
| L'ESP ne voit pas le point d'accès | point d'accès en 5 GHz ou coupé par l'économie d'énergie | régler la bande sur 2,4 GHz, désactiver l'économie d'énergie |
| Panneau Caméra vide sur le dashboard | conteneur vision arrêté ou ffmpeg non lancé | onglet « Diffusion camera », `docker compose logs vision` |
| `docker compose down` affiche « Resource is still in use » | l'écoute de l'onglet « Capteurs ESP » est encore branchée sur le réseau | sans conséquence ; fermer l'onglet avant l'arrêt |
| Retour à l'écran de connexion | le conteneur api a redémarré (sessions en mémoire) | se reconnecter |

Les mesures de sécurité et leur justification sont décrites dans le dossier d'ingénierie (Workshop2026-M1-G[n]-Dossier.pdf).