# E-invoicing standards, mandates and browser-side Factur-X/ZUGFeRD feasibility for SASU Invoice

Research date: 2026-10-05. Items marked (2025–26 change) are recent developments worth flagging. Sources are a mix of primary (FNFE-MPE, FeRD, impots.gouv, IHK citing BMF) and secondary (advisory firms and vendor blogs). Where a fact rests only on secondary sources, it says so.

## 1. Factur-X / ZUGFeRD: versions, profiles, acceptance in France and Germany, required data

### Takeaway
The current spec is **Factur-X 1.09.2 / ZUGFeRD 2.5.2**, published 4 Aug 2026 and effective 1 Sep 2026. It uses CII D22B and stays backward compatible with D16B. **Germany** accepts every ZUGFeRD ≥2.0.1 profile except MINIMUM and BASIC WL. **France** is stricter: under AFNOR XP Z12-012 v1.4 (June 2026), only **EN 16931** and **EXTENDED-CTC-FR** are "declarable" profiles. BASIC WL is allowed only temporarily, until Sept 2027, and BASIC is not retained. SASU should target the **EN 16931 profile**. It is the only profile accepted in both countries, and it needs line items, which SASU already has.

### Cited Findings
- (2025–26 change) Factur-X 1.08 / ZUGFeRD 2.4 was announced on 4 Dec 2025 and applied from 15 Jan 2026. It is backwards compatible, aligns with the biannual EN 16931 update and adds sub-line management (subtotal lines, kits and bundles). Reference profiles include XRECHNUNG (DE) and EXTENDED-CTC-FR (FR), which is a subset of EXTENDED. — [FNFE-MPE press release Dec 2025](https://fnfe-mpe.org/wp-content/uploads/2025/12/2025-12-04_Factur-X_1.08_ZUGFeRD_2.4_Press_Release_EN.pdf); [FeRD ZUGFeRD 2.4](https://www.ferd-net.de/en/downloads/publications/details/zugferd-24-english)
- (2026 change) **Factur-X 1.09.2 / ZUGFeRD 2.5.2 was published on 4 Aug 2026** and is described as the latest release, with corrections to the 10 June iteration. FeRD says 2.5.2 is effective from 1 Sep 2026. It uses UN/CEFACT CII **D22B**, backward compatible with D16B, and adds fixes for VAT breakdown, rounding and EXTENDED cardinalities. — [FNFE-MPE Factur-X EN page](https://fnfe-mpe.org/factur-x/factur-x_en/); [VATupdate, 11 Aug 2026](https://www.vatupdate.com/2026/08/11/germany-and-france-update-zugferd-2-5-for-2026-e-invoicing-compliance/)
- There are five profiles: MINIMUM (header only, roughly what OCR captures), BASIC WL (document-level data, no lines), BASIC (BASIC WL plus core lines), EN16931 ("Comfort", full EN), and EXTENDED (EN plus extra data). The hybrid file is a readable PDF/A-3 plus a CII XML conformant to EN 16931. — [FNFE-MPE](https://fnfe-mpe.org/factur-x/factur-x_en/)
- **Germany:** the BMF letter of 15 Oct 2025 accepts formats compliant with EN 16931 (XRechnung, ZUGFeRD 2.x from 2.0.1) **except the MINIMUM and BASIC-WL profiles**, which lack mandatory VAT details and count only as booking aids. — [IHK Köln on BMF letter 15.10.2025](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012); [Spendesk DE](https://www.spendesk.com/de/blog/zugferd-rechnung-e-rechnungspflicht/)
- **France (conflicting sources, 2026 change):**
  - FNFE-MPE's EN page says Factur-X is one of the three base formats and that "BASIC and above" are valid. — [FNFE-MPE](https://fnfe-mpe.org/factur-x/factur-x_en/)
  - A French explainer citing **AFNOR XP Z12-012 v1.4 (dated 30 Jun 2026, published 1 Jul 2026)** says only EN 16931 and EXTENDED-CTC-FR are declarable. In that source, MINIMUM is "non utilisable comme profil cible", BASIC WL is "autorisé au démarrage, jusqu'en septembre 2027", and BASIC is "non retenu comme profil déclaré". — [ma-facture-electronique.org](https://ma-facture-electronique.org/formats-normes/factur-x/)
  - An open-source French project removed MINIMUM, BASIC WL and BASIC because their XML is rejected by the "Schematron France CTC" rules BR-FR-05/12/13. — [GitHub guitwo63/Facture_elec PR #131](https://github.com/guitwo63/Facture_elec/pull/131)
  - An older secondary source says the DGFiP would accept MINIMUM, BASIC WL and BASIC. This looks outdated. — [lido.app](https://www.lido.app/fr/factur-x)
- France's three base formats, which every Plateforme Agréée (PA) must support for sending and receiving, are **UBL, CII and Factur-X**. — [Pennylane](https://www.pennylane.com/fr/fiches-pratiques/facture-electronique/formats-facture-electronique); [Quadient](https://www.quadient.com/fr/blog/formats-facturation-electronique-france)
- New French mandatory mentions under Decree 2022-1299:
  - **Buyer SIREN**, the routing pivot
  - **Delivery address** if it differs from the billing address
  - **Category of operation**: goods, services or mixed
  - **VAT-on-debits option**

  — [ma-facture-electronique.org](https://ma-facture-electronique.org/formats-normes/factur-x/)

### Inferences
- **Fields SASU must add for a valid EN 16931 CII**, based on EN 16931 business terms (BT numbers from the standard; individual BT numbers not re-verified in this session):
  - **Invoice header:**
    - Invoice type code (BT-3, UNTDID 1001: 380 invoice, 381 credit note)
    - Currency (BT-5; SASU already has ISO 4217)
    - Optional buyer reference / PO (BT-10/BT-13). XRechnung requires BT-10 (Leitweg-ID).
  - **Seller:**
    - Country code ISO 3166-1 alpha-2 (BT-40), with structured address split into line, city, postcode and country. SASU stores the address as free text today.
    - VAT ID (BT-31) and/or legal registration ID (BT-30, SIREN with scheme 0002)
    - For France, a SIRET/SIREN and an electronic address (BT-34, scheme 0225 for the French directory)
  - **Buyer:**
    - Country code (BT-55)
    - Buyer SIREN (BT-47) for French B2B
    - Buyer VAT ID (BT-48) when reverse charge or intra-EU
    - Buyer electronic address (BT-49)
  - **Lines:**
    - **Unit code from UN/ECE Rec 20/21** (BT-130: C62 piece, HUR hour, DAY, KGM, …). SASU's free-text "unit" needs a mapping or picker.
    - **VAT category code per line** (BT-151, UNCL5305): S standard, Z zero, E exempt, AE reverse charge, K intra-EU, G export, O out of scope
    - Rate (BT-152)
  - **VAT breakdown (BG-23):** one group per category/rate, with taxable amount, tax amount and category. Exemptions (E/AE/K/O) need an **exemption reason text or code** (BT-120/121, VATEX list). This matters for French auto-entrepreneurs under "TVA non applicable, art. 293 B du CGI": category E plus a reason.
  - **Totals (BG-22):**
    - Sum of lines, allowances, charges, tax-exclusive, tax, tax-inclusive, prepaid (maps from "amount paid"), due payable
    - SASU's document-level discount maps to a document allowance (BG-20) with its own VAT category
    - Shipping maps to a document charge (BG-21) with its own VAT category
    - Rounding must satisfy the BR-CO arithmetic rules
  - **Payment:**
    - Payment means code (BT-81, UNCL4461: 30 credit transfer, 58 SEPA credit transfer, 48 card, 10 cash)
    - IBAN/BIC (BT-84/86)
    - Due date (BT-9) or payment terms (BT-20)
  - **France-specific:** operation category (goods/services/mixed), VAT-on-debits flag, and delivery address if different.
- SASU's "tax label" and a single document "tax rate" are not enough. The XML needs category-coded VAT per line and per breakdown group. The fix is a VAT-category select per line, defaulting to S, plus an exemption-reason field.

### Gaps
- I could not open the AFNOR XP Z12-012 v1.4 text or the DGFiP external specifications directly. Exclusion of BASIC, and BASIC WL being "transitional to Sept 2027", rest on secondary French sources plus one GitHub PR. FNFE-MPE's EN page still says "BASIC and above". This needs checking against the DGFiP specs (impots.gouv) before making claims in the UI.
- I did not verify the exact BR-FR rule texts or the 0225 electronic-address scheme from a primary source.

## 2. PDF/A-3 container: can jsPDF and @cantoo/pdf-lib produce a valid Factur-X, and which JS libraries exist?

### Takeaway
jsPDF on its own cannot produce PDF/A-3b. It has no OutputIntent/ICC support, no PDF/A XMP identification or Factur-X extension schema, and no associated-file (/AF) support. I found no evidence otherwise. The realistic path is: render the visual invoice with jsPDF as today, then post-process the bytes with **@cantoo/pdf-lib** (or a library built on pdf-lib). That step attaches `factur-x.xml` with AFRelationship (Alternative for EN 16931), adds the catalog /AF array, an sRGB OutputIntent, XMP (pdfaid part=3 conformance=B plus the fx: extension schema) and a document ID. Several TS libraries already do exactly this on pdf-lib. None is clearly marketed as browser-tested, and all say PDF/A output must be validated.

### Cited Findings
- PDF/A compliance requires embedded PDF/A XMP metadata, an sRGB OutputIntent and other structural requirements. PDF/A-3b allows arbitrary attachments such as invoice XML. — [search summary of PDF/A tooling docs](https://abacktools.com/tools/pdf/security/pdf-to-pdfa)
- When converting, the XMP structure must be correct and /OutputIntents and /ID must be carried into the target. — [debian-factur-x commit "Fix XMP metadata structure"](https://git.entrouvert.org/entrouvert/debian-factur-x/commit/39fe7e9289e22e3440f90c63c1dc9478a2330343)
- AFRelationship valid values are Source, Data, Alternative, Supplement and Unspecified. "Alternative" means the file is an alternative representation of the document content. — [pdf-tools SDK docs](https://api-reference.pdf-tools.com/pdfsdk/1.19/pydocs/_autosummary/pdftools_sdk.pdf_a.conversion.a_f_relationship.html)
- **@e-invoice-eu/core** (GitHub gflohr/e-invoice-eu):
  - License: **WTFPL**
  - Generates CII, UBL, all Factur-X profiles plus ZUGFeRD aliases, and XRechnung CII/UBL
  - **Works in browsers**, with a browser demo. The one exception is spreadsheet-to-PDF rendering, which needs LibreOffice.
  - Uses **pdf-lib** with "pretty complicated transformations" for PDF/A, and warns this is "not battle-tested and may fail"
  - Active project (1,836 commits)

  — [GitHub e-invoice-eu](https://github.com/gflohr/e-invoice-eu)
- **@stafyniaksacha/facturx** (GitHub stafyniaksacha/facturx):
  - TS port of Akretion's Python factur-x
  - Generates PDF/A-3 by embedding XML; also extracts, parses and serializes
  - Validates against XSD and optional EN 16931 Schematron via **libxml2-wasm**
  - Supports all five profiles at Factur-X 1.09 / ZUGFeRD 2.5 (CII D22B)
  - ESM-only, needs Node ≥20.11; **browser support not documented**

  — [GitHub facturx](https://github.com/stafyniaksacha/facturx)
- **@stackforge-eu/factur-x** (JSR):
  - License: **EUPL-1.2**; version 1.4.3, published about late Sep 2026
  - CII for Factur-X 1.09 / ZUGFeRD 2.5, PDF/A-3 embedding with XMP and ICC, XSD validation via libxml2-wasm, standalone XRechnung
  - Browser compatibility "unknown"

  — [JSR @stackforge-eu/factur-x](https://jsr.io/@stackforge-eu/factur-x)
- **node-zugferd**: creates Factur-X XML, attaches it to PDF/A-3b and validates. The npm README describes it as "still under development". — [npm node-zugferd](https://npmjs.com/package/node-zugferd); [unpkg README 0.0.10-beta.1](https://unpkg.com/node-zugferd@0.0.10-beta.1/README.md)
- **factur-x-kit** is another all-in-one TS library for hybrid invoices, at version 0.3.2. — [jsDelivr README](https://cdn.jsdelivr.net/npm/factur-x-kit@0.3.2/README.md)

### Inferences
These come from library knowledge and were not re-verified from primary docs in this session.
- **jsPDF 4.2:**
  - It can write custom XMP via its `addMetadata` plugin, but it does not emit an OutputIntent, /AF or a PDF/A-conformant trailer ID.
  - Any text drawn with the built-in standard-14 fonts (Helvetica, which jspdf-autotable uses by default) is **not embedded**, which breaks PDF/A. Every text run, autotable cells included, must use the embedded Inter subset.
  - Transparency (opacity/GState) is allowed in PDF/A-2/3, but needs the OutputIntent. Any image with an alpha channel must be checked.
- **pdf-lib (and @cantoo/pdf-lib):**
  - `PDFDocument.attach()` accepts an `afRelationship` option and sets it on the file spec.
  - It probably does not add the catalog-level `/AF` array. Existing libraries add that by hand with low-level `context.obj()` calls, alongside `/OutputIntents` (embedding an sRGB ICC stream of about 3 KB) and the `/Metadata` XMP stream.
  - Prefer @cantoo/pdf-lib, the maintained fork, over the unmaintained original.
  - Loading a jsPDF output into pdf-lib and saving it again is a well-trodden path. `useObjectStreams: false` may be safer for veraPDF.
- **CSP risk:** libxml2-wasm (for XSD/Schematron validation) needs `'wasm-unsafe-eval'` in script-src to compile WASM under a strict CSP. That loosens SASU's current `script-src 'self'` policy. Recommendation: do no in-browser XSD validation, or add only `'wasm-unsafe-eval'`, which still forbids JS eval.
- **Bundle size:** pdf-lib is about 200–300 KB minified (est.), loaded lazily only on "Export Factur-X". Writing the CII XML with a template or DOM builder adds little.
- @e-invoice-eu/core has the best-documented browser support and the most permissive license. For SASU it may be simplest to use it only for **XML generation** (CII/UBL) and do PDF/A-3 embedding itself with @cantoo/pdf-lib, or to use its embedding if it can take an existing PDF.

### Gaps
- I could not confirm from jsPDF docs or issues that it has no PDF/A support. This is inferred from the absence of any search hits and from library knowledge.
- I could not confirm the exact pdf-lib `attach()` signature or the `/AF` catalog handling in @cantoo/pdf-lib 2.11.
- I could not confirm bundle sizes or whether any of the libraries above run unchanged in a Vite browser build (Node `Buffer` or `fs` usage). This needs a spike.
- The npm page for node-zugferd returned 403, so its license and latest version are unverified.

## 3. Validators: client-side or link-out?

### Takeaway
No complete client-side validator exists. A full Factur-X check needs both a **PDF/A check** (veraPDF, Java) and an **XML check** (XSD plus EN 16931 Schematron, plus France CTC or XRechnung rules). Partial in-browser XML validation is possible with libxml2-wasm XSD, at a CSP cost. Schematron needs XSLT 2/3 (SaxonJS), which is heavy. SASU should run unit tests with veraPDF and Mustang in CI, and offer **link-outs** to free online validators.

### Cited Findings
- FNFE-MPE publishes XSD schemas, Schematron rules and code lists per profile. — [FNFE-MPE](https://fnfe-mpe.org/factur-x/factur-x_en/)
- @stafyniaksacha/facturx validates XSD and optional EN 16931 Schematron with libxml2-wasm. — [GitHub facturx](https://github.com/stafyniaksacha/facturx)
- Free French online checkers exist, for example conformicheck.fr and facturevalide.fr, which cover XSD, Schematron and BR-* errors. Their reliability is unvetted. — [conformicheck.fr](https://conformicheck.fr/blog/format-factur-x-pdf-a3-xml-cii); [facturevalide.fr](https://facturevalide.fr/blog/factur-x-guide-technique-complet.html)
- @e-invoice-eu advises validating all generated invoices afterwards. — [GitHub e-invoice-eu](https://github.com/gflohr/e-invoice-eu)

### Inferences
- **CI (devDependency, Java):** run veraPDF (PDF/A-3b) plus Mustang CLI (`--action validate`, which covers PDF/A and XML Schematron for ZUGFeRD/Factur-X) on golden-file exports in GitHub Actions. KoSIT validator plus the XRechnung configuration applies only if XRechnung is added.
- **In-app:** do a pure-TS pre-flight before export, not a full validator. Check required fields, code lists and BR-CO total arithmetic. Then link to the FNFE-MPE and FeRD resources and to Mustang's web validator.

### Gaps
- I did not verify the current URLs or terms of FNFE-MPE's or Mustang's hosted online validators, or whether veraPDF has a WASM build. I am not aware of one.

## 4. Mandates and timelines

### Takeaway
- **EU (ViDA):** adopted 11 Mar 2025, published 25 Mar 2025, in force 14 Apr 2025. EN 16931 e-invoicing plus digital reporting for intra-EU B2B starts 1 Jul 2030. Member states may impose domestic e-invoicing without EU derogation, and existing systems must converge by 2035.
- **France:** every business must be able to receive via a PA from 1 Sep 2026. SMEs and micro-businesses must issue via a PA from 1 Sep 2027. Between French VAT-registered businesses, **emailing a PDF, or even a Factur-X, directly will no longer count as compliant issuance**.
- **Germany:** reception has been mandatory since 1 Jan 2025. Issuance is mandatory from 2027 for businesses over €800k turnover and from 2028 for all.
- **Belgium:** Peppol B2B since 1 Jan 2026, with a Q1 tolerance period.
- **Poland:** KSeF from Feb/Apr 2026.
- **India:** IRN applies above ₹5 crore turnover.

### Cited Findings
- **EU ViDA:**
  - Adopted 11 Mar 2025, published in the OJEU 25 Mar 2025, in force 14 Apr 2025
  - EN 16931 e-invoicing mandatory for intra-EU transactions from **1 Jul 2030**, with intra-EU B2B digital reporting via a harmonised system
  - Existing national systems must align by 1 Jan 2035

  — [PwC Luxembourg](https://www.pwc.lu/en/newsletter/2025/vat-in-the-digital-age-vida.html); [Banqup](https://www.banqup.com/resources/blog/vida-adopted-everything-you-need-to-know-about-the-new-e-invoicing-and-reporting-requirements)
- **France:**
  - Reception is mandatory for all from 1 Sep 2026; issuance for SMEs, TPEs and micro-businesses from 1 Sep 2027
  - PAs (formerly PDPs) must support UBL, CII and Factur-X

  — [Pennylane](https://www.pennylane.com/fr/fiches-pratiques/facture-electronique/formats-facture-electronique)
  - The **DGFiP published its first list of 101 PAs on 16 Jan 2026**. Later reporting cites more than 115 and then 137 registered PAs, some "sous réserve" pending interoperability tests. impots.gouv is the only authoritative list. — [impots.gouv actualité](https://www.impots.gouv.fr/actualite/facturation-electronique-publication-de-la-liste-des-plateformes-agreees?lang=en); [Légifiscal](https://www.legifiscal.fr/actualites-fiscales/4536-facturation-electronique-137-plateformes-agreees.html); [FFB](https://www.ffbatiment.fr/actualites-batiment/actualite-ba/facturation-electronique-liste-101-plateformes-agreee-publiee)
  - "Entre assujettis français, la facture doit transiter par une plateforme agréée, et l'e-mail direct ne vaut plus émission conforme." Email to foreign buyers or consumers stays outside the e-invoicing mandate (B2C and international are covered by e-reporting instead). — [ma-facture-electronique.org](https://ma-facture-electronique.org/formats-normes/factur-x/)
- **Germany:**
  - Since 1 Jan 2025 all domestic businesses must be able to receive e-invoices. The BMF letter of 15 Oct 2025 is the current guidance. — [IHK Köln](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012)
  - Issuance is mandatory from 1 Jan 2027 for businesses with prior-year turnover over €800,000, and from 1 Jan 2028 for all other B2B
  - Exceptions: invoices under €250 gross, B2C, certain exempt supplies, and **Kleinunternehmer (small businesses), which are permanently exempt from issuing**

  — [Börse Express](https://www.boerse-express.com/news/articles/e-rechnung-pflicht-ab-januar-2027-fuer-unternehmen-ueber-800000-euro-929362); [ecosio](https://ecosio.com/de/blog/e-invoicing-e-rechnungspflicht/)
  - Hybrid ZUGFeRD is valid if it uses an EN 16931-conformant profile, so not MINIMUM or BASIC WL. A plain PDF stops being an "E-Rechnung" once the transition ends. — [IHK Köln](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012)
- **Belgium:**
  - From 1 Jan 2026, invoices between Belgian VAT-registered businesses must be EN 16931 structured and sent **via Peppol**. PDFs by email are no longer compliant for in-scope transactions.
  - A three-month tolerance period ran Jan–Mar 2026 and depended on demonstrable preparation
  - Fines: €1,500, then €3,000, then €5,000

  — [BDO Belgium](https://www.bdo.be/en-gb/insights/news-alerts/2025/mandatory-e-invoicing-in-2026-in-belgium-three-month-tolerance-period); [Marosa](https://marosavat.com/e-invoicing-b2b-belgium-complete-guide-january-2026/)
- **Poland (KSeF):**
  - Mandatory from 1 Feb 2026 for large taxpayers (2024 turnover over PLN 200m) and from 1 Apr 2026 for others
  - Micro-entrepreneurs with monthly sales under PLN 10,000 follow from 1 Jan 2027
  - KSeF uses its own FA(3) XML, not EN 16931 hybrid

  — [Rödl & Partner](https://www.roedl.pl/en/good-to-know/good-to-know/vat/the-national-e-invoicing-system-obligatory-from-1-february-2026); [KPMG PL](https://kpmg.com/pl/en/insights/taxes/tax-alert-ksef-mandatory-from-2026.html)
- **India (IRN):**
  - e-Invoicing applies to GST-registered businesses with AATO over **₹5 crore** (since 1 Aug 2023)
  - From 1 Apr 2025, businesses with AATO of ₹10 crore or more must report to the IRP within 30 days

  — [Tungsten](https://us.tungsten-network.com/compliance-overview/country-updates/country/india/new-time-limit-to-report-e-invoices-to-the-irp); [TaxBuddy](https://www.taxbuddy.com/blog/what-is-the-e-invoice-limit)

### Inferences
- Previous researcher's claims, checked:
  - French dates are **confirmed**: reception for all from 1 Sep 2026, issuance for SMEs and micro-businesses from 1 Sep 2027. Large and mid-size companies (GE/ETI) issue from 1 Sep 2026. That GE/ETI date comes from general knowledge and was not re-fetched.
  - What the earlier note missed: the PA list is live (Jan 2026), the format/profile rules are tightening (XP Z12-012 v1.4, Jul 2026), and direct email between French businesses is non-compliant.
- What this means for SASU's user base (freelancers, SASU/micro-entreprise owners):
  - **France:** from 1 Sep 2026 the PDF SASU makes today can still be sent to *French B2B* clients, because issuance only becomes mandatory for small businesses on 1 Sep 2027. It remains fine for B2C and foreign clients. From 1 Sep 2027 French B2B invoices must go through the user's PA. A SASU-made Factur-X EN 16931 is useful **as an upload to a PA**, if the PA accepts uploaded Factur-X, which most should since it is a base format.
  - **Germany:** a ZUGFeRD EN 16931 file sent by email is a fully valid E-Rechnung. This is the clearest win for a client-side tool. Kleinunternehmer can stay with plain PDFs.
  - **Belgium:** a hybrid file emailed directly is not enough, because Peppol is mandatory. SASU could give Belgian users a UBL (Peppol BIS Billing 3.0) file to upload to a Peppol provider.
  - **Poland and India:** out of scope. Both are clearance models with proprietary schemas and a government portal.

### Gaps
- The economie.gouv.fr page returned 403, so I could not fetch the official French gov text on the email prohibition, the timelines or e-reporting directly. The email claim relies on a secondary source; it is consistent with how the reform is designed but should be checked against impots.gouv's FAQ.
- I did not verify the status of France's free public portal (PPF), which was scaled back in Oct 2024 to a directory and data concentrator. I found nothing new in 2026.
- I did not verify a Peppol BIS UBL acceptance path for Belgian SMEs via Hermes, the free government Peppol portal.

## 5. Positioning for a free client-side tool, recommended approach, effort, risks, and what SASU should tell users it does not do

### Takeaway
SASU can realistically produce a **Factur-X / ZUGFeRD EN 16931 hybrid PDF** fully in the browser, and optionally standalone **CII** and **UBL** XML. Users would email these directly where hybrid is allowed (Germany, cross-border and B2C) or upload them to their PA or Peppol provider (France from 2027, Belgium). Transmission, Peppol access, PA connectivity and e-reporting are out of scope and must be stated plainly.

### Cited Findings
- PAs must accept Factur-X, UBL and CII. — [Quadient](https://www.quadient.com/fr/blog/formats-facturation-electronique-france)
- Germany accepts ZUGFeRD EN 16931 hybrids as e-invoices. — [IHK Köln](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012)
- Belgium requires Peppol transmission. — [BDO](https://www.bdo.be/en-gb/insights/news-alerts/2025/mandatory-e-invoicing-in-2026-in-belgium-three-month-tolerance-period)
- JS libraries implement CII generation and PDF/A-3 embedding on pdf-lib, and warn about PDF/A reliability. — [e-invoice-eu](https://github.com/gflohr/e-invoice-eu); [facturx](https://github.com/stafyniaksacha/facturx)

### Inferences (recommendations)

**(a) Recommended technical approach**
1. **Data model additions**, kept optional so the current simple flow still works. Show them only when "E-invoice (Factur-X)" mode is on.
   - Structured addresses: line1, line2, postcode, city, **country (ISO 3166-1 alpha-2)**, for both seller and buyer
   - Seller legal ID: **SIREN/SIRET** with a scheme, plus VAT ID. Buyer SIREN and VAT ID.
   - Seller and buyer **electronic address** (email or Peppol ID), BT-34/BT-49
   - Per line: **unit code**, a dropdown of about 15 common UN/ECE Rec 20 codes (C62, HUR, DAY, MON, KGM, MTR, LTR, …) mapped from the existing free-text unit, and a **VAT category** (S/Z/E/AE/K/G/O) next to the per-line rate
   - **VAT exemption reason** (text plus optional VATEX code), for example the art. 293 B CGI note for French micro-entrepreneurs and "Kleinunternehmer §19 UStG"
   - **Payment means code** (default 58 SEPA or 30), IBAN and BIC, payment terms text
   - Invoice **type code** (380 or 381 credit note), and a buyer reference / PO
   - France: **operation category** (goods/services/mixed), VAT-on-debits flag, delivery address
2. **Calculation layer:** derive an EN 16931 totals model that satisfies the BR-CO rules.
   - Line net = qty × price
   - The document discount becomes an allowance and shipping becomes a charge, each with a VAT category
   - VAT breakdown per (category, rate)
   - Prepaid comes from "amount paid"
   - Round to 2 dp per the EN rules
   - Unit-test it against FNFE-MPE sample invoices.
3. **XML:** write a small, dependency-free TS **CII D22B serializer for the EN 16931 profile** (guideline ID `urn:cen.eu:en16931:2017`), escaping every user string. That is consistent with the existing XSS tests. The alternative is `@e-invoice-eu/core` (WTFPL, browser-capable) for CII plus UBL, if its bundle and CSP behaviour pass a spike. Optionally add a UBL (Peppol BIS 3.0) export for Belgium and PAs.
4. **PDF/A-3:**
   - Keep jsPDF for rendering, but make sure **every font is embedded**: Inter for all text including autotable, and no standard-14 fonts. Also avoid alpha images without the OutputIntent.
   - Post-process with **@cantoo/pdf-lib**, lazy-loaded:
     1. Attach `factur-x.xml` (mime `text/xml`, AFRelationship `/Alternative`; use `/Data` only for MINIMUM/BASIC WL)
     2. Add the catalog `/AF` array
     3. Add `/OutputIntents` with an embedded sRGB IEC61966-2.1 ICC profile, bundled as a static asset
     4. Add the `/Metadata` XMP: pdfaid:part=3, conformance=B, the Factur-X `fx:` extension schema with DocumentType=INVOICE, DocumentFileName=factur-x.xml, Version=1.0 and ConformanceLevel=EN 16931, plus dc:title and xmp dates matching the Info dict
     5. Add a trailer `/ID`
     6. No encryption
   - For Germany, the same file can be labelled ZUGFeRD. The filename inside stays `factur-x.xml` for 2.x.
5. **Validation:**
   - In CI: veraPDF plus Mustang on golden exports.
   - In app: a TS pre-flight (required fields, code lists, arithmetic) and a link to external validators.
   - Avoid libxml2-wasm in production unless it is acceptable to add `'wasm-unsafe-eval'` to the CSP.
6. **UX:** add an "Export → Factur-X (PDF + XML)" option and an "XML only (CII/UBL)" option, with a country-aware help panel.

**(b) Effort**
- **M overall**, roughly 2–4 developer-weeks:
  - XML serializer plus totals model: S–M
  - Data model and UI fields: M
  - PDF/A-3 post-processing plus veraPDF/Mustang CI until clean: M; this is where the iteration risk is
- UBL export adds S.
- An EXTENDED-CTC-FR profile or XRechnung (Leitweg-ID, stricter KoSIT rules) adds another S–M each.

**(c) Risks**
- **PDF/A conformance of jsPDF output** is unproven. Possible problems include non-embedded fonts from autotable defaults, transparency or ICC issues, and the XMP/Info dict mismatch. Libraries say their PDF/A path "may fail". Mitigation: CI with veraPDF.
- **Spec churn:** five Factur-X versions between 1.07 and 1.09.2 in about 18 months, French profile rules changed in Jul 2026 (XP Z12-012 v1.4), and EN 16931 updates twice a year. Ongoing maintenance is needed.
- **French profile ambiguity:** BASIC and BASIC WL status conflicts between sources, and France CTC Schematron rules (BR-FR-*) may reject EN 16931 files that lack the French-specific fields. Implement EN 16931 with the French fields.
- **CSP and bundle:** WASM validators need `'wasm-unsafe-eval'`, and pdf-lib adds weight, so lazy-load it.
- **Liability and user expectations:** users may believe that a "Factur-X" download means they are compliant. In France from 2027, compliance depends on transmission through a PA, not on the file.
- **Arithmetic edge cases:** mixed VAT rates with a document-level percentage discount have to be split per VAT category, and rounding mismatches will fail BR-CO-10/13/15.
- **Library maturity:** node-zugferd is pre-1.0 and browser support is undocumented for facturx and stackforge. Spike before committing.

**(d) What SASU should tell users it does NOT do**
- It does **not transmit** invoices. It is not a Plateforme Agréée (PA), not connected to one, not a Peppol access point, not connected to KSeF or India's IRP, and does not deliver invoices to German or Belgian recipients' systems.
- It does **not do e-reporting**: no B2C/international transaction or payment-status reporting to the DGFiP. It does not handle lifecycle statuses (rejected, paid, …) or the French directory (annuaire) lookup.
- It does **not archive** invoices for legal retention: 10 years in France, 8 years in Germany (since 2025). Users must keep their own copies.
- It does **not guarantee legal compliance**. Files follow EN 16931 / Factur-X, but users must check with their PA, accountant or validator. From 1 Sep 2027, French B2B invoices **must be sent through the user's PA, not emailed**. Belgian B2B invoices must go over Peppol.
- It does **not support** Polish KSeF FA(3), Indian IRN/GST JSON, Italian FatturaPA/SdI, or other clearance-model formats.
- Where it helps:
  - **Germany:** directly emailable ZUGFeRD EN 16931 e-invoices
  - **France:** a Factur-X file the user can upload to their PA, and a valid hybrid PDF for B2C and foreign clients
  - **Belgium and other PAs:** CII/UBL XML to import into a Peppol/PA provider
  - **2030:** ViDA intra-EU readiness through EN 16931 data

### Gaps
- I did not confirm whether major French PAs accept *uploaded* user-generated Factur-X files from third-party tools, or whether micro-entrepreneur-oriented PAs only accept invoices made in their own editor. This is the key factor for whether the feature helps French users in practice.
- I did not verify a precise bundle-size or CSP compatibility test for @cantoo/pdf-lib or @e-invoice-eu/core in a Vite build.
