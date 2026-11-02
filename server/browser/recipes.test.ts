import { describe, expect, it } from "vitest";
import { RECIPES, recipeFor, recipeHint, siteRecipe } from "./recipes.ts";

describe("India browser service guides", () => {
  it("preserves the six service recipes, scoped to their real hostnames", () => {
    expect(RECIPES.map((recipe) => recipe.id)).toEqual(["swiggy", "zomato", "zepto", "blinkit", "swish", "uber"]);
    expect(recipeFor("https://m.uber.com/")?.id).toBe("uber");
    expect(recipeFor("https://blinkit.com.attacker.example/")).toBeUndefined();
    expect(recipeFor("bad URL")).toBeUndefined();
    expect(siteRecipe("Zepto")?.id).toBe("zepto");
  });
  it("uses the visible browser sign-in and leaves the spending press to the person", () => {
    for (const recipe of RECIPES) {
      const hint = recipeHint(recipe.homeUrl);
      expect(hint).toContain("request_sign_in");
      expect(hint).toContain("Stop before any press that spends money");
      expect(hint).not.toContain("browser_submit");
    }
    expect(recipeHint("https://example.com/")).toBe("");
  });
});
