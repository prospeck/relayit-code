export type Station = { code: string; name: string; city: string; aliases: string[] };
export type TravelClass = "1A" | "2A" | "3A" | "3E" | "SL" | "CC" | "EC" | "2S";
export type Quota = "GN" | "TQ" | "LD" | "SS" | "PT";
export type TrainInput = {
  from: string;
  to: string;
  date: string;
  travelClass?: TravelClass;
  quota?: Quota;
};
export type HandoffInput = TrainInput & { trainNo: string; travelClass: TravelClass; quota: Quota };
export type Train = {
  trainNo: string;
  name: string;
  from: string;
  to: string;
  via?: string[];
  runningDays: number[];
  departure: string;
  arrival: string;
  durationMin: number;
  classes: Partial<Record<TravelClass, number>>;
};
export type TrainResult = Train & {
  availability: Partial<Record<TravelClass, string>>;
  recommended: boolean;
};
export type LinkPart = { type: "link"; url: string; title: string; subtitle?: string };
export type TrainSearch = {
  dataSource: string;
  from: Station;
  to: Station;
  date: string;
  travelClass: TravelClass;
  quota: Quota;
  trains: TrainResult[];
  /** Classes running on this route and day, whatever was requested. */
  availableClasses: TravelClass[];
  /** True when trains run on this route but none in the requested class. */
  classUnavailable: boolean;
};
export type MetroRoute = {
  dataSource: string;
  from: string;
  to: string;
  lines: string[];
  interchange: string[];
  stations: string[];
  numberOfStops: number;
  estimatedTimeMin: number;
  estimatedTokenFareInr: number;
  fareLabel: string;
  _parts: LinkPart[];
};
export type BookingHandoff = {
  dataSource: string;
  booked: false;
  trainNo: string;
  name: string;
  from: Station;
  to: Station;
  date: string;
  travelClass: TravelClass;
  quota: Quota;
  boardingStation: Station;
  instructions: string[];
  url: string;
  _parts: LinkPart[];
};
export type CabHandoff = {
  service: "Uber";
  pickup: string;
  drop: string;
  url: string;
  _parts: LinkPart[];
};
export interface TravelProvider {
  resolveStation(query: string): Promise<Station[]>;
  findTrains(input: TrainInput): Promise<TrainSearch>;
  irctcBookingHandoff(input: HandoffInput): Promise<BookingHandoff>;
  metroRoute(from: string, to: string): Promise<MetroRoute>;
  cabHandoff(pickup: string, drop: string): Promise<CabHandoff>;
}
