import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function TelemetryCharts({ telemetry }) {
  const data = telemetry.map((item, index) => ({
    index,
    time: formatTime(
      item.timestamp ||
      item.created_at ||
      item.time
    ),

    temperature: numberValue(
      item.temperature ?? item.temp
    ),

    humidity: numberValue(
      item.humidity ?? item.hum
    ),

    gas: numberValue(
      item.gas ??
      item.gas_value ??
      item.gas_level
    ),
  }));

  return (
    <section className="panel charts-panel">
      <div className="panel-header">
        <div>
          <h2>Telemetry</h2>
          <span>Real-time sensor data</span>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>Temperature / Humidity</h3>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="time" />

              <YAxis />

              <Tooltip />

              <Legend />

              <Line
                type="monotone"
                dataKey="temperature"
                name="Temperature"
                dot={false}
              />

              <Line
                type="monotone"
                dataKey="humidity"
                name="Humidity"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>Gas level</h3>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="time" />

              <YAxis />

              <Tooltip />

              <Line
                type="monotone"
                dataKey="gas"
                name="Gas"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function numberValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isNaN(number) ? null : number;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "--";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default TelemetryCharts;