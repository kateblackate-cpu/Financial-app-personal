import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const CATEGORIES = [
  { id: "housing", label: "Rent & Housing", emoji: "🏠" },
  { id: "utilities", label: "Utilities", emoji: "💡" },
  { id: "food", label: "Groceries & Food", emoji: "🥐" },
  { id: "cafe", label: "Cafés & Dining", emoji: "☕" },
  { id: "transport", label: "Transport", emoji: "🚇" },
  { id: "health", label: "Health", emoji: "🌿" },
  { id: "gym", label: "Gym & Sport", emoji: "🏋️" },
  { id: "education", label: "Lessons & Courses", emoji: "📖" },
  { id: "subscriptions", label: "Subscriptions", emoji: "📱" },
  { id: "beauty", label: "Beauty & Care", emoji: "✨" },
  { id: "fashion", label: "Fashion", emoji: "👗" },
  { id: "culture", label: "Culture & Art", emoji: "🎭" },
  { id: "travel", label: "Travel", emoji: "✈️" },
  { id: "studio", label: "Studio & Work", emoji: "💼" },
  { id: "other", label: "Other", emoji: "•" },
];

const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const catOf = (id) => CAT[id] || CAT.other;

const ENTRIES_KEY = "finance_entries";
const BUDGETS_KEY = "budgets";
const NECESSARY_KEY = "necessary";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TABS = [
  { id: "overview", label: "Overview", icon: "◈" },
  { id: "add", label: "Add", icon: "+" },
  { id: "stats", label: "Stats", icon: "◫" },
  { id: "budget", label: "Budget", icon: "◎" },
  { id: "needs", label: "Needs", icon: "▣" },
  { id: "all", label: "All", icon: "≡" },
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const eurFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const money = (n) => eurFmt.format(Number.isFinite(n) ? n : 0);

/** Local-time YYYY-MM-DD. `toISOString()` is UTC and would file a late-evening
 *  entry under tomorrow's date for anyone east of Greenwich. */
function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses the ISO string by hand — `new Date("2026-06-01")` is parsed as UTC
 *  midnight and can render as the previous day in negative offsets. */
function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

const ymOf = (iso) => {
  const [y, m] = String(iso).split("-").map(Number);
  return { y, m: m - 1 };
};

/**
 * Keeps only digits and a single decimal separator, preserving whichever
 * separator was typed so a European keyboard still reads naturally.
 */
function sanitizeAmount(raw) {
  let out = "";
  let sep = false;
  let decimals = 0;
  for (const ch of String(raw).replace(/[^0-9.,]/g, "")) {
    if (ch === "." || ch === ",") {
      if (sep) continue;
      sep = true;
      out += ch;
      continue;
    }
    if (sep) {
      if (decimals >= 2) continue; // euros: two decimals is the limit
      decimals += 1;
    }
    out += ch;
  }
  return out;
}

/** "5,50" and "5.50" both become 5.5. */
function parseAmount(raw) {
  const n = parseFloat(sanitizeAmount(raw).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/* ---------- persistence ---------- */

function loadEntries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENTRIES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    // Normalise defensively: this data is hand-editable and survives upgrades.
    return parsed
      .filter((e) => e && typeof e === "object" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(Number(e.amount)))
      .map((e, i) => ({
        id: Number.isFinite(Number(e.id)) ? Number(e.id) : Date.now() + i,
        type: e.type === "income" ? "income" : "expense",
        amount: Math.abs(Number(e.amount)),
        category: CAT[e.category] ? e.category : "other",
        note: typeof e.note === "string" ? e.note : "",
        date: e.date,
      }));
  } catch {
    return [];
  }
}

function loadBudgets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BUDGETS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (CAT[id] && Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The recurring things a month costs, one row each:
 *
 *   { id, category: "subscriptions", label: "Claude", amount: 20 }
 *
 * A category can hold as many rows as it needs — several subscriptions, two
 * language courses — so `label` is what tells them apart. An amount of 0 means
 * "listed, not priced yet" and must survive, so unlike budgets an empty value
 * never drops the row.
 */
function loadNecessary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NECESSARY_KEY) || "[]");

    // The first version stored one amount per category, as { housing: 890 }.
    // Migrate it to a single unlabelled row per category rather than dropping
    // whatever had already been entered.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .filter(([id]) => CAT[id])
        .map(([id, v], i) => ({
          id: Date.now() + i,
          category: id,
          label: "",
          amount: Number(v) > 0 ? Number(v) : 0,
        }));
    }

    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it) => it && typeof it === "object" && CAT[it.category])
      .map((it, i) => ({
        id: Number.isFinite(Number(it.id)) ? Number(it.id) : Date.now() + i,
        category: it.category,
        label: typeof it.label === "string" ? it.label : "",
        amount: Number(it.amount) > 0 ? Number(it.amount) : 0,
      }));
  } catch {
    return [];
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the session still works, it just won't persist */
  }
}

