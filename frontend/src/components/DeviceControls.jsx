import { useState } from "react";

import { sendCommand } from "../services/api";

function DeviceControls({ devices }) {
  const [deviceId, setDeviceId] = useState(
    devices[0]?.device_id || ""
  );

  const [loading, setLoading] = useState(false);

  const executeCommand = async (
    target,
    action,
    duration_ms
  ) => {
    if (!deviceId) {
      alert("Sélectionnez un appareil.");
      return;
    }

    try {
      setLoading(true);

      await sendCommand({
        device_id: deviceId,
        target,
        action,
        ...(duration_ms
          ? { duration_ms }
          : {}),
      });
    } catch (error) {
      console.error(error);
      alert(
        `Erreur lors de l'envoi de la commande : ${error.message}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel controls-panel">
      <div className="panel-header">
        <div>
          <h2>Device Controls</h2>
          <span>
            Send commands to ESP8266 devices
          </span>
        </div>
      </div>

      <div className="controls">
        <label>
          Device

          <select
            value={deviceId}
            onChange={(event) =>
              setDeviceId(event.target.value)
            }
          >
            <option value="">
              Select device
            </option>

            {devices.map((device) => (
              <option
                key={device.device_id}
                value={device.device_id}
              >
                {device.device_id}
              </option>
            ))}
          </select>
        </label>

        <div className="control-group">
          <h3>Buzzer</h3>

          <button
            className="button"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "buzzer",
                "on",
                1000
              )
            }
          >
            ON 1s
          </button>

          <button
            className="button button-secondary"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "buzzer",
                "off"
              )
            }
          >
            OFF
          </button>
        </div>

        <div className="control-group">
          <h3>Alert LED</h3>

          <button
            className="button"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "led_alert",
                "on"
              )
            }
          >
            ON
          </button>

          <button
            className="button button-secondary"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "led_alert",
                "off"
              )
            }
          >
            OFF
          </button>

          <button
            className="button button-secondary"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "led_alert",
                "blink",
                3000
              )
            }
          >
            BLINK
          </button>
        </div>

        <div className="control-group">
          <h3>Status LED</h3>

          <button
            className="button"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "led_status",
                "on"
              )
            }
          >
            ON
          </button>

          <button
            className="button button-secondary"
            disabled={loading}
            onClick={() =>
              executeCommand(
                "led_status",
                "off"
              )
            }
          >
            OFF
          </button>
        </div>
      </div>
    </section>
  );
}

export default DeviceControls;