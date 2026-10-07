# Pare-feu Windows pour SENTINEL-X. À lancer dans un PowerShell ouvert en administrateur.
#
# Seuls les appareils du point d'accès (192.168.137.0/24) peuvent joindre le serveur,
# et seulement sur les ports 80 (redirection), 443 (dashboard, API) et 8883 (MQTTS).
# Les règles de blocage passent avant les règles d'autorisation que Docker Desktop crée.

$ports  = @("80", "443", "8883")
$hotspot = "192.168.137.0/24"
# Toutes les adresses sauf le point d'accès et la machine elle-même
$autres = @("0.0.0.0-126.255.255.255", "128.0.0.0-192.168.136.255", "192.168.138.0-255.255.255.255")

# Supprime les anciennes règles du projet pour repartir de zéro
Get-NetFirewallRule -DisplayName "Sentinel-X*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName "Sentinel-X : autoriser le point d'accès" `
    -Direction Inbound -Protocol TCP -LocalPort $ports -RemoteAddress $hotspot -Action Allow -Profile Any | Out-Null

New-NetFirewallRule -DisplayName "Sentinel-X : bloquer les autres réseaux" `
    -Direction Inbound -Protocol TCP -LocalPort $ports -RemoteAddress $autres -Action Block -Profile Any | Out-Null

# Ports internes : jamais joignables depuis le réseau (flux caméra brut, ffmpeg, base de données)
New-NetFirewallRule -DisplayName "Sentinel-X : bloquer les ports internes" `
    -Direction Inbound -Protocol TCP -LocalPort @("8000", "1235", "5432") -RemoteAddress Any -Action Block -Profile Any | Out-Null

Get-NetFirewallRule -DisplayName "Sentinel-X*" |
    Select-Object DisplayName, Enabled, Action |
    Format-Table -AutoSize
