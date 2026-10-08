# Affiche en direct les messages MQTT des boîtiers (télémétrie, événements, statut, commandes).
# Le client d'écoute rejoint le réseau Docker du projet et joint le broker par son nom,
# sans passer par Windows ni par le pare-feu.
Set-Location "$PSScriptRoot\.."
$Host.UI.RawUI.WindowTitle = "Sentinel-X - ESP"

Write-Host "Attente du conteneur api..."
while (-not (docker compose exec api printenv MQTT_API_PASSWORD 2>$null)) { Start-Sleep 2 }
$p = (docker compose exec api printenv MQTT_API_PASSWORD).Trim()

while ($true) {
    docker run --rm --network sentinel-x_backend -v "${PWD}\certs:/c:ro" eclipse-mosquitto:2.0 `
        mosquitto_sub -h mosquitto -p 8883 --cafile /c/ca.crt -u api -P $p -t 'sentinel/#' -v
    Write-Host "Connexion perdue, nouvelle tentative dans 3 s..." -ForegroundColor DarkGray
    Start-Sleep 3
}