// Historical connected-app event record shapes; no broker transport is shipped.
import { z } from "zod";

export interface BrokerAccess {
  url: string;
  token: string;
}

export class BrokerError extends Error {
  readonly status: number;
  readonly retryAfterS?: number;

  constructor(message: string, status: number, retryAfterS?: number) {
    super(message);
    this.status = status;
    this.retryAfterS = retryAfterS;
  }

  /** The service or the network failed; the same call can work later. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

const triggerTypeSchema = z.object({
  slug: z.string(),
  toolkit: z.string(),
  name: z.string(),
  description: z.string().default(""),
  instructions: z.string().optional(),
  type: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type BrokerTriggerType = z.infer<typeof triggerTypeSchema>;



const dropSchema = z.object({ count: z.number(), lastAt: z.number() });
const bindingSchema = z.object({
  triggerId: z.string(),
  slug: z.string(),
  toolkit: z.string(),
  connectedAccountId: z.string(),
  enabled: z.boolean(),
  remote: z.object({ state: z.enum(["enabled", "disabled", "missing"]), config: z.record(z.string(), z.unknown()).optional() }).nullable(),
  dropped: z.record(z.string(), dropSchema).default({}),
});
const inventorySchema = z.object({
  triggers: z.array(bindingSchema),
  unbound: z.array(z.object({ triggerId: z.string(), enabled: z.boolean() })).nullable(),
  remoteError: z.string().optional(),
  limits: z.object({ plan: z.enum(["desktop", "cloud"]), eventsPerDay: z.number() }),
  usage: z.object({ eventsToday: z.number() }),
});
export type BrokerInventory = z.infer<typeof inventorySchema>;

const brokerEventSchema = z.object({
  seq: z.number(),
  id: z.string(),
  kind: z.enum(["message", "test", "trigger_disabled", "account_expired"]),
  triggerId: z.string().nullable(),
  receivedAt: z.number(),
  event: z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
});
export type BrokerEvent = z.infer<typeof brokerEventSchema>;


export interface AppTriggerBroker {
  triggerTypes(apps: string[]): Promise<Record<string, { types?: BrokerTriggerType[]; error?: string }>>;
  triggerType(slug: string): Promise<BrokerTriggerType | null>;
  create(input: { slug: string; connectedAccountId: string; config: Record<string, unknown> }): Promise<{ triggerId: string }>;
  setEnabled(triggerId: string, enabled: boolean): Promise<void>;
  remove(triggerId: string): Promise<void>;
  inventory(): Promise<BrokerInventory>;
  poll(input: { after: number; waitS: number; poller: string; signal?: AbortSignal }): Promise<{ events: BrokerEvent[]; cursor: number }>;
  testEvent(triggerId: string, data: Record<string, unknown>): Promise<void>;
}



/** `access` is read on every call: the desktop hands the token over after the server starts, and a Cloud registers late. */
