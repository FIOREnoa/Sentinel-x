// Modèle de configuration du boîtier SENTINEL-X.
// Copier ce fichier en "secrets.h" dans le même dossier, puis remplacer les valeurs.
// secrets.h est ignoré par Git : ne jamais y mettre de vraies valeurs dans ce fichier-ci.
#pragma once

// Point d'accès Wi-Fi du PC serveur (bande 2,4 GHz, sécurité WPA2)
#define WIFI_SSID "nom_du_hotspot"
#define WIFI_PASS "mot_de_passe_du_hotspot"

// Compte MQTT du boîtier (doit exister dans le fichier passwd de Mosquitto)
#define MQTT_USER "esp01"
#define MQTT_PASS "mot_de_passe_mqtt_du_boitier"

// Certificat de l'autorité de certification du groupe :
// coller ici le contenu de certs/ca.crt (généré par le service "setup" du docker compose)
static const char CA_PEM[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
contenu_de_certs/ca.crt
-----END CERTIFICATE-----
)EOF";