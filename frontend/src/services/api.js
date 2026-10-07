// Appels à l'API. L'authentification passe par un cookie de session HttpOnly,
// posé par /api/v1/login : aucun jeton n'est écrit dans ce code ni stocké dans le navigateur.
const API_BASE = "/api/v1";

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && endpoint !== "/login") {
    // Session expirée ou API redémarrée : on renvoie vers l'écran de connexion
    window.dispatchEvent(new Event("sentinel:unauthorized"));
  }

  if (!response.ok) {
    let message = `Erreur API ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        message = typeof body.detail === "string" ? body.detail : message;
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

export async function login(token) {
  return request("/login", { method: "POST", body: JSON.stringify({ token }) });
}

export async function logout() {
  return request("/logout", { method: "POST" });
}

export async function checkSession() {
  try {
    await request("/session");
    return true;
  } catch {
    return false;
  }
}

export async function getHealth() {
  return request("/health");
}

export async function getDevices() {
  return request("/devices");
}

export async function getTelemetry({ device_id, minutes, limit } = {}) {
  const params = new URLSearchParams();
  if (device_id) params.set("device_id", device_id);
  if (minutes !== undefined) params.set("minutes", minutes);
  if (limit !== undefined) params.set("limit", limit);
  const query = params.toString();
  return request(`/telemetry${query ? `?${query}` : ""}`);
}

export async function getAlerts({ limit, unacked } = {}) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", limit);
  if (unacked !== undefined) params.set("unacked", unacked);
  const query = params.toString();
  return request(`/alerts${query ? `?${query}` : ""}`);
}

export async function acknowledgeAlert(alertId) {
  return request(`/alerts/${alertId}/ack`, { method: "POST" });
}

export async function sendCommand(command) {
  return request("/commands", { method: "POST", body: JSON.stringify(command) });
}

// Image d'une alerte : la balise <img> envoie le cookie de session automatiquement
export function getSnapshotUrl(alertId) {
  return `${API_BASE}/alerts/${alertId}/snapshot`;
}
