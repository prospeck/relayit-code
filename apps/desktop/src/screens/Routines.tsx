import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Play, Plus, Trash2 } from "lucide-react";
import type { Routine } from "@relayit/shared";
import { api, ApiError } from "../lib/api";
import { cx, relTime } from "../lib/format";
import { navigate } from "../lib/router";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Page, Switch, Textarea } from "../components/ui";

const PRESETS = [
  { label: "Every weekday at 8:30", cron: "30 8 * * 1-5" },
  { label: "Every Monday at 9:00", cron: "0 9 * * 1" },
  { label: "Every day at 21:00", cron: "0 21 * * *" },
  { label: "Every Friday at 17:00", cron: "0 17 * * 5" },
  { label: "1st of every month, 10:00", cron: "0 10 1 * *" },
];

const IDEAS = [
  { title: "Week ahead", prompt: "Summarise my week ahead: meetings, deadlines and anything I should prepare.", cron: "0 9 * * 1" },
  { title: "Inbox sweep", prompt: "Sort my unread email and tell me the 3 things that most need me today.", cron: "30 8 * * 1-5" },
  { title: "Friday wrap-up", prompt: "/weekly-review", cron: "0 17 * * 5" },
];

export function describeCron(cron: string): string {
  const p = PRESETS.find((x) => x.cron === cron);
  if (p) return p.label;
  const [m, h, dom, , dow] = cron.split(" ");
  const time = /^\d+$/.test(h ?? "") && /^\d+$/.test(m ?? "") ? `${h!.padStart(2, "0")}:${m!.padStart(2, "0")}` : null;
  const days: Record<string, string> = { "*": "Every day", "1-5": "Weekdays", "0,6": "Weekends", "1": "Mondays", "2": "Tuesdays", "3": "Wednesdays", "4": "Thursdays", "5": "Fridays", "6": "Saturdays", "0": "Sundays" };
  if (time && dom === "*" && dow && days[dow]) return `${days[dow]} at ${time}`;
  return cron;
}

export function Routines() {
  const qc = useQueryClient();
  const routines = useQuery({ queryKey: ["routines"], queryFn: api.routines, refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Partial<Routine> | null>(null);
  const inval = () => void qc.invalidateQueries({ queryKey: ["routines"] });
  const toggle = useMutation({ mutationFn: (r: Routine) => api.updateRoutine(r.id, { enabled: !r.enabled }), onSuccess: inval });
  const del = useMutation({ mutationFn: api.deleteRoutine, onSuccess: inval });
  const run = useMutation({ mutationFn: api.runRoutine, onSuccess: (r) => navigate(`chat/${r.conversationId}`) });

  return (
    <Page
      title="Routines"
      subtitle="Things RelayIt does on a schedule — even with the window closed, as long as it's running in the tray. You can also just say “every Monday at 9, summarise my week”."
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ title: "", prompt: "", cron: "0 9 * * 1", enabled: true })}>
          New routine
        </Button>
      }
    >
      {routines.data?.length === 0 ? (
        <>
          <Card>
            <EmptyState icon={<CalendarClock className="size-5" />} title="No routines yet" body="Start with one of these, or write your own." />
          </Card>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {IDEAS.map((i) => (
              <button key={i.title} onClick={() => setEditing({ ...i, enabled: true })} className="text-left bg-surface border border-line rounded-[16px] p-4 hover:border-line-strong hover:shadow-md transition-all">
                <div className="text-[13.5px] font-semibold">{i.title}</div>
                <div className="text-[12px] text-accent-text mt-0.5">{describeCron(i.cron)}</div>
                <div className="text-[12.5px] text-muted mt-2 line-clamp-2">{i.prompt}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Card className="divide-y divide-line">
          {(routines.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-4 group">
              <span className={cx("size-9 rounded-[10px] flex items-center justify-center", r.enabled ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint")}>
                <CalendarClock className="size-[18px]" />
              </span>
              <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(r)}>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{r.title}</span>
                  {r.lastStatus === "error" && <Badge tone="danger">Last run failed</Badge>}
                </div>
                <div className="text-[12.5px] text-muted truncate">
                  {describeCron(r.cron)}
                  {r.enabled && r.nextRunAt ? ` · next ${new Date(r.nextRunAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                  {r.lastRunAt ? ` · last ran ${relTime(r.lastRunAt)}` : ""}
                </div>
              </button>
              <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} onClick={() => run.mutate(r.id)} loading={run.isPending && run.variables === r.id}>
                Run now
              </Button>
              <Switch checked={r.enabled} onCheckedChange={() => toggle.mutate(r)} label={`Enable ${r.title}`} />
              <button onClick={() => del.mutate(r.id)} className="text-faint hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label="Delete">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
      {editing && <RoutineEditor routine={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function RoutineEditor({ routine, onClose }: { routine: Partial<Routine>; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(routine.title ?? "");
  const [prompt, setPrompt] = useState(routine.prompt ?? "");
  const [cron, setCron] = useState(routine.cron ?? "0 9 * * 1");
  const save = useMutation({
    mutationFn: () => (routine.id ? api.updateRoutine(routine.id, { title, prompt, cron }) : api.createRoutine({ title, prompt, cron, enabled: true })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["routines"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={routine.id ? "Edit routine" : "New routine"} width={560}>
      <Field label="Name">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week ahead" />
      </Field>
      <Field label="What should RelayIt do?" className="mt-3" hint="Anything you'd type in chat. Skills work too, e.g. /weekly-review.">
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
      </Field>
      <div className="mt-3">
        <div className="text-[12.5px] font-medium text-ink-2 mb-1.5">When</div>
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {PRESETS.map((p) => (
            <button key={p.cron} onClick={() => setCron(p.cron)} className={cx("h-7 px-3 rounded-full border text-[12.5px]", cron === p.cron ? "bg-ink text-bg border-ink" : "border-line-strong text-ink-2 hover:border-ink/30")}>
              {p.label}
            </button>
          ))}
        </div>
        <Input value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono text-[13px]" />
        <p className="text-[12px] text-muted mt-1.5">{describeCron(cron)} · cron format: minute hour day month weekday</p>
      </div>
      {save.error && <p className="text-[12.5px] text-danger mt-3">{save.error instanceof ApiError ? save.error.message : "Couldn't save"}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!title.trim() || !prompt.trim()}>
          Save routine
        </Button>
      </div>
    </Dialog>
  );
}
