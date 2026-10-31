import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockTravelProvider, availability } from "../src/mock/provider.ts";
import { stations } from "../src/mock/stations.ts";
import { trains } from "../src/mock/trains.ts";
import { createServer } from "../src/server.ts";
import { findTrains, irctcBookingHandoff, metroRoute, cabHandoff } from "../src/tools.ts";

const provider = new MockTravelProvider();
describe("rail stations", () => {
  it.each([
    ["SBC", "SBC"],
    ["bangalore", "SBC"],
    ["bengaluru", "SBC"],
    ["madras", "MAS"],
    ["bombay", "CSMT"],
    ["yeshwanthpur", "YPR"],
    ["chennai centrl", "MAS"],
  ])("resolves %s", async (query, code) => {
    expect((await provider.resolveStation(query))[0]?.code).toBe(code);
  });
  it("has around 60 stations and no unknown codes in the timetable", () => {
    expect(stations.length).toBeGreaterThanOrEqual(60);
    expect(stations.length).toBeLessThanOrEqual(65);
    expect(trains).toHaveLength(25);
    for (const train of trains) {
      for (const code of [train.from, train.to, ...(train.via ?? [])])
        expect(stations.some((s) => s.code === code)).toBe(true);
    }
  });
  it("returns no fabricated match for an unknown station", async () => {
    expect(await provider.resolveStation("zzzzzzzzzz")).toEqual([]);
    await expect(
      provider.findTrains({ from: "zzzzzzzzzz", to: "MAS", date: "2026-11-02" }),
    ).rejects.toThrow("Unknown station");
  });
});
it("returns deterministic dated availability and a recommendation, sorted by departure", async () => {
  const input = {
    from: "Bengaluru",
    to: "Madras",
    date: "2026-11-02",
    travelClass: "CC" as const,
    quota: "GN" as const,
  };
  const a = await findTrains(provider, input);
  expect(a).toEqual(await findTrains(provider, input));
  expect(a.dataSource).toBe("demo timetable — verify on IRCTC");
  expect(a.trains.length).toBeGreaterThan(1);
  expect(a.trains.map((t) => t.departure)).toEqual(a.trains.map((t) => t.departure).sort());
  expect(a.trains.filter((t) => t.recommended)).toHaveLength(1);
  const rank = (s: string) =>
    s.startsWith("AVAILABLE") ? 0 : s.startsWith("RAC") ? 1 : s.startsWith("WL") ? 2 : 3;
  const best = [...a.trains].sort(
    (x, y) =>
      rank(x.availability.CC!) - rank(y.availability.CC!) ||
      x.durationMin - y.durationMin ||
      x.departure.localeCompare(y.departure),
  )[0]!;
  expect(best.recommended).toBe(true);
  for (const train of a.trains)
    expect(train.availability.CC).toMatch(/^(AVAILABLE-\d{4}|RAC \d+|WL \d+|REGRET)$/);
  expect(availability("12028", "2026-11-02", "CC")).toBe(availability("12028", "2026-11-02", "CC"));
  const later = await findTrains(provider, { ...input, date: "2026-11-09" });
  expect(later.trains.map((t) => t.availability.CC)).not.toEqual(
    a.trains.map((t) => t.availability.CC),
  );
});
it("honours explicit station codes, running days and class", async () => {
  const monday = await provider.findTrains({
    from: "SBC",
    to: "MAS",
    date: "2026-11-02",
    travelClass: "CC",
  });
  expect(monday.trains.some((t) => t.trainNo === "12028")).toBe(true);
  expect(
    monday.trains.every((t) => t.from === "SBC" && t.to === "MAS" && t.classes.CC !== undefined),
  ).toBe(true);
  const tuesday = await provider.findTrains({
    from: "SBC",
    to: "MAS",
    date: "2026-11-03",
    travelClass: "CC",
  });
  expect(tuesday.trains.some((t) => t.trainNo === "12028")).toBe(false);
  expect(
    (await provider.findTrains({ from: "SBC", to: "MAS", date: "2026-11-02", travelClass: "1A" }))
      .trains,
  ).toEqual([]);
  expect(
    (
      await provider.findTrains({
        from: "Bengaluru",
        to: "Hyderabad",
        date: "2026-11-02",
        travelClass: "CC",
      })
    ).trains.some((t) => t.trainNo === "20704"),
  ).toBe(true);
});
it.each(["2026-02-30", "2026-13-01", "02-11-2026"])("rejects invalid date %s", async (date) => {
  expect(() => findTrains(provider, { from: "SBC", to: "MAS", date })).toThrow();
});
it("hands off exact booking instructions and the official IRCTC link", async () => {
  const result = await irctcBookingHandoff(provider, {
    trainNo: "12028",
    from: "bangalore",
    to: "madras",
    date: "2026-11-02",
    travelClass: "CC",
    quota: "TQ",
  });
  expect(result.booked).toBe(false);
  expect(result.boardingStation.code).toBe("SBC");
  expect(result.instructions.join(" ")).toContain("class CC, quota TQ");
  expect(result._parts[0]).toEqual({
    type: "link",
    url: "https://www.irctc.co.in/nget/train-search",
    title: "Book on IRCTC",
    subtitle: "12028 Chennai Shatabdi Express · CC · TQ · 2026-11-02",
  });
  expect(new URL(result.url).protocol).toBe("https:");
  await expect(
    provider.irctcBookingHandoff({
      trainNo: "99999",
      from: "SBC",
      to: "MAS",
      date: "2026-11-02",
      travelClass: "CC",
      quota: "GN",
    }),
  ).rejects.toThrow("not in the demo timetable");
});
it("routes Purple to Green at Majestic and Green to Yellow at RV Road", async () => {
  const route = await metroRoute(provider, { from: "Indiranagr", to: "Electronic City" });
  expect(route.lines).toEqual(["Purple", "Green", "Yellow"]);
  expect(route.interchange).toEqual([
    "Nadaprabhu Kempegowda Station Majestic",
    "Rashtreeya Vidyalaya Road",
  ]);
  expect(route.numberOfStops).toBe(route.stations.length - 1);
  expect(route.numberOfStops).toBe(25);
  expect(route.estimatedTimeMin).toBe(65);
  expect(route.estimatedTokenFareInr).toBe(90);
  expect(route.fareLabel).toContain("Estimate");
  expect(route._parts[0]).toEqual({
    type: "link",
    url: "https://english.bmrc.co.in/",
    title: "Buy ticket (official)",
  });
});
it("handles reverse, direct, same-station, alias and unknown metro routes", async () => {
  const forward = await provider.metroRoute("Indiranagar", "Electronic City");
  const reverse = await provider.metroRoute("Electronic City", "Indiranagar");
  expect(reverse.stations).toEqual([...forward.stations].reverse());
  const direct = await provider.metroRoute("MG Road", "Indiranagar");
  expect(direct.lines).toEqual(["Purple"]);
  expect(direct.numberOfStops).toBe(3);
  expect(direct.interchange).toEqual([]);
  const same = await provider.metroRoute("rv road", "Rashtreeya Vidyalaya Road");
  expect(same.numberOfStops).toBe(0);
  expect(same.estimatedTimeMin).toBe(0);
  expect(same.estimatedTokenFareInr).toBe(0);
  expect((await provider.metroRoute("Majestic", "rv road")).lines).toEqual(["Green"]);
  await expect(provider.metroRoute("nonexistent", "Majestic")).rejects.toThrow(
    "Unknown metro station",
  );
});
it("builds safe Uber universal links for current and explicit pickup without fare guesses", async () => {
  for (const pickup of ["current location", "MG Road & 1st Cross, Bengaluru"]) {
    const result = await cabHandoff(provider, { pickup, drop: "Airport, Gate 2 & arrivals #1" });
    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe("https://m.uber.com/ul/");
    expect(url.searchParams.get("action")).toBe("setPickup");
    expect(url.searchParams.get("dropoff[formatted_address]")).toBe(
      "Airport, Gate 2 & arrivals #1",
    );
    expect(
      url.searchParams.get(pickup === "current location" ? "pickup" : "pickup[formatted_address]"),
    ).toBe(pickup === "current location" ? "my_location" : pickup);
    expect(result._parts[0]?.url).toBe(result.url);
    expect(result).not.toHaveProperty("fare");
  }
});
it("exposes read-only MCP tools with service metadata and JSON errors", async () => {
  const server = createServer(provider);
  const client = new Client({ name: "travel-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool._meta?.["relayit/class"]).toBe("read");
      expect(["IRCTC", "Namma Metro", "Uber"]).toContain(tool._meta?.["relayit/service"]);
    }
    const result = await client.callTool({
      name: "cab_handoff",
      arguments: { pickup: "current location", drop: "MG Road" },
    });
    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).service).toBe("Uber");
    const error = await client.callTool({
      name: "metro_route",
      arguments: { from: "nowhere", to: "MG Road" },
    });
    expect(error.isError).toBe(true);
    expect(JSON.parse((error.content as { text: string }[])[0]!.text).error).toContain(
      "Unknown metro station",
    );
  } finally {
    await client.close();
    await server.close();
  }
});
