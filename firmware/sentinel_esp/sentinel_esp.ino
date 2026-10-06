#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <ESP8266WiFi.h>        // [RÉSEAU]
#include <WiFiClientSecure.h>   // [RÉSEAU]
#include <PubSubClient.h>       // [RÉSEAU]
#include "secrets.h"            // [RÉSEAU] WIFI_SSID, WIFI_PASS, MQTT_USER, MQTT_PASS, CA_PEM


#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C


Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);


// DHT22 sur D4 (GPIO 2)
#define DHTPIN 2
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);


// PIR sur D7 (GPIO 13)
#define PIR_PIN 13


// [RÉSEAU] MQ-2 sur A0
#define GAS_PIN A0


// [RÉSEAU] Broker MQTT sur le PC (hotspot Windows)
#define DEVICE_ID "esp01"
const IPAddress BROKER_IP(192, 168, 137, 1);
const uint16_t BROKER_PORT = 8883;
// Date fixe pour valider le certificat (1er décembre 2026), l'ESP n'a pas d'horloge
const time_t CERT_CHECK_TIME = 1796083200;


const char* T_TELEMETRY = "sentinel/" DEVICE_ID "/telemetry";
const char* T_EVENT     = "sentinel/" DEVICE_ID "/event";
const char* T_STATUS    = "sentinel/" DEVICE_ID "/status";
const char* T_CMD       = "sentinel/" DEVICE_ID "/cmd";


BearSSL::WiFiClientSecure net;
BearSSL::X509List caCert(CA_PEM);
PubSubClient mqtt(net);
unsigned long lastMqttAttempt = 0;
bool lastPresenceEnvoyee = false;


unsigned long previousSensorMillis = 0;
unsigned long dernierMouvementMillis = 0;
const unsigned long timeoutInactivite = 15000; // 15 secondes sans mouvement


float lastTemp = 0.0;
float lastHum = 0.0;
bool hasValidReading = false;
bool ecranAllume = true;
bool presenceActive = false;




// ---------- [RÉSEAU] ----------


void onCommand(char* topic, byte* payload, unsigned int len) {
  Serial.print("Commande reçue : ");
  Serial.write(payload, len);
  Serial.println();
  // À compléter quand le format des commandes de l'API sera fixé (buzzer, LEDs)
}


// Ne bloque jamais la boucle : si le broker est absent, l'écran et les capteurs continuent
void gererReseau() {
  static unsigned long lastWifiLog = 0;
  if (millis() - lastWifiLog > 3000) {
    lastWifiLog = millis();
    Serial.printf("Wi-Fi état %d\n", WiFi.status());
  }


  if (WiFi.status() != WL_CONNECTED) return;   // le Wi-Fi se reconnecte tout seul


  if (!mqtt.connected()) {
    if (millis() - lastMqttAttempt < 5000) return;
    lastMqttAttempt = millis();
    Serial.print("Connexion MQTTS... ");
    // Last Will : le broker publiera "offline" si le boîtier disparaît sans prévenir
    if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, T_STATUS, 1, true, "offline")) {
      Serial.println("OK");
      mqtt.publish(T_STATUS, "online", true);
      mqtt.subscribe(T_CMD);
    } else {
      char err[80];
      net.getLastSSLError(err, sizeof(err));
      Serial.printf("échec, état MQTT %d, TLS : %s\n", mqtt.state(), err);
    }
    return;
  }
  mqtt.loop();
}


void envoyerTelemetrie() {
  if (!mqtt.connected() || !hasValidReading) return;
  char msg[128];
  snprintf(msg, sizeof(msg), "{\"t\":%.2f,\"h\":%.1f,\"gas\":%d,\"pir\":%d,\"rssi\":%d}",
           lastTemp, lastHum, analogRead(GAS_PIN), presenceActive ? 1 : 0, WiFi.RSSI());
  mqtt.publish(T_TELEMETRY, msg);
  Serial.println(msg);
}


void envoyerEvenementPresence() {
  if (presenceActive == lastPresenceEnvoyee) return;
  lastPresenceEnvoyee = presenceActive;
  if (mqtt.connected()) {
    mqtt.publish(T_EVENT, presenceActive ? "{\"type\":\"motion\"}" : "{\"type\":\"motion_end\"}");
  }
}


// Ligne du haut de l'écran : état de la connexion (le sujet demande le statut IP/Wi-Fi)
void afficherStatutReseau() {
  display.setCursor(0, 0);
  if (WiFi.status() != WL_CONNECTED) {
        display.print("Wi-Fi etat ");
    display.print(WiFi.status());


  } else {
    display.print(WiFi.localIP());
    display.print(mqtt.connected() ? " OK" : " MQTT..");
  }
}


// ---------- fin [RÉSEAU] ----------




