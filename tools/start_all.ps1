# Lance toute la pile Sentinel-X : Docker, les conteneurs, puis les outils dans une seule fenêtre à onglets
Set-Location "$PSScriptRoot\.."
docker desktop start
while (-not (docker info 2>$null)) { Start-Sleep 2 }
docker compose up -d
docker compose ps

$scripts = [ordered]@{
    "Diffusion camera" = "$PSScriptRoot\start_camera.ps1"
    "Etat camera"      = "$PSScriptRoot\watch_camera.ps1"
    "Capteurs ESP"     = "$PSScriptRoot\watch_esp.ps1"
}

if (Get-Command wt -ErrorAction SilentlyContinue) {
    foreach ($titre in $scripts.Keys) {
        wt -w sentinel new-tab --title $titre --suppressApplicationTitle powershell -NoExit -ExecutionPolicy Bypass -File $scripts[$titre]
        Start-Sleep 1
    }
} else {
    # Windows Terminal absent : une fenêtre PowerShell par outil
    foreach ($titre in $scripts.Keys) {
        Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $scripts[$titre]
    }
}