import type { BrowserSession } from "./session.ts";
import { siteRecipe } from "./recipes.ts";

export * from "./session.ts";
export * from "./snapshot.ts";
export * from "./tools.ts";
export * from "./recipes.ts";

/** The human signs in themselves; credentials remain only in the dedicated Chromium profile. */
export async function openLoginWindow(session: BrowserSession, site: string): Promise<void> {
  const recipe = siteRecipe(site);
  if (!recipe) throw new Error(`No login page configured for site: ${site}`);
  const page = await session.show();
  await page.goto(recipe.loginUrl, { waitUntil: "domcontentloaded", timeout: 12_000 });
  await session.bringToFront();
  await session.afterAction();
}
