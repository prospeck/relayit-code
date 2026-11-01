import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Mic, Square } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { Tooltip } from "./ui";

export type ComposerHandle = { focus(): void; setText(t: string): void };

type Props = {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "hero" | "dock";
  disabled?: boolean;
};

/** The one input that matters. Enter sends, Shift+Enter adds a line, "/" opens skills, the mic does push-to-talk. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ onSend, onStop, busy, placeholder, autoFocus, size = "dock", disabled }, ref) {
  const [text, setText] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const listId = useId();
  const hintId = useId();
  const ta = useRef<HTMLTextAreaElement>(null);
  const skills = useQuery({ queryKey: ["skills"], queryFn: api.skills, staleTime: 60_000, retry: false });

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), setText: (t) => { setText(t); requestAnimationFrame(() => ta.current?.focus()); } }));

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, size === "hero" ? 220 : 200)}px`;
  }, [text, size]);

  const slashQuery = /^\/([a-z0-9-]*)$/.exec(text)?.[1];
  const matches = useMemo(
    () => (slashQuery === undefined || slashDismissed ? [] : (skills.data ?? []).filter((s) => s.slug.startsWith(slashQuery)).slice(0, 6)),
    [slashQuery, skills.data, slashDismissed],
  );

  const submit = () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    onSend(t);
    setText("");
  };

  const voice = useVoice((t) => setText((prev) => (prev ? `${prev} ${t}` : t)));

  return (
    <div className="relative">
      <AnimatePresence>
        {matches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            id={listId}
            role="listbox"
            aria-label="Skills"
            className="absolute bottom-full mb-2 left-0 right-0 bg-surface border border-line-strong rounded-[14px] shadow-lg p-1.5 z-20"
          >
            <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Skills</div>
            {matches.map((s, i) => (
              <button
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === slashIdx}
                tabIndex={-1}
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => {
                  setText(`/${s.slug} `);
                  ta.current?.focus();
                }}
                className={cx("w-full flex items-baseline gap-3 px-2.5 py-2 rounded-[9px] text-left", i === slashIdx && "bg-surface-2")}
              >
                <span className="text-[13.5px] font-medium text-accent-text">/{s.slug}</span>
                <span className="text-[12.5px] text-muted truncate">{s.description || s.title}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cx(
          "group relative bg-surface border border-control transition-[border,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[var(--ring),var(--shadow-md)]",
          size === "hero" ? "rounded-[22px] shadow-md px-5 pt-4 pb-3" : "rounded-[18px] shadow-sm px-4 pt-3 pb-2.5",
        )}
      >
        <textarea
          ref={ta}
          autoFocus={autoFocus}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setSlashIdx(0);
            setSlashDismissed(false);
          }}
          aria-label="Message RelayIt"
          aria-describedby={hintId}
          aria-autocomplete="list"
          aria-controls={matches.length ? listId : undefined}
          aria-activedescendant={matches.length ? `${listId}-${slashIdx}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape" && matches.length) {
              e.preventDefault();
              setSlashDismissed(true);
              return;
            }
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setSlashIdx((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (matches.length && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              setText(`/${matches[slashIdx]!.slug} `);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={voice.recording ? "Listening…" : placeholder ?? "Say it once…"}
          className={cx(
            "block w-full resize-none bg-transparent outline-none placeholder:text-faint text-ink",
            size === "hero" ? "text-[17px] leading-[1.5] min-h-[52px]" : "text-[14.5px] leading-[1.55] min-h-[24px]",
          )}
        />
        <div className={cx("flex items-center gap-1", size === "hero" ? "mt-3" : "mt-1.5")}>
          <span id={hintId} className="text-[12px] text-faint pl-0.5 hidden sm:inline">
            <span className="font-medium text-muted">/</span> for skills
          </span>
          <div className="flex-1" />
          <Tooltip label={voice.recording ? "Release to stop" : "Hold to talk"}>
            <button
              onPointerDown={voice.start}
              onPointerUp={voice.stop}
              onPointerLeave={voice.recording ? voice.stop : undefined}
              onPointerCancel={voice.stop}
              onBlur={voice.stop}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!e.repeat && !voice.busy) voice.start();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  voice.stop();
                }
              }}
              aria-pressed={voice.recording}
              disabled={voice.busy}
              className={cx(
                "size-8 rounded-full flex items-center justify-center transition-colors",
                voice.recording ? "bg-accent-soft text-accent" : voice.busy ? "text-muted animate-pulse" : "text-muted hover:text-ink hover:bg-surface-2",
              )}
              aria-label={voice.recording ? "Recording — release to stop" : "Hold to talk"}
            >
              <Mic className="size-[17px]" />
            </button>
          </Tooltip>
          {busy ? (
            <button onClick={onStop} aria-label="Stop" className="size-8 rounded-full bg-ink text-bg flex items-center justify-center hover:opacity-85 transition-opacity">
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || disabled}
              aria-label="Send"
              className="size-8 rounded-full bg-accent text-on-accent flex items-center justify-center disabled:bg-surface-3 disabled:text-faint transition-colors hover:bg-accent-hover"
            >
              <ArrowUp className="size-[17px]" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      {voice.error && (
        <p role="alert" className="text-[12px] text-danger mt-1.5 px-1">
          {voice.error}
        </p>
      )}
    </div>
  );
});

/** Push-to-talk: record while held, then transcribe through the core (local Whisper or the user's provider). */
function useVoice(onText: (t: string) => void) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stopRequested = useRef(false);
  const chunks = useRef<Blob[]>([]);

  const start = async () => {
    setError(null);
    stopRequested.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Released before the permission prompt resolved: don't start recording.
      if (stopRequested.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 2000) return;
        setBusy(true);
        try {
          const { text } = await api.transcribe(blob);
          if (text.trim()) onText(text.trim());
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't transcribe that.");
        } finally {
          setBusy(false);
        }
      };
      mr.start();
      rec.current = mr;
      setRecording(true);
    } catch {
      setError("Microphone access was blocked. Check microphone permissions for RelayIt.");
    }
  };
  const stop = () => {
    stopRequested.current = true;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    rec.current = null;
    setRecording(false);
  };
  return { recording, busy, error, start: () => void start(), stop };
}
