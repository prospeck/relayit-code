export type SiteRecipe = {
  id: string;
  name: string;
  hosts: readonly string[];
  homeUrl: string;
  loginUrl: string;
  /** Replace {query} with encodeURIComponent(searchTerm). */
  searchUrlTemplate?: string;
  loggedInSelectors: readonly string[];
  loggedInText: string;
  playbook: string;
};

/** Best-effort hints only. Sites change; inspect a fresh snapshot before acting. */
export const RECIPES: readonly SiteRecipe[] = [
  {
    id: "swiggy",
    name: "Swiggy",
    hosts: ["swiggy.com"],
    homeUrl: "https://www.swiggy.com/",
    loginUrl: "https://www.swiggy.com/",
    searchUrlTemplate: "https://www.swiggy.com/search?query={query}",
    loggedInSelectors: ['a[href*="/my-account"]', '[aria-label="My account"]'],
    loggedInText: "\\b(?:logout|log out|my account)\\b",
    playbook:
      "On Swiggy (best-effort): search the restaurant, open it, add items with ADD, open cart and set the address. Use browser_submit on Proceed to Pay. Payment is always handed to the user; login and OTP are user-only.",
  },
  {
    id: "zomato",
    name: "Zomato",
    hosts: ["zomato.com"],
    homeUrl: "https://www.zomato.com/",
    loginUrl: "https://www.zomato.com/",
    searchUrlTemplate: "https://www.zomato.com/search?q={query}",
    loggedInSelectors: ['a[href*="/users/"]', '[aria-label="Profile"]'],
    loggedInText: "\\b(?:logout|log out|your profile)\\b",
    playbook:
      "On Zomato (best-effort): set the location, search and open a restaurant, choose items and review the cart. Use browser_submit for checkout or placing an order. Hand payment and login steps to the user.",
  },
  {
    id: "zepto",
    name: "Zepto",
    hosts: ["zeptonow.com", "zepto.com"],
    homeUrl: "https://www.zeptonow.com/",
    loginUrl: "https://www.zeptonow.com/",
    searchUrlTemplate: "https://www.zeptonow.com/search?query={query}",
    loggedInSelectors: ['a[href*="/account"]', '[aria-label="Profile"]'],
    loggedInText: "\\b(?:logout|log out|my account)\\b",
    playbook:
      "On Zepto (best-effort): choose delivery location, search products, add quantities and inspect the cart. Use browser_submit for checkout. The user completes OTP and all payment steps.",
  },
  {
    id: "blinkit",
    name: "Blinkit",
    hosts: ["blinkit.com"],
    homeUrl: "https://blinkit.com/",
    loginUrl: "https://blinkit.com/",
    searchUrlTemplate: "https://blinkit.com/s/?q={query}",
    loggedInSelectors: ['a[href*="/account"]', '[aria-label="My account"]'],
    loggedInText: "\\b(?:logout|log out|my account)\\b",
    playbook:
      "On Blinkit (best-effort): select location, search products, use ADD and review cart quantities. Use browser_submit for checkout or order confirmation; hand payment and OTP to the user.",
  },
  {
    id: "swish",
    name: "Swish",
    hosts: ["justswish.in"],
    homeUrl: "https://www.justswish.in/",
    loginUrl: "https://www.justswish.in/",
    loggedInSelectors: ['a[href*="/account"]', '[aria-label="Profile"]'],
    loggedInText: "\\b(?:logout|log out|my account)\\b",
    playbook:
      "On Swish (best-effort): inspect whether web ordering is available, set location and add items if supported. Use browser_submit for ordering. If app-only, tell the user. Payment and sign-in are user-only.",
  },
  {
    id: "uber",
    name: "Uber",
    hosts: ["uber.com"],
    homeUrl: "https://m.uber.com/",
    loginUrl: "https://m.uber.com/",
    loggedInSelectors: ['a[href*="/account"]', '[aria-label="Account"]'],
    loggedInText: "\\b(?:sign out|log out|logout|manage account)\\b",
    playbook:
      "On Uber (best-effort): set pickup and destination, compare available rides and fares. Use browser_submit for Request ride or booking confirmation. Hand sign-in, OTP and any payment step to the user.",
  },
];

export function recipeFor(url: string): SiteRecipe | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return RECIPES.find((recipe) =>
      recipe.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    );
  } catch {
    return undefined;
  }
}

export function serviceFor(url: string): string {
  const recipe = recipeFor(url);
  if (recipe) return recipe.name;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "irctc.co.in" || host.endsWith(".irctc.co.in")) return "IRCTC";
    return host || "Browser";
  } catch {
    return "Browser";
  }
}

export const SITE_LIST = RECIPES.map(({ id, name, loginUrl }) => ({ id, name, loginUrl }));

export function siteRecipe(site: string): SiteRecipe | undefined {
  return (
    RECIPES.find(
      (recipe) =>
        recipe.id === site.toLowerCase() || recipe.name.toLowerCase() === site.toLowerCase(),
    ) ?? recipeFor(site.includes("://") ? site : `https://${site}`)
  );
}
