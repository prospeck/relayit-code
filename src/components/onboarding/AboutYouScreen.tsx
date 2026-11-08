// The first run's second screen: who RelayIt works for and where. A name to greet you by, the city it searches in,
// and the two addresses it delivers to and books cabs from. Each one is optional; all of it stays on this computer, in
// "About me", where you can change it any time.
import { useState, type FormEvent } from "react";
import { MapPin } from "lucide-react";

import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { PILL } from "./SignInPill";

export const INDIAN_CITIES = [
  "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Kochi",
  "Chandigarh", "Lucknow", "Indore", "Mysuru", "Gurugram", "Noida", "Coimbatore", "Visakhapatnam", "Bhubaneswar", "Goa",
];

const LINES = { city: "City", home: "Home address", work: "Work address" } as const;
type Line = keyof typeof LINES;

/** "About me" with its City, Home address and Work address lines replaced by `values`; other lines stay as written. */
export function withPlaces(aboutMe: string, values: Partial<Record<Line, string>>): string {
  const labels = new Set(Object.values(LINES).map((label) => `${label}:`));
  const kept = aboutMe.split("\n").filter((line) => ![...labels].some((label) => line.startsWith(label)));
  const added = (Object.keys(LINES) as Line[]).flatMap((key) => {
    const value = values[key]?.trim().replace(/\s+/g, " ");
    return value ? [`${LINES[key]}: ${value}`] : [];
  });
  return [...added, ...kept].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The values "About me" already holds for each line, so a replay shows what was saved. */
export function placesIn(aboutMe: string | undefined): Record<Line, string> {
  const lines = (aboutMe ?? "").split("\n");
  const find = (label: string) => lines.find((line) => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
  return { city: find(LINES.city), home: find(LINES.home), work: find(LINES.work) };
}

const FIELD = "h-11 w-full rounded-xl border border-hairline/70 bg-composer px-3.5 text-[15px] text-ink placeholder:text-ink-tertiary focus:border-ink/40 focus:outline-none";

export function AboutYouScreen({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const saved = placesIn(state.config?.profile?.aboutMe);
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [city, setCity] = useState(saved.city);
  const [home, setHome] = useState(saved.home);
  const [work, setWork] = useState(saved.work);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const profile: { aboutMe?: string } = state.config?.profile ?? {};
    const aboutMe = withPlaces(profile.aboutMe ?? "", { city, home, work });
    try {
      const config = await api<NonNullable<typeof state.config>>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ profile: { ...profile, name: name.trim(), aboutMe } }),
        signal: AbortSignal.timeout(10_000),
      });
      dispatch({ type: "configStatus", config });
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} data-about-you="" className="mx-auto flex min-h-full w-full max-w-[440px] flex-col justify-center px-6 py-12 text-left">
      <h1 id="welcome-title" className="font-display text-[28px] font-semibold leading-[34px] tracking-[-0.02em] text-ink">{t("onboarding.about.title")}</h1>
      <p className="mt-2 text-[14px] leading-[21px] text-ink-secondary">{t("onboarding.about.subtitle")}</p>

      <label className="mt-7 block text-[13px] font-medium text-ink" htmlFor="about-name">{t("onboarding.about.name")}</label>
      <input id="about-name" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
        placeholder={t("onboarding.about.namePlaceholder")} className={`${FIELD} mt-1.5`} autoFocus />

      <label className="mt-4 block text-[13px] font-medium text-ink" htmlFor="about-city">{t("onboarding.about.city")}</label>
      <input id="about-city" list="about-cities" autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80}
        placeholder="Bengaluru" className={`${FIELD} mt-1.5`} />
      <datalist id="about-cities">{INDIAN_CITIES.map((name) => <option key={name} value={name} />)}</datalist>

      <fieldset className="mt-4">
        <legend className="flex items-center gap-1.5 text-[13px] font-medium text-ink"><MapPin size={14} aria-hidden="true" />{t("onboarding.about.places")}</legend>
        <label className="sr-only" htmlFor="about-home">{t("onboarding.about.home")}</label>
        <input id="about-home" autoComplete="street-address" value={home} onChange={(event) => setHome(event.target.value)} maxLength={240}
          placeholder={t("onboarding.about.homePlaceholder")} className={`${FIELD} mt-1.5`} />
        <label className="sr-only" htmlFor="about-work">{t("onboarding.about.work")}</label>
        <input id="about-work" value={work} onChange={(event) => setWork(event.target.value)} maxLength={240}
          placeholder={t("onboarding.about.workPlaceholder")} className={`${FIELD} mt-2`} />
      </fieldset>
      <p className="mt-3 text-[12px] leading-[17px] text-ink-tertiary">{t("onboarding.about.private")}</p>

      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <div className="mt-7 flex flex-col items-center gap-3">
        <button type="submit" data-primary="" disabled={saving} className={PILL}>{t("onboarding.about.go")}</button>
        <button type="button" onClick={onDone} className="rounded text-[13px] text-ink-secondary hover:text-ink">{t("onboarding.about.skip")}</button>
      </div>
    </form>
  );
}
