import { z } from "zod";
import type { ToolDef } from "@relayit/shared";
import type { ToolSpec } from "../models/types.ts";

export type RegisteredTool = {
  def: ToolDef;
  /** "native" or the MCP server id. */
  source: string;
  /** JSON Schema sent to the model. */
  parameters: Record<string, unknown>;
  /** For MCP tools: the server-side tool name (def.name may be prefixed). */
  remoteName?: string;
  /** Hidden from the model (internal MCP tools). */
  internal?: boolean;
};

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(def: ToolDef, source = "native", opts: { parameters?: Record<string, unknown>; remoteName?: string; internal?: boolean } = {}): void {
    const parameters = opts.parameters ?? toJsonSchema(def.input);
    this.tools.set(def.name, { def, source, parameters, ...(opts.remoteName ? { remoteName: opts.remoteName } : {}), ...(opts.internal ? { internal: true } : {}) });
  }

  registerAll(defs: ToolDef[], source = "native"): void {
    for (const d of defs) this.register(d, source);
  }

  unregisterSource(source: string): void {
    for (const [name, t] of this.tools) if (t.source === source) this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  domains(): string[] {
    return [...new Set(this.list().filter((t) => !t.internal).map((t) => t.def.domain))].sort();
  }

  /** Tools for the selected domains; "general" tools are always included. */
  forDomains(domains: string[] | "all"): RegisteredTool[] {
    return this.list().filter((t) => !t.internal && (domains === "all" || t.def.domain === "general" || domains.includes(t.def.domain)));
  }

  specs(tools: RegisteredTool[]): ToolSpec[] {
    return tools.map((t) => ({
      name: t.def.name,
      description: `${t.def.description}${t.def.toolClass === "act" ? " (Requires the user's approval; the user sees a confirmation card.)" : ""}`,
      parameters: t.parameters,
    }));
  }
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  if (js.type !== "object") return { type: "object", properties: {}, additionalProperties: true };
  return js;
}
