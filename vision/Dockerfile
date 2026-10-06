FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch CPU uniquement (évite plusieurs Go de dépendances CUDA)
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

ENV HOME=/tmp \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    MPLCONFIGDIR=/tmp/matplotlib \
    YOLO_OFFLINE=1 \
    PYTHONUNBUFFERED=1

# Poids téléchargés à la construction : le Wi-Fi de table n'a pas forcément Internet
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY sentinel_vision.py .

# Utilisateur non root, membre du groupe video pour accéder à /dev/video0
RUN useradd -r -u 10001 -G video sentinel \
 && mkdir -p /app/logs && chown -R sentinel /app
USER sentinel

EXPOSE 8000
CMD ["python", "sentinel_vision.py"]
