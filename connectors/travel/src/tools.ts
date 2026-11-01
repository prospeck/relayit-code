import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TravelProvider } from "./provider.ts";

const text = z.string().trim().min(1);
const stationSchema = z.object({ query: text });
const travelClass = z.enum(["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S"]);
const quota = z.enum(["GN", "TQ", "LD", "SS", "PT"]);
const date = z.iso.date();
export const trainSchema = z.object({
  from: text,
  to: text,
  date,
  travelClass: travelClass.optional(),
  quota: quota.optional(),
});
export const handoffSchema = trainSchema.extend({
  trainNo: z.string().regex(/^\d{5}$/),
  travelClass,
  quota,
});
const metroSchema = z.object({ from: text, to: text });
const cabSchema = z.object({ pickup: text, drop: text });
export const resolveStation = (p: TravelProvider, input: { query: string }) =>
  p.resolveStation(stationSchema.parse(input).query);
export const findTrains = (p: TravelProvider, input: z.infer<typeof trainSchema>) =>
  p.findTrains(trainSchema.parse(input));
export const irctcBookingHandoff = (p: TravelProvider, input: z.infer<typeof handoffSchema>) =>
  p.irctcBookingHandoff(handoffSchema.parse(input));
export const metroRoute = (p: TravelProvider, input: z.infer<typeof metroSchema>) => {
  const args = metroSchema.parse(input);
  return p.metroRoute(args.from, args.to);
};
export const cabHandoff = (p: TravelProvider, input: z.infer<typeof cabSchema>) => {
  const args = cabSchema.parse(input);
  return p.cabHandoff(args.pickup, args.drop);
};
async function result(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        },
      ],
    };
  }
}
const meta = (service: string, label: string) => ({
  "relayit/class": "read",
  "relayit/service": service,
  "relayit/label": label,
});
export function registerTools(server: McpServer, provider: TravelProvider) {
  server.registerTool(
    "resolve_station",
    {
      description: "Find major Indian railway stations by name, alias or code.",
      inputSchema: stationSchema,
      _meta: meta("IRCTC", "Finding stations"),
    },
    (input) => result(() => resolveStation(provider, input)),
  );
  server.registerTool(
    "find_trains",
    {
      description:
        "Find trains (demo timetable, fares and availability — verify on IRCTC). City names include local terminals. Defaults to 3A, GN. A remembered class is a preference: if classUnavailable is true, offer the returned availableClasses as one quick-reply question and search again with the chosen class. Then hand off with irctc_booking_handoff.",
      inputSchema: trainSchema,
      _meta: meta("IRCTC", "Checking trains"),
    },
    (input) => result(() => findTrains(provider, input)),
  );
  server.registerTool(
    "irctc_booking_handoff",
    {
      description: "Get instructions and a link to book yourself on IRCTC. Does not book a ticket.",
      inputSchema: handoffSchema,
      _meta: meta("IRCTC", "Opening IRCTC booking"),
    },
    (input) => result(() => irctcBookingHandoff(provider, input)),
  );
  server.registerTool(
    "metro_route",
    {
      description: "Plan a demo Namma Metro route with estimated time and token fare.",
      inputSchema: metroSchema,
      _meta: meta("Namma Metro", "Planning metro route"),
    },
    (input) => result(() => metroRoute(provider, input)),
  );
  server.registerTool(
    "cab_handoff",
    {
      description: "Open Uber with pickup and drop filled in. No booking or fare estimate.",
      inputSchema: cabSchema,
      _meta: meta("Uber", "Opening Uber"),
    },
    (input) => result(() => cabHandoff(provider, input)),
  );
}
