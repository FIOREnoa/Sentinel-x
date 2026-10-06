function StatusCards({ telemetry, devices, health }) {
  const temperature = findValue(
    telemetry,
    ["temperature", "temp"]
  );

  const humidity = findValue(
    telemetry,
    ["humidity", "hum"]
  );

  const gas = findValue(
    telemetry,
    ["gas", "gas_value", "gas_level"]
  );

  const motion = findValue(
    telemetry,
    ["motion", "pir"]
  );

  const rssi = findValue(
    telemetry,
    ["rssi", "signal"]
  );

  const onlineDevices = devices.filter(
    (device) =>
      device.online === true ||
      device.connected === true ||
      device.status === "online"
  ).length;

  return (
    <section className="stats-grid">
      <Card
        title="Temperature"
        value={formatValue(temperature, "°C")}
        icon="🌡"
      />

      <Card
        title="Humidity"
        value={formatValue(humidity, "%")}
        icon="💧"
      />

      <Card
        title="Gas"
        value={formatValue(gas)}
        icon="◉"
      />

      <Card
        title="Motion"
        value={formatMotion(motion)}
        icon="◌"
      />

      <Card
        title="Devices online"
        value={onlineDevices}
        icon="▣"
      />

      <Card
        title="RSSI"
        value={formatValue(rssi, " dBm")}
        icon="⌁"
      />

      <Card
        title="System"
        value={health ? "ONLINE" : "OFFLINE"}
        icon="◆"
      />
    </section>
  );
}

function Card({ title, value, icon }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>

      <div>
        <p>{title}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function findValue(data, keys) {
  if (!data) {
    return null;
  }

  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) {
      return data[key];
    }
  }

  return null;
}

function formatValue(value, suffix = "") {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${value}${suffix}`;
}

function formatMotion(value) {
  if (value === null || value === undefined) {
    return "--";
  }

  if (value === true || value === 1 || value === "1") {
    return "DETECTED";
  }

  return "CLEAR";
}

export default StatusCards;