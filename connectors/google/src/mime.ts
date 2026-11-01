export type MessageInput = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

function header(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Email headers cannot contain line breaks");
  return value;
}

export function encodeMessage(input: MessageInput): string {
  const subject = header(input.subject);
  // Fold encoded words separately so long Unicode subjects remain valid MIME headers.
  const encodedSubject =
    /[^\x20-\x7e]/.test(subject) || subject.length > 70
      ? (subject.match(/.{1,11}/gu) ?? [])
          .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`)
          .join("\r\n ")
      : subject;
  const headers = [
    `To: ${header(input.to)}`,
    ...(input.cc ? [`Cc: ${header(input.cc)}`] : []),
    `Subject: ${encodedSubject}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${header(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${header(input.references)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body =
    Buffer.from(input.body.replace(/\r?\n/g, "\r\n"))
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`).toString("base64url");
}

export function decodeHeader(value: string): string {
  return value
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, encoding: string, text: string) =>
      encoding.toLowerCase() === "b"
        ? Buffer.from(text, "base64").toString("utf8")
        : Buffer.from(
            text
              .replace(/_/g, " ")
              .replace(/=([\da-f]{2})/gi, (_: string, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              ),
            "binary",
          ).toString("utf8"),
    );
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(br\s*\/?|\/p|\/div|\/li|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (code.startsWith("#")) {
        const n =
          code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
      }
      return (
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[
          code.toLowerCase()
        ] ?? entity
      );
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

export function bodyText(payload: GmailPart): string {
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GmailPart) => {
    if (part.filename) return;
    if (part.body?.data) {
      const value = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.mimeType?.toLowerCase() === "text/plain") plain.push(value);
      else if (part.mimeType?.toLowerCase() === "text/html") html.push(stripHtml(value));
    }
    part.parts?.forEach(visit);
  };
  visit(payload);
  return (plain.length ? plain : html).join("\n");
}
