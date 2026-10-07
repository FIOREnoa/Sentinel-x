// Connexion temps réel. Le navigateur joint le cookie de session à la demande
// de connexion : aucun jeton dans l'adresse.
export function createWebSocket(onMessage, onStatusChange) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.onopen = () => onStatusChange?.("connected");

  socket.onmessage = (event) => {
    try {
      onMessage?.(JSON.parse(event.data));
    } catch (error) {
      console.error("Message WebSocket invalide :", error);
    }
  };

  socket.onerror = () => onStatusChange?.("error");
  socket.onclose = () => onStatusChange?.("disconnected");

  return socket;
}
