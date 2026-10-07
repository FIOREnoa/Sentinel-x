import { useEffect, useRef } from "react";

import { createWebSocket } from "../services/websocket";

export function useWebSocket(
  onMessage,
  onStatusChange
) {
  const messageRef = useRef(onMessage);
  const statusRef = useRef(onStatusChange);

  useEffect(() => {
    messageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    statusRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const socket = createWebSocket(
      (message) => {
        messageRef.current?.(message);
      },
      (status) => {
        statusRef.current?.(status);
      }
    );

    return () => {
      socket.close();
    };
  }, []);
}