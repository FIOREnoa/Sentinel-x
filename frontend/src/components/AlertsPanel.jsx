function AlertsPanel({
  alerts,
  onAcknowledge,
}) {
  return (
    <section className="panel alerts-panel">
      <div className="panel-header">
        <div>
          <h2>Security Alerts</h2>
          <span>Detected security events</span>
        </div>

        <span className="panel-count">
          {alerts.length}
        </span>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 && (
          <div className="empty-state">
            Aucune alerte.
          </div>
        )}

        {alerts.map((alert, index) => {
          const acknowledged =
            alert.acknowledged === true ||
            alert.ack === true;

          const severity =
            alert.severity ||
            alert.level ||
            "unknown";

          return (
            <article
              className={`alert-row severity-${String(
                severity
              ).toLowerCase()}`}
              key={alert.id ?? index}
            >
              <div className="alert-main">
                <span className="alert-severity">
                  {severity}
                </span>

                <div>
                  <strong>
                    {alert.type ||
                      alert.alert_type ||
                      "Security alert"}
                  </strong>

                  <span>
                    Device:{" "}
                    {alert.device_id ||
                      alert.source ||
                      "--"}
                  </span>
                </div>
              </div>

              <div className="alert-meta">
                <span>
                  {formatDate(
                    alert.timestamp ||
                    alert.created_at ||
                    alert.time
                  )}
                </span>

                {!acknowledged && alert.id != null && (
                  <button
                    className="button button-small"
                    onClick={() =>
                      onAcknowledge(alert.id)
                    }
                  >
                    Acknowledge
                  </button>
                )}

                {acknowledged && (
                  <span className="ack-badge">
                    ACK
                  </span>
                )}
              </div>
            </article>
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

export default AlertsPanel;