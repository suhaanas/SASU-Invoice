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
- **Backup and restore:** download all invoices as JSON and import them on another device.
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
  styles/    app and landing stylesheets
  main-app.ts       editor entry
  main-landing.ts   landing page entry
tests/       Vitest unit and XSS regression tests
```

## Known limitations

- The PDF font subset covers Latin, Greek, Cyrillic and currency symbols. CJK text in invoice fields will not render in the PDF (use PNG or Print instead).
- Data lives in this browser's storage. Clearing site data deletes it, so use **Download backup** regularly.

## Author

**Suha Anas**: [LinkedIn](https://www.linkedin.com/in/suha-anas/)

## Contributing

Issues and pull requests are welcome on the [issues page](https://github.com/suhaAnas/SASU-Invoice/issues). Please run `npm run lint && npm test` before opening a PR.

## License

MIT. See [LICENSE](LICENSE).
