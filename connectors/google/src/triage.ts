export type TriageEmail = { id: string; from: string; subject: string; snippet: string };
export type TriageDecision = { id: string; bucket: "needs_you" | "can_wait"; reason: string };
/** The caller must treat the supplied email strings as untrusted data in its LLM prompt. */
export type TriageClassifier = (emails: TriageEmail[]) => Promise<TriageDecision[]>;

export function heuristicTriage(emails: TriageEmail[]): TriageDecision[] {
  return emails.map(email => {
    const text = `${email.subject} ${email.snippet}`.toLowerCase();
    const sender = email.from.toLowerCase();
    // Classification only: mail content, including hostile instructions, is never executed.
    if (/newsletter|promotions?|unsubscribe|receipt|contract note/.test(text)) {
      return { id: email.id, bucket: "can_wait", reason: "An informational update, receipt, or promotion; no reply appears necessary." };
    }
    if (/by tomorrow|by today|due (?:tomorrow|today|date)|deadline|bill.*due|before.*review|rsvp|please confirm|can you|could you|\?/.test(text)) {
      return { id: email.id, bucket: "needs_you", reason: "Contains a direct question, response request, or upcoming deadline." };
    }
    if (/invitation|invite|please (?:send|review)|form 16|needed for itr/.test(text)) {
      return { id: email.id, bucket: "needs_you", reason: "Requests your input, documents, or attendance." };
    }
    if (/no-?reply|do-?not-?reply|notifications?@/.test(sender)) {
      return { id: email.id, bucket: "can_wait", reason: "An automated notification without an apparent action request." };
    }
    return { id: email.id, bucket: "can_wait", reason: "No direct question or time-sensitive action is apparent." };
  });
}
