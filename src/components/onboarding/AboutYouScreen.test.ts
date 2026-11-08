import { describe, expect, it } from "vitest";
import { placesIn, withPlaces } from "./AboutYouScreen";

describe("where RelayIt works for you", () => {
  it("writes city and addresses as their own lines at the top of About me, keeping the rest", () => {
    const about = withPlaces("Vegetarian.\nCity: Pune", { city: "Bengaluru", home: " 12th Main,   Indiranagar ", work: "" });
    expect(about).toBe("City: Bengaluru\nHome address: 12th Main, Indiranagar\nVegetarian.");
  });

  it("reads them back for a replay", () => {
    expect(placesIn("City: Bengaluru\nWork address: MG Road\nLikes tea")).toEqual({ city: "Bengaluru", home: "", work: "MG Road" });
    expect(placesIn(undefined)).toEqual({ city: "", home: "", work: "" });
  });
});
