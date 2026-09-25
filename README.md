# K+ — Personal Finance Tracker

A mobile-first PWA for tracking personal spending. No backend, no accounts, no
network calls: every entry lives in `localStorage` on the device, and the app
works fully offline once installed.

Built with Vite + React. All UI lives in a single component file, `src/App.jsx`.

## Running it

```bash
npm install
npm run dev        # dev server with HMR
npm run build      # production build -> dist/
npm run preview    # serve the built dist/ locally
npm run icons      # regenerate the app icons in public/icons/
```

## Installing on an iPhone

1. Serve the app over **HTTPS** (a service worker will not register otherwise —
   `localhost` is the one exception).
2. Open it in **Safari** (not Chrome — only Safari can install to the home
   screen on iOS).
3. Share → **Add to Home Screen**.

It then launches full-screen with its own icon, and opens with no network.

## Screens

| Tab | What it does |
| --- | --- |
| **Overview** | Month/year picker, Income / Spent / Balance cards, top 5 spending categories, 5 most recent entries |
| **Add** | Expense/income toggle, large amount field, category chips, optional note, date |
| **Stats** | Every category with spending in the month: share of total and entry count |
| **Budget** | A monthly limit per category, with a colour-coded bar — green under 80%, amber 80–99%, red at or over 100% |
| **Needs** | The unavoidable things and what each costs, totalled into a monthly minimum |
| **All** | The full history, newest first |

A red dot appears on the Budget tab whenever any category is at or over its
limit for the selected month.

### Budget vs. Needs

They answer opposite questions and are stored separately. A **budget** is a
ceiling — the most you want to spend on something. A **need** is a floor — what
the month costs before anything optional. Needs adds up to the headline
*minimum per month*, alongside what has actually been spent on those categories
and what is left of the month's income once the minimum is covered.

Add a category by tapping it in the picker at the bottom of the tab. Each
category holds as many rows as it needs, and every row can be named, so several
things that share a category stay separate and legible:

```
📱 Subscriptions                43,49 €
   Claude                        20,00
   Photoshop                     12,50
   Spotify                       10,99
```

The name is optional — rent or electricity rarely needs one — and each category
shows its own subtotal alongside what was actually spent in it this month.

Where there is history to go on, a category offers the typical monthly figure so
variable bills like electricity or groceries can be priced from real numbers
rather than guessed. That offer only appears for a category holding a single
row: spending is recorded per category, not per row, so with several rows no
average could know how to split itself between them.

That average divides by the months the category actually appears in, not by the
size of the window. A bill first recorded this month costs what it costs —
dividing it across two earlier months that predate the habit would understate
the minimum, and understating is the one direction this screen must not err in.

The minimum itself is a plan, not a measurement, so it does not change as you
move between months; only the spent and left-over figures follow the period.

## Data

Two `localStorage` keys, both plain JSON:

```jsonc
// "finance_entries"
[{ "id": 1749427200000, "type": "expense", "amount": 5.5, "category": "food", "note": "Monoprix", "date": "2026-06-01" }]

// "budgets" — monthly limit per category id
{ "food": 250, "cafe": 60 }

// "necessary" — one row per recurring thing. A category may hold several rows;
// `label` is what tells them apart. 0 means "listed, not priced yet".
[
  { "id": 1749427200000, "category": "subscriptions", "label": "Claude", "amount": 20 },
  { "id": 1749427200001, "category": "subscriptions", "label": "Photoshop", "amount": 12.5 },
  { "id": 1749427200002, "category": "housing", "label": "", "amount": 890 }
]
```

An earlier version stored `necessary` as one amount per category
(`{ "housing": 890 }`). That shape is migrated to a single unlabelled row per
category on load and written back in the new form, so nothing entered under it
is lost.

Both are read defensively on boot, so hand-editing them (or restoring an older
export) cannot crash the app — malformed records are dropped, unknown
categories fall back to `other`. To back up, copy the values out of the browser
console; to wipe, clear site data.

Because the store is per-origin and per-browser, entries do **not** sync between
devices, and they are lost if you clear website data for the site.

## Deploying

The build is fully static and every asset path is relative, so `dist/` can be
served from a domain root or a sub-path.

- **Vercel** — import the repo; `vercel.json` sets the build and stops `sw.js`
  from being cached, so updates actually reach installed devices.
- **Replit** — `.replit` runs the dev server directly, and deploys as a static
  site from `dist/`.
- **Anything else** — `npm run build` and serve `dist/` over HTTPS.

## Notes on two implementation choices

**The amount field is `type="text"` with `inputMode="decimal"`, not
`type="number"`.** A number input treats `5,50` as invalid and reports its value
as an empty string, so comma handling on top of it can never run — the European
separator the app is meant to accept would silently be dropped. Text plus
`inputMode="decimal"` still raises the numeric keypad on iOS, and the input is
filtered on every keystroke: non-numeric characters are stripped, a single
separator is kept in whichever form was typed, and the value is capped at two
decimals. Both `5,50` and `5.50` parse to `5.5`.

**The delete × is revealed on hover only where hovering exists.** Behind
`@media (hover: hover)` it fades in on row hover as designed; on touch devices,
which is where this app actually runs, it stays visible so it can be tapped at
all. Deleting also offers an Undo in the confirmation toast — with no backend
there is nothing else to recover a mis-tap from.
