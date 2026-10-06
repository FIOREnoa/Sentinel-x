# Affiche en direct l'état de la caméra (RAS, SUSPECT, INTRUSION) et ouvre le stream dans le navigateur
Set-Location "$PSScriptRoot\.."
$Host.UI.RawUI.WindowTitle = "Sentinel-X - camera"
$t = (Select-String -Path .env -Pattern '^STREAM_TOKEN=').Line.Split('=', 2)[1].Trim()

Write-Host "Attente du conteneur vision..."
while (-not (curl.exe -sk https://localhost:8000/health)) { Start-Sleep 2 }
Start-Process "https://localhost:8000/stream?token=$t"

$couleurs = @{ RAS = "Green"; SUSPECT = "Yellow"; INTRUSION = "Red" }
while ($true) {
    try {
        $s = curl.exe -sk "https://localhost:8000/status?token=$t" | ConvertFrom-Json
        $ligne = "{0}  {1,-9}  {2,5} fps  inference {3,6} ms  personnes {4}  intrus {5}" -f (Get-Date -Format HH:mm:ss), $s.status, $s.fps, $s.inference_ms, $s.persons, $s.intruders
        $c = $couleurs[$s.status]; if (-not $c) { $c = "Gray" }
        Write-Host $ligne -ForegroundColor $c
    } catch {
        Write-Host "$(Get-Date -Format HH:mm:ss)  conteneur vision injoignable" -ForegroundColor DarkGray
    }
    Start-Sleep 1
}