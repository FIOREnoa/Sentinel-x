import { useEffect, useState } from "react";

import { sendCommand } from "../services/api";

// Commandes acceptées par l'API et le firmware :
//   alarm      on = rouge (alarme), off = verte (fin d'alarme)
//   led_alert  on/off = LED rouge
//   led_status on = verte, off = rouge
function DeviceControls({ devices }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.device_id || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!deviceId && devices.length > 0) {
      setDeviceId(devices[0].device_id);
    }
  }, [devices, deviceId]);

  const executeCommand = async (target, action) => {
    if (!deviceId) {
      alert("Sélectionnez un appareil.");
      return;
    }
    try {
      setLoading(true);
      await sendCommand({ device_id: deviceId, target, action });
    } catch (error) {
      alert(`Erreur lors de l'envoi de la commande : ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel controls-panel">
      <div className="panel-header">
        <div>
          <h2>Commandes du boîtier</h2>
          <span>Pilotage des LEDs de l'ESP8266</span>
        </div>
      </div>

      <div className="controls">
        <label>
          Boîtier
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Choisir un boîtier</option>
            {devices.map((device) => (
              <option key={device.device_id} value={device.device_id}>
                {device.device_id}
              </option>
            ))}
          </select>
        </label>

        <div className="control-group">
          <h3>Alarme</h3>
          <button className="button" disabled={loading} onClick={() => executeCommand("alarm", "on")}>
            Déclencher
          </button>
          <button className="button button-secondary" disabled={loading} onClick={() => executeCommand("alarm", "off")}>
            Arrêter
          </button>
        </div>

        <div className="control-group">
          <h3>LED rouge</h3>
          <button className="button" disabled={loading} onClick={() => executeCommand("led_alert", "on")}>
            ON
          </button>
          <button className="button button-secondary" disabled={loading} onClick={() => executeCommand("led_alert", "off")}>
            OFF
          </button>
        </div>
      </div>
    </section>
  );
}

export default DeviceControls;
