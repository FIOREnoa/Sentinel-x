function DevicesPanel({ devices }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Devices</h2>
          <span>Connected IoT devices</span>
        </div>

        <span className="panel-count">
          {devices.length}
        </span>
      </div>

      <div className="devices-list">
        {devices.length === 0 && (
          <div className="empty-state">
            Aucun appareil détecté.
          </div>
        )}

        {devices.map((device) => {
          const online =
            device.online === true ||
            device.connected === true ||
            device.status === "online";

          return (
            <div
              className="device-row"
              key={device.device_id}
            >
              <div className="device-main">
                <span
                  className={`status-dot ${
                    online ? "online" : "offline"
                  }`}
                />

                <div>
                  <strong>
                    {device.device_id || "Unknown"}
                  </strong>

                  <span>
                    {online ? "Online" : "Offline"}
                  </span>
                </div>
              </div>

              <div className="device-meta">
                <span>
                  RSSI: {device.rssi ?? "--"}
                </span>

                <span>
                  Last seen:{" "}
                  {formatDate(
                    device.last_seen ||
                    device.lastSeen
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatDate(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("fr-FR");
}

export default DevicesPanel;