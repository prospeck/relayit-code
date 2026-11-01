import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wand2 } from "lucide-react";
import type { Skill } from "@relayit/shared";
import { api, ApiError } from "../lib/api";
import { navigate } from "../lib/router";
import { Badge, Button, Card, Dialog, Field, Input, Page, Textarea } from "../components/ui";

const DOMAINS = [
  "email",
  "calendar",
  "food",
  "grocery",
  "payments",
  "travel",
  "browser",
  "web",
  "meetings",
  "notes",
];

export function Skills() {
  const qc = useQueryClient();
  const skills = useQuery({ queryKey: ["skills"], queryFn: api.skills });
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const del = useMutation({
    mutationFn: api.deleteSkill,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["skills"] }),
  });
  const run = useMutation({
    mutationFn: async (slug: string) => {
      const c = await api.createConversation();
      await api.send(c.id, `/${slug}`);
      return c;
    },
    onSuccess: (c) => navigate(`chat/${c.id}`),
  });

  return (
    <Page
      title="Skills"
      subtitle={
        <>
          Reusable instructions you can run with{" "}
          <span className="font-medium text-accent-text">/name</span> in any chat. Each skill only
          loads the tools it needs.
        </>
      }
      actions={
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() =>
            setEditing({ slug: "", title: "", description: "", instructions: "", domains: [] })
          }
        >
          New skill
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {(skills.data ?? []).map((s) => (
          <Card key={s.id} className="p-5 flex flex-col group">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[14.5px] font-semibold text-accent-text">/{s.slug}</div>
                <div className="text-[13px] text-ink-2 mt-0.5">{s.description || s.title}</div>
              </div>
              {s.builtin && <Badge>Built-in</Badge>}
            </div>
            <p className="text-[12.5px] text-muted mt-3 line-clamp-3 leading-relaxed whitespace-pre-line flex-1">
              {s.instructions}
            </p>
            <div className="flex flex-wrap gap-1 mt-3">
              {s.domains.map((d) => (
                <span
                  key={d}
                  className="text-[11px] px-2 h-5 inline-flex items-center rounded-full bg-surface-2 border border-line text-muted"
                >
                  {d}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-4">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => run.mutate(s.slug)}
                loading={run.isPending && run.variables === s.slug}
              >
                Run
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                Edit
              </Button>
              {!s.builtin && (
                <button
                  onClick={() => del.mutate(s.id)}
                  className="ml-auto text-faint hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
      {skills.data?.length === 0 && (
        <Card>
          <div className="py-12 text-center text-muted">
            <Wand2 className="size-6 mx-auto mb-2" /> No skills yet.
          </div>
        </Card>
      )}
      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function SkillEditor({ skill, onClose }: { skill: Partial<Skill>; onClose: () => void }) {
  const qc = useQueryClient();
  const [s, setS] = useState({
    slug: skill.slug ?? "",
    title: skill.title ?? "",
    description: skill.description ?? "",
    instructions: skill.instructions ?? "",
    domains: skill.domains ?? [],
  });
  const save = useMutation({
    mutationFn: () => api.saveSkill({ ...s, title: s.title || s.slug }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skills"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={skill.id ? `Edit /${skill.slug}` : "New skill"}
      width={600}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Command" hint="Type it as /command">
          <Input
            value={s.slug}
            disabled={!!skill.id}
            onChange={(e) =>
              setS({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
            }
            placeholder="book-haircut"
          />
        </Field>
        <Field label="Title">
          <Input
            value={s.title}
            onChange={(e) => setS({ ...s, title: e.target.value })}
            placeholder="Book a haircut"
          />
        </Field>
      </div>
      <Field label="Short description" className="mt-3">
        <Input
          value={s.description}
          onChange={(e) => setS({ ...s, description: e.target.value })}
        />
      </Field>
      <Field
        label="Instructions"
        hint="Write it like you'd brief a smart assistant: the goal, the steps, your preferences."
        className="mt-3"
      >
        <Textarea
          value={s.instructions}
          onChange={(e) => setS({ ...s, instructions: e.target.value })}
          rows={8}
        />
      </Field>
      <div className="mt-3">
        <div className="text-[12.5px] font-medium text-ink-2 mb-1.5">Tools it needs</div>
        <div className="flex flex-wrap gap-1.5">
          {DOMAINS.map((d) => {
            const on = s.domains.includes(d);
            return (
              <button
                key={d}
                onClick={() =>
                  setS({ ...s, domains: on ? s.domains.filter((x) => x !== d) : [...s.domains, d] })
                }
                className={`h-7 px-3 rounded-full border text-[12.5px] ${on ? "bg-ink text-bg border-ink" : "border-line-strong text-ink-2 hover:border-ink/30"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
      {save.error && (
        <p className="text-[12.5px] text-danger mt-3">
          {save.error instanceof ApiError ? save.error.message : "Couldn't save"}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!s.slug || !s.instructions.trim()}
        >
          Save skill
        </Button>
      </div>
    </Dialog>
  );
}