void dessinerDormeur() {
  display.clearDisplay();


  int cx = 58;
  int cy = 25;


  display.drawCircle(cx, cy, 18, SSD1306_WHITE);


  display.drawFastHLine(cx - 10, cy - 2, 6, SSD1306_WHITE);
  display.drawPixel(cx - 11, cy - 1, SSD1306_WHITE);
  display.drawPixel(cx - 4, cy - 1, SSD1306_WHITE);


  display.drawFastHLine(cx + 4, cy - 2, 6, SSD1306_WHITE);
  display.drawPixel(cx + 3, cy - 1, SSD1306_WHITE);
  display.drawPixel(cx + 10, cy - 1, SSD1306_WHITE);


  display.drawCircle(cx, cy + 7, 2, SSD1306_WHITE);


  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(cx + 22, cy - 12);
  display.print("z");
  display.setTextSize(2);
  display.setCursor(cx + 30, cy - 22);
  display.print("Z");


  display.setTextSize(1);
  display.setCursor(28, 52);
  display.print("BONNE NUIT...");


  display.display();
}


void passerEnVeille() {
  dessinerDormeur();
  delay(3000);


  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);
  ecranAllume = false;
  presenceActive = false;
}


void reveillerEcran() {
  display.ssd1306_command(SSD1306_DISPLAYON);
  ecranAllume = true;
  dernierMouvementMillis = millis(); // Réinitialise proprement le chrono
}


void afficherEcran(bool mouvement) {
  display.clearDisplay();


  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  afficherStatutReseau();   // [RÉSEAU] remplace le titre "STATION METEO"
  display.drawLine(0, 9, 127, 9, SSD1306_WHITE);


  if (!hasValidReading) {
    display.setCursor(12, 22);
    display.println("Attente DHT22...");
  } else {
    display.setCursor(0, 14);
    display.print("Temp : ");
    display.print(lastTemp, 1);
    display.print(" C");


    display.setCursor(0, 27);
    display.print("Hum  : ");
    display.print(lastHum, 1);
    display.print(" %");
  }


  display.drawLine(0, 40, 127, 40, SSD1306_WHITE);


  display.setCursor(0, 46);
  display.print("Presence : ");
  if (mouvement) {
    display.print("OUI");
    display.fillRect(92, 45, 30, 9, SSD1306_WHITE);
  } else {
    display.print("NON");
    display.drawRect(92, 45, 30, 9, SSD1306_WHITE);
  }


  unsigned long ecoule = millis() - dernierMouvementMillis;
  int tempsRestant = 0;
  if (timeoutInactivite > ecoule) {
    tempsRestant = (timeoutInactivite - ecoule) / 1000;
  }


  display.setCursor(0, 56);
  display.print("Veille dans : ");
  display.print(tempsRestant);
  display.print("s");


  display.display();
}


void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(PIR_PIN, INPUT);


  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    for (;;);
  }


  // [RÉSEAU] Wi-Fi et TLS. La connexion se fait en arrière-plan pendant l'initialisation.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  net.setTrustAnchors(&caCert);
  net.setX509Time(CERT_CHECK_TIME);
  mqtt.setServer(BROKER_IP, BROKER_PORT);
  mqtt.setCallback(onCommand);


  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(18, 15);
  display.println("INITIALISATION");
  display.setCursor(15, 32);
  display.println("Attente 5 sec...");
  display.display();


  delay(5000);
  dernierMouvementMillis = millis();
}


void loop() {
  gererReseau();   // [RÉSEAU]


  unsigned long currentMillis = millis();
  int lecture = digitalRead(PIR_PIN);


  // 1. Détection directe sans temps mort artificiel
  if (lecture == HIGH) {
    dernierMouvementMillis = currentMillis;
    presenceActive = true;


    if (!ecranAllume) {
      reveillerEcran();
    }
  } else {
    presenceActive = false; // Repasse à NON dès que la broche tombe à LOW
  }


  envoyerEvenementPresence();   // [RÉSEAU]


  // 2. Gestion de l'extinction
  if (ecranAllume) {
    if (currentMillis - dernierMouvementMillis >= timeoutInactivite) {
      passerEnVeille();
    } else {
      afficherEcran(presenceActive);
    }
  }


  // 3. Mesures DHT22
  if (currentMillis - previousSensorMillis >= 2500) {
    previousSensorMillis = currentMillis;


    float hum = dht.readHumidity();
    float temp = dht.readTemperature();


    if (!isnan(hum) && !isnan(temp)) {
      lastTemp = temp;
      lastHum = hum;
      hasValidReading = true;
    }


    envoyerTelemetrie();   // [RÉSEAU] une mesure envoyée toutes les 2,5 s
  }


  delay(200);
}