/** Newest first; ties broken by insertion id so same-day entries stay stable. */
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const CSS = `
:root {
  --bg: #E5E5E5;
  --accent: #7C8F94;
  --text: #515151;
  --card: #DADADA;
  --line: #D0D0D0;
  --line-2: #C8C8C8;
  --income: #4A7060;
  --expense: #8B4040;
  --muted: #AAAAAA;
  --icon-bg: #CECECE;
  --warn: #A98545;
}

* { box-sizing: border-box; }

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 400;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

.app {
  max-width: 440px;
  margin: 0 auto;
  padding: 22px 20px calc(96px + env(safe-area-inset-bottom));
  min-height: 100%;
}

/* ---- type ---- */
.cap {
  font-size: 9px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 400;
}
.h1 {
  font-size: 21px;
  font-weight: 500;
  color: var(--accent);
  margin: 0;
  letter-spacing: .01em;
}
.section-title {
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 500;
  margin: 28px 0 10px;
}

/* ---- header ---- */
.masthead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18px;
}
.wordmark {
  font-size: 24px;
  font-weight: 500;
  color: var(--accent);
  letter-spacing: .04em;
}

/* ---- period picker ---- */
.period { display: flex; gap: 8px; }
.period select {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  padding: 11px 28px 11px 12px;
  border-radius: 0;
  background-image: linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%);
  background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.period select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

/* ---- cards ---- */
.cards { display: flex; gap: 8px; margin-top: 14px; }
.card {
  flex: 1;
  background: var(--card);
  border: 1px solid var(--line);
  padding: 13px 12px 14px;
  min-width: 0;
}
.card .cap { margin-bottom: 7px; }
.card .val {
  font-size: 16px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- bars ---- */
.bar-row { margin-bottom: 13px; }
.bar-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.bar-head .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-head .amt { font-weight: 500; white-space: nowrap; }
.bar-head .pct { color: var(--muted); font-size: 11px; white-space: nowrap; }
.bar {
  height: 6px;
  background: var(--line-2);
  overflow: hidden;
}
.bar-fill { height: 100%; transition: width .28s ease; }

/* ---- entries ---- */
.entry {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.entry:last-child { border-bottom: none; }
.entry-icon {
  width: 34px;
  height: 34px;
  flex: none;
  background: var(--icon-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 1;
}
.entry-main { flex: 1; min-width: 0; }
.entry-title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.entry-amt { font-size: 14px; font-weight: 500; white-space: nowrap; }

.del {
  flex: none;
  width: 24px;
  height: 24px;
  margin-left: 2px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: opacity .15s ease, color .15s ease;
  border-radius: 0;
}
.del:hover, .del:focus-visible { color: var(--expense); }
/* Spec asks for reveal-on-hover; touch devices have no hover, and this app
   lives on a phone — so only hide it where hovering is actually possible. */
@media (hover: hover) and (pointer: fine) {
  .entry .del { opacity: 0; }
  .entry:hover .del, .entry .del:focus-visible { opacity: 1; }
}

/* ---- add form ---- */
.toggle { display: flex; border: 1px solid var(--line-2); }
.toggle button {
  flex: 1;
  padding: 12px;
  border: none;
  background: var(--card);
  color: var(--muted);
  font-family: inherit;
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 0;
}
.toggle button.on { background: var(--accent); color: #F2F2F2; }

.amount-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--line-2);
  padding: 6px 0 10px;
}
.amount-wrap .cur { font-size: 24px; color: var(--muted); font-weight: 400; }
.amount-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 38px;
  font-weight: 500;
  color: var(--text);
  padding: 0;
  border-radius: 0;
}
.amount-input:focus { outline: none; }
.amount-input::placeholder { color: #C2C2C2; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 10px;
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 0;
}
.chip.on { background: var(--accent); border-color: var(--accent); color: #F2F2F2; }

.field {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  padding: 12px;
  border-radius: 0;
}
.field:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

.submit {
  width: 100%;
  margin-top: 26px;
  padding: 16px;
  border: none;
  background: var(--accent);
  color: #F2F2F2;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: .14em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 0;
}
.submit:active { opacity: .85; }

/* ---- necessary expenses ---- */
.hero {
  margin-top: 14px;
  padding: 16px 14px 15px;
  background: var(--card);
  border: 1px solid var(--line);
}
.hero-val {
  font-size: 34px;
  font-weight: 500;
  color: var(--accent);
  line-height: 1.1;
  margin: 7px 0 6px;
}
.hero-note { font-size: 11px; color: var(--muted); }

.chip-plus { color: var(--accent); font-size: 13px; margin-left: 1px; }

.need-group { padding: 15px 0 14px; border-bottom: 1px solid var(--line); }
.need-group:last-of-type { border-bottom: none; }
.need-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 9px;
}
.need-group-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.need-group-sum { font-size: 14px; font-weight: 500; white-space: nowrap; }

.need-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.need-label, .need-amount {
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: inherit;
  /* 16px keeps iOS from zooming the page in on focus */
  font-size: 16px;
  padding: 8px;
  border-radius: 0;
  min-width: 0;
}
.need-label { flex: 1; }
.need-label::placeholder { color: var(--muted); }
.need-amount { width: 88px; flex: none; text-align: right; }
.need-label:focus, .need-amount:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

.need-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted);
}
.need-foot-actions { display: flex; gap: 14px; }

.link {
  border: none;
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-family: inherit;
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}

/* ---- budget ---- */
.budget-row { padding: 14px 0; border-bottom: 1px solid var(--line); }
.budget-row:last-child { border-bottom: none; }
.budget-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
.budget-name { flex: 1; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.budget-input {
  width: 86px;
  flex: none;
  text-align: right;
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  padding: 7px 8px;
  border-radius: 0;
}
.budget-input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
.budget-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}

/* ---- empty state ---- */
.empty {
  padding: 34px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

/* ---- flash ---- */
.flash {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #3A3A3A;
  color: #EFEFEF;
  padding: 11px 15px;
  font-size: 12px;
  letter-spacing: .04em;
  max-width: calc(100vw - 40px);
  animation: flash-in .18s ease-out;
}
@keyframes flash-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-7px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.flash button {
  border: none;
  background: transparent;
  color: #9FB6BB;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  cursor: pointer;
  padding: 0;
  border-radius: 0;
}

/* ---- nav ---- */
.nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  background: var(--bg);
  border-top: 1px solid var(--line-2);
  padding-bottom: env(safe-area-inset-bottom);
}
.nav-inner { display: flex; width: 100%; max-width: 440px; margin: 0 auto; }
.nav button {
  position: relative;
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  cursor: pointer;
  padding: 10px 1px 11px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-radius: 0;
}
.nav button.on { color: var(--accent); }
.nav .ico { font-size: 16px; line-height: 1; }
.nav .lbl { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.dot {
  position: absolute;
  top: 8px;
  left: 50%;
  margin-left: 8px;
  width: 5px;
  height: 5px;
  background: var(--expense);
  border-radius: 50%;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;

/* ------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------ */

function PeriodPicker({ period, years, onChange }) {
  return (
    <div className="period">
      <select
        aria-label="Month"
        value={period.m}
        onChange={(e) => onChange({ ...period, m: Number(e.target.value) })}
      >
        {MONTHS.map((name, i) => (
          <option key={name} value={i}>{name}</option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={period.y}
        onChange={(e) => onChange({ ...period, y: Number(e.target.value) })}
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

function Bar({ pct, color }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

function EntryRow({ entry, onDelete }) {
  const c = catOf(entry.category);
  const income = entry.type === "income";
  return (
    <div className="entry">
      <div className="entry-icon" aria-hidden="true">{c.emoji}</div>
      <div className="entry-main">
        <div className="entry-title">{entry.note || c.label}</div>
        <div className="entry-sub">
          {entry.note ? `${c.label} · ` : ""}
          {fmtDate(entry.date)}
        </div>
      </div>
      <div className="entry-amt" style={{ color: income ? "var(--income)" : "var(--text)" }}>
        {income ? "+" : "−"}
        {money(entry.amount)}
      </div>
      <button
        className="del"
        onClick={() => onDelete(entry.id)}
        aria-label={`Delete ${entry.note || c.label}, ${money(entry.amount)}`}
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

function EntryList({ entries, onDelete, empty }) {
  if (!entries.length) return <div className="empty">{empty}</div>;
  return (
    <div>
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} onDelete={onDelete} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

export default function App() {
  const [entries, setEntries] = useState(loadEntries);
  const [budgets, setBudgets] = useState(loadBudgets);
  const [necessary, setNecessary] = useState(loadNecessary);
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);

  useEffect(() => save(ENTRIES_KEY, entries), [entries]);
  useEffect(() => save(BUDGETS_KEY, budgets), [budgets]);
  useEffect(() => save(NECESSARY_KEY, necessary), [necessary]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const showFlash = useCallback((text, undo) => {
    clearTimeout(flashTimer.current);
    setFlash({ text, undo, key: Date.now() });
    flashTimer.current = setTimeout(() => setFlash(null), undo ? 5000 : 1800);
  }, []);

  /* ---- derived data ---- */

  const sorted = useMemo(() => [...entries].sort(byDateDesc), [entries]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const set = new Set([now - 1, now, now + 1, period.y]);
    for (const e of entries) set.add(ymOf(e.date).y);
    return [...set].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
  }, [entries, period.y]);

  const month = useMemo(() => {
    const list = entries.filter((e) => {
      const { y, m } = ymOf(e.date);
      return y === period.y && m === period.m;
    });

    let income = 0;
    let spent = 0;
    const byCat = {};
    for (const e of list) {
      if (e.type === "income") {
        income += e.amount;
      } else {
        spent += e.amount;
        const slot = byCat[e.category] || (byCat[e.category] = { total: 0, count: 0 });
        slot.total += e.amount;
        slot.count += 1;
      }
    }

    const cats = Object.entries(byCat)
      .map(([id, v]) => ({ id, ...v, pct: spent > 0 ? (v.total / spent) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);

    return { list: [...list].sort(byDateDesc), income, spent, balance: income - spent, byCat, cats };
  }, [entries, period]);

  /**
   * Typical monthly spend per category, over the three months ending at the
   * selected one.
   *
   * The divisor is per category — how many of those months the category was
   * actually recorded in — not how many months exist. A bill first tracked this
   * month costs what it costs; dividing it by three because two earlier months
   * predate the habit would understate the floor, which is the one direction
   * this screen must never err in.
   */
  const avgByCat = useMemo(() => {
    const window = new Set();
    for (let i = 0; i < 3; i++) {
      const d = new Date(period.y, period.m - i, 1);
      window.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const totals = {};
    const monthsSeen = {};
    for (const e of entries) {
      const key = e.date.slice(0, 7);
      if (e.type !== "expense" || !window.has(key)) continue;
      totals[e.category] = (totals[e.category] || 0) + e.amount;
      (monthsSeen[e.category] ||= new Set()).add(key);
    }
    const out = {};
    for (const [id, total] of Object.entries(totals)) out[id] = total / monthsSeen[id].size;
    return out;
  }, [entries, period]);

  const anyOverBudget = useMemo(
    () => Object.entries(budgets).some(([id, limit]) => limit > 0 && (month.byCat[id]?.total || 0) >= limit),
    [budgets, month],
  );

  /* ---- actions ---- */

  const addEntry = useCallback(
    (entry) => {
      setEntries((prev) => [entry, ...prev]);
      // Jump the period to the entry's month, otherwise a back-dated entry
      // lands the user on an Overview that doesn't show what they just added.
      const { y, m } = ymOf(entry.date);
      setPeriod({ y, m });
      showFlash(entry.type === "income" ? "Income added" : "Expense added");
      setTab("overview");
    },
    [showFlash],
  );

  const deleteEntry = useCallback(
    (id) => {
      const removed = entries.find((e) => e.id === id);
      if (!removed) return;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      // No backend and no trash can, so make a mis-tap recoverable.
      showFlash("Entry deleted", () =>
        setEntries((prev) => (prev.some((e) => e.id === removed.id) ? prev : [removed, ...prev])),
      );
    },
    [entries, showFlash],
  );

  const addNeed = useCallback((catId) => {
    setNecessary((prev) => [...prev, { id: Date.now(), category: catId, label: "", amount: 0 }]);
  }, []);

  const updateNeed = useCallback((id, patch) => {
    setNecessary((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const removeNeed = useCallback((id) => {
    setNecessary((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const setBudget = useCallback((catId, value) => {
    setBudgets((prev) => {
      const next = { ...prev };
      const n = parseAmount(value);
      if (!Number.isFinite(n) || n <= 0) delete next[catId];
      else next[catId] = n;
      return next;
    });
  }, []);

  /* ---- render ---- */

  return (
    <>
      <style>{CSS}</style>

      {flash && (
        <div className="flash" key={flash.key} role="status">
          <span>{flash.text}</span>
          {flash.undo && (
            <button
              onClick={() => {
                flash.undo();
                clearTimeout(flashTimer.current);
                setFlash(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      <div className="app">
        {tab === "overview" && (
          <Overview
            month={month}
            period={period}
            years={years}
            setPeriod={setPeriod}
            recent={sorted.slice(0, 5)}
            onDelete={deleteEntry}
          />
        )}
        {tab === "add" && <AddEntry onAdd={addEntry} onInvalid={showFlash} />}
        {tab === "stats" && <Stats month={month} period={period} years={years} setPeriod={setPeriod} />}
        {tab === "budget" && (
          <Budget
            month={month}
            period={period}
            years={years}
            setPeriod={setPeriod}
            budgets={budgets}
            setBudget={setBudget}
          />
        )}
        {tab === "needs" && (
          <Necessary
            month={month}
            period={period}
            years={years}
            setPeriod={setPeriod}
            items={necessary}
            avgByCat={avgByCat}
            onAdd={addNeed}
            onUpdate={updateNeed}
            onRemove={removeNeed}
          />
        )}
        {tab === "all" && <AllEntries entries={sorted} onDelete={deleteEntry} />}
      </div>

      <nav className="nav">
        <div className="nav-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <span className="ico" aria-hidden="true">{t.icon}</span>
              <span className="lbl">{t.label}</span>
              {t.id === "budget" && anyOverBudget && <span className="dot" title="Over budget" />}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 1. Overview
 * ------------------------------------------------------------------ */

function Overview({ month, period, years, setPeriod, recent, onDelete }) {
  const top = month.cats.slice(0, 5);
  return (
    <>
      <div className="masthead">
        <span className="wordmark">K+</span>
        <span className="cap">{MONTHS[period.m]} {period.y}</span>
      </div>

      <PeriodPicker period={period} years={years} onChange={setPeriod} />

      <div className="cards">
        <div className="card">
          <div className="cap">Income</div>
          <div className="val" style={{ color: "var(--income)" }}>{money(month.income)}</div>
        </div>
        <div className="card">
          <div className="cap">Spent</div>
          <div className="val" style={{ color: "var(--expense)" }}>{money(month.spent)}</div>
        </div>
        <div className="card">
          <div className="cap">Balance</div>
          <div className="val" style={{ color: month.balance < 0 ? "var(--expense)" : "var(--text)" }}>
            {money(month.balance)}
          </div>
        </div>
      </div>

      <div className="section-title">Top categories</div>
      {top.length ? (
        top.map((c) => (
          <div className="bar-row" key={c.id}>
            <div className="bar-head">
              <span className="name">{catOf(c.id).emoji} {catOf(c.id).label}</span>
              <span className="amt">{money(c.total)}</span>
              <span className="pct">{Math.round(c.pct)}%</span>
            </div>
            <Bar pct={c.pct} color="var(--accent)" />
          </div>
        ))
      ) : (
        <div className="empty">No spending recorded this month.</div>
      )}

      <div className="section-title">Recent</div>
      <EntryList entries={recent} onDelete={onDelete} empty="Nothing yet — add your first entry." />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Add
 * ------------------------------------------------------------------ */

function AddEntry({ onAdd, onInvalid }) {
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO);

  function submit(e) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!Number.isFinite(value) || value <= 0) {
      onInvalid("Enter an amount first");
      return;
    }
    onAdd({ id: Date.now(), type, amount: value, category, note: note.trim(), date });
    setAmount("");
    setNote("");
  }

  return (
    <form onSubmit={submit}>
      <div className="masthead">
        <h1 className="h1">New entry</h1>
      </div>

      <div className="toggle">
        <button type="button" className={type === "expense" ? "on" : ""} onClick={() => setType("expense")}>
          Expense
        </button>
        <button type="button" className={type === "income" ? "on" : ""} onClick={() => setType("income")}>
          Income
        </button>
      </div>

      <div className="section-title">Amount</div>
      <div className="amount-wrap">
        <span className="cur" aria-hidden="true">€</span>
        {/*
          type="text" + inputMode="decimal", not type="number": a number input
          rejects "5,50" outright and hands back an empty string, which would
          make the comma handling below unreachable. inputMode="decimal" still
          brings up the numeric keypad on iOS.
        */}
        <input
          className="amount-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          aria-label="Amount in euros"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
        />
      </div>

      <div className="section-title">Category</div>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${category === c.id ? " on" : ""}`}
            onClick={() => setCategory(c.id)}
            aria-pressed={category === c.id}
          >
            <span aria-hidden="true">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      <div className="section-title">Note</div>
      <input
        className="field"
        type="text"
        placeholder="Optional"
        aria-label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="section-title">Date</div>
      <input
        className="field"
        type="date"
        aria-label="Date"
        value={date}
        onChange={(e) => setDate(e.target.value || todayISO())}
      />

      <button className="submit" type="submit">
        Add {type}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Stats
 * ------------------------------------------------------------------ */

