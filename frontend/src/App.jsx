import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "./components/Header";
import StatusCards from "./components/StatusCards";
import TelemetryCharts from "./components/TelemetryCharts";
import DevicesPanel from "./components/DevicesPanel";
import AlertsPanel from "./components/AlertsPanel";
import CameraPanel from "./components/CameraPanel";
import DeviceControls from "./components/DeviceControls";

import {
  acknowledgeAlert,
  getAlerts,
  getDevices,
  getHealth,
  getTelemetry,
} from "./services/api";

import { useWebSocket } from "./hooks/useWebSocket";

function App() {
  const [health, setHealth] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [devices, setDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [wsStatus, setWsStatus] = useState("disconnected");

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [
        healthResponse,
        telemetryResponse,
        devicesResponse,
        alertsResponse,
      ] = await Promise.all([
        getHealth(),
        getTelemetry({
          minutes: 60,
          limit: 500,
        }),
        getDevices(),
        getAlerts({
          limit: 50,
        }),
      ]);

      setHealth(healthResponse);
      setTelemetry(normalizeList(telemetryResponse));
      setDevices(normalizeList(devicesResponse));
      setAlerts(normalizeList(alertsResponse));
    } catch (err) {
      console.error(err);
      setError(err.message || "Impossible de charger le dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleWebSocketMessage = useCallback((message) => {
    if (!message) {
      return;
    }

    switch (message.kind) {
      case "telemetry":
        setTelemetry((previous) => {
          const item = message.data ?? message.payload ?? message;

          const next = [...previous, item];

          return next.slice(-500);
        });
        break;

      case "alert":
        setAlerts((previous) => {
          const alert = message.data ?? message.payload ?? message;

          return [alert, ...previous].slice(0, 50);
        });
        break;

      case "device":
        updateDevice(message.data ?? message.payload ?? message);
        break;

      case "devices":
        setDevices(normalizeList(message.data ?? message.payload ?? message));
        break;

      case "ack":
        updateAlertAck(message);
        break;

      default:
        console.debug("WebSocket message:", message);
    }
  }, []);

  const updateDevice = (device) => {
    if (!device?.device_id) {
      return;
    }

    setDevices((previous) => {
      const exists = previous.some(
        (item) => item.device_id === device.device_id
      );

      if (!exists) {
        return [...previous, device];
      }

      return previous.map((item) =>
        item.device_id === device.device_id
          ? { ...item, ...device }
          : item
      );
    });
  };

  const updateAlertAck = (message) => {
    const id =
      message?.id ??
      message?.alert_id ??
      message?.data?.id ??
      message?.data?.alert_id;

    if (id == null) {
      return;
    }

    setAlerts((previous) =>
      previous.map((alert) =>
        String(alert.id) === String(id)
          ? {
              ...alert,
              acknowledged: true,
              ack: true,
            }
          : alert
      )
    );
  };

  useWebSocket(handleWebSocketMessage, setWsStatus);

  const handleAcknowledge = async (alertId) => {
    try {
      await acknowledgeAlert(alertId);

      setAlerts((previous) =>
        previous.map((alert) =>
          String(alert.id) === String(alertId)
            ? {
                ...alert,
                acknowledged: true,
                ack: true,
              }
            : alert
        )
      );
    } catch (err) {
      console.error("Erreur acknowledge:", err);
      alert("Impossible d'acquitter cette alerte.");
    }
  };

  const onlineDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.online === true ||
          device.status === "online" ||
          device.connected === true
      ).length,
    [devices]
  );

  const latestTelemetry =
    telemetry.length > 0 ? telemetry[telemetry.length - 1] : null;

  return (
    <div className="app">
      <Header
        health={health}
        wsStatus={wsStatus}
        onlineDevices={onlineDevices}
      />

      <main className="dashboard">
        {error && (
          <div className="error-banner">
            <strong>Erreur :</strong> {error}
            <button onClick={loadDashboard}>Réessayer</button>
          </div>
        )}

        <StatusCards
          telemetry={latestTelemetry}
          devices={devices}
          health={health}
        />

        <section className="dashboard-grid dashboard-grid-large">
          <TelemetryCharts telemetry={telemetry} />

          <DevicesPanel devices={devices} />
        </section>

        <section className="dashboard-grid">
          <AlertsPanel
            alerts={alerts}
            onAcknowledge={handleAcknowledge}
          />

          <CameraPanel alerts={alerts} />
        </section>

        <section>
          <DeviceControls devices={devices} />
        </section>

        {loading && (
          <div className="loading-overlay">
            Chargement des données...
          </div>
        )}
      </main>
    </div>
  );
}

function normalizeList(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.items)) {
    return response.items;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  return [];
}

export default App;