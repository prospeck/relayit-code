export interface BoatOffer {
  url: string;
  until: number | null;
}

export const BOAT_OFFER: BoatOffer = {
  url: "https://boat.dev",
  until: null,
};

export function boatOfferRuns(now: number, offer: BoatOffer = BOAT_OFFER): boolean {
  return offer.until === null || now < offer.until;
}
