import { useId } from "react";
import { Globe } from "lucide-react";
import { track } from "@/lib/analytics";
import { BOAT_OFFER, boatOfferRuns } from "@/lib/boat-offer";
import { brandStatus } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { LinkButton, NoticeCard, NotNowButton, PRIMARY_BUTTON } from "./NoticeCard";

export type BoatOfferAction = "get_boat" | "not_now" | "close";
type BoatOfferPlace = "card" | "settings";

export function reportBoatOffer(action: BoatOfferAction | "shown", place: BoatOfferPlace) {
  track("boat_offer", { action, place });
}

function BoatOfferWords() {
  return <>
    <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">{t("boatOffer.body")}</p>
  </>;
}

export function BoatOfferCard({ onDone }: { onDone: (action: BoatOfferAction) => void }) {
  return <NoticeCard titleId="boat-offer-title" notice="boat-offer" icon={Globe} title={t("boatOffer.title")} onDismiss={() => onDone("close")}>
    <BoatOfferWords />
    <div className="mt-3 flex flex-col gap-2">
      <LinkButton url={BOAT_OFFER.url} label={t("boatOffer.get")} className={cn(PRIMARY_BUTTON, "w-full")} onOpened={() => onDone("get_boat")} />
      <NotNowButton onClick={() => onDone("not_now")} />
    </div>
  </NoticeCard>;
}

export function BoatOfferPanel() {
  const titleId = useId();
  if (!boatOfferRuns(Date.now()) || brandStatus().source === "file") return null;
  return <section data-boat-offer aria-labelledby={titleId} className="rounded-lg bg-ink/[0.04] p-3">
    <h3 id={titleId} className="flex items-center gap-1.5 text-[13px] font-semibold leading-[18px] text-ink">
      <Globe size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />{t("boatOffer.title")}
    </h3>
    <BoatOfferWords />
    <div className="mt-3 flex flex-wrap items-start gap-2">
      <LinkButton url={BOAT_OFFER.url} label={t("boatOffer.get")} onOpened={() => reportBoatOffer("get_boat", "settings")} />
    </div>
  </section>;
}
