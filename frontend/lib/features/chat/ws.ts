import type { WorkflowTraceEventData } from "./workflowTypes";

export type WSEventType =
  | "chunk"
  | "builder_think"
  | "plan_created"
  | "done"
  | "error"
  | "pong"
  | "session_renamed"
  | "stop_result"
  | "workflow_started"
  | "workflow_node_updated"
  | "workflow_completed"
  | "workflow_failed"
  | "workflow_stopped"
  | "workflow_presentation_prompt";

export interface WSPlanEvent {
  plan_id: string;
  orchestration: string;
  agents: { id: string; role: string; goal: string; tools: string[] }[];
}

export interface WSEventData {
  type: WSEventType;
  run_id?: string;
  chunk?: string;
  agent_id?: string;
  session_id?: string;
  plan_created?: WSPlanEvent;
  error?: string;
  title?: string;
  data?: WorkflowTraceEventData;
  stop_result?: {
    execution_session_id: string;
    run_id: string;
    status: string;
    message?: string;
  };
  presentation_prompt?: {
    prompt_id: string;
    question: string;
    original_message: string;
  };
}

export interface WSMessage {
  type: string;
  session_id?: string;
  execution_session_id?: string;
  run_id?: string;
  message?: string;
  target_agent_id?: string;
  presentation_mode?: string;
}

type EventHandler = (event: WSEventData) => void;
type CloseHandler = (wasIntentional: boolean) => void;

const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onEvent: EventHandler;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyClosed = false;
  public onReconnectFailed: (() => void) | null = null;
  public onClose: CloseHandler | null = null;

  // Maximum reconnect attempts before giving up (for fallback logic)
  private maxReconnectAttempts = 5;

  constructor(url: string, onEvent: EventHandler) {
    this.url = url;
    this.onEvent = onEvent;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.reconnectAttempts = 0;
    this._connect();
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data: WSEventData = JSON.parse(event.data as string);
        this.onEvent(data);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.onClose?.(this.intentionallyClosed);
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.onReconnectFailed?.();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    this.reconnectTimer = setTimeout(() => {
      this._connect();
    }, delay);
  }
}

/**
 * Creates a WebSocket client for the primary backend only.
 * Fallbacks are intentionally disabled so the UI does not bypass the
 * hardened backend auth boundary.
 */
export function createClientWithFallback(
  primaryUrl: string,
  onEvent: EventHandler,
): WebSocketClient {
  return new WebSocketClient(primaryUrl, onEvent);
}
