import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/models/types.ts";

export type ScriptStep = ModelEvent[] | ((request: ModelRequest) => AsyncIterable<ModelEvent>);

/** Each stream consumes one step; snapshots survive the loop mutating its message array. */
export class ScriptedModel implements ModelProvider {
  readonly id = "scripted";
  readonly requests: ModelRequest[] = [];
  private steps: ScriptStep[];

  constructor(...steps: ScriptStep[]) {
    this.steps = [...steps];
  }

  async listModels(): Promise<string[]> {
    return ["test"];
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const { signal, ...snapshot } = request;
    this.requests.push({ ...structuredClone(snapshot), signal });
    const step = this.steps.shift();
    if (!step) throw new Error("Script exhausted");
    if (typeof step === "function") yield* step(request);
    else yield* step;
  }
}

export const text = (delta: string): ModelEvent[] => [{ type: "text", delta }, { type: "done", stopReason: "end_turn" }];
export const call = (name: string, args: unknown = {}, id = `call_${name}`): ModelEvent => ({
  type: "tool_call", call: { id, name, args, rawArgs: JSON.stringify(args) },
});
