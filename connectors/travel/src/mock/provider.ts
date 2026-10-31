import type {
  BookingHandoff,
  CabHandoff,
  HandoffInput,
  MetroRoute,
  Station,
  TrainInput,
  TrainSearch,
  TravelClass,
  TravelProvider,
} from "../provider.ts";
import { stations } from "./stations.ts";
import { trains } from "./trains.ts";
import { fareSlabs, metroAliases, metroLines } from "./metro.ts";

const dataSource = "demo timetable — verify on IRCTC";
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(row[j + 1]! + 1, next[j]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
function score(query: string, value: string) {
  const text = normalise(value);
  if (text === query) return 100;
  if (text.includes(query)) return 70;
  if (query.length >= 4 && editDistance(query, text) <= 2) return 40;
  if (
    query.length >= 4 &&
    query
      .split(" ")
      .every((q) =>
        text.split(" ").some((w) => w === q || (q.length >= 4 && editDistance(q, w) <= 1)),
      )
  )
    return 30;
  return 0;
}
export function validateDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error("Invalid calendar date");
  return parsed;
}
export function availability(trainNo: string, date: string, travelClass: TravelClass): string {
  let seed = 2166136261;
  for (const c of `${trainNo}:${date}:${travelClass}`)
    seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const value = seed % 100;
  if (value < 60) return `AVAILABLE-${String(1 + (seed % 180)).padStart(4, "0")}`;
  if (value < 78) return `RAC ${1 + (seed % 30)}`;
  if (value < 96) return `WL ${1 + (seed % 80)}`;
  return "REGRET";
}
const rank = (s: string) =>
  s.startsWith("AVAILABLE") ? 0 : s.startsWith("RAC") ? 1 : s.startsWith("WL") ? 2 : 3;
