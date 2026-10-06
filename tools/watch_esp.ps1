# Affiche en direct les messages MQTT des boîtiers (télémétrie, événements, statut)
Set-Location "$PSScriptRoot\.."
$Host.UI.RawUI.WindowTitle = "Sentinel-X - ESP"

Write-Host "Attente du conteneur api..."
while (-not (docker compose exec api printenv MQTT_API_PASSWORD 2>$null)) { Start-Sleep 2 }
$p = (docker compose exec api printenv MQTT_API_PASSWORD).Trim()

docker run --rm -v "${PWD}\certs:/c" eclipse-mosquitto:2.0 mosquitto_sub -h host.docker.internal -p 8883 --cafile /c/ca.crt --insecure -u api -P $p -t 'sentinel/#' -v