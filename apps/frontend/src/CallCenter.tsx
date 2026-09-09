import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Lead, Conversation } from "./App";
import "./CallCenter.css";

type Callback = {
  contact_id: string;
  due_at: string;
  note: string;
  status: string;
  version: string;
};
type Props = {
  leads: Lead[];
  live: boolean;
  selected: Lead | null;
  onSelect: (l: Lead) => void;
  conversations: Conversation[];
  eventsLive: boolean;
  refresh: () => void;
};
export async function requestJson(path: string, body?: unknown) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const payload = await response.json();
  if (!response.ok || payload.ok !== true)
    throw new Error(
      payload.error ||
        "Request unavailable. Check your operator access and try again.",
    );
  return payload.data;
}
const dateLabel = (value: string | number) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
const localInput = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export default function CallCenter({
  leads,
  live,
  selected,
  onSelect,
  conversations,
  eventsLive,
  refresh,
}: Props) {
  const [section, setSection] = useState("Lead queue"),
    [query, setQuery] = useState(""),
    [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState(false),
    [schedule, setSchedule] = useState<string | null>(null),
    [activeCall, setActiveCall] = useState<Conversation | null>(null);
  const [confirmCall, setConfirmCall] = useState<string | null>(null);
  const lock = useRef(false);
  const callRequests = useRef(new Map<string, string>());
  const [draftCallback, setDraftCallback] = useState<Callback | undefined>();
  async function load() {
    try {
      setCallbacks(await requestJson("/api/call-center"));
      setReady(true);
    } catch {
      setReady(false);
    }
  }
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const data = await requestJson("/api/call-center");
        if (alive) {
          setCallbacks(data);
          setReady(true);
        }
      } catch {
        if (alive) setReady(false);
      }
    };
    void poll();
    const timer = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const pending = callbacks.filter((c) => c.status === "scheduled");
  const callback = callbacks.find((c) => c.contact_id === selected?.id);
  const calls = conversations.filter((c) => c.callSid);
  const selectedHistory = calls.filter((c) => c.contactId === selected?.id);
  const currentCall = activeCall
    ? selectedHistory.find((c) => c.callSid === activeCall.callSid) ||
      selectedHistory[0]
    : selectedHistory[0];
  const matches = (l: Lead) =>
    `${l.firstName} ${l.lastName} ${l.phone} ${l.email} ${l.interest}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const available = live && ready && !busy;
  const choose = (lead: Lead) => {
    onSelect(lead);
    setConfirmCall(null);
    setSchedule(null);
    setActiveCall(null);
  };
  function openSchedule(lead: Lead) {
    choose(lead);
    setDraftCallback(callbacks.find((c) => c.contact_id === lead.id));
    setSchedule(lead.id);
  }
  async function updateCallback(c: Callback, status: string) {
    await requestJson("/api/call-center", {
      action: "callback",
      contactId: c.contact_id,
      dueAt: c.due_at,
      note: c.note,
      version: c.version,
      status,
    });
    setNotice(
      status === "completed"
        ? "Callback marked handled."
        : "Callback cancelled.",
    );
  }

  return (
    <section className="call-center" aria-label="Call Center">
      <header className="cc-heading">
        <div>
          <span className="eyebrow">CUSTOMER FOLLOW-UP</span>
          <h2>Call Center</h2>
          <p>Every new inquiry. Every promised callback.</p>
        </div>
        <div className="cc-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                refresh();
              })
            }
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            className="cc-primary"
            disabled={!available}
            onClick={() => setIntake(!intake)}
          >
            <Plus size={16} /> Add lead
          </button>
        </div>
      </header>
      <div className="cc-summary">
        <span>
          <b>{leads.length}</b> leads
        </span>
        <span>
          <b>{ready ? pending.length : "—"}</b> callbacks
        </span>
        <span>
          <b>
            {ready
              ? pending.filter((c) => Date.parse(c.due_at) <= Date.now()).length
              : "—"}
          </b>{" "}
          due now
        </span>
        <span>
          <b>{eventsLive ? calls.length : "—"}</b> captured calls
        </span>
        <small>Callbacks are operator reminders · no automatic dialing</small>
      </div>
      {(!live || !ready) && (
        <p className="cc-warning" role="status">
          Live lead or callback data is unavailable. Displayed records may be
          outdated; refresh or check your operator access before making changes.
        </p>
      )}
      {!eventsLive && (
        <p className="cc-warning">
          Call history is unavailable. Check the provider before retrying a
          call.
        </p>
      )}
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="cc-success" role="status">
          {notice}
        </p>
      )}
      {intake && (
        <form
          className="cc-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fields = Object.fromEntries(new FormData(e.currentTarget));
            void run(async () => {
              const lead = await requestJson("/api/call-center", {
                action: "intake",
                ...fields,
              });
              setIntake(false);
              setNotice("Lead saved. No call or message has been sent.");
              onSelect(lead);
            });
          }}
        >
          <div className="cc-heading">
            <h3>Lead intake</h3>
            <button
              type="button"
              aria-label="Close lead intake"
              onClick={() => setIntake(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            Add an inbound inquiry from your existing system. Save first, then
            choose a call or callback.
          </p>
          <div className="cc-fields">
            <label>
              First name
              <input name="firstName" required maxLength={100} />
            </label>
            <label>
              Last name
              <input name="lastName" maxLength={100} />
            </label>
            <label>
              Phone with country code
              <input name="phone" type="tel" placeholder="+1…" required />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <label>
              Product interest
              <input name="interest" maxLength={200} />
            </label>
            <label>
              Customer request
              <input name="comments" maxLength={2000} />
            </label>
          </div>
          <button className="cc-primary" disabled={!available}>
            Save lead
          </button>
        </form>
      )}
      <div className="cc-toolbar">
        <div className="cc-tabs">
          {["Lead queue", "Calls", "Callbacks"].map((name) => (
            <button
              key={name}
              aria-pressed={section === name}
              onClick={() => setSection(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="cc-search">
          <Search size={16} />
          <input
            aria-label="Search Call Center"
            placeholder="Find a customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="cc-layout">
        <div className="cc-cards">
          {section === "Lead queue" &&
            leads.filter(matches).map((l) => (
              <button
                className={`cc-card ${selected?.id === l.id ? "selected" : ""}`}
                key={l.id}
                onClick={() => choose(l)}
              >
                <div className="cc-card-top">
                  <span className="initials">
                    {l.firstName[0]}
                    {l.lastName?.[0]}
                  </span>
                  <strong>
                    {l.firstName} {l.lastName}
                  </strong>
                  <span className="cc-score">{l.score ?? "—"}</span>
                </div>
                <p>{l.interest}</p>
                <div className="cc-badges">
                  <span>{l.stage}</span>
                  <span>
                    {l.optedOut ? "Opted out" : l.callStatus || "Not called"}
                  </span>
                </div>
                <div className="cc-facts">
                  <span>
                    PHONE<b>{l.phone || "No phone"}</b>
                  </span>
                  <span>
                    SOURCE<b>{l.source || "—"}</b>
                  </span>
                </div>
                <small>
                  {pending.some((c) => c.contact_id === l.id)
                    ? "Callback scheduled"
                    : "Select for call controls"}{" "}
                  →
                </small>
              </button>
            ))}
          {section === "Callbacks" &&
            pending
              .filter((c) => {
                const l = leads.find((l) => l.id === c.contact_id);
                return l && matches(l);
              })
              .map((c) => {
                const l = leads.find((l) => l.id === c.contact_id)!;
                return (
                  <article
                    className={`cc-card ${selected?.id === l.id ? "selected" : ""}`}
                    key={c.contact_id}
                  >
                    <button
                      className="cc-card-select"
                      onClick={() => choose(l)}
                    >
                      <strong>
                        {l.firstName} {l.lastName}
                      </strong>
                      <span
                        className={`cc-due ${Date.parse(c.due_at) <= Date.now() ? "overdue" : ""}`}
                      >
                        {Date.parse(c.due_at) <= Date.now()
                          ? "Due now"
                          : "Scheduled"}
                      </span>
                      <p>{dateLabel(c.due_at)}</p>
                      <p>{c.note || "Customer follow-up"}</p>
                    </button>
                    <div className="cc-actions">
                      <button
                        onClick={() => {
                          choose(l);
                          setConfirmCall(l.id);
                        }}
                        disabled={!available || !l.phone || l.optedOut}
                      >
                        <Phone size={14} /> Call
                      </button>
                      <button
                        onClick={() => {
                          openSchedule(l);
                        }}
                        disabled={!available}
                      >
                        <CalendarDays size={14} /> Edit
                      </button>
                      <button
                        disabled={!available}
                        onClick={() =>
                          void run(() => updateCallback(c, "completed"))
                        }
                      >
                        <Check size={14} /> Handled
                      </button>
                    </div>
                  </article>
                );
              })}
          {section === "Calls" &&
            calls
              .filter((c) => {
                const l = leads.find((l) => l.id === c.contactId);
                return l ? matches(l) : !query;
              })
              .map((c) => {
                const l = leads.find((l) => l.id === c.contactId);
                const status = [...c.events]
                  .reverse()
                  .find(
                    (e) =>
                      e.type.startsWith("call.") && e.type !== "call.created",
                  );
                return (
                  <button
                    className={`cc-card ${currentCall?.callSid === c.callSid ? "selected" : ""}`}
                    key={c.callSid}
                    onClick={() => {
                      if (l) {
                        onSelect(l);
                        setSchedule(null);
                        setConfirmCall(null);
                        setActiveCall(c);
                      }
                    }}
                    disabled={!l}
                  >
                    <strong>
                      {l
                        ? `${l.firstName} ${l.lastName}`
                        : "Customer record unavailable"}
                    </strong>
                    <div className="cc-badges">
                      <span>{status?.type.slice(5) || "Requested"}</span>
                      <span>Voice</span>
                    </div>
                    <p>{dateLabel(c.startedAt)}</p>
                    <small>
                      {c.transcript.length} transcript turns · View conversation
                      →
                    </small>
                  </button>
                );
              })}
          {((section === "Lead queue" && !leads.filter(matches).length) ||
            (section === "Callbacks" &&
              !pending.some((c) =>
                leads.some((l) => l.id === c.contact_id && matches(l)),
              )) ||
            (section === "Calls" &&
              !calls.some((c) => {
                const l = leads.find((l) => l.id === c.contactId);
                return l ? matches(l) : !query;
              }))) && (
            <div className="cc-empty">
              <Phone size={28} />
              <h3>
                {query
                  ? "No matching customers"
                  : section === "Callbacks"
                    ? "No callbacks waiting"
                    : section === "Calls"
                      ? "No captured calls yet"
                      : "Your call queue starts here"}
              </h3>
              <p>
                {section === "Lead queue"
                  ? "New leads appear here as they arrive. Use Add lead for an inbound inquiry."
                  : "Select a lead to call or schedule a follow-up."}
              </p>
            </div>
          )}
        </div>
        <aside className="cc-detail" aria-label="Call controls">
          {selected ? (
            <>
              <span className="eyebrow">SELECTED CUSTOMER</span>
              <h3>
                {selected.firstName} {selected.lastName}
              </h3>
              <p>{selected.interest}</p>
              <div className="cc-facts">
                <span>
                  PHONE<b>{selected.phone || "No phone"}</b>
                </span>
                <span>
                  STAGE<b>{selected.stage}</b>
                </span>
              </div>
              <p>{selected.comments}</p>
              {selected.optedOut && (
                <p className="cc-warning">
                  This customer has opted out. Calling is disabled.
                </p>
              )}
              <div className="cc-actions">
                <button
                  className="cc-primary"
                  disabled={
                    !available ||
                    !eventsLive ||
                    !selected.phone ||
                    selected.optedOut
                  }
                  onClick={() => {
                    setConfirmCall(selected.id);
                    setSchedule(null);
                  }}
                >
                  <Phone size={15} /> Call customer
                </button>
                <button
                  disabled={!available}
                  onClick={() => {
                    openSchedule(selected);
                  }}
                >
                  <CalendarDays size={15} /> Schedule callback
                </button>
                {selected.email && (
                  <a href={`mailto:${encodeURIComponent(selected.email)}`}>
                    <Mail size={15} /> Email
                  </a>
                )}
              </div>
              {confirmCall === selected.id && (
                <div className="cc-confirm">
                  <b>Call {selected.phone}?</b>
                  <p>
                    Buddy will place an outbound voice call. Confirm the
                    customer requested this follow-up and check that no call is
                    already active.
                  </p>
                  <div className="cc-actions">
                    <button
                      className="cc-primary"
                      disabled={
                        !available ||
                        !eventsLive ||
                        selected.optedOut ||
                        !selected.phone
                      }
                      onClick={() =>
                        void run(async () => {
                          const requestId =
                            callRequests.current.get(selected.id) ||
                            crypto.randomUUID();
                          callRequests.current.set(selected.id, requestId);
                          await requestJson("/api/calls", {
                            contactId: selected.id,
                            requestId,
                          });
                          callRequests.current.delete(selected.id);
                          setConfirmCall(null);
                          setNotice(
                            "Call request accepted by the voice provider. Watch Calls for the outcome.",
                          );
                        })
                      }
                    >
                      {busy ? "Requesting…" : "Start call"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setConfirmCall(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {schedule === selected.id && (
                <form
                  className="cc-form"
                  key={selected.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      await requestJson("/api/call-center", {
                        action: "callback",
                        contactId: selected.id,
                        dueAt: new Date(
                          String(data.get("dueAt")),
                        ).toISOString(),
                        note: data.get("note"),
                        status: "scheduled",
                        version: draftCallback?.version,
                      });
                      setSchedule(null);
                      setNotice(
                        "Callback reminder saved. An operator starts the call when due.",
                      );
                    });
                  }}
                >
                  <label>
                    Callback time ·{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    <input
                      name="dueAt"
                      type="datetime-local"
                      required
                      defaultValue={
                        draftCallback?.status === "scheduled"
                          ? localInput(draftCallback.due_at)
                          : ""
                      }
                    />
                  </label>
                  <label>
                    Follow-up notes
                    <textarea
                      name="note"
                      maxLength={2000}
                      defaultValue={draftCallback?.note || ""}
                      placeholder="What did the customer request?"
                    />
                  </label>
                  <div className="cc-actions">
                    <button className="cc-primary" disabled={!available}>
                      Save callback
                    </button>
                    <button type="button" onClick={() => setSchedule(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {callback && (
                <div className="cc-callback-detail">
                  <b>Callback · {callback.status}</b>
                  <p>{dateLabel(callback.due_at)}</p>
                  <p>{callback.note}</p>
                  {callback.status === "scheduled" && (
                    <div className="cc-actions">
                      <button
                        disabled={!available}
                        onClick={() =>
                          void run(() => updateCallback(callback, "completed"))
                        }
                      >
                        Mark handled
                      </button>
                      <button
                        disabled={!available}
                        onClick={() =>
                          void run(() => updateCallback(callback, "cancelled"))
                        }
                      >
                        Cancel callback
                      </button>
                    </div>
                  )}
                </div>
              )}
              <h4>Conversation & history</h4>
              {!eventsLive ? (
                <p>History unavailable. Refresh to try again.</p>
              ) : selectedHistory.length ? (
                <>
                  <select
                    aria-label="Select captured call"
                    value={currentCall?.callSid}
                    onChange={(e) =>
                      setActiveCall(
                        selectedHistory.find(
                          (c) => c.callSid === e.target.value,
                        ) || null,
                      )
                    }
                  >
                    {selectedHistory.map((c) => (
                      <option value={c.callSid} key={c.callSid}>
                        {dateLabel(c.startedAt)}
                      </option>
                    ))}
                  </select>
                  <div className="cc-transcript">
                    {currentCall?.transcript.length ? (
                      currentCall.transcript.map((turn, i) => (
                        <div
                          className={`cc-turn ${turn.role}`}
                          key={`${turn.at}-${i}`}
                        >
                          <b>{turn.role === "buddy" ? "Buddy" : "Customer"}</b>
                          <p>{turn.text}</p>
                        </div>
                      ))
                    ) : (
                      <p>No transcript captured for this call.</p>
                    )}
                  </div>
                  <details>
                    <summary>Call events</summary>
                    {currentCall?.events.map((e) => (
                      <p className="cc-event" key={e.id}>
                        {dateLabel(e.createdAt)} · {e.type}
                      </p>
                    ))}
                  </details>
                </>
              ) : (
                <p>No captured calls for this customer yet.</p>
              )}
            </>
          ) : (
            <div className="cc-empty">
              <Phone size={26} />
              <h3>Ready for the next conversation</h3>
              <p>
                Select a customer to call, schedule a callback, or review their
                history.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
