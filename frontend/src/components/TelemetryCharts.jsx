import { useEffect, useMemo, useState } from "react";
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

import { getTelemetryHistory } from "../services/api";

// Périodes proposées. live = les nouvelles mesures s'ajoutent en direct sur la courbe.
const RANGES = [
  { id: "15m", label: "15 min", ms: 15 * 60e3, live: true },
  { id: "1h", label: "1 h", ms: 60 * 60e3, live: true },
  { id: "6h", label: "6 h", ms: 6 * 3600e3, live: false },
  { id: "24h", label: "24 h", ms: 24 * 3600e3, live: false },
  { id: "7d", label: "7 jours", ms: 7 * 86400e3, live: false },
  { id: "30d", label: "30 jours", ms: 30 * 86400e3, live: false },
];

const COLORS = {
  temperature: "#f59e0b",
  humidity: "#38bdf8",
  gas: "#34d399",
  gasMax: "#f87171",
  grid: "#1e2a35",
  axis: "#71818f",
};

const REFRESH_MS = 60e3;   // les longues périodes sont rechargées chaque minute

function TelemetryCharts({ telemetry, deviceId = "esp01" }) {
  const [rangeId, setRangeId] = useState("1h");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const range = RANGES.find((r) => r.id === rangeId);

  // Chargement de l'historique à chaque changement de période, puis rafraîchissement régulier
  useEffect(() => {
    let cancelled = false;

    const load = async (showLoading) => {
      if (showLoading) setLoading(true);
      try {
        const res = await getTelemetryHistory({ device_id: deviceId, range: rangeId });
        if (!cancelled) {
          setPoints((res.points || []).map(toPoint));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Historique indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load(true);
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rangeId, deviceId]);

  // Périodes courtes : chaque nouvelle mesure reçue en direct est ajoutée à la courbe
  const latest = telemetry.length > 0 ? telemetry[telemetry.length - 1] : null;

  useEffect(() => {
    if (!range.live || !latest?.ts) return;
    if (latest.device_id && latest.device_id !== deviceId) return;

    const point = toPoint(latest);
    setPoints((previous) => {
      const last = previous[previous.length - 1];
      if (last && point.t <= last.t) return previous;
      const limit = Date.now() - range.ms;
      return [...previous.filter((p) => p.t >= limit), point];
    });
  }, [latest, range, deviceId]);

  const now = Date.now();
  const domain = [now - range.ms, now];
  const tickFormatter = useMemo(() => makeTickFormatter(range.ms), [range.ms]);

  const tooltipProps = {
    labelFormatter: (t) => formatFullDate(t),
    contentStyle: {
      background: "#0b1118",
      border: "1px solid #2d4658",
      borderRadius: 8,
      fontSize: 12,
    },
    labelStyle: { color: "#e6edf3", marginBottom: 4 },
    cursor: { stroke: "#5a6b78", strokeDasharray: "4 4" },
  };

  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={domain}
      tickFormatter={tickFormatter}
      tickCount={7}
      stroke={COLORS.axis}
      tick={{ fontSize: 11 }}
    />
  );

  return (
    <section className="panel charts-panel">
      <div className="panel-header">
        <div>
          <h2>Télémétrie</h2>
          <span>
            {range.live ? "Données en direct" : "Moyennes par tranche de temps"}
            {loading ? " · chargement..." : ""}
          </span>
        </div>

        <div className="range-selector">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`range-button${r.id === rangeId ? " active" : ""}`}
              onClick={() => setRangeId(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner chart-error">{error}</div>}

      <div className="charts-grid">
        <div className="chart-container">
          <h3>Température et humidité</h3>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              {xAxis}
              <YAxis
                yAxisId="temp"
                stroke={COLORS.temperature}
                tick={{ fontSize: 11 }}
                domain={["auto", "auto"]}
                unit="°C"
                width={55}
              />
              <YAxis
                yAxisId="hum"
                orientation="right"
                stroke={COLORS.humidity}
                tick={{ fontSize: 11 }}
                domain={[0, 100]}
                unit="%"
                width={45}
              />
              <Tooltip {...tooltipProps} formatter={formatValue} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name="Température"
                stroke={COLORS.temperature}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="hum"
                type="monotone"
                dataKey="humidity"
                name="Humidité"
                stroke={COLORS.humidity}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>Gaz (MQ-2, valeur brute 0 à 1023)</h3>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              {xAxis}
              <YAxis yAxisId="gas" stroke={COLORS.axis} tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={45} />
              <Tooltip {...tooltipProps} formatter={formatValue} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                yAxisId="gas"
                type="monotone"
                dataKey="gas"
                name="Gaz (moyenne)"
                stroke={COLORS.gas}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              {!range.live && (
                <Line
                  yAxisId="gas"
                  type="monotone"
                  dataKey="gas_max"
                  name="Gaz (pic)"
                  stroke={COLORS.gasMax}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </section>
  );
}

// Mesure (direct ou historique) -> point du graphique, avec l'heure en millisecondes
function toPoint(item) {
  return {
    t: new Date(item.ts).getTime(),
    temperature: numberValue(item.temperature),
    humidity: numberValue(item.humidity),
    gas: numberValue(item.gas),
    gas_max: numberValue(item.gas_max ?? item.gas),
  };
}

function numberValue(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

// Graduations de l'axe du temps, adaptées à la période affichée
function makeTickFormatter(rangeMs) {
  return (t) => {
    const d = new Date(t);
    if (rangeMs <= 15 * 60e3) {
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    if (rangeMs <= 24 * 3600e3) {
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    if (rangeMs <= 7 * 86400e3) {
      return d.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  };
}

function formatFullDate(t) {
  return new Date(t).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatValue(value, name) {
  if (value === null || value === undefined) return ["--", name];
  if (name.startsWith("Température")) return [`${value.toFixed(1)} °C`, name];
  if (name.startsWith("Humidité")) return [`${value.toFixed(1)} %`, name];
  return [Math.round(value), name];
}

export default TelemetryCharts;
