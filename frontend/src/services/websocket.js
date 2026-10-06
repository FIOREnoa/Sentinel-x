export function createWebSocket(onMessage, onStatusChange) {
  const token = import.meta.env.VITE_DASHBOARD_TOKEN || "";

  const protocol =
    window.location.protocol === "https:" ? "wss:" : "ws:";

  const query = token
    ? `?token=${encodeURIComponent(token)}`
    : "";

  const url = `${protocol}//${window.location.host}/ws${query}`;

  const socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("WebSocket connected");
    onStatusChange?.("connected");
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      onMessage?.(message);
    } catch (error) {
      console.error("Invalid WebSocket message:", error);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    onStatusChange?.("error");
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected");
    onStatusChange?.("disconnected");
  };

  return socket;
}