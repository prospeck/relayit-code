import { EventEmitter } from "node:events";
import type { ServerEvent } from "@relayit/shared";

/** In-process event bus. The WebSocket layer forwards every event to connected UIs. */
export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(100);
  }
  emit(event: ServerEvent): void {
    this.emitter.emit("event", event);
  }
  on(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
