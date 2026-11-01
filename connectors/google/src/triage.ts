export type TriageEmail = { id: string; from: string; subject: string; snippet: string };
export type TriageDecision = { id: string; bucket: "needs_you" | "can_wait"; reason: string };
/** The caller must treat the supplied email strings as untrusted data in its LLM prompt. */
export type TriageClassifier = (emails: TriageEmail[]) => Promise<TriageDecision[]>;

export function heuristicTriage(emails: TriageEmail[]): TriageDecision[] {
  return emails.map((email) => ({ id: email.id, ...classify(email) }));
}

/** Short, specific reasons written to the user ("Bill due tomorrow"), not generic labels. */
function classify(email: TriageEmail): Omit<TriageDecision, "id"> {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  const sender = email.from.toLowerCase();
  const can = (reason: string) => ({ bucket: "can_wait" as const, reason });
  const needs = (reason: string) => ({ bucket: "needs_you" as const, reason });
  // Classification only: mail content, including hostile instructions, is never executed.
  if (/unsubscribe|newsletter|digest/.test(text)) return can("Newsletter — read when you like");
  if (/promotion|offer|% off|sale\b|deal/.test(text)) return can("Promotion");
  if (/receipt|order (?:delivered|summary)|contract note|statement is ready/.test(text))
    return can("Receipt or statement for your records");
  if (/\b(?:bill|payment|rent)\b.*\b(?:due|overdue)\b|\bdue (?:tomorrow|today|on)\b/.test(text))
    return needs(
      /tomorrow/.test(text)
        ? "Bill due tomorrow"
        : /today/.test(text)
          ? "Bill due today"
          : "Payment due soon",
    );
  if (/rsvp|invitation|invite|wedding|ptm|parent.?teacher/.test(text))
    return needs("Invitation — they're waiting for your RSVP");
  if (/form 16|itr|documents?|please send|attach/.test(text))
    return needs("Asks you to send something");
  if (
    /by (?:tomorrow|today|eod|monday|tuesday|wednesday|thursday|friday)|deadline|before .*review/.test(
      text,
    )
  )
    return needs(/tomorrow/.test(text) ? "Needs you by tomorrow" : "Has a deadline");
  if (/please confirm|confirm (?:your|the)|can you|could you|would you|\?/.test(text))
    return needs("Asks you a direct question");
  if (/no-?reply|do-?not-?reply|notifications?@|alerts?@/.test(sender))
    return can("Automated notification");
  return can("Nothing for you to do");
}
