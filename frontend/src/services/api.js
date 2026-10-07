const API_BASE = "/api/v1";

function getToken() {
  return import.meta.env.VITE_DASHBOARD_TOKEN || "";
}

function getHeaders() {
  const token = getToken();

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : {}),
  };
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,

    headers: {
      ...getHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;

    try {
      const body = await response.json();

      if (body?.detail) {
        message = body.detail;
      }
    } catch {
      // Réponse non JSON
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function getHealth() {
  return request("/health");
}

export async function getDevices() {
  return request("/devices");
}

export async function getTelemetry({
  device_id,
  minutes,
  limit,
} = {}) {
  const params = new URLSearchParams();

  if (device_id) {
    params.set("device_id", device_id);
  }

  if (minutes !== undefined) {
    params.set("minutes", minutes);
  }

  if (limit !== undefined) {
    params.set("limit", limit);
  }

  const query = params.toString();

  return request(`/telemetry${query ? `?${query}` : ""}`);
}

export async function getAlerts({
  limit,
  unacked,
} = {}) {
  const params = new URLSearchParams();

  if (limit !== undefined) {
    params.set("limit", limit);
  }

  if (unacked !== undefined) {
    params.set("unacked", unacked);
  }

  const query = params.toString();

  return request(`/alerts${query ? `?${query}` : ""}`);
}

export async function acknowledgeAlert(alertId) {
  return request(`/alerts/${alertId}/ack`, {
    method: "POST",
  });
}

export async function sendCommand(command) {
  return request("/commands", {
    method: "POST",
    body: JSON.stringify(command),
  });
}

export function getSnapshotUrl(alertId) {
  return `${API_BASE}/alerts/${alertId}/snapshot`;
}