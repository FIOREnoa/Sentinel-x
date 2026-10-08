// Appels à l'API.
// L'authentification passe par un cookie de session HttpOnly,
// posé par /api/v1/login.
// Aucun jeton n'est stocké dans le navigateur.

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
    window.dispatchEvent(new Event("sentinel:unauthorized"));
  }

  if (!response.ok) {
    let message = `Erreur API ${response.status}`;

    try {
      const body = await response.json();

      if (body?.detail) {
        message =
          typeof body.detail === "string"
            ? body.detail
            : message;
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


/* =========================
   AUTHENTIFICATION
   ========================= */

export async function login(username, password) {
  return request("/login", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
    }),
  });
}

export async function logout() {
  return request("/logout", {
    method: "POST",
  });
}

export async function checkSession() {
  return request("/session");
}


/* =========================
   HEALTH
   ========================= */

export async function getHealth() {
  return request("/health");
}


/* =========================
   DEVICES
   ========================= */

export async function getDevices() {
  return request("/devices");
}


/* =========================
   TELEMETRY
   ========================= */

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

  return request(
    `/telemetry${query ? `?${query}` : ""}`
  );
}


// Historique regroupé par tranches :
// 15m, 1h, 6h, 24h, 7d ou 30d
export async function getTelemetryHistory({
  device_id = "esp01",
  range = "1h",
} = {}) {
  const params = new URLSearchParams({
    device_id,
    range,
  });

  return request(
    `/telemetry/history?${params.toString()}`
  );
}


/* =========================
   ALERTS
   ========================= */

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

  return request(
    `/alerts${query ? `?${query}` : ""}`
  );
}

export async function acknowledgeAlert(alertId) {
  return request(`/alerts/${alertId}/ack`, {
    method: "POST",
  });
}


// Image d'une alerte.
// Le navigateur envoie automatiquement le cookie
// de session avec la requête <img>.
export function getSnapshotUrl(alertId) {
  return `${API_BASE}/alerts/${alertId}/snapshot`;
}


/* =========================
   COMMANDES
   ========================= */

export async function sendCommand(command) {
  return request("/commands", {
    method: "POST",
    body: JSON.stringify(command),
  });
}


/* =========================
   USERS / ADMINISTRATION
   ========================= */

export async function getUsers() {
  return request("/users");
}

export async function createUser({
  username,
  password,
}) {
  return request("/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
    }),
  });
}

export async function updateUserPassword(
  userId,
  password
) {
  return request(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      password,
    }),
  });
}

export async function deleteUser(userId) {
  return request(`/users/${userId}`, {
    method: "DELETE",
  });
}