# SASU Invoice 🧾

**SASU Invoice** is a free, privacy-first invoice generator that runs entirely in your browser. Create, preview and export professional invoices without an account. Your data never leaves your device.

Live: <https://sasuinvoice.netlify.app>

## Features

- **Live preview:** every keystroke updates an A4 invoice sheet.
- **Autosave and invoice history:** drafts are saved in your browser automatically. Switch between, duplicate or delete saved invoices, and new invoices get the next number (`INV-002`, …).
- **Business profile and client book:** your details are remembered for new invoices, and previous clients are one click away.
- **Accurate totals:**
  - integer-cent arithmetic (no floating-point drift)
  - percentage or fixed discounts
  - invoice-wide or per-line tax rates with a custom label (VAT, GST…)
  - shipping, amount paid and balance due
- **13 currencies and 8 number formats.** Decimals come from the currency itself (JPY has none) and grouping from the locale (₹1,23,456.78).
- **Payment terms:** Due on receipt or Net 7/15/30/45/60. The due date is computed for you, and unpaid invoices show as *Overdue* once that date passes.
- **Compliance fields:** your business tax/VAT ID (VAT, SIRET, GSTIN…), the client's tax ID, and a legal footer note.
- **Smart suggestions:** turn shorthand like "logo" or "seo audit" into professional line-item wording, and insert friendly, formal or reminder payment notes. This is a built-in phrase library. It is **not AI** and sends nothing anywhere.
- **Exports:**
  - **PDF:** true vector output with selectable, searchable text, automatic multi-page tables with repeated headers and page numbers, and an embedded font so ₹ € £ ¥ render correctly.
  - **PNG:** high-resolution (2×) image.
  - **Print:** clean A4 print stylesheet; only the invoice prints.
- **Quotes, credit notes, receipts and proformas:** one switch changes the document type, title and number series (INV-, QUO-, CN-, RCT-, PRO-). Quotes convert to invoices in one click; credit notes reference the invoice they correct.
- **Issue and lock:** issuing assigns the final number (duplicates are blocked) and locks the document, so a sent invoice can't change by accident. Corrections go through a credit note.
- **Legal details:** supply date, a VAT category per line with an automatic VAT breakdown (rate, taxable base, VAT), company registration details (legal form, capital, registration number, registry), client company number and delivery address, and optional legal wording (French VAT franchise, reverse charge, intra-EU supply, export, French late-payment terms). Verify the wording applies to you; it is not legal advice.
- **Get paid faster:** a scan-to-pay QR code on the invoice and PDF (SEPA/EPC for euro invoices, UPI for rupee invoices, or your own Stripe/PayPal link); an invoices drawer with Unpaid/Overdue/Paid filters and outstanding totals; one-click reminder emails drafted in your mail app.
- **Productivity:** saved items catalogue, "Repeat next month" for recurring work, CSV export for your accountant.
- **Installable offline app:** install from the browser and keep working without a connection.
- **Backup and restore:** download everything as JSON and import it on another device. A reminder appears if you haven't backed up for 14 days, and the app asks the browser to keep its data.
- **Styling:** 8 accent colours plus a custom colour picker, and square, rounded or circle logos.

## Security and privacy