export class MockTravelProvider implements TravelProvider {
  async resolveStation(query: string): Promise<Station[]> {
    const q = normalise(query);
    if (!q) throw new Error("Enter a station name or code");
    return stations
      .map((station) => ({
        station,
        score:
          station.code.toLowerCase() === q
            ? 200
            : Math.max(...[station.name, ...station.aliases].map((s) => score(q, s))),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.station.code.localeCompare(b.station.code))
      .slice(0, 8)
      .map((s) => structuredClone(s.station));
  }
  private async endpoints(query: string) {
    const matches = await this.resolveStation(query);
    const best = matches[0];
    if (!best) throw new Error(`Unknown station: ${query}`);
    // A city query includes local terminals; an explicit code or station name stays precise.
    const cityAliases: Record<string, string> = {
      bangalore: "bengaluru",
      madras: "chennai",
      bombay: "mumbai",
      cochin: "kochi",
      trivandrum: "thiruvananthapuram",
      mysore: "mysuru",
    };
    const q = normalise(query);
    const cityQuery = (cityAliases[q] ?? q) === normalise(best.city);
    return {
      best,
      codes: cityQuery
        ? stations.filter((s) => s.city === best.city).map((s) => s.code)
        : [best.code],
    };
  }
  async findTrains(input: TrainInput): Promise<TrainSearch> {
    const day = validateDate(input.date).getUTCDay();
    const from = await this.endpoints(input.from);
    const to = await this.endpoints(input.to);
    const travelClass = input.travelClass ?? "3A";
    const quota = input.quota ?? "GN";
    const results = trains
      .filter(
        (t) =>
          from.codes.includes(t.from) &&
          to.codes.includes(t.to) &&
          t.runningDays.includes(day) &&
          t.classes[travelClass] !== undefined,
      )
      .map((t) => ({
        ...structuredClone(t),
        availability: Object.fromEntries(
          (Object.keys(t.classes) as TravelClass[]).map((c) => [
            c,
            availability(t.trainNo, input.date, c),
          ]),
        ),
        recommended: false,
      }));
    const best = [...results].sort(
      (a, b) =>
        rank(a.availability[travelClass]!) - rank(b.availability[travelClass]!) ||
        a.durationMin - b.durationMin ||
        a.departure.localeCompare(b.departure),
    )[0];
    if (best) best.recommended = true;
    return {
      dataSource,
      from: from.best,
      to: to.best,
      date: input.date,
      travelClass,
      quota,
      trains: results.sort((a, b) => a.departure.localeCompare(b.departure)),
    };
  }
  async irctcBookingHandoff(input: HandoffInput): Promise<BookingHandoff> {
    const found = await this.findTrains(input);
    const train = found.trains.find((t) => t.trainNo === input.trainNo);
    if (!train)
      throw new Error(
        "Train is not in the demo timetable for this route, date and class; verify on IRCTC",
      );
    const from = stations.find((s) => s.code === train.from)!;
    const to = stations.find((s) => s.code === train.to)!;
    const url = "https://www.irctc.co.in/nget/train-search";
    return {
      dataSource,
      booked: false,
      trainNo: train.trainNo,
      name: train.name,
      from,
      to,
      date: input.date,
      travelClass: input.travelClass,
      quota: input.quota,
      boardingStation: from,
      instructions: [
        `Open IRCTC and sign in yourself. Search ${from.name} (${from.code}) to ${to.name} (${to.code}) for ${input.date}.`,
        `Select train ${train.trainNo} ${train.name}, class ${input.travelClass}, quota ${input.quota}.`,
        `Set boarding station to ${from.name} (${from.code}). Verify the live schedule, eligibility, availability and fare.`,
        "Enter passenger details and complete payment on IRCTC. RelayIt has not booked a ticket.",
      ],
      url,
      _parts: [
        {
          type: "link",
          url,
          title: "Book on IRCTC",
          subtitle: `${train.trainNo} ${train.name} · ${input.travelClass} · ${input.quota} · ${input.date}`,
        },
      ],
    };
  }
  private metroStation(query: string): string {
    const q = normalise(query);
    if (!q) throw new Error("Enter a metro station");
    if (Object.hasOwn(metroAliases, q)) return metroAliases[q]!;
    const matches = [...new Set(Object.values(metroLines).flat())]
      .map((name) => ({ name, score: score(q, name) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!matches[0]) throw new Error(`Unknown metro station: ${query}`);
    if (matches[1]?.score === matches[0].score)
      throw new Error(
        `Ambiguous metro station: ${query}. Try ${matches
          .slice(0, 3)
          .map((m) => m.name)
          .join(", ")}`,
      );
    return matches[0].name;
  }
  async metroRoute(fromQuery: string, toQuery: string): Promise<MetroRoute> {
    const from = this.metroStation(fromQuery);
    const to = this.metroStation(toQuery);
    type Path = {
      station: string;
      line: string;
      cost: number;
      stations: string[];
      lines: string[];
      interchange: string[];
    };
    const queue: Path[] = Object.entries(metroLines)
      .filter(([, stops]) => stops.includes(from))
      .map(([line]) => ({
        station: from,
        line,
        cost: 0,
        stations: [from],
        lines: [line],
        interchange: [],
      }));
    const visited = new Set<string>();
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const path = queue.shift()!;
      const key = `${path.line}:${path.station}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (path.station === to) {
        const numberOfStops = path.stations.length - 1;
        const distanceKm = numberOfStops * 1.1;
        return {
          dataSource: "demo metro map — verify on BMRCL",
          from,
          to,
          lines: path.lines,
          interchange: path.interchange,
          stations: path.stations,
          numberOfStops,
          estimatedTimeMin:
            Math.round((numberOfStops * 2.2 + path.interchange.length * 5) * 10) / 10,
          estimatedTokenFareInr:
            numberOfStops === 0 ? 0 : fareSlabs.find((s) => distanceKm <= s.maxKm)!.fare,
          fareLabel:
            "Estimate using 1.1 km per stop and demo distance slabs; verify the current token fare on BMRCL.",
          _parts: [
            { type: "link", url: "https://english.bmrc.co.in/", title: "Buy ticket (official)" },
          ],
        };
      }
      const stops = metroLines[path.line]!;
      const index = stops.indexOf(path.station);
      for (const station of [stops[index - 1], stops[index + 1]])
        if (station)
          queue.push({
            ...path,
            station,
            cost: path.cost + 2.2,
            stations: [...path.stations, station],
          });
      for (const [line, stations] of Object.entries(metroLines))
        if (line !== path.line && stations.includes(path.station))
          queue.push({
            ...path,
            line,
            cost: path.cost + 5,
            lines: [...path.lines, line],
            interchange: [...path.interchange, path.station],
          });
    }
    throw new Error("No route in the demo metro map");
  }
  async cabHandoff(pickup: string, drop: string): Promise<CabHandoff> {
    if (!pickup.trim() || !drop.trim()) throw new Error("Pickup and drop are required");
    const url = new URL("https://m.uber.com/ul/");
    url.searchParams.set("action", "setPickup");
    url.searchParams.set(
      normalise(pickup) === "current location" ? "pickup" : "pickup[formatted_address]",
      normalise(pickup) === "current location" ? "my_location" : pickup.trim(),
    );
    url.searchParams.set("dropoff[formatted_address]", drop.trim());
    return {
      service: "Uber",
      pickup: pickup.trim(),
      drop: drop.trim(),
      url: url.href,
      _parts: [
        {
          type: "link",
          url: url.href,
          title: "Continue in Uber",
          subtitle: `${pickup.trim()} → ${drop.trim()}`,
        },
      ],
    };
  }
}
