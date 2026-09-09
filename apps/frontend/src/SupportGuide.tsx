import { useEffect, useRef, useState } from "react";
import { BookOpen, Headphones, Search, X } from "lucide-react";
import "./CallCenter.css";

const articles = [
  {
    category: "Start here",
    title: "Where do I start?",
    text: "Open Operations → Pipeline to see the customer journey. Select a lead to review contact details, product interest, documents, and delivery status. Open Call Center for customer follow-up. Check that the sidebar says Live data before taking action.",
  },
  {
    category: "Start here",
    title: "Who is this guide for?",
    text: "Store operators use this dashboard for daily customer work. Corporate operators can review pipeline progress, call activity, signed documents, and deliveries. End users should use the customer-facing shopping, signing, and delivery links provided to them; this dashboard requires operator access.",
  },
  {
    category: "Start here",
    title: "Is 24-hour support a live agent?",
    text: "This searchable operating guide is available at any time. It does not connect you to a live human or submit a support ticket. For an unresolved issue, contact your designated corporate administrator with the customer ID, approximate time, and the error message. Never include passwords, private keys, or access tokens.",
  },
  {
    category: "Daily work",
    title: "What do the pipeline stages mean?",
    text: "New Lead is an incoming inquiry. Contacted means outreach has started. Engaged reflects a conversation or product selection. Docs Sent tracks the agreement workflow. Scheduled indicates a delivery appointment. Closed indicates completion. Review the detailed call and document status before deciding the next action; a pipeline stage is not proof of payment or a completed delivery.",
  },
  {
    category: "Daily work",
    title: "How do incoming leads reach the Call Center?",
    text: "The Call Center uses the same customer records as Pipeline and Leads. New inquiries appear when the dashboard refreshes, normally every five seconds. Add lead creates a record for a customer inquiry taken by an operator. Include the international phone country code. Saving through Add lead sends no call or message. Existing website intake retains its configured follow-up behavior.",
  },
  {
    category: "Daily work",
    title: "How do I find and contact a customer?",
    text: "Use the search field in Call Center to match a name, phone, email, or product interest. Select the customer card to open call controls and history. Email opens your email application. The Pipeline message action uses the configured SMS service. Confirm the recipient and the customer’s communication preferences before sending.",
  },
  {
    category: "Calls & callbacks",
    title: "How do I return a customer call?",
    text: "Open Call Center → Lead queue. Select the customer, check their phone number and request, then choose Call customer. Review the confirmation and press Start call. Buddy places an outbound voice call through the existing voice service. An accepted request is not proof the customer answered. Follow the outcome in Call Center → Conversations. Opted-out customers cannot be called from this interface.",
  },
  {
    category: "Calls & callbacks",
    title: "How do callback reminders work?",
    text: "Select a customer and choose Schedule callback. Enter the promised date and time and useful follow-up notes. The form shows your browser’s timezone; saved times are shared consistently across operators. Callbacks are reminders, not an automatic dialer. Open Callbacks to find due items, start a call, edit the reminder, or mark it handled after completing the follow-up.",
  },
  {
    category: "Calls & callbacks",
    title: "How do I reschedule or cancel?",
    text: "Choose Edit on a callback card, or Schedule callback in the customer panel. Save a new future time and notes. Cancel callback removes the item from the pending queue while retaining its latest status. Mark handled records that an operator completed the follow-up; it does not end a phone call or change the sales stage. Each customer has one current callback record.",
  },
  {
    category: "Calls & callbacks",
    title: "Where are recordings and transcripts?",
    text: "Conversations shows captured voice activity with a provider call ID. Select a card or choose a call from the history selector to read its captured transcript and events. Missing transcript text means it was not captured or has not arrived yet. This interface does not provide an audio recording player. History is a recent telemetry window, not a complete permanent archive.",
  },
  {
    category: "Calls & callbacks",
    title: "What if the customer does not answer?",
    text: "Check the call events for no-answer, busy, failed, or completed. Schedule a callback for the agreed follow-up window and add context for the next operator. Do not repeatedly press Start call. If the request timed out or status is unclear, check the provider’s call log with your administrator before trying again; the provider may have accepted the call.",
  },
  {
    category: "Documents & delivery",
    title: "How do I send or review an agreement?",
    text: "Use the document action on the customer’s Pipeline or Leads card. If an agreement already exists, the action opens its PDF. Otherwise enter the selected product and submit the agreement request. Documents shows the recorded DocuSign status and agreement reference. A sent agreement has not necessarily been signed. Check the recorded status before scheduling the next step.",
  },
  {
    category: "Documents & delivery",
    title: "Where do I find delivery appointments?",
    text: "Open Deliveries to view the scheduled customer appointments. The delivery calendar uses Eastern Time, as labeled in that view. Select an appointment to inspect the customer; the detail panel can open the linked Google Calendar event where available. Callback reminders use your local timezone and are separate from delivery appointments.",
  },
  {
    category: "Corporate & integrations",
    title: "What can corporate users oversee?",
    text: "Use Operations for pipeline and fulfillment status, Call Center → Conversations for captured voice transcripts, and Analytics for recent workflow event counts. Counts reflect the records loaded by this dashboard. This Call Center shares Buddy customer records and voice services; it does not change other products or the shared AI runtime.",
  },
  {
    category: "Corporate & integrations",
    title: "How does this connect to our existing system?",
    text: "Existing Buddy lead ingestion remains in place. Operators can enter an inquiry with Add lead today. An external CRM integration requires an agreed field mapping, authenticated ingestion, deduplication rules, and ownership of callback updates. There is no external CRM sync toggle in this interface yet. Ask your administrator to configure that integration before relying on automatic synchronization.",
  },
  {
    category: "Corporate & integrations",
    title: "How are access and provider credentials managed?",
    text: "Your administrator manages operator access and roles. Viewers can inspect data; agents and administrators can perform permitted customer actions. Provider credentials are configured on the server through Cloudflare bindings. Operators should never paste credentials into customer notes, the guide search, or a support request.",
  },
  {
    category: "Troubleshooting",
    title: "Why is data unavailable or an action forbidden?",
    text: "Refresh and check that your operator login is current. Unavailable data may indicate an expired session or an API/database problem. Call Center disables actions when required live data cannot be loaded. A Forbidden response means your assigned role lacks permission. Ask your administrator to check access and service health; do not create duplicate customer records as a workaround.",
  },
  {
    category: "Troubleshooting",
    title: "Why was my callback edit rejected?",
    text: "Another operator may have saved a newer version of that callback. Refresh, review their updated time and notes, and then make your change. This prevents one operator from silently overwriting another operator’s work.",
  },
  {
    category: "Troubleshooting",
    title: "What should I send to an administrator?",
    text: "Describe the action you tried, the visible error, the approximate time and timezone, and the customer or call ID if available. Say whether the problem affects one customer or the whole dashboard. If a call request failed ambiguously, ask them to verify provider activity before retrying. Do not include customer transcripts unless necessary and authorized.",
  },
];
export default function SupportGuide({
  navigate,
}: {
  navigate: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [category, setCategory] = useState("Start here"),
    [query, setQuery] = useState("");
  const launcher = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };
  const categories = [...new Set(articles.map((a) => a.category))];
  const results = articles.filter((a) =>
    query.trim()
      ? `${a.title} ${a.text} ${a.category}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      : a.category === category,
  );
  return (
    <div className="buddy-support">
      {open && (
        <section
          className="support-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="support-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header>
            <span className="support-mark">
              <BookOpen size={22} />
            </span>
            <div>
              <h2 id="support-title">Buddy’s Operating Guide</h2>
              <p>Help for operators and corporate teams · available anytime</p>
            </div>
            <button aria-label="Close support guide" onClick={close}>
              <X size={18} />
            </button>
          </header>
          <div className="support-categories" aria-label="Guide topics">
            {categories.map((c) => (
              <button
                aria-pressed={category === c && !query}
                key={c}
                onClick={() => {
                  setCategory(c);
                  setQuery("");
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="support-body">
            <div className="support-intro">
              <b>Your next step, made clear.</b>
              <p>Find instructions or jump to the right workspace.</p>
              <div className="cc-actions">
                {["Pipeline", "Call Center", "Documents", "Deliveries"].map(
                  (tab) => (
                    <button
                      key={tab}
                      onClick={() => {
                        navigate(tab);
                        close();
                      }}
                    >
                      {tab}
                    </button>
                  ),
                )}
              </div>
            </div>
            <label className="cc-search">
              <Search size={16} />
              <input
                ref={search}
                aria-label="Search operating guide"
                placeholder="Search instructions and questions…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <p className="support-count" aria-live="polite">
              {results.length} articles{query ? " across all topics" : ""}
            </p>
            {results.map((a) => (
              <details key={a.title}>
                <summary>{a.title}</summary>
                <p>{a.text}</p>
              </details>
            ))}
            {!results.length && (
              <p>
                No matching instructions. Try “callback”, “agreement”, or
                “access”. For unresolved issues, contact your corporate
                administrator.
              </p>
            )}
            <small className="support-footer">
              Self-service guide · no live agent or ticket submission
            </small>
          </div>
        </section>
      )}
      <button
        ref={launcher}
        className="support-launcher"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Headphones size={25} />
        <span>
          <b>24-hour support</b>
          <small>Buddy’s operator guide</small>
        </span>
      </button>
    </div>
  );
}
