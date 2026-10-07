function Header({ health, wsStatus, onlineDevices }) {
  const apiStatus = health ? "online" : "offline";

  return (
    <header className="header">
      <div>
        <div className="brand">
          <span className="brand-mark">SX</span>

          <div>
            <h1>SENTINEL-X</h1>
            <p>Industrial Security Monitoring</p>
          </div>
        </div>
      </div>

      <div className="header-status">
        <Status label="API" status={apiStatus} />
        <Status label="WebSocket" status={wsStatus} />
        <Status
          label="Devices"
          status={onlineDevices > 0 ? "online" : "offline"}
        />
      </div>
    </header>
  );
}

function Status({ label, status }) {
  const online = status === "online" || status === "connected";

  return (
    <div className="status-indicator">
      <span className={`status-dot ${online ? "online" : "offline"}`} />

      <span>
        {label}: {online ? "OK" : "OFF"}
      </span>
    </div>
  );
}

export default Header;