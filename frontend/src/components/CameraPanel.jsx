import { getSnapshotUrl } from "../services/api";

function CameraPanel({ alerts }) {
  const cameraAlert = alerts.find(
    (alert) =>
      alert.snapshot ||
      alert.snapshot_url ||
      alert.has_snapshot === true
  );

  return (
    <section className="panel camera-panel">
      <div className="panel-header">
        <div>
          <h2>Camera</h2>
          <span>Security snapshots</span>
        </div>
      </div>

      {!cameraAlert && (
        <div className="camera-placeholder">
          <div className="camera-icon">▣</div>

          <strong>
            No camera snapshot available
          </strong>

          <span>
            Les snapshots apparaîtront ici lorsqu'une
            alerte caméra sera générée.
          </span>
        </div>
      )}

      {cameraAlert && cameraAlert.id != null && (
        <div className="snapshot-container">
          <img
            src={getSnapshotUrl(cameraAlert.id)}
            alt="Security alert snapshot"
          />

          <div className="snapshot-info">
            <strong>
              Alert #{cameraAlert.id}
            </strong>

            <span>
              {cameraAlert.type ||
                cameraAlert.alert_type ||
                "Camera detection"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

export default CameraPanel;