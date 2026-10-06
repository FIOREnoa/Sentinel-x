# Diffuse la webcam USB vers le conteneur vision (qui se connecte en TCP sur 127.0.0.1:1235).
# Le nom de la caméra s'obtient avec : ffmpeg -list_devices true -f dshow -i dummy
param([string]$Camera = "Web Camera")
while ($true) {
    ffmpeg -hide_banner -loglevel warning -f dshow -video_size 640x480 -framerate 30 -i video="$Camera" -vcodec mpeg4 -q:v 5 -f mpegts "tcp://127.0.0.1:1235?listen=1"
}