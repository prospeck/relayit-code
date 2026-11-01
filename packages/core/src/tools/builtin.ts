import { z } from "zod";
import { defineTool, MemoryCategory, type ToolDef } from "@relayit/shared";
import type { MemoryRepo } from "../store/repo.ts";

/** Tools that are always available, regardless of routing. */
export function coreTools(deps: { memory: MemoryRepo }): ToolDef[] {
  return [
    defineTool({
      name: "offer_quick_replies",
      description:
        "Show the user 2–4 tappable reply buttons. Use whenever you ask the user to choose (e.g. which restaurant, which time). Call this as the LAST thing in your reply; the user's tap becomes their next message.",
      domain: "general",
      toolClass: "read",
      service: "RelayIt",
      input: z.object({
        question: z.string().optional().describe("Optional short label above the buttons"),
        options: z.array(z.string().min(1).max(60)).min(2).max(4),
      }),
      label: () => "Offering choices",
      async run(input) {
        return { shown: true, options: input.options };
      },
      toParts: (_o, input) => [
        {
          type: "choices",
          ...(input.question ? { question: input.question } : {}),
          options: input.options,
        },
      ],
    }),
    defineTool({
      name: "remember_fact",
      description:
        "Save a durable fact about the user so you can use it later (usual orders, preferences, important people, seat preference, dietary needs). Only save things the user said or clearly confirmed. Never save passwords, OTPs, card numbers or other secrets.",
      domain: "general",
      toolClass: "prepare",
      service: "RelayIt",
      input: z.object({
        category: MemoryCategory,
        key: z.string().min(1).max(60).describe("Short label, e.g. 'usual pizza order' or 'wife'"),
        value: z.string().min(1).max(400),
      }),
      label: (i) => `Remembering ${i.key}`,
      async run(input) {
        if (
          /\b(\d{4}[ -]?){3}\d{4}\b|password|otp|cvv|\bpin\b/i.test(`${input.key} ${input.value}`)
        )
          return { saved: false, reason: "Refused to store something that looks like a secret." };
        const fact = await deps.memory.upsert(input, "agent");
        return { saved: true, id: fact.id };
      },
    }),
    defineTool({
      name: "forget_fact",
      description: "Delete a saved fact about the user when they ask you to forget it.",
      domain: "general",
      toolClass: "prepare",
      service: "RelayIt",
      input: z.object({ id: z.string() }),
      async run(input) {
        await deps.memory.delete(input.id);
        return { deleted: true };
      },
    }),
  ];
}

/** A prepare/act pair that proves the approval flow end to end without touching any real service. */
export function demoTools(): ToolDef[] {
  return [
    defineTool({
      name: "demo_prepare_note",
      description:
        "DEMO: draft a short note to someone. Use when the user asks to try a demo action.",
      domain: "demo",
      toolClass: "prepare",
      service: "Demo",
      input: z.object({ to: z.string().min(1), topic: z.string().min(1) }),
      label: () => "Drafting the note",
      async run(input) {
        return {
          to: input.to,
          subject: `About ${input.topic}`,
          body: `Hi ${input.to},\n\nQuick note about ${input.topic} — does that still work for you?\n\nThanks!`,
        };
      },
    }),
    defineTool({
      name: "demo_send_note",
      description:
        "DEMO: send a note drafted with demo_prepare_note. Nothing actually leaves the machine.",
      domain: "demo",
      toolClass: "act",
      service: "Demo",
      input: z.object({
        to: z.string().min(1),
        subject: z.string().min(1),
        body: z.string().min(1),
      }),
      label: (i) => `Sending to ${i.to}`,
      preview: (i) => ({
        title: `Send note to ${i.to}`,
        summary: "This is a demo: the note is saved locally and nothing is actually sent.",
        service: "Demo",
        recipient: i.to,
        details: [
          { label: "To", value: i.to },
          { label: "Subject", value: i.subject },
          { label: "Message", value: i.body },
        ],
      }),
      async run(input, ctx) {
        const key = `demo.sent.${ctx.idempotencyKey}`;
        const prior = await ctx.kv.get<{ id: string }>(key);
        if (prior) return { ...prior, duplicate: true };
        const result = {
          id: `note_${Date.now().toString(36)}`,
          to: input.to,
          subject: input.subject,
          sentAt: new Date().toISOString(),
        };
        await ctx.kv.set(key, result);
        return result;
      },
    }),
    defineTool({
      name: "demo_book_table",
      description:
        "DEMO: book a restaurant table that needs a deposit. Shows a money approval card.",
      domain: "demo",
      toolClass: "act",
      service: "Demo",
      involvesMoney: true,
      input: z.object({
        restaurant: z.string(),
        partySize: z.number().int().min(1).max(20),
        time: z.string(),
        depositInr: z.number().positive(),
      }),
      label: (i) => `Booking ${i.restaurant}`,
      preview: (i) => ({
        title: `Book a table at ${i.restaurant}`,
        summary: `Table for ${i.partySize} at ${i.time}. A refundable deposit is charged on the next screen.`,
        service: "Demo",
        recipient: i.restaurant,
        amountInr: i.depositInr,
        details: [
          { label: "Party", value: `${i.partySize} people` },
          { label: "Time", value: i.time },
        ],
      }),
      async run(input) {
        return { bookingId: `bk_${Date.now().toString(36)}`, ...input, status: "confirmed (demo)" };
      },
    }),
  ];
}