function Stats({ month, period, years, setPeriod }) {
  return (
    <>
      <div className="masthead">
        <h1 className="h1">Stats</h1>
        <span className="cap">{month.list.length} entries</span>
      </div>

      <PeriodPicker period={period} years={years} onChange={setPeriod} />

      <div className="cards">
        <div className="card">
          <div className="cap">Total income</div>
          <div className="val" style={{ color: "var(--income)" }}>{money(month.income)}</div>
        </div>
        <div className="card">
          <div className="cap">Total spent</div>
          <div className="val" style={{ color: "var(--expense)" }}>{money(month.spent)}</div>
        </div>
      </div>

      <div className="section-title">By category</div>
      {month.cats.length ? (
        month.cats.map((c) => (
          <div className="bar-row" key={c.id}>
            <div className="bar-head">
              <span className="name">{catOf(c.id).emoji} {catOf(c.id).label}</span>
              <span className="amt">{money(c.total)}</span>
            </div>
            <Bar pct={c.pct} color="var(--accent)" />
            <div className="budget-foot">
              <span>{c.pct.toFixed(1)}% of spending</span>
              <span>{c.count} {c.count === 1 ? "entry" : "entries"}</span>
            </div>
          </div>
        ))
      ) : (
        <div className="empty">No spending recorded this month.</div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Budget
 * ------------------------------------------------------------------ */

function budgetColor(pct) {
  if (pct >= 100) return "var(--expense)";
  if (pct >= 80) return "var(--warn)";
  return "var(--income)";
}

function Budget({ month, period, years, setPeriod, budgets, setBudget }) {
  const limitTotal = Object.values(budgets).reduce((s, n) => s + n, 0);
  const spentOnBudgeted = Object.keys(budgets).reduce((s, id) => s + (month.byCat[id]?.total || 0), 0);

  return (
    <>
      <div className="masthead">
        <h1 className="h1">Budget</h1>
        <span className="cap">{MONTHS[period.m]} {period.y}</span>
      </div>

      <PeriodPicker period={period} years={years} onChange={setPeriod} />

      <div className="cards">
        <div className="card">
          <div className="cap">Budgeted</div>
          <div className="val">{money(limitTotal)}</div>
        </div>
        <div className="card">
          <div className="cap">Used</div>
          <div className="val" style={{ color: spentOnBudgeted > limitTotal ? "var(--expense)" : "var(--text)" }}>
            {money(spentOnBudgeted)}
          </div>
        </div>
      </div>

      <div className="section-title">Monthly limits</div>
      <div className="cap" style={{ marginBottom: 4 }}>
        Leave blank for no limit
      </div>

      {CATEGORIES.map((c) => (
        <BudgetRow
          key={c.id}
          category={c}
          limit={budgets[c.id] || 0}
          spent={month.byCat[c.id]?.total || 0}
          onChange={(v) => setBudget(c.id, v)}
        />
      ))}
    </>
  );
}

function BudgetRow({ category, limit, spent, onChange }) {
  /*
   * The text field keeps its own draft so a half-typed "5," survives the
   * round-trip: a value driven straight off the parsed number would re-render
   * as "5" and swallow the separator mid-keystroke. Nothing else writes to
   * this category's limit, so the draft never needs to resync from above.
   */
  const [draft, setDraft] = useState(() => (limit > 0 ? String(limit).replace(".", ",") : ""));

  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  const left = limit - spent;

  return (
    <div className="budget-row">
      <div className="budget-head">
        <span aria-hidden="true">{category.emoji}</span>
        <span className="budget-name">{category.label}</span>
        <input
          className="budget-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="—"
          aria-label={`Monthly limit for ${category.label}`}
          value={draft}
          onChange={(e) => {
            const v = sanitizeAmount(e.target.value);
            setDraft(v);
            onChange(v);
          }}
        />
      </div>

      {limit > 0 ? (
        <>
          <Bar pct={pct} color={budgetColor(pct)} />
          <div className="budget-foot">
            <span>{money(spent)} of {money(limit)}</span>
            <span style={{ color: left < 0 ? "var(--expense)" : undefined }}>
              {left < 0 ? `${money(Math.abs(left))} over` : `${money(left)} left`}
            </span>
          </div>
        </>
      ) : (
        <div className="budget-foot">
          <span>{spent > 0 ? `${money(spent)} spent` : "Nothing spent"}</span>
          <span>No limit set</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Necessary expenses — the monthly floor
 * ------------------------------------------------------------------ */

function Necessary({ month, period, years, setPeriod, items, avgByCat, onAdd, onUpdate, onRemove }) {
  /*
   * Rows are grouped by category, and the groups are ordered by when the
   * category was first added rather than by the master category list — a
   * category tapped in the picker then appears at the bottom, right where the
   * tap happened, instead of silently slotting in somewhere up the page.
   */
  const groups = useMemo(() => {
    const byCat = new Map();
    for (const it of items) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      byCat.get(it.category).push(it);
    }
    return [...byCat.entries()]
      .map(([id, rows]) => ({
        cat: catOf(id),
        rows,
        addedAt: Math.min(...rows.map((r) => r.id)),
        planned: rows.reduce((sum, r) => sum + r.amount, 0),
        spent: month.byCat[id]?.total || 0,
      }))
      .sort((a, b) => a.addedAt - b.addedAt);
  }, [items, month]);

  // The floor is what was planned, not what happened: it stays the same
  // whichever month is on screen, while spent/left move with the period.
  const minimum = items.reduce((sum, it) => sum + it.amount, 0);
  const spent = groups.reduce((sum, g) => sum + g.spent, 0);
  const unpriced = items.filter((it) => !it.amount).length;
  const left = month.income - minimum;
  const rest = CATEGORIES.filter((c) => !items.some((it) => it.category === c.id));

  return (
    <>
      <div className="masthead">
        <h1 className="h1">Necessary</h1>
        <span className="cap">{items.length} {items.length === 1 ? "item" : "items"}</span>
      </div>

      <PeriodPicker period={period} years={years} onChange={setPeriod} />

      <div className="hero">
        <div className="cap">Minimum per month</div>
        <div className="hero-val">{money(minimum)}</div>
        <div className="hero-note">
          {items.length === 0
            ? "Add the things you cannot skip."
            : unpriced > 0
              ? `${unpriced} ${unpriced === 1 ? "item has" : "items have"} no amount yet`
              : "What it costs to keep the month running."}
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <div className="cap">Spent so far</div>
          <div className="val" style={{ color: spent > minimum && minimum > 0 ? "var(--expense)" : "var(--text)" }}>
            {money(spent)}
          </div>
        </div>
        <div className="card">
          <div className="cap">Left over</div>
          <div className="val" style={{ color: month.income === 0 ? "var(--muted)" : left < 0 ? "var(--expense)" : "var(--income)" }}>
            {month.income === 0 ? "—" : left < 0 ? `\u2212${money(Math.abs(left))}` : money(left)}
          </div>
        </div>
      </div>

      <div className="section-title">Every month I need</div>
      {groups.length ? (
        groups.map((g) => (
          <NeedGroup
            key={g.cat.id}
            group={g}
            average={avgByCat[g.cat.id]}
            onAdd={() => onAdd(g.cat.id)}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))
      ) : (
        <div className="empty">Nothing listed as necessary yet.</div>
      )}

      {rest.length > 0 && (
        <>
          <div className="section-title">Add a category</div>
          <div className="chips">
            {rest.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => onAdd(c.id)}>
                <span aria-hidden="true">{c.emoji}</span>
                {c.label}
                <span className="chip-plus" aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function NeedGroup({ group, average, onAdd, onUpdate, onRemove }) {
  const { cat, rows, planned, spent } = group;
  const over = planned > 0 && spent > planned;

  // Spending is tracked per category, not per row, so the historical average
  // can only fill in a category that holds a single row. With several rows the
  // split between them is the user's own and no average could guess it.
  const single = rows.length === 1 ? rows[0] : null;
  const rounded = average > 0 ? Math.round(average * 100) / 100 : 0;
  const suggestion = single && rounded && rounded !== single.amount ? rounded : null;

  return (
    <div className="need-group">
      <div className="need-group-head">
        <span aria-hidden="true">{cat.emoji}</span>
        <span className="need-group-name">{cat.label}</span>
        <span className="need-group-sum">{money(planned)}</span>
      </div>

      {rows.map((row) => (
        <NeedRow
          key={row.id}
          row={row}
          category={cat}
          onUpdate={onUpdate}
          onRemove={() => onRemove(row.id)}
        />
      ))}

      <div className="need-foot">
        <span className="need-foot-actions">
          <button className="link" onClick={onAdd}>+ add another</button>
          {suggestion ? (
            <button className="link" onClick={() => onUpdate(single.id, { amount: suggestion })}>
              use average {money(suggestion)}
            </button>
          ) : null}
        </span>
        <span style={{ color: over ? "var(--expense)" : undefined }}>
          {spent > 0 ? `${money(spent)} spent this month` : "Nothing spent this month"}
          {over ? ` \u00b7 ${money(spent - planned)} above plan` : ""}
        </span>
      </div>
    </div>
  );
}

function NeedRow({ row, category, onUpdate, onRemove }) {
  /*
   * The amount keeps a local draft so a half-typed "12," survives the round
   * trip — a value derived from the parsed number would re-render as "12" and
   * swallow the separator mid-keystroke. The label needs no such care, so it
   * stays controlled straight from state.
   */
  const [draft, setDraft] = useState(() => (row.amount > 0 ? String(row.amount).replace(".", ",") : ""));

  // A row filled from the average is written to state without going through
  // this field, so mirror it back into the draft when that happens.
  const lastAmount = useRef(row.amount);
  useEffect(() => {
    if (row.amount !== lastAmount.current) {
      lastAmount.current = row.amount;
      if (parseAmount(draft) !== row.amount) setDraft(row.amount > 0 ? String(row.amount).replace(".", ",") : "");
    }
  }, [row.amount, draft]);

  return (
    <div className="need-row">
      <input
        className="need-label"
        type="text"
        autoComplete="off"
        placeholder="Name (optional)"
        aria-label={`Name for this ${category.label} item`}
        value={row.label}
        onChange={(e) => onUpdate(row.id, { label: e.target.value })}
      />
      <input
        className="need-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
        aria-label={`Monthly amount for ${row.label || category.label}`}
        value={draft}
        onChange={(e) => {
          const v = sanitizeAmount(e.target.value);
          setDraft(v);
          const n = parseAmount(v);
          lastAmount.current = Number.isFinite(n) && n > 0 ? n : 0;
          onUpdate(row.id, { amount: lastAmount.current });
        }}
      />
      <button className="del" onClick={onRemove} aria-label={`Remove ${row.label || category.label}`} title="Remove">
        ×
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 6. All
 * ------------------------------------------------------------------ */

function AllEntries({ entries, onDelete }) {
  return (
    <>
      <div className="masthead">
        <h1 className="h1">All entries</h1>
        <span className="cap">{entries.length} total</span>
      </div>
      <EntryList entries={entries} onDelete={onDelete} empty="No entries yet." />
    </>
  );
}
