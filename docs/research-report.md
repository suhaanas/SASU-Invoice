# Make SASU compliant, payable, then e-invoice-ready

SASU Invoice should build **legal correctness and pay-from-invoice features next, then a browser-side Factur-X/ZUGFeRD EN 16931 export**. More generic features should wait. The privacy-first, no-signup pitch is now shared by at least four rival browser-only generators, so it no longer sets SASU apart. Meanwhile the app is missing fields that EU, French and UK law require on every invoice: a supply date, a per-rate VAT breakdown, and structured SIREN, RCS and share-capital mentions for a French SASU. The most visible competitor gaps are quotes, credit notes and payment QR codes. All three can be built without a backend. On e-invoicing, France requires SMEs and SASUs to issue structured e-invoices **through an approved platform (PA) from 1 Sep 2027**. SASU can produce the Factur-X file in the browser. It cannot transmit it, and it must say so plainly. The library stack is healthy. jsPDF 4.2.1 has no open advisories and SASU does not call the APIs hit by its 2026 advisory burst. The bigger operational risk is silent data loss: Safari deletes script-writable storage after seven days without interaction. The backlog at the end merges all three threads. In short: fix data safety and supply-chain hygiene this week, then make invoices legally complete, then make them payable and correctable, then make them machine-readable.

## Privacy is table stakes; document types and payment QR are the gap

