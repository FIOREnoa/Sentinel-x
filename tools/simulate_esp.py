"""
Simulateur du boîtier ESP8266 : publie en MQTTS exactement ce que publiera le vrai firmware.

Sert à tester la stack, construire le dashboard et préparer la maintenance prédictive
avant que le câblage soit prêt.

    pip install paho-mqtt
    python tools/simulate_esp.py                       # fonctionnement normal
    python tools/simulate_esp.py --anomaly-after 120   # dérive lente temp + gaz après 2 min
"""

import argparse
import json
import math
import random
import time
from pathlib import Path

import paho.mqtt.client as mqtt


def read_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


root = Path(__file__).resolve().parent.parent
env = read_env(root / ".env")

p = argparse.ArgumentParser()
p.add_argument("--host", default="localhost")
p.add_argument("--port", type=int, default=8883)
p.add_argument("--device", default="esp01")
p.add_argument("--password", default=env.get("MQTT_ESP_PASSWORD"))
p.add_argument("--ca", default=str(root / "certs" / "ca.crt"))
p.add_argument("--interval", type=float, default=2.0, help="secondes entre deux mesures")
p.add_argument("--anomaly-after", type=float, default=0, help="démarre une dérive après N secondes (0 = jamais)")
args = p.parse_args()

if not args.password:
    raise SystemExit("Mot de passe MQTT introuvable : renseigner MQTT_ESP_PASSWORD dans .env ou --password")

base = f"sentinel/{args.device}"


def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code.is_failure:
        print(f"Connexion refusée : {reason_code}")
        return
    print(f"Connecté à {args.host}:{args.port} en tant que {args.device}")
    client.publish(f"{base}/status", "online", qos=1, retain=True)
    client.publish(f"{base}/event", json.dumps({"type": "boot"}), qos=1)
    client.subscribe(f"{base}/cmd", qos=1)


def on_message(client, userdata, msg):
    print(f"<< commande reçue : {msg.payload.decode()}")


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{args.device}")
client.username_pw_set(args.device, args.password)
client.tls_set(ca_certs=args.ca)
client.will_set(f"{base}/status", "offline", qos=1, retain=True)
client.on_connect = on_connect
client.on_message = on_message
client.connect(args.host, args.port, keepalive=30)
client.loop_start()

start = time.time()
pir = False
next_pir_toggle = start + random.uniform(20, 40)
temp_drift = gas_drift = 0.0

try:
    while True:
        now = time.time()
        elapsed = now - start

        # Valeurs normales : légère oscillation + bruit de mesure
        temp = 22.0 + 0.4 * math.sin(elapsed / 300) + random.gauss(0, 0.08)
        hum = 45.0 + 2.0 * math.sin(elapsed / 500) + random.gauss(0, 0.3)
        gas = 180 + random.gauss(0, 4)

        # Anomalie : hausse lente de température et micro-dérive du gaz (cas décrit dans le sujet)
        if args.anomaly_after and elapsed > args.anomaly_after:
            temp_drift += 0.015 * args.interval
            gas_drift += 0.4 * args.interval
            temp += temp_drift
            gas += gas_drift

        if now >= next_pir_toggle:
            pir = not pir
            client.publish(f"{base}/event", json.dumps({"type": "motion" if pir else "motion_end"}), qos=1)
            next_pir_toggle = now + (random.uniform(3, 8) if pir else random.uniform(30, 60))

        payload = {
            "t": round(temp, 2), "h": round(hum, 1), "gas": int(max(0, min(1023, gas))),
            "pir": int(pir), "rssi": random.randint(-65, -55),
        }
        client.publish(f"{base}/telemetry", json.dumps(payload), qos=0)
        print(f">> {payload}")
        time.sleep(args.interval)
except KeyboardInterrupt:
    client.publish(f"{base}/status", "offline", qos=1, retain=True).wait_for_publish(2)
    client.loop_stop()
    client.disconnect()
