# Competitor Feature Gaps for SASU Invoice (research as of Oct 2026)

Scope note: ~17 tool calls. Primary pricing pages fetched for Invoice-Generator.com, Wave, Invoice Ninja, Square, Zoho Invoice. Invoice Simple, Billdu, Refrens and Zoho-limit details partly come from aggregators (Capterra, costbench, search snippets) and are flagged. No G2/Capterra review-text mining or Reddit thread was fetched successfully; "what users value" evidence is thin (see Gaps).

## 1. What do competitors offer today (per competitor)?

### Takeaway
Every hosted competitor bundles quotes/estimates, recurring invoices, payment links and automated reminders, usually in the free tier; the no-signup generators (Invoice-Generator.com and the privacy-first newcomers) win instead on breadth of document types (quote, credit note, receipt, proforma), more label languages, and payment QR codes. SASU already matches or beats the no-signup group on totals, autosave, client book and export quality. Its clearest gaps are other document types, payment QR codes and label languages.

### Cited Findings

**Invoice-Generator.com (no-signup generator, the reference point)**
- Free, no signup: "Create and download invoice PDFs for free with no signup required", unlimited invoices — [invoice-generator.com](https://invoice-generator.com/)
- Fields: business/customer details, number, date, due date, payment terms, line items, tax % or flat, shipping, discount % or flat, 150+ currencies — [invoice-generator.com](https://invoice-generator.com/)
- Separate generators for **invoices, receipts, quotes, estimates, credit notes, purchase orders, sales orders, proforma invoices, timesheets, work orders, account statements, packing slips** — [invoice-generator.com](https://invoice-generator.com/)
- **Editable labels and 15+ UI/invoice languages** (da, de, en, es, fr, id, it, nl, no, pl, pt, ro, sv, th, tr, uk) — [invoice-generator.com](https://invoice-generator.com/)
- The homepage does not mention email sending, recurring billing or payments — [invoice-generator.com](https://invoice-generator.com/)

**Zoho Invoice (free)**
- Official pricing page: entirely free; limits are **up to 2 users, 3 projects, 500 invoices/year**, plus "Powered by Zoho Invoice" branding — [Zoho Invoice pricing](https://www.zoho.com/invoice/pricing/)
- Free features: quotes/estimates, recurring invoices, **credit notes and retainers**, customer self-service portal, multiple payment gateways, automated payment reminders, customizable templates, expenses, time tracking/timesheets, **multi-language support**, sales/financial reports, 24/5 email+phone support — [Zoho Invoice pricing](https://www.zoho.com/invoice/pricing/)
- Accounts inactive for 180+ days are deleted (after notice) — [Zoho Invoice pricing](https://www.zoho.com/invoice/pricing/). Relevant to SASU's "your data stays yours" pitch.
- CONFLICT: aggregators say the free plan has 5 clients/1 user and unlimited invoices ([search snippet / tech.co & costbench](https://costbench.com/software/invoicing/zoho-invoice/free-plan)). This contradicts the official page (2 users, 500 invoices/yr). Trust the official page.

**Wave**
- Starter (free): unlimited invoices, estimates, bills; mobile app; customer management dashboard. Card payments **2.9% + $0.60** (Amex 3.4% + $0.60) — [Wave pricing](https://www.waveapps.com/pricing)
- Pro ($19/mo or $190/yr) adds: **automated late-payment reminders, logo and brand colours on invoices, removal of Wave branding**, bank import via Plaid, receipt capture/expenses, reports, team members — [Wave pricing](https://www.waveapps.com/pricing)
- Notable: on Wave, logo/brand colours and reminders are paid features. SASU gives logo and colours away free.

**Invoice Ninja**
- Free hosted plan: **up to 5 clients**, unlimited invoicing, 11 templates, online payments, recurring invoices, deposits/partial payments, product management (item catalogue), time tracking, kanban, expenses, client portal — [Invoice Ninja pricing](https://invoiceninja.com/pricing-plans/)
- Pro $14/mo ($140/yr): unlimited clients, custom branding, full invoice design customisation, API, email via Gmail/Microsoft, **auto payment reminders**, reports. Enterprise from $18/mo: users/permissions, branded portal, bank sync, **PEPPOL e-invoicing**, portal file attachments — [Invoice Ninja pricing](https://invoiceninja.com/pricing-plans/)
- Gateways: Stripe, PayPal, Square, GoCardless; credit notes supported; self-hostable (open source); native apps for macOS/Windows/Linux/iOS/Android — [Invoice Ninja pricing](https://invoiceninja.com/pricing-plans/)

**Square Invoices**
- Free: invoices and **recurring invoices, estimates and contracts**, projects; standard processing fees — [Square Invoices pricing](https://squareup.com/us/en/invoices/pricing)
- All plans: automatic reminders before/on/after the due date, deposits, **estimates with multiple package options**. Plus: payment schedules, **custom invoice templates**, batch invoicing, contract templates with **e-signatures**, $10 ACH cap — [Square Invoices pricing](https://squareup.com/us/en/invoices/pricing)
- Exact fee percentages were not on the fetched page.

**Invoice Simple** (aggregator data)
- No permanent free plan, 14-day trial. Essentials ~$5.83/mo, Plus $14.99, Premium $21.99. Includes autofill client/item info, online payments, **read receipts**, mobile app. Premium adds **client signatures**, premium templates, deposits, restoring previous invoices. Receipt-scanning expense tracker — [Capterra listing](https://www.capterra.com/p/165683/Invoice-Simple/) / [PricingSaaS](https://pricingsaas.com/companies/invoicesimple) (via search snippets; not verified on invoicesimple.com/pricing)

**Billdu** (aggregator data)
- FREE: expenses plus an "instant website" only. LITE from $4.99/mo: unlimited invoices, 10 clients, status tracking, **client signature**. STANDARD $9.99: estimates, **payment reminders**, quote requests. PREMIUM $19.99: **recurring invoices**, online store, API — [Capterra](https://www.capterra.ca/software/153134/billdu) (via search snippet)
- Capterra rating 4.2/5 from 35 reviews — same source.

**Refrens (India-focused)**
- Free tier: **15 documents per year**. Recurring invoices (weekly/monthly/yearly), customizable columns, PDF download, sending by **email or WhatsApp**, status tracking, **auto payment reminders**, bank/UPI payments direct to your account with no Refrens fee — [Refrens](https://www.refrens.com/free-invoice-for-freelancers)
- The search results did not confirm UPI QR on invoices.

**Privacy-first / local-only competitors** (see Q4)
- Invoice Now: live preview, **UPI and custom payment-link QR codes**, **multiple workspaces (multi-business)**, JSON backup/restore, PDF (selectable text, clickable links) and PNG export, **undo/redo**, dark mode, multi-currency, configurable tax labels, multiple templates, open source — [DEV article](https://dev.to/ashutoshkrris/introducing-invoice-now-a-free-privacy-first-invoice-generator-that-runs-entirely-in-your-browser-2pop)

### Inferences
- Feature matrix (Y = has it, P = paid tier, — = none or not found):

| Feature | SASU | Inv-Gen.com | Zoho free | Wave free | Ninja free | Square free | Invoice Now |
|---|---|---|---|---|---|---|---|
| Quotes/estimates | — | Y | Y | Y | Y | Y | ? |
| Credit notes | — | Y | Y | ? | Y | ? | ? |
| Receipts / proforma | — | Y | ? | ? | ? | ? | ? |
| Recurring | — | — | Y | ? | Y | Y | — |
| Payment links/gateway | — | — | Y | Y | Y | Y | QR link |
| Payment QR (UPI/EPC) | — | — | ? | — | ? | — | UPI |
| Item catalogue | — | — | Y | ? | Y | ? | ? |
| Auto reminders | — | — | Y | P | P | Y | — |
| Multi-language labels | locales only | 15+ | Y | ? | ? | ? | ? |
| Multiple templates | 1 layout, colours | ? | Y | ? | 11 | P | Y |
| Signatures | — | — | ? | ? | ? | P (contracts) | ? |
| Time/expenses | — | timesheet doc | Y | P (expenses) | Y | — | — |
| Multi-business | — | — | ? | ? | ? | ? | Y |
| Undo/redo | — | ? | ? | ? | ? | ? | Y |

- "?" means not verified, not that the feature is absent.
- Hosted freemium tools put limits on free use (Zoho 500/yr, Ninja 5 clients, Refrens 15 docs/yr, Billdu free has no invoices, Invoice Simple has no free plan). SASU being unlimited and free is a real advantage.

### Gaps
- Could not verify Wave free-tier recurring invoices or credit notes, or Square's 2026 fee rates.
- Did not fetch Invoice Simple, Billdu or Refrens pricing pages directly; their data comes from aggregator snippets.
- No reliable source checked for each competitor's accessibility (WCAG) or offline/PWA support. Invoice Ninja's native desktop apps are the only offline-capable option found.

## 2. Which features do freelancers and small businesses value most?

### Takeaway
Late payment is the main pain point (74–85% of freelancers report it). The most-cited features are therefore payment-related: automated reminders, online payment options, plus professional templates and time-tracking integration. The evidence is vendor blogs, not neutral surveys.

### Cited Findings
- In a survey of 400+ US freelancers, 74% reported payment delays and 16% were owed for over two months; another figure says 85% get paid late — cited by [Plutio / Bloom / workee search results](https://www.plutio.com/solutions/freelancers/invoicing) (vendor content; original survey not identified)
- Features most often recommended: automated payment reminders, online payments (Stripe/PayPal/Square), branded templates, late fees and payment terms, and time-tracking-to-invoice — same sources ([bloom.io](https://blog.bloom.io/invoicing-software-for-freelancers/), [taskip](https://taskip.net/invoicing-software-for-freelancers/))
- Free tools stress "no signup, no watermark, PDF in 60 seconds" (InvoiceFormly, Noneedinvoice, SideStackers). InvoiceFormly charges ($9.9/mo) for cloud storage, client management, **recurring templates** and multi-currency, which SASU already offers free except recurring templates — [search results: Product Hunt / sidestackers](https://www.producthunt.com/products/invoiceformly)
- Paid tiers often hold back reminders (Wave Pro, Ninja Pro, Billdu Standard), signatures (Invoice Simple Premium, Billdu Lite, Square Plus) and branding (Wave Pro, Ninja Pro). Vendors evidently see these as features people will pay for — [Wave](https://www.waveapps.com/pricing), [Invoice Ninja](https://invoiceninja.com/pricing-plans/), [Square](https://squareup.com/us/en/invoices/pricing)

### Inferences
- Without a server, SASU cannot send reminders automatically. A local equivalent is still possible: an overdue dashboard plus a "copy reminder email" or `mailto:` draft. This covers the most-valued need within SASU's constraints.
- A payment QR or link printed on the invoice speeds up payment without needing a payment processor.

### Gaps
- No neutral 2025–26 survey or G2/Capterra feature-ranking data was retrieved. Treat the ranking as indicative.

## 3. Client-side feasible vs server-required

### Takeaway
Most document and payment-instruction features can be built client-side: quotes, credit notes, receipts, EPC/UPI QR codes, PayPal.me/Stripe Payment Link fields, label translations, CSV export, PWA offline mode, item catalogue and recurring "templates". Anything that acts while the user is away needs a server: sending email, automatic recurring sends, reminders, online payment status, the client portal and e-invoice transmission.

### Cited Findings
- **EPC QR (SEPA "GiroCode")**, standard EPC069-12 v3.0. Data elements, one per line: Service tag "BCD", version "002" (BIC optional in EEA), charset (1 = UTF-8), "SCT", BIC (optional in v002), beneficiary name ≤70, IBAN ≤34, amount "EUR" + 0.01–999999999.99, purpose, structured reference ≤35 *or* unstructured remittance ≤140, beneficiary-to-originator info. Maximum payload 331 bytes, error correction level **M**, QR version ≤13 — [EPC069-12 v3.0 PDF](https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2022-09/EPC069-12%20v3.0%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT_0.pdf); [segno docs](https://segno.readthedocs.io/en/stable/epc-qrcodes.html); [GiroCode line layout](https://docs.docbits.com/administration-and-setup/settings/document-processing/module/bar-code-qr-code-extraction/girocode)
- **UPI QR**: `upi://pay?pa=<VPA>&pn=<name>&am=<amount>&cu=INR&tn=<note>`. `pa` is mandatory. `cu` supports **INR only**. `tr` (reference) is required for merchant transactions. Values are percent-encoded (%20, not +) per NPCI's UPI Linking Specification — [NPCI linking spec copy (labnol)](https://www.labnol.org/files/linking.pdf); [upiqr README](https://cdn.jsdelivr.net/npm/upiqr@1.3.22/README.md)
- Invoice Now already ships UPI and custom-link QR codes fully client-side, which shows it is feasible — [DEV](https://dev.to/ashutoshkrris/introducing-invoice-now-a-free-privacy-first-invoice-generator-that-runs-entirely-in-your-browser-2pop)
- **French e-invoicing reform**: from 1 Sep 2026 all VAT-registered French companies must be able to *receive* e-invoices through an approved platform. SMEs, micro-enterprises and SASUs must *issue* them from 1 Sep 2027 in structured formats (Factur-X, UBL, CII). Scanned or plain PDFs sent by email will no longer be compliant for domestic B2B — [Hello Monaco](https://www.hellomonaco.com/news/latest-news/goodbye-pdfs-hello-compliance-frances-electronic-invoicing-countdown-has-begun/); [hayot-expertise](https://hayot-expertise.fr/en/blog/mandatory-e-invoicing-software-in-2026-what-every-french-business-needs-to-know). Invoice Ninja sells PEPPOL e-invoicing in its Enterprise plan — [Invoice Ninja](https://invoiceninja.com/pricing-plans/)

### Inferences (feasibility classification)
- **Client-side only:** quotes/estimates with "convert to invoice"; credit notes that reference the original invoice and carry negative totals; receipts/proforma (a document-type switch plus labels); EPC QR; UPI QR; Swiss QR-bill (different spec, not researched); PayPal.me / Stripe Payment Link URL fields rendered as a link and QR in the PDF; translated label packs per invoice language, separate from the UI locale; CSV export of invoices and line items; item/product catalogue in localStorage; recurring "templates" (duplicate with the next number and shifted dates, plus a local "due to re-issue" list); PWA install and offline mode (service worker); signature (draw or upload an image); multiple businesses/workspaces; undo/redo; an outstanding/overdue dashboard; `mailto:` reminder drafts; a time-entries-to-line-items helper; Factur-X *generation* (PDF/A-3 with embedded CII XML, e.g. via pdf-lib — note that full PDF/A-3 conformance from a browser is non-trivial).
- **Needs a server or third party:** sending email from the app (beyond `mailto:`); automatic recurring sending; automatic reminders; online card payment with paid/unpaid status (needs Stripe webhooks; a static Stripe Payment Link pasted by the user works, but status won't sync); read receipts; client portal; multi-device sync; bank feeds; e-invoice *transmission* through a French approved platform (PA/PDP) or a PEPPOL access point.

### Gaps
- Did not verify whether French banks broadly support EPC QR scanning. Adoption is strongest in DE/AT/NL/BE/FI. No source checked.
- Did not research the Swiss QR-bill or Factur-X profile requirements in detail.
- The name "SASU" suggests a French audience. If so, the 2027 e-invoicing mandate is strategically critical, but transmission cannot be done client-side.

## 4. Privacy-first / local-only competitors and how they position themselves

### Takeaway
There is a growing group of "no signup, runs in your browser" generators (Invoice Now, Billfold, DocForge, InvoicesCraft, a Chrome extension). They all compete on privacy and simplicity, so privacy alone no longer sets SASU apart. Features (payment QR, document types, workspaces) and quality now matter more.

### Cited Findings
- Invoice Now: "Everything happens locally in your browser. Once the page loads, your data never leaves your device unless you choose to export it"; no sign-up, cloud or tracking; open source; free with no paywall — [DEV](https://dev.to/ashutoshkrris/introducing-invoice-now-a-free-privacy-first-invoice-generator-that-runs-entirely-in-your-browser-2pop); [Product Hunt](https://www.producthunt.com/products/invoice-now)
- Billfold: "runs entirely in your browser. No account, no backend, no build step", a single index.html — [DEV](https://dev.to/ahmed_memon_f17e868877740/i-built-an-invoice-generator-with-no-backend-the-whole-app-is-one-html-file-1j1g)
- DocForge: "100% private — generated in your browser. No signup, no upload"; invoice, receipt and quote generator — [hunted.space](https://webmail.hunted.space/product/docforge-4)
- Invoice Generator Maker (Chrome extension): "No account. No cloud. All your data stays local… offline access" — [chromeboard](https://chromeboard.com/extension/invoice-generator-maker-dilpeglkhckjpikdfjkeaabhhijpkkej)
- Contrast with hosted tools: Zoho deletes data after 180+ days of inactivity — [Zoho](https://www.zoho.com/invoice/pricing/)

### Inferences
- The privacy pitches are interchangeable. SASU can stand out on **correctness** (integer cents, tax handling, legal fields), **export fidelity** (vector multi-page PDF) and **built-in compliance help** (e-invoicing readiness, legal mentions).
- Offline use and PWA install back up the "local-only" claim. Several rivals say "offline", and SASU should be able to say it too.

### Gaps
- Didn't verify user counts or traction for these local-only tools.

---

## Ranked top gaps for SASU (judgement)

| # | Gap | Why it matters | Feasibility | Effort |
|---|---|---|---|---|
| 1 | **Quotes/estimates + convert to invoice** | Free at Zoho, Wave, Ninja, Square; separate generator at Invoice-Gen.com; core freelancer workflow | Client-side | M |
| 2 | **Payment QR / links on invoice** (EPC SEPA QR, UPI, PayPal.me/Stripe Payment Link URL) | Late payment is the #1 pain point; pay-from-invoice works without a processor | Client-side (qrcode lib; EPC payload ≤331 B, ECC M) | S–M |
| 3 | **Credit notes** (+ receipts/proforma via a doc-type switch) | Legally required for corrections in EU/FR; free at Zoho, Ninja, Invoice-Gen.com | Client-side | S–M |
| 4 | **Invoice label language separate from UI locale** (fr/de/es/it/nl/pt…) | Invoice-Gen.com has 15+; Zoho multi-language; cross-border freelancers | Client-side | S–M |
| 5 | **Overdue/outstanding dashboard + reminder drafts** (mailto/copy text) | Covers the reminder need without a server | Client-side; automatic sending needs a server | S |
| 6 | **Item/product catalogue** | Ninja free, Invoice Simple autofill; speeds repeat billing | Client-side | S |
| 7 | **PWA install + offline** | Strengthens the local-only claim; rivals mention offline | Client-side | S |
| 8 | **CSV export** (invoices, line items, for accountants/tax) | Accountant hand-off; reports | Client-side | S |
| 9 | **Factur-X (PDF/A-3 + CII XML) generation** | Mandatory issuing for FR SMEs/SASUs from Sep 2027 | Generation client-side (hard); transmission needs an approved platform/server | L |
| 10 | **Recurring "templates"** (re-issue next period with incremented number/dates) | Free at Zoho, Ninja, Square, Refrens | Client-side as manual re-issue; automatic sending needs a server | S–M |
| 11 | **Signature** (draw or upload) | Paid feature at Invoice Simple, Billdu, Square | Client-side | S |
| 12 | **Multiple templates/layouts** (beyond colours) | Ninja 11 templates, Square custom templates | Client-side | M |
| 13 | **Multi-business workspaces, undo/redo** | Invoice Now has both | Client-side | M |
| 14 | Time-entries-to-line-items, simple expenses | Zoho/Ninja free; lower priority for a generator | Client-side | M–L |
| — | Email sending, auto reminders, payment status sync, client portal, multi-device sync, read receipts | High value but outside SASU's architecture | Server required | L |