Every hosted competitor gives away quotes or estimates, recurring invoices and payment collection in its free tier. **Zoho Invoice** is free with limits of 2 users and **500 invoices a year**, and includes quotes, credit notes, retainers, recurring invoices, reminders and multi-language support ([Zoho](https://www.zoho.com/invoice/pricing/)). Aggregators quote different Zoho limits; the official page above takes precedence. **Invoice Ninja's** free plan caps you at **5 clients**, and its auto-reminders sit in Pro ($14/mo) and PEPPOL e-invoicing in Enterprise ([Invoice Ninja](https://invoiceninja.com/pricing-plans/)). **Wave** charges $19/mo for reminders and even for **logo and brand colours**, both of which SASU gives away free ([Wave](https://www.waveapps.com/pricing)). **Square** includes estimates and automatic reminders in all plans ([Square](https://squareup.com/us/en/invoices/pricing)). **Invoice-Generator.com**, the closest no-signup reference, wins on breadth instead. It has separate generators for quotes, credit notes, receipts, proforma invoices and nine other document types, plus **15+ invoice languages** with editable labels ([invoice-generator.com](https://invoice-generator.com/)). Data on Invoice Simple, Billdu and Refrens comes from aggregator snippets and was not verified on the vendors' own pages.

The browser-only niche is crowded. Invoice Now, Billfold, DocForge and a Chrome extension all make near-identical "your data never leaves your device" claims ([DEV: Invoice Now](https://dev.to/ashutoshkrris/introducing-invoice-now-a-free-privacy-first-invoice-generator-that-runs-entirely-in-your-browser-2pop); [DEV: Billfold](https://dev.to/ahmed_memon_f17e868877740/i-built-an-invoice-generator-with-no-backend-the-whole-app-is-one-html-file-1j1g); [DocForge](https://webmail.hunted.space/product/docforge-4)). Invoice Now already ships **UPI and payment-link QR codes, multiple workspaces and undo/redo** entirely client-side. SASU should therefore compete on correctness (integer cents, legal fields, e-invoice readiness) and export fidelity. "Local-only" is no longer a differentiator.

Late payment is the pain freelancers cite most: 74% report delays in one survey of 400+ US freelancers. That figure comes from vendor content, and the original survey was not identified ([Plutio](https://www.plutio.com/solutions/freelancers/invoicing)). The feasible answer is a payment QR printed on the invoice. The **EPC SEPA QR ("GiroCode")** payload is fully specified: service tag BCD, version 002, IBAN, amount, and a reference, with a maximum of **331 bytes at error-correction level M** ([EPC069-12 v3.0](https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2022-09/EPC069-12%20v3.0%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT_0.pdf)). **UPI** uses `upi://pay?pa=…&am=…&cu=INR`, which supports INR only ([NPCI linking spec copy](https://www.labnol.org/files/linking.pdf)). A user-pasted Stripe Payment Link or PayPal.me URL can also be rendered as a QR. The research did not check whether French banking apps scan EPC QR codes; adoption is known to be strongest in DE, AT, NL, BE and FI.

The line between what SASU can and cannot build is clean. Quotes with "convert to invoice", credit notes, receipts and proforma invoices, payment QR codes, invoice-language label packs, an item catalogue, CSV export, PWA offline mode, recurring "re-issue" templates, signatures, workspaces and an overdue dashboard with `mailto:` reminder drafts **all work client-side**. Sending email, automatic reminders, synced payment status, read receipts, client portals, multi-device sync and e-invoice transmission **all need a server**. SASU should leave them out rather than half-build them.

## Legal completeness: four fields SASU lacks in every EU jurisdiction

The EU VAT Directive's **art. 226 lists 15 mandatory particulars**, including:

- a sequential number in "one or more series";
- the supply date where it differs from the issue date;
- the taxable amount and VAT **per rate**;
- the customer's VAT ID under reverse charge or for intra-EU supplies;
- exemption references;
- "Reverse charge", "Self-billing" and margin-scheme mentions.

**Art. 230** lets the invoice be in any currency, provided the VAT is expressed in the member state's currency ([EUR-Lex 2006/112/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)). *Flag: the EUR-Lex text could not be fetched during research. The art. 226/226b/230 content comes from the researcher's knowledge of a very stable statute. Check the wording against the consolidated text before using it in UI copy.*

France adds about 16 mentions ([service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808)). For a company these include:

- **SIREN, registered office, legal form and share capital** (for example "SASU au capital de 1 000 €");
- the date of sale or service;
- the payment due date;
- "Escompte pour paiement anticipé : néant" (or the early-payment discount terms);
- the late-payment penalty rate;
- the **€40 indemnité forfaitaire pour frais de recouvrement** for business clients;
- conditional mentions such as **"TVA non applicable, art. 293 B du CGI"** and **"Autoliquidation"**.

The same page lists four mentions added by the e-invoicing reform: **client SIREN, delivery address if different, the nature of the operation (goods, services or both), and the "option pour le paiement de la taxe d'après les débits"**. They apply from 1 Sep 2027 for SMEs and micro-enterprises. *Flag, not re-fetched (Légifrance was unreachable): the "RCS + city" requirement ([R123-237](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006256237)), the €15-per-missing-mention tax fine ([CGI art. 1737](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006312398)), and 10-year commercial retention.* A single "Tax / VAT ID" field cannot hold all of this. SASU needs a structured French seller profile and generated footer presets, not free text.

In the UK, **VAT Regulations 1995 reg. 14** requires a time of supply (tax point), unit price, a per-line VAT rate, the total VAT and a "reverse charge" reference where it applies ([legislation.gov.uk](https://www.legislation.gov.uk/uksi/1995/2518/regulation/14)). VAT amounts must always be expressed in sterling ([VAT Notice 700](https://www.gov.uk/guidance/vat-guide-notice-700)). Limited companies must show their registered number, registered office and place of registration ([GOV.UK](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material)). *The simplified-invoice limit of £250 and the 30-day issue rule come from VAT Notice 700/21, which was not re-fetched.*

India's **CGST Rule 46** tax invoice is a different model ([CBIC Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), read via the [GSTZen mirror](https://gstzen.in/a/tax-invoice-cgst-rule-46.html)). It requires:

- GSTINs;
- a **serial number of 16 characters or fewer, unique per financial year**;
- **HSN/SAC codes**: 4 digits up to ₹5 crore turnover, 6 digits above ([Notif. 78/2020](https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-78-central-tax-english-2020.pdf));
- CGST/SGST or IGST split by place of supply;
- a reverse-charge indicator;
- e-invoicing (IRN and QR) above ₹5 crore turnover, which a browser cannot generate.

*Clauses (c) to (m) of Rule 46 were not verified verbatim.*

The US has no federal invoice-content law. Its main gap is per-line taxability, because many services are exempt from sales tax. The 1099-NEC threshold rose to **$2,000 for payments after 31 Dec 2025** under OBBBA §70433. That figure comes from secondary sources ([Instead.com](https://instead.com/resources/blog/w-9-and-backup-withholding-for-contractors-in-2026)); the primary IRS page was not fetched.

Every regime requires unique sequential numbering, and corrections must be made by a **credit note that references the original invoice**. A localStorage tool cannot guarantee retention or immutability. It can still reserve a number only when an invoice is issued, lock issued invoices as read-only, and turn "delete" into "cancel via credit note".

| Field SASU lacks or under-models | EU | FR | UK VAT | IN | US |
|---|---|---|---|---|---|
| Supply / tax-point date | Conditional | Mandatory | Mandatory | Conditional | Recommended |
| VAT breakdown per rate + per-line category | Mandatory | Mandatory | Mandatory | Mandatory (per tax head) | Conditional |
| Exemption / reverse-charge mentions | Conditional | Conditional | Conditional | Mandatory flag | – |
| Structured company IDs (SIREN/RCS/capital; Ltd number) | – | Mandatory | Ltd: mandatory | GSTIN | – |
| Client SIREN, delivery address, operation type | – | Mandatory from 2027 | – | – | – |
| VAT total in national currency | Mandatory | EUR | GBP | INR | – |
| Credit note referencing original | Mandatory | Mandatory | Mandatory | Mandatory | Recommended |

## Factur-X EN 16931 can be built in the browser, but transmission cannot

The current specification is **Factur-X 1.09.2 / ZUGFeRD 2.5.2**, published 4 Aug 2026 on UN/CEFACT CII D22B ([FNFE-MPE](https://fnfe-mpe.org/factur-x/factur-x_en/); [VATupdate](https://www.vatupdate.com/2026/08/11/germany-and-france-update-zugferd-2-5-for-2026-e-invoicing-compliance/)). SASU should target the **EN 16931 profile**, the only one accepted in both target countries:

- **Germany** accepts all ZUGFeRD 2.x profiles except MINIMUM and BASIC WL ([IHK Köln on the BMF letter of 15 Oct 2025](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012)).
- **France** is stricter, but the sources conflict. A French explainer citing **AFNOR XP Z12-012 v1.4 (July 2026)** says only EN 16931 and EXTENDED-CTC-FR are declarable profiles, with BASIC WL tolerated until Sept 2027 ([ma-facture-electronique.org](https://ma-facture-electronique.org/formats-normes/factur-x/); corroborated by [an open-source project's PR](https://github.com/guitwo63/Facture_elec/pull/131)). FNFE-MPE's English page still says "BASIC and above". *Neither the AFNOR text nor the DGFiP specifications could be opened, so check before making any claim in the UI.*

The mandates make this export valuable but not sufficient:

- **France:** reception is mandatory for all businesses from **1 Sep 2026**, and SMEs issue through a PA from **1 Sep 2027** ([Pennylane](https://www.pennylane.com/fr/fiches-pratiques/facture-electronique/formats-facture-electronique)). The DGFiP published its first list of **101 PAs on 16 Jan 2026** ([impots.gouv](https://www.impots.gouv.fr/actualite/facturation-electronique-publication-de-la-liste-des-plateformes-agreees?lang=en)). Between French VAT-registered businesses, a PDF or even a Factur-X sent by email will no longer count as compliant issuance. *Secondary source only ([ma-facture-electronique.org](https://ma-facture-electronique.org/formats-normes/factur-x/)); economie.gouv.fr returned 403.*
- **Germany:** businesses with turnover above €800k must issue e-invoices from 2027, and all businesses from 2028. Kleinunternehmer are permanently exempt ([ecosio](https://ecosio.com/de/blog/e-invoicing-e-rechnungspflicht/)). An emailed ZUGFeRD EN 16931 file is a fully valid E-Rechnung, which makes Germany **the clearest win for a client-side tool**.
- **Belgium:** B2B invoices have gone over **Peppol since 1 Jan 2026**, with fines of €1,500 to €5,000 ([BDO](https://www.bdo.be/en-gb/insights/news-alerts/2025/mandatory-e-invoicing-in-2026-in-belgium-three-month-tolerance-period)). A UBL file only helps if the user uploads it to a Peppol provider.
- **EU (ViDA):** e-invoicing for intra-EU B2B starts **1 Jul 2030** ([PwC](https://www.pwc.lu/en/newsletter/2025/vat-in-the-digital-age-vida.html)).
- **Out of scope:** Poland's KSeF uses a proprietary FA(3) schema and India's IRP is a clearance model.

The research could not establish **whether French PAs aimed at micro-businesses accept uploaded third-party Factur-X files**. That single unknown decides how useful the feature is to French users, and it should be checked with two or three PAs before committing L-sized effort.

Technically, **jsPDF cannot produce PDF/A-3b on its own**. It has no OutputIntent and no /AF associated-file support. That conclusion is inferred from library knowledge and the absence of evidence, not confirmed in jsPDF's docs. The practical path is a post-processing step:

1. Keep jsPDF for rendering, and **embed Inter for every text run**. jspdf-autotable's default Helvetica is a non-embedded standard-14 font, which breaks PDF/A.
2. Lazy-load **@cantoo/pdf-lib**. It is the maintained fork; the original pdf-lib has had no release since Nov 2021 ([Cantoo README](https://unpkg.com/@cantoo/pdf-lib@2.7.1/README.md)).
3. Use it to attach `factur-x.xml` with AFRelationship `/Alternative`, and add the catalog /AF array, an sRGB OutputIntent, the pdfaid/fx XMP metadata and a trailer /ID.

Existing libraries do this already but all warn about PDF/A reliability. **@e-invoice-eu/core** (WTFPL) is the only one that documents browser support, and it calls its PDF/A path "not battle-tested" ([GitHub](https://github.com/gflohr/e-invoice-eu)). **@stafyniaksacha/facturx** does not document browser support ([GitHub](https://github.com/stafyniaksacha/facturx)). For SASU, a small dependency-free CII serializer is safer than a heavy dependency: it can escape every string in line with the existing XSS tests. It should be backed by **veraPDF and Mustang validation in CI**, a TypeScript pre-flight check in the app, and links to external validators.

Avoid in-browser XSD validation with libxml2-wasm unless adding `'wasm-unsafe-eval'` to the CSP is acceptable. The data model also has to grow:

- structured addresses with ISO country codes;
- UN/ECE unit codes;
- a per-line VAT category (S/Z/E/AE/K/G/O) with an exemption reason;
- a payment-means code with IBAN;
- type code 381 for credit notes.

These overlap almost entirely with the legal fields in the previous section. **Doing the compliance work first gets SASU most of the way to e-invoicing.** The e-invoicing note estimates 2–4 developer-weeks for the export itself, with PDF/A conformance as the main iteration risk. Spec churn is another ongoing cost: five Factur-X versions shipped in about 18 months.

## jsPDF is safe as used; data loss is the larger risk

jsPDF has had **10 advisories between January and March 2026**. They include critical PDF object injection via `addJS` (CVE-2026-25755) and HTML injection in `output('*newwindow')` (CVE-2026-31938, fixed in 4.2.1) ([GitHub advisories](https://github.com/parallax/jsPDF/security/advisories); [GHSA-wfv2-pwc8-crg5](https://github.com/advisories/GHSA-wfv2-pwc8-crg5)). Snyk reports **no vulnerabilities affecting 4.2.1** ([Snyk](https://security.snyk.io/package/npm/jspdf)). A grep of the local repo shows SASU calls only `addImage` with a canvas-re-encoded logo and `output('blob')`. Its remaining exposure is the image-decoder DoS class (PNG, GIF and BMP: CVE-2025-57810, CVE-2026-25535, CVE-2026-24133). One gap matters: **the JSON-import path may hand `style.logo` to `addImage` without re-encoding it**, so the canvas step needs to run on restore too.

The other dependencies are clean:

- **jspdf-autotable 5.0.8**, **@zumer/snapdom 3.2.0** and **zod 4.6.5** have no advisories ([OSV](https://osv.dev/list?q=jspdf-autotable&ecosystem=npm); [snapdom](https://github.com/zumerlab/snapdom)). Zod's only advisory was a 2023 ReDoS in 3.22.2 ([Snyk](https://security.snyk.io/vuln/SNYK-JS-ZOD-5925617)).
- A local `npm audit` found 0 vulnerabilities.
- The realistic threat is account takeover. Each runtime package is published from a single npm account, and the **Shai-Hulud worms** of 2025 republished hundreds of trojanized packages through stolen maintainer credentials ([DevOps.com](https://devops.com/how-github-plans-to-secure-npm-after-recent-supply-chain-attacks/)). The fixes cost little: pin GitHub Actions by SHA, run `npm audit signatures`, use `npm ci --ignore-scripts` where possible, and add a dependency cooldown.

The CSP is already strong. Trusted Types reached Baseline in every major browser in **Feb 2026**, when Firefox shipped it; that date comes from secondary sources and was not confirmed in BCD ([URIports](https://www.uriports.com/blog/csp-trusted-types/)). Adding `require-trusted-types-for 'script'` would make SASU's ESLint innerHTML ban browser-enforced. Ship it first as `Content-Security-Policy-Report-Only` with a reporting endpoint, to catch any sinks inside snapdom ([Netlify CSP docs](https://docs.netlify.com/manage/security/content-security-policy/)). SASU's own code sets styles only through CSSOM, so **`'unsafe-inline'` can likely come out of style-src**. Use `style-src-attr` as a fallback if snapdom needs it. Smaller header changes:

- drop the obsolete `interest-cohort=()`;
- widen the Permissions-Policy deny list;
- add HSTS `preload`;
- keep X-Frame-Options as a legacy fallback ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html));
- self-host the ProductHunt badge.

WebKit **deletes all script-writable storage, IndexedDB included, after seven days of Safari use without interaction** ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). A Safari user who comes back two weeks later can therefore find their saved invoices and client book gone. Switching to IndexedDB does not fix this on its own. Mitigations:

- backup nudges with a last-backup timestamp;
- `navigator.storage.persist()`, though whether it overrides ITP is unverified;
- PWA install, since home-screen apps keep their own counter;
- a "clear all data on this device" button, because client names, VAT numbers and IBANs are GDPR personal data on shared machines.

Moving to IndexedDB with Blob logos is still worthwhile, because it avoids the roughly 5 MB localStorage quota and base64 bloat. For PDF libraries, **no alternative beats jsPDF + autotable for rendering**. pdfmake has a large bundle and a historical eval CVE ([INCIBE](https://www.incibe.es/en/incibe-cert/early-warning/vulnerabilities/cve-2022-46161)). @react-pdf/renderer needs React and has had CSP eval issues ([Lightrun](https://lightrun.com/answers/diegomura-react-pdf-cant-use-with-content-security-policy)). @cantoo/pdf-lib should be added for the Factur-X step only, not as a replacement. The bundle sizes in the notes were estimated, not measured.

## What SASU must tell users it does not do

Factur-X and "compliance" features invite over-trust, so the limits need to sit in the UI next to the export button and on the landing page, not only in a FAQ. The core facts:

- **SASU does not transmit invoices.** It is not a French Plateforme Agréée (PA), is not connected to one, and is not a Peppol access point. From 1 Sep 2027, French B2B invoices must go through the user's own PA, and Belgian B2B invoices must already go over Peppol.
- **It does no e-reporting.** It does not report B2C, international or payment data to the DGFiP, does not handle lifecycle statuses, and does not look up the French directory (annuaire).
- **It does not connect to clearance systems.** It does not generate an Indian IRN or e-invoice QR and does not connect to Poland's KSeF or Italy's SdI.
- **It is not a legal archive.** Data lives only in this browser and can be evicted. France requires 10-year retention, the UK 6 years and Germany 8 years.
- **It does not guarantee compliance.** Files follow EN 16931 / Factur-X, but users should confirm with their PA, accountant or a validator.
- **It has no server features.** It does not send email or automatic reminders and does not track payment status.

Suggested copy:

> SASU Invoice creates invoice files on your device; it never sends them anywhere. It is **not** a Plateforme Agréée or a Peppol access point and does not perform e-reporting. From 1 September 2027, invoices between French businesses must be sent through your approved platform. Upload SASU's Factur-X file there rather than emailing it. Your data is stored only in this browser and may be deleted by the browser; export backups and keep your own archive for the legally required period.

## Prioritized backlog across all three threads

Priorities: **P0** means do now (cheap, protects users or the codebase). **P1** means legal completeness and the top competitor gaps. **P2** means e-invoicing and differentiation. **P3** means nice-to-have.

| Priority | Item | Effort | Rationale |
|---|---|---|---|
| P0 | Re-encode and size-cap `style.logo` on JSON import, same as the upload path | S | Closes the remaining jsPDF image-decoder DoS path (CVE-2025-57810 / 2026-25535 / 2026-24133) |
| P0 | Data-loss guard: last-backup timestamp, backup nudges, `storage.persist()`, Safari 7-day warning, "clear all data" button, "not a legal archive" notice | S | WebKit evicts all storage after 7 days; GDPR exposure on shared machines; retention rules of 6–10 years |
| P0 | Supply-chain hardening: SHA-pin Actions, `permissions: read`, `npm audit signatures`, `npm ci --ignore-scripts`, update cooldown | S | Single-publisher packages; Shai-Hulud account-takeover precedent |
| P0 | ESLint ban on `addJS`, AcroForm, `createAnnotation`, `html()`, `addSvgAsImage`, `output('*newwindow')`; stay on jsPDF ≥4.2.1 | S | All critical 2026 jsPDF advisories sit in these APIs |
| P0 | User-facing "what SASU does not do" disclaimer (copy above) | S | Prevents users assuming e-invoicing compliance ahead of the Sep 2026/2027 French dates |
| P1 | Supply / delivery / tax-point date field with "same as issue date" toggle | S | Mandatory in EU art. 226(7), France and UK reg. 14 |
| P1 | Per-line VAT category (S/Z/E/AE/K/G/O) + per-rate VAT breakdown block | M | Required by art. 226(8–10), UK and FR; also the core of EN 16931 BG-23 |
| P1 | Legal-mention presets: 293 B franchise, Autoliquidation/reverse charge, intra-EU exemption, self-billing, margin schemes; customer VAT ID required on reverse charge | M | Conditional art. 226 mentions; French fine per missing mention (not re-fetched); verify CGI article strings first |
| P1 | French SASU profile: SIREN/SIRET, RCS city, legal form, share capital, FR VAT ID; generated B2B footer (penalty rate, €40 indemnity, escompte néant) | M | Mandatory French mentions for companies; SASU's namesake audience |
| P1 | Issue/lock workflow: draft → issued (read-only) → paid/cancelled; per-series counters assigned on issue; gap/duplicate warnings | M | Sequential numbering and immutability in every regime |
| P1 | Credit notes (type 381) created from an invoice, referencing its number and date | M | Legally required correction mechanism; free at Zoho, Ninja and Invoice-Generator.com |
| P1 | Quotes/estimates with "convert to invoice"; receipt/proforma via a document-type switch | M | Top competitor gap; free at Zoho, Wave, Ninja and Square |
| P1 | Payment QR: EPC SEPA (≤331 B, ECC M), UPI, user-pasted Stripe/PayPal link | S | Late payment is the top pain point; fully client-side; Invoice Now already has it |
| P1 | French reform fields: client SIREN, delivery address, operation category, "débits" option | S | Mandatory for SMEs from 1 Sep 2027; map directly to Factur-X |
| P2 | Structured addresses (ISO 3166 country), UN/ECE unit codes, payment-means code + IBAN/BIC | M | Prerequisite for valid EN 16931 CII; reuses P1 fields |
| P2 | Embed Inter for all text, including autotable (no standard-14 fonts) | S | PDF/A-3 blocker; harmless for normal PDFs |
| P2 | Factur-X/ZUGFeRD EN 16931 export: TS CII D22B serializer + lazy @cantoo/pdf-lib PDF/A-3 step + veraPDF/Mustang CI + in-app pre-flight | L | Valid E-Rechnung in Germany by email; upload file for French PAs (confirm PAs accept uploads first); ViDA-ready |
| P2 | CSP Report-Only → enforce Trusted Types, `style-src 'self'`, Reporting-Endpoints | M | Baseline since Feb 2026 (secondary source); makes the innerHTML ban browser-enforced |
| P2 | Header cleanup: drop interest-cohort, widen Permissions-Policy, HSTS preload, trim unused CSP sources, self-host badge | S | Brings headers in line with OWASP; removes a third-party request |
| P2 | Invoice label language independent of UI locale | M | Invoice-Generator.com offers 15+; serves cross-border freelancers |
| P2 | Overdue dashboard + `mailto:`/copy reminder drafts | S | Covers the reminder need without a server |
| P2 | VAT total in national currency with rate and source when invoice currency differs | S | EU art. 230 (not re-fetched); UK Notice 700 sterling rule |
| P2 | PWA install + offline service worker | S | Backs up the local-only claim; resets Safari's ITP counter for home-screen apps |
| P2 | UK Ltd preset (company number, registered office, place of registration) + VAT-registered toggle; US "sales tax" label, per-line taxable flag, exemption certificate no. | S | Low-cost jurisdiction coverage |
| P3 | Item/product catalogue; CSV export of invoices and lines | S | Repeat-billing speed; hand-off to accountants |
| P3 | Recurring "re-issue next period" templates | S | Free at Zoho, Ninja and Square; automatic sending stays out of scope |
| P3 | Migrate storage to IndexedDB with Blob logos; schema migrations that quarantine invalid data instead of wiping it | M | Avoids the ~5 MB quota and base64 bloat; does not fix ITP on its own |
| P3 | UBL (Peppol BIS 3.0) XML export | S | Upload path for Belgian Peppol providers and PAs; after Factur-X |
| P3 | Signature block, multiple layouts, workspaces, undo/redo | M | Paid features at competitors; Invoice Now parity |
| P3 | Opt-in passphrase encryption (AES-GCM + PBKDF2 via Web Crypto) for storage and backups | M | Protects data at rest on shared machines; no CSP change |
| P3 | India GST mode: GSTIN, place of supply, CGST/SGST/IGST split, HSN/SAC, 16-char FY series, Bill of Supply, IRN warning | L | Large scope; a market separate from the French core |
| P3 | Per-jurisdiction compliance checker panel | L | Depends on all P1 fields; turns the jurisdiction matrix into pre-export warnings |
| Won't do | Email sending, auto reminders, payment-status sync, client portal, multi-device sync, PA/Peppol transmission | L | Needs a backend; conflicts with the browser-only architecture |

## Conclusion

Legal compliance and e-invoicing turn out to be one roadmap, not two. The fields France and the EU require on paper invoices today are the same ones EN 16931 needs: supply date, VAT category per line, per-rate breakdown, structured IDs, client SIREN and credit-note references. Every P1 compliance item therefore also counts as progress toward Factur-X. This changes the strategic picture. A browser-only tool can still produce the e-invoice file SMEs will need, and for German users that file alone is a valid E-Rechnung. What it cannot be is the delivery channel. In France the value moves to the PA in 2027, so SASU's role there is to prepare good data, not to deliver it. Germany is the clearest market for a client-side e-invoice generator.

Two unknowns should be resolved before the L-sized work starts. First, whether French micro-business PAs accept uploaded third-party Factur-X files. Second, whether jsPDF output plus a pdf-lib post-process passes veraPDF. A one-week spike that exports one golden invoice and runs it through veraPDF and Mustang answers the second question. Until both are known, the P0 and P1 items are where the value is: they protect users from data loss and make every PDF SASU produces lawful.
