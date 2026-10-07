import { useState } from "react";

import { getSnapshotUrl } from "../services/api";

// Flux vidéo en direct (relayé par nginx, protégé par la session) et dernière intrusion photographiée
function CameraPanel({ alerts }) {
  const [streamError, setStreamError] = useState(false);
  const [streamKey, setStreamKey] = useState(0);

  const lastIntrusion = alerts.find(
    (alert) => alert.source === "camera" && alert.type === "intrusion" && alert.has_snapshot
  );

  const retry = () => {
    setStreamError(false);
    setStreamKey((k) => k + 1);   // force le navigateur à rouvrir le flux
  };

  return (
    <section className="panel camera-panel">
      <div className="panel-header">
        <div>
          <h2>Caméra</h2>
          <span>Flux en direct et dernière intrusion</span>
        </div>
      </div>

      <div className="snapshot-container">
        {streamError ? (
          <div className="camera-placeholder">
            <div className="camera-icon">📷</div>
            <strong>Flux vidéo indisponible</strong>
            <span>Vérifier que le conteneur vision et start_camera.ps1 tournent.</span>
            <button className="button button-small" onClick={retry}>
              Réessayer
            </button>
          </div>
        ) : (
          <img
            key={streamKey}
            src={`/camera/stream?v=${streamKey}`}
            alt="Flux vidéo de la caméra"
            className="camera-live"
            onError={() => setStreamError(true)}
          />
        )}
      </div>

      {lastIntrusion && (
        <div className="snapshot-container">
          <img src={getSnapshotUrl(lastIntrusion.id)} alt="Dernière intrusion détectée" />
          <div className="snapshot-info">
            <span>Dernière intrusion (alerte n° {lastIntrusion.id})</span>
            <span>{new Date(lastIntrusion.ts).toLocaleString("fr-FR")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default CameraPanel;
