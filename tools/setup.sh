#!/bin/sh
# Génère l'autorité de certification, le certificat serveur et les comptes MQTT.
# Lancé par : docker compose --profile setup run --rm setup
set -eu

: "${SERVER_IP:?SERVER_IP manquant dans .env}"
: "${MQTT_ESP_PASSWORD:?MQTT_ESP_PASSWORD manquant dans .env}"
: "${MQTT_API_PASSWORD:?MQTT_API_PASSWORD manquant dans .env}"

if ! command -v openssl >/dev/null || ! command -v mosquitto_passwd >/dev/null; then
  apk add --no-cache openssl mosquitto >/dev/null
fi

CERTS=/out/certs
cd "$CERTS"

# Autorité de certification (conservée si elle existe déjà, sinon il faudrait
# redistribuer ca.crt à tous les clients : ESP8266, script vision, navigateurs)
if [ ! -f ca.key ]; then
  echo "Création de l'autorité de certification"
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 365 \
    -subj "/O=Sentinel-X/CN=Sentinel-X CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out ca.crt
fi

# Certificat serveur (régénéré à chaque fois, pour suivre SERVER_IP)
echo "Création du certificat serveur pour $SERVER_IP"
cat > server.ext << EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=DNS:localhost,DNS:mosquitto,DNS:api,DNS:nginx,IP:127.0.0.1,IP:${SERVER_IP}
EXT
openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -subj "/O=Sentinel-X/CN=sentinel-x" -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -sha256 -extfile server.ext -out server.crt
rm -f server.csr server.ext

# Mosquitto et Nginx tournent sous des utilisateurs non root : la clé doit leur être lisible
chmod 644 server.key server.crt ca.crt
chmod 600 ca.key

# Comptes MQTT (mots de passe hachés)
PASSWD=/out/mosquitto/passwd
rm -f "$PASSWD"
(umask 077; touch "$PASSWD")
mosquitto_passwd -b "$PASSWD" esp01 "$MQTT_ESP_PASSWORD"
mosquitto_passwd -b "$PASSWD" api "$MQTT_API_PASSWORD"
# Lisible par l'utilisateur mosquitto du conteneur (Mosquitto 2.0 affichera un avertissement, sans effet)
chmod 644 "$PASSWD"

echo "Terminé. Fichiers générés :"
ls -l "$CERTS"/ "$PASSWD"
echo "Empreinte SHA-256 de la CA (utile pour vérifier côté ESP8266) :"
openssl x509 -in ca.crt -noout -fingerprint -sha256
