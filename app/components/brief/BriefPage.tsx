import {
  actionErrorMessage,
  callAction,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconClipboard,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconPrinter,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

import { briefingToMarkdown, formatDay } from "../../../shared/briefing/markdown";
import { briefingToPrintHtml } from "../../../shared/briefing/print";
import {
  CATEGORY_LABELS,
  MEETING_PURPOSES,
  PURPOSE_LABELS,
  type Briefing,
  type Claim,
  type MeetingPurpose,
  type ResearchResult,
  type Source,
  type TargetType,
} from "../../../shared/briefing/schema";

type Stage = "idle" | "plan" | "search" | "synth" | "done" | "error";

const HISTORY_KEY = "groundwork:history";

function defaultMeetingLocal(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadHistory(): Briefing[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as Briefing[];
  } catch {
    return [];
  }
}

function saveHistory(b: Briefing) {
  const next = [b, ...loadHistory().filter((x) => x.id !== b.id)].slice(0, 6);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota: ignore */
  }
  return next;
}

// ------------------------------------------------------------------ status

function EngineStatus() {
  const { data } = useActionQuery("briefing-status", {});
  if (!data) return null;
  const chain = data.llmChain.join(" → ");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {data.mock ? (
        <Pill tone="warn">Demo mode · fictional fixtures</Pill>
      ) : (
        <Pill tone={data.search === "tavily" ? "ok" : "warn"}>
          Search: {data.search === "tavily" ? "Tavily" : "missing TAVILY_API_KEY"}
        </Pill>
      )}
      <Pill>Model: {chain}</Pill>
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: "ok" | "warn" }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "border-border bg-muted text-foreground/80";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls}`}>{children}</span>;
}

// ------------------------------------------------------------------ form

interface FormState {
  target: string;
  targetType: TargetType;
  organization: string;
  officialDomain: string;
  meetingLocal: string;
  purpose: MeetingPurpose;
  context: string;
  windowDays: number;
}

const field =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40";

function BriefForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (f: FormState) => void;
}) {
  const [f, setF] = useState<FormState>({
    target: "",
    targetType: "company",
    organization: "",
    officialDomain: "",
    meetingLocal: defaultMeetingLocal(),
    purpose: "sales",
    context: "",
    windowDays: 30,
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.target.trim().length >= 2) onSubmit(f);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Who are you meeting?</span>
          <input
            className={field}
            placeholder={f.targetType === "company" ? "Company, e.g. Northwind Robotics" : "Person, e.g. Dana Whitfield"}
            value={f.target}
            onChange={(e) => set("target", e.target.value)}
            required
            minLength={2}
            autoFocus
          />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <div className="flex rounded-md border border-input p-0.5">
            {(["company", "person"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("targetType", t)}
                className={`rounded px-3 py-1.5 text-sm capitalize ${f.targetType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {f.targetType === "person" ? (
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Their company (disambiguates the name)</span>
            <input className={field} value={f.organization} onChange={(e) => set("organization", e.target.value)} placeholder="Optional" />
          </label>
        ) : (
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Official domain (counts as primary source)</span>
            <input className={field} value={f.officialDomain} onChange={(e) => set("officialDomain", e.target.value)} placeholder="Optional, e.g. stripe.com" />
          </label>
        )}
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Meeting date & time</span>
          <input type="datetime-local" className={field} value={f.meetingLocal} onChange={(e) => set("meetingLocal", e.target.value)} required />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Meeting purpose</span>
          <select className={field} value={f.purpose} onChange={(e) => set("purpose", e.target.value as MeetingPurpose)}>
            {MEETING_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Look-back</span>
          <select className={field} value={f.windowDays} onChange={(e) => set("windowDays", Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Context (optional): your goal, what you sell, who's attending</span>
        <textarea className={`${field} min-h-[64px]`} value={f.context} onChange={(e) => set("context", e.target.value)} maxLength={1000} />
      </label>

      <Button type="submit" disabled={busy || f.target.trim().length < 2} className="w-full sm:w-auto">
        {busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconSparkles className="size-4" />}
        {busy ? "Researching…" : "Generate brief"}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ progress

function Progress({ stage, research, error }: { stage: Stage; research: ResearchResult | null; error: string | null }) {
  const steps: Array<{ key: Stage; label: string; detail?: string | undefined }> = [
    { key: "plan", label: "Plan searches", detail: research ? `${research.stats.queries} targeted queries` : undefined },
    {
      key: "search",
      label: research?.searchMode === "mock" ? "Search (demo fixtures)" : "Search Tavily (date-windowed)",
      detail: research
        ? `${research.stats.rawResults} results → ${research.stats.kept} sources · ${research.stats.duplicates} dupes · ${research.stats.outOfWindow} outside window${research.stats.extracted ? ` · ${research.stats.extracted} full-text` : ""}`
        : undefined,
    },
    {
      key: "synth",
      label: research?.searchMode === "mock" ? "Draft (mock LLM) + verify every claim" : "Draft via Bifrost LLM gateway + verify every claim",
    },
    { key: "done", label: "Brief ready" },
  ];
  const order: Stage[] = ["plan", "search", "synth", "done"];
  const cur = order.indexOf(stage);
  return (
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => {
        const state = stage === "error" && i >= Math.max(cur, 0) ? "idle" : i < cur || stage === "done" ? "done" : i === cur ? "active" : "idle";
        return (
          <li key={s.key} className="flex items-start gap-2">
            <span className="mt-0.5">
              {state === "done" ? (
                <IconCircleCheck className="size-4 text-emerald-600" />
              ) : state === "active" ? (
                <IconLoader2 className="size-4 animate-spin text-foreground" />
              ) : (
                <span className="inline-block size-4 rounded-full border border-border" />
              )}
            </span>
            <span>
              <span className={state === "idle" ? "text-muted-foreground" : ""}>{s.label}</span>
              {s.detail && state !== "idle" ? <span className="block text-xs text-muted-foreground">{s.detail}</span> : null}
            </span>
          </li>
        );
      })}
      {error ? (
        <li className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </li>
      ) : null}
    </ol>
  );
}

// ------------------------------------------------------------------ brief card

function Cites({ ids, byId }: { ids: string[]; byId: Map<string, Source> }) {
  if (!ids.length) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap gap-0.5 align-baseline">
      {ids.map((id) => {
        const s = byId.get(id);
        return (
          <a
            key={id}
            href={s?.url}
            target="_blank"
            rel="noreferrer"
            title={s ? `${s.title} — ${s.domain}, ${formatDay(s.publishedAt)}` : id}
            className="rounded bg-muted px-1 text-[10px] font-semibold text-foreground/70 no-underline hover:bg-foreground hover:text-background"
          >
            {id}
          </a>
        );
      })}
    </span>
  );
}

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: "warn" }) {
  return (
    <section className={`break-inside-avoid ${tone === "warn" ? "rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/40" : ""}`}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ClaimItem({ c, byId, showReason }: { c: Claim; byId: Map<string, Source>; showReason?: boolean }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 shrink-0">
        {c.confidence === "verified" ? (
          <IconCheck className="size-3.5 text-emerald-600" aria-label="verified" />
        ) : (
          <IconAlertTriangle className="size-3.5 text-amber-600" aria-label="uncertain" />
        )}
      </span>
      <span>
        <span className="me-1.5 font-mono text-[11px] text-muted-foreground">{formatDay(c.date)}</span>
        <span className="me-1.5 rounded border border-border px-1 text-[10px] uppercase text-muted-foreground">{CATEGORY_LABELS[c.category]}</span>
        {c.text}
        <Cites ids={c.sourceIds} byId={byId} />
        {showReason ? <span className="block text-xs italic text-amber-800 dark:text-amber-300">{c.confidenceReason}</span> : null}
      </span>
    </li>
  );
}

function BriefCard({ b }: { b: Briefing }) {
  const byId = useMemo(() => new Map(b.sources.map((s) => [s.id, s])), [b]);
  const [copied, setCopied] = useState(false);

  async function copyMd() {
    const md = (await callAction("export-briefing", { briefing: b }).catch(() => null))?.markdown ?? briefingToMarkdown(b);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  function downloadMd() {
    const md = briefingToMarkdown(b);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `brief-${b.request.target.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printOnePager() {
    const w = window.open("", "_blank");
    if (!w) return window.print();
    w.document.open();
    w.document.write(briefingToPrintHtml(b));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  const meeting = new Date(b.request.meetingAt);
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copyMd}>
          {copied ? <IconCheck className="size-4" /> : <IconClipboard className="size-4" />} {copied ? "Copied" : "Copy Markdown"}
        </Button>
        <Button variant="outline" size="sm" onClick={downloadMd}>
          <IconDownload className="size-4" /> Download .md
        </Button>
        <Button variant="outline" size="sm" onClick={printOnePager}>
          <IconPrinter className="size-4" /> Print one-pager
        </Button>
      </div>

      <article id="brief-print" className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm leading-relaxed shadow-sm">
        <header className="space-y-1 border-b border-border pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{b.request.target}</h2>
            <span className="text-xs text-muted-foreground">
              {PURPOSE_LABELS[b.request.purpose]} · {meeting.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Pill>
              Window {formatDay(b.window.start)} → {formatDay(b.window.end)}
            </Pill>
            <Pill>{b.stats.sourcesReviewed} sources reviewed</Pill>
            <Pill tone="ok">{b.stats.claimsVerified} verified</Pill>
            <Pill tone="warn">{b.stats.claimsUncertain} uncertain</Pill>
            {b.stats.claimsDropped ? <Pill>{b.stats.claimsDropped} unsupported dropped</Pill> : null}
            {b.stats.citationsRemoved ? <Pill tone="warn">{b.stats.citationsRemoved} citations removed</Pill> : null}
            {b.stats.sitePages ? <Pill>{b.stats.sitePages} newsroom page{b.stats.sitePages === 1 ? "" : "s"} (Tavily Map)</Pill> : null}
            {b.stats.tavilyCalls !== undefined ? (
              <Pill>
                Tavily: {b.stats.tavilyCalls} calls · {b.stats.tavilyEstimated ? "~" : ""}
                {b.stats.tavilyCredits} credits{b.stats.tavilyEstimated ? " (est.)" : ""}
              </Pill>
            ) : null}
            <Pill>
              {b.engine.search} + {b.engine.llm}
              {b.engine.model ? ` (${b.engine.model})` : ""}
            </Pill>
          </div>
          {b.demoData ? (
            <p className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Demo mode: fictional fixture data on <code>.example</code> domains. Not real news about “{b.request.target}”.
            </p>
          ) : null}
        </header>

        <Section title="TL;DR">
          {b.tldr.length ? (
            <ul className="list-disc space-y-1 ps-5 font-medium">
              {b.tldr.map((t, i) => (
                <li key={i}>
                  {t.text}
                  <Cites ids={t.sourceIds} byId={byId} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No material, verifiable developments found in the window.</p>
          )}
        </Section>

        <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
          <Section title="Key developments · verified">
            <ul className="space-y-1.5">
              {b.keyDevelopments.length ? b.keyDevelopments.map((c) => <ClaimItem key={c.id} c={c} byId={byId} />) : <li className="text-muted-foreground">None verified.</li>}
            </ul>
          </Section>
          <Section title="People & org changes">
            <ul className="space-y-1.5">
              {b.peopleChanges.length ? b.peopleChanges.map((c) => <ClaimItem key={c.id} c={c} byId={byId} />) : <li className="text-muted-foreground">None verified in the window.</li>}
            </ul>
          </Section>
          <Section title="Talking points">
            <ul className="list-disc space-y-1 ps-5">
              {b.talkingPoints.map((t, i) => (
                <li key={i}>
                  {t.text}
                  <Cites ids={t.sourceIds} byId={byId} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Open questions">
            <ul className="list-disc space-y-1 ps-5">
              {b.openQuestions.map((q, i) => (
                <li key={i}>
                  {q.text}
                  {q.why ? <span className="text-xs text-muted-foreground"> ({q.why})</span> : null}
                  <Cites ids={q.sourceIds} byId={byId} />
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section title="Uncertain / unverified — confirm before relying on these" tone="warn">
          <ul className="space-y-1.5">
            {b.uncertain.length ? b.uncertain.map((c) => <ClaimItem key={c.id} c={c} byId={byId} showReason />) : <li className="text-muted-foreground">Nothing flagged.</li>}
          </ul>
        </Section>

        <Section title="Sources">
          <ol className="grid gap-x-4 gap-y-0.5 text-xs md:grid-cols-2 print:grid-cols-2">
            {b.sources.map((s) => (
              <li key={s.id} className="truncate">
                <span className="font-semibold">[{s.id}]</span>{" "}
                <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-foreground">
                  {s.title}
                </a>{" "}
                <span className="text-muted-foreground">
                  {s.domain} · {formatDay(s.publishedAt)}
                  {s.isPrimary ? " · primary" : ""}
                  {s.origin === "site" ? " · newsroom (Tavily Map)" : ""}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        {b.warnings.length ? (
          <details className="no-print text-xs text-muted-foreground">
            <summary className="cursor-pointer">Pipeline notes ({b.warnings.length})</summary>
            <ul className="mt-1 list-disc ps-5">
              {b.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <footer className="text-[10px] text-muted-foreground">
          ✓ verified = 2+ independent outlets or a primary source, and every figure/key term found in the cited text. ⚠ = single secondary source,
          hedged/rumoured, undated, or not fully supported. Generated {new Date(b.generatedAt).toLocaleString()}.
        </footer>
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function BriefPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Briefing[]>([]);
  useEffect(() => setHistory(loadHistory()), []);

  async function run(f: FormState) {
    setError(null);
    setBriefing(null);
    setResearch(null);
    setStage("plan");
    const req = {
      target: f.target.trim(),
      targetType: f.targetType,
      meetingAt: new Date(f.meetingLocal).toISOString(),
      purpose: f.purpose,
      windowDays: f.windowDays,
      ...(f.targetType === "person" && f.organization.trim() ? { organization: f.organization.trim() } : {}),
      ...(f.targetType === "company" && f.officialDomain.trim() ? { officialDomain: f.officialDomain.trim() } : {}),
      ...(f.context.trim() ? { context: f.context.trim() } : {}),
    };
    try {
      await new Promise((r) => setTimeout(r, 250));
      setStage("search");
      const r = (await callAction("research-target", req, { timeoutMs: 120_000 })) as ResearchResult;
      setResearch(r);
      setStage("synth");
      const b = (await callAction("generate-briefing", { ...req, research: r }, { timeoutMs: 180_000 })) as Briefing;
      setBriefing(b);
      setHistory(saveHistory(b));
      setStage("done");
    } catch (e) {
      setError(actionErrorMessage(e) ?? "Something went wrong while researching. Check the server logs.");
      setStage("error");
    }
  }

  const busy = stage === "plan" || stage === "search" || stage === "synth";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="no-print mb-6 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <IconSearch className="size-4" /> Pre-meeting briefing agent
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Walk in knowing what changed.</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Enter a company or person and your meeting time. The agent researches the 30 days before it with Tavily, drafts through the Bifrost
          gateway, and verifies every claim against its sources — so you get a one-page brief you can trust, with uncertain items called out.
        </p>
        <EngineStatus />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="no-print space-y-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <BriefForm busy={busy} onSubmit={run} />
          </div>
          {stage !== "idle" ? (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <Progress stage={stage} research={research} error={error} />
            </div>
          ) : null}
          {history.length ? (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent briefs</h2>
              <ul className="space-y-1 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setBriefing(h);
                        setStage("done");
                        setError(null);
                      }}
                      className="w-full truncate rounded-md px-2 py-1 text-start hover:bg-muted"
                    >
                      {h.request.target} <span className="text-xs text-muted-foreground">· {formatDay(h.request.meetingAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Prefer to talk? <Link to="/chat" className="underline">Ask the agent in chat</Link> — it calls the same actions.
          </p>
        </aside>

        <main>
          {briefing ? (
            <BriefCard b={briefing} />
          ) : (
            <div className="no-print flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {busy ? <IconLoader2 className="size-6 animate-spin" /> : <IconExternalLink className="size-6" />}
              <p className="max-w-sm">
                {busy
                  ? "Researching… searches run in parallel; synthesis and verification follow."
                  : "Your one-page brief appears here: TL;DR, dated developments, people changes, talking points, open questions, and what's still unverified — every line cited."}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