- **No servers, no tracking:** fonts and libraries are bundled and self-hosted, so the app makes no third-party requests.
- **Strict security headers** (see [netlify.toml](netlify.toml)): a Content-Security-Policy with `script-src 'self'` (no inline scripts or `eval`), plus `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy and Permissions-Policy.
- **XSS-safe rendering:** user input is only ever written with `textContent`. ESLint bans `innerHTML`, `outerHTML` and `insertAdjacentHTML`, and a regression test renders hostile input.
- **Validated data:** everything read from `localStorage` or an imported backup is validated with [zod](https://zod.dev). Out-of-range values and unknown keys are rejected or stripped.
- **Logo uploads:**
  - PNG, JPEG or WebP only, verified by magic bytes; SVG is rejected
  - 2 MB or smaller
  - re-encoded through a canvas, which strips metadata and any embedded payload

## Tech stack

- [Vite](https://vite.dev) + TypeScript (strict)
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) for vector PDFs (lazy-loaded)
- [snapdom](https://github.com/zumerlab/snapdom) for PNG capture (lazy-loaded)
- [zod](https://zod.dev) for runtime validation
- [Vitest](https://vitest.dev) + jsdom for tests, ESLint + Prettier
- Self-hosted fonts via Fontsource (DM Sans, Space Grotesk) and an Inter subset for PDFs (SIL OFL, see [src/assets/fonts/OFL.txt](src/assets/fonts/OFL.txt))

## Getting started

Requires Node 22.12+ (Node 24 recommended; see `.nvmrc`).

```bash
git clone https://github.com/suhaAnas/SASU-Invoice.git
cd SASU-Invoice
npm install
npm run dev        # local dev server
```

| Script            | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Start the Vite dev server                              |
| `npm run build`   | Type-check and build to `dist/`                        |
| `npm run preview` | Serve the build with the production security headers   |
| `npm test`        | Run unit tests                                         |
| `npm run lint`    | Lint with ESLint                                       |
| `npm run audit`   | Audit production dependencies                          |

Netlify builds with `npm run build` and publishes `dist/` (configured in `netlify.toml`). CI runs lint, tests, build and audit on every pull request.

## Project structure

```text
src/
  core/      pure logic: state, money, calc, dates, validation, storage, suggestions
  ui/        DOM rendering, line items, exports (PDF/PNG), logo processing
  cloud/     Supabase client, cloud document API, browser cloud preferences
  dashboard/ React cloud dashboard (served at /dashboard/)
  editor/    editor add-ons: catalogue, PWA, optional cloud sync
  styles/    app and landing stylesheets
  main-app.ts       editor entry
  main-landing.ts   landing page entry
supabase/
  migrations/  database schema, row-level security and RPCs
  functions/   Edge Functions (invoices: validated, server-computed saves)
  tests/       SQL security tests (run on plain PostgreSQL)
tests/       Vitest unit and XSS regression tests
```

## Cloud workspace (beta)

Optional accounts add cloud storage, organizations and teams on top of the free editor. Nothing changes for people who don't sign in, and the editor only saves to the cloud once you turn that on for your browser.

- **Stack:** Supabase (Postgres with row-level security, Auth, Storage, Edge Functions) and a React dashboard.
- **Set up:** copy `.env.example` to `.env.local` and fill in your Supabase project's URL and anon key. Without them the build still works and the dashboard reports that cloud features are off.
- **Tests:** `npm run test:functions` (Deno) and `PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres npm run test:db` (any scratch PostgreSQL 15+ server; it creates and drops a `sasu_test` database).

- **End-to-end:** `npm run test:e2e` (Playwright, uses your installed Google Chrome).

Architecture, data model and security model: [docs/architecture/saas.md](docs/architecture/saas.md). Deploying and running it (staging/production, monitoring, incidents, backups, rollback, data requests): [docs/operations/runbook.md](docs/operations/runbook.md).

## What SASU Invoice doesn't do

- It doesn't send invoices. It is not a French approved e-invoicing platform (PA) or a Peppol access point, and it does no e-reporting.
- It doesn't archive invoices for legal retention. Keep copies of what you send.
- It doesn't send emails or automatic reminders (reminders open in your own mail app).
- It can't guarantee legal compliance. Check requirements with your accountant.

## Known limitations

- The PDF font subset covers Latin, Greek, Cyrillic and currency symbols. CJK text in invoice fields will not render in the PDF (use PNG or Print instead).
- Data lives in this browser's storage. Clearing site data deletes it, so use **Download backup** regularly.

## Author

**Suha Anas**: [LinkedIn](https://www.linkedin.com/in/suha-anas/)

## Contributing

Please run `npm run lint && npm test` before opening a PR.

## License

Proprietary. © 2026 Suha Anas. All rights reserved. No licence is granted to copy, modify or redistribute this code.
