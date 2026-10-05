# Legally mandatory invoice contents (EU, France, UK, India, US) and compliance gaps in SASU Invoice

> Research date: 2026-10-05. Source quality note: service-public.gouv.fr, legislation.gov.uk, GOV.UK, CBIC/GST Council notifications and GSTN advisories were fetched or seen in search results during this session. **EUR-Lex (Directive 2006/112/EC), Légifrance and economie.gouv.fr could not be fetched** (EUR-Lex returned an empty JS shell; Légifrance returned 404; economie.gouv.fr returned 403). Items from those sources are marked **[not re-fetched]**. They come from the researcher's own knowledge of the statutes, with the canonical primary URL given. The report writer should treat them as high-confidence but unverified in this session. Article numbering in Directive 2006/112/EC is very stable.

## Q1. EU: Directive 2006/112/EC (art. 226, simplified invoices, reverse charge, intra-community, exemption, currency, numbering)

### Takeaway
Article 226 lists 15 mandatory particulars, plus conditional mentions for exemption, reverse charge, self-billing and margin schemes. Simplified invoices (art. 226b) are allowed up to EUR 100, or up to EUR 400 where a member state uses the art. 238 option. The VAT amount must be expressed in the member state's currency, but the invoice itself may be in any currency. Sequential numbering ("one or more series") is mandatory, and gaps are not explicitly banned at EU level.

### Cited Findings
- **Art. 226 full invoice particulars [not re-fetched]**, [EUR-Lex 2006/112/EC consolidated](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101):
  1. date of issue;
  2. a sequential number, based on one or more series, which uniquely identifies the invoice;
  3. the supplier's VAT identification number;
  4. the customer's VAT identification number, where the customer is liable for the tax (reverse charge) or receives an exempt intra-community supply of goods (art. 138);
  5. the full name and address of the supplier and of the customer;
  6. the quantity and nature of the goods supplied, or the extent and nature of the services rendered;
  7. the date of supply or completion, or the date of a payment on account, if that date can be determined and differs from the date of issue;
  7a. "Cash accounting" where VAT becomes chargeable on receipt of payment (art. 66(b)) and the right of deduction arises at the same time;
  8. the taxable amount per rate or exemption, the unit price exclusive of VAT, and any discounts or rebates not included in the unit price;
  9. the VAT rate applied;
  10. the VAT amount payable, except where a special arrangement excludes it;
  10a. "Self-billing" where the customer issues the invoice;
  11. for exemptions, a reference to the applicable provision of the Directive or national law, or any other indication that the supply is exempt;
  11a. "Reverse charge" where the customer is liable for the tax;
  12. for new means of transport, the particulars in art. 2(2)(b);
  13. "Margin scheme – Travel agents";
  14. "Margin scheme – Second-hand goods", "Margin scheme – Works of art" or "Margin scheme – Collector's items and antiques";
  15. where a tax representative is liable, that representative's VAT ID, name and address.
- **Art. 226b simplified invoice [not re-fetched]** ([EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)): the minimum content is the date of issue, the supplier's identity, the type of goods or services, the VAT amount payable or the data needed to calculate it, and, for credit notes, a specific and unambiguous reference to the initial invoice.
- **Art. 220a [not re-fetched]**: member states must allow simplified invoices where the amount is no higher than EUR 100, or for corrective documents. They are not allowed for intra-EU B2B supplies of goods, distance sales or reverse-charge supplies. **Art. 238**: after consulting the VAT Committee, a member state may allow simplified invoices up to EUR 400 (or for sectors where invoicing practice makes full invoices difficult). [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)
- **Art. 222 [not re-fetched]**: for intra-community supplies of goods (art. 138) and B2B cross-border reverse-charge services (art. 196), the invoice must be issued no later than the 15th day of the month after the chargeable event. [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)
- **Art. 230 [not re-fetched]**: amounts on the invoice may be in any currency, provided the VAT payable is expressed in the national currency of the member state, converted using the art. 91 mechanism. [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)
- **Art. 232 / 233 [not re-fetched]**: e-invoices need the customer's acceptance until ViDA changes this. Authenticity of origin, integrity of content and legibility must be ensured from issue until the end of the storage period. **Art. 247**: each member state sets the storage period. [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)
- France transposes the reverse-charge mention as **"Auto-liquidation"**, and service-public lists it as a required mention when the buyer is liable for VAT. [service-public.gouv.fr F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808)

### Inferences
- The EU baseline that SASU lacks is: a supply date (226-7), a per-rate VAT breakdown (226-8), conditional legal mentions (226-10a, 11, 11a, 13, 14), customer VAT ID promoted to a formal "required when reverse charge / intra-EU" rule, and a VAT amount in national currency when the invoice currency differs (226 + 230).
- Simplified invoices (EUR 100 or EUR 400) are mainly relevant to retail receipts. A B2B freelancer tool can ignore them, except to allow credit notes that reference the original invoice (226b(e) and 219).
- ViDA (adopted 2025) is out of scope here. Its field-level effect is that from 2030 intra-EU B2B invoices go through structured e-invoicing and are issued within 10 days. The other researcher should confirm this.

### Gaps
- Could not fetch EUR-Lex in this session, so verbatim wording of art. 226 should be checked against the consolidated text before it is shown in UI copy.
- Which member states use the art. 238 EUR 400 option was not researched.

## Q2. France: SASU/SAS and micro-entrepreneurs, e-invoicing reform mentions and dates

### Takeaway
French invoices need about 16 general mentions (Code de commerce L441-9 plus CGI annexe II art. 242 nonies A). For an SASU these include SIREN, legal form plus share capital, registered office, sale/service date, the late-payment penalty rate, the EUR 40 recovery indemnity and the escompte mention. Four new mentions arrive with the e-invoicing reform: client SIREN, delivery address, nature of operation, and the "option pour le paiement de la taxe d'après les débits" mention. They apply from **1 Sept 2026** for large companies and ETI, and from **1 Sept 2027** for SMEs and micro-enterprises, per service-public.

### Cited Findings
- **General mandatory mentions** per [service-public.gouv.fr F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808):
  - date of issue;
  - unique number, sequential and chronological;
  - date of sale or service (actual delivery or completion);
  - seller identity:
    - for a company: name (dénomination), SIREN, registered office address, legal form (EURL, SARL, SA, SNC, **SAS**) and **share capital**;
    - for an individual: name plus "Entrepreneur individuel" or "EI", address, SIREN;
  - buyer name and address, and billing address if different;
  - purchase order number if one was established;
  - **VAT identification number, except invoices under EUR 150 HT**;
  - description (nature, brand, references; materials and labour for services);
  - quantity, precise name, unit price HT, applicable VAT rate;
  - totals HT and TTC;
  - price increases (transport, packaging);
  - rebates and discounts directly linked to the transaction;
  - payment due date, plus early-payment discount terms **or "Escompte pour paiement anticipé : néant"**;
  - late-payment penalty rate (due without reminder);
  - the **EUR 40 indemnité forfaitaire pour frais de recouvrement** (professional clients only);
  - legal warranty mention (minimum 2 years) for listed consumer goods.
- **Conditional mentions** per [service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808):
  - **"TVA non applicable, art. 293 B du CGI"** for the VAT franchise (franchise en base, typical for micro-entrepreneurs);
  - **"Auto-liquidation"** when the buyer is liable for VAT;
  - **auto-facturation** mention when the client issues the invoice;
  - "Membre d'une association agréée, le règlement par chèque et carte bancaire est accepté";
  - DEEE eco-participation;
  - private-copy levy;
  - craft activities (artisans): professional insurance details (insurer, contract number, geographic coverage).
- **E-invoicing reform mentions** per [service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808), effective 1 Sept 2026 (large and ETI) and 1 Sept 2027 (SME and micro):
  1. client SIREN when the client is a business;
  2. delivery address if different from the client address;
  3. nature of the operation: goods, services, or both;
  4. "Option pour le paiement de la taxe d'après les débits" if the seller opted for it.
- Legal bases cited by the same page: **Code de commerce art. L441-9** (general mentions), **R526-27** (EI denomination), **CGI art. 293 B** (franchise), **CGI annexe II art. 242 nonies A** (VAT mentions), and **loi n° 2023-1322 of 29 Dec 2023** (e-invoicing dates). [service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808)
- **Penalties and rates [not re-fetched]** ([Légifrance, Code de commerce](https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005634379/); [CGI art. 1737](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006312398)):
  - the late-payment penalty rate may not be lower than 3 times the legal interest rate; absent a stipulation, it is the ECB refinancing rate + 10 points (L441-10);
  - the EUR 40 amount is fixed by D441-5;
  - the tax fine is EUR 15 per missing or inaccurate mention, capped at 1/4 of the invoice amount (CGI art. 1737);
  - the administrative fine for L441-9 breaches is up to EUR 75,000 for a natural person and EUR 375,000 for a legal person, doubled for a repeat breach (L441-16).
- **Retention [not re-fetched]**: 10 years under commercial law (C. com. L123-22) and 6 years for tax purposes (LPF L102 B). [Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006438819)
- **RCS mention [not re-fetched]**: companies registered at the RCS must show "RCS" plus the registry city next to the SIREN on invoices and commercial papers (C. com. R123-237). Since 2023 the RNE has replaced some registers, but the RCS mention remains for commercial companies. [Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006256237)
- **Reform calendar**: per loi 2023-1322 as summarised by service-public, all companies must be able to *receive* e-invoices from 1 Sept 2026. Issuing (and the new mentions) applies from 1 Sept 2026 for large companies and ETI, and from 1 Sept 2027 for PME and micro. [service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808)

### Inferences
- For an SASU, SASU Invoice needs these structured seller fields:
  - SIREN (9 digits) and optionally SIRET (14 digits);
  - RCS city;
  - legal form (preset "SASU");
  - share capital (e.g. "SASU au capital de 1 000 €");
  - FR intra-community VAT number (FRxx + SIREN).
  
  A single "Tax / VAT ID" field cannot hold all of these.
- The B2B footer should come from presets, not free text: penalty rate, EUR 40 indemnity, escompte "néant", and "TVA non applicable, art. 293 B du CGI" when VAT is 0 and franchise mode is on.
- Most SASU users are SMEs or micros, so the client SIREN, delivery address, operation type and "débits" option are legally needed from 1 Sept 2027. Adding them now is low-risk and future-proof.
- Per-line VAT rate is required ("taux de TVA applicable" per item), which supports making per-line tax first-class rather than optional.

### Gaps
- The exact text of art. 242 nonies A after décret 2022-1299 (and any 2024–2025 amendments, such as the "catégorie de l'opération" coding) was not fetched.
- The impots.gouv.fr and economie.gouv.fr pages were not retrieved (403).
- It was not confirmed whether 2026 finance-law changes moved the micro/franchise thresholds. The franchise-threshold reform debated in 2025 should be checked.

## Q3. UK: HMRC VAT invoices and Companies Act disclosures

### Takeaway
UK VAT invoice particulars are set out in VAT Regulations 1995 reg. 14. They include a sequential number, the time of supply (tax point), supplier VAT number, customer name and address, and per-item quantity, rate and amount ex-VAT. They also require unit price and a "reverse charge" reference where applicable. HMRC also allows simplified (≤ £250) and modified invoices. Limited companies must show their registered name on invoices, and their number, registered office and place of registration on business documents and websites.

### Cited Findings
- **Reg. 14(1) particulars**, per [legislation.gov.uk, VAT Regulations 1995 reg. 14](https://www.legislation.gov.uk/uksi/1995/2518/regulation/14):
  - sequential identification number;
  - time of supply;
  - date of issue;
  - supplier name, address and VAT registration number;
  - recipient name and address;
  - description of goods or services;
  - for each description: quantity, VAT rate and amount payable excluding VAT;
  - gross total excluding VAT;
  - rate of any cash discount;
  - unit price;
  - the total amount of VAT;
  - a margin-scheme reference where applicable;
  - a **"reverse charge"** reference where applicable.
- Reg. 14(2) sets reduced particulars for invoices to EU member states, mainly Northern Ireland "XI" goods supplies. These require the "XI"-prefixed supplier number and the recipient's registration number. [legislation.gov.uk reg. 14](https://www.legislation.gov.uk/uksi/1995/2518/regulation/14)
- **Sterling**: "amounts of money must always be expressed in sterling" for VAT purposes. Three conversion methods are allowed: the UK market selling rate, the HMRC period rate, or an approved commercial rate. [VAT Notice 700 para 7.6](https://www.gov.uk/guidance/vat-guide-notice-700)
- **Every business (VAT or not)**, per [GOV.UK "Invoices: what they must include"](https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include):
  - a unique identification number;
  - your company name, address and contact information;
  - the customer's company name and address;
  - a clear description;
  - supply date and invoice date;
  - amounts charged;
  - VAT if applicable;
  - total owed.
  
  Limited companies must show the full name as on the certificate of incorporation. If directors' names are shown, all directors must be named.
- **Companies House disclosures** on business letters, order forms and websites: registered number; registered office address; place of registration (England and Wales, Scotland or Northern Ireland); and the fact that it is a limited company. If share capital is mentioned, it must be paid-up capital. [GOV.UK "Running a limited company: signs, stationery"](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material)
- **[not re-fetched]** HMRC VAT Notice 700/21 ([GOV.UK](https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021)) says:
  - a VAT invoice must normally be issued within 30 days of the tax point;
  - **simplified invoice** for retail supplies of £250 or less (VAT-inclusive): supplier name, address and VAT number; time of supply; description; and per rate, the VAT-inclusive total and VAT rate;
  - **modified invoice** for retail supplies over £250 when the customer agrees: VAT-inclusive amounts per line;
  - VAT records must be kept for 6 years;
  - for the construction domestic reverse charge, invoices must state that the reverse charge applies and show the VAT that the customer must account for.
- **[not re-fetched]** A sole trader or partnership trading under a business name must show the owner's name and an address for service on invoices and business letters (Companies Act 2006 ss.1201–1204). [legislation.gov.uk CA 2006 s.1202](https://www.legislation.gov.uk/ukpga/2006/46/section/1202)

### Inferences
- UK mode needs:
  - a tax point (time of supply) date;
  - a per-line VAT rate;
  - a VAT total shown in GBP when the invoice currency is not GBP (with an exchange-rate field);
  - a "Reverse charge" preset;
  - a Company number, Registered office and "Registered in England and Wales" footer preset for Ltd companies.
- UK freelancers below the VAT threshold must not show VAT or a VAT number, so the tool should allow a "not VAT registered" state that hides tax lines.

### Gaps
- VAT Notice 700/21 section 4 (invoice contents, 30-day rule, £250) could not be fetched directly. Two GOV.UK URLs tried returned 404 or irrelevant content.
- The current UK VAT registration threshold (£90,000 since April 2024) was not re-verified for 2026.

## Q4. India GST: Rule 46 tax invoice, bill of supply, e-invoicing

### Takeaway
A CGST Rule 46 tax invoice needs:
- supplier GSTIN, and recipient GSTIN if registered;
- a ≤16-character serial number that is unique per financial year;
- HSN/SAC codes: 4 digits up to ₹5 cr turnover (optional for B2C at that size), 6 digits above ₹5 cr;
- tax rate and amount split into CGST/SGST or IGST;
- place of supply with state name for inter-state supplies;
- a reverse-charge indicator;
- a signature, which is not required on electronic invoices.

E-invoicing (IRN plus QR) applies above ₹5 crore AATO. Since 1 Apr 2025, taxpayers with AATO ≥ ₹10 crore must report invoices to the IRP within 30 days.

### Cited Findings
- **Rule 46** text from the CBIC tax repository and secondary mirrors, per [CBIC Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) (TLS error on fetch; text via [GSTZen Rule 46](https://gstzen.in/a/tax-invoice-cgst-rule-46.html) and search excerpts):
  - (a) name, address and GSTIN of the supplier;
  - (b) "a consecutive serial number not exceeding sixteen characters, in one or multiple series, containing alphabets or numerals or special characters – hyphen or dash and slash … and any combination thereof, unique for a financial year";
  - (n) "place of supply along with the name of the State, in the case of a supply in the course of inter-State trade or commerce";
  - (p) "whether the tax is payable on reverse charge basis";
  - (q) "signature or digital signature of the supplier or his authorised representative";
  - (r) a QR code with the embedded IRN for e-invoices;
  - (s) a declaration where the e-invoice is not required.
  
  Provisos:
  - for an unregistered recipient where the value is ≥ ₹50,000, the invoice must show name, address and delivery address with state name and code;
  - no signature is required on an electronic invoice.
- **Remaining Rule 46 clauses [not re-fetched verbatim]**, per [GSTZen Rule 46](https://gstzen.in/a/tax-invoice-cgst-rule-46.html) summary and researcher knowledge:
  - date of issue;
  - recipient name, address and GSTIN/UIN if registered;
  - HSN/SAC;
  - description;
  - quantity and unit;
  - total value;
  - taxable value after discount or abatement;
  - rate of tax (central, state, integrated, UT tax, cess);
  - amount of tax for each;
  - address of delivery where different from the place of supply.
- **HSN digits (Notif. 78/2020-CT, from 1 Apr 2021)**:
  - AATO up to ₹5 crore: 4 digits;
  - AATO above ₹5 crore: 6 digits;
  - taxpayers ≤ ₹5 crore may omit HSN on B2C invoices.
  
  [GST Council Notification 78/2020](https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-78-central-tax-english-2020.pdf)
- **E-invoice**: the threshold has been ₹5 crore AATO since 1 Aug 2023. Per the GSTN advisory, from 1 Apr 2025 taxpayers with AATO ≥ ₹10 crore cannot report invoices or credit/debit notes older than 30 days to the IRP. [Maharashtra GST copy of GSTN advisory](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf); [Taxmann summary](https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/)
- **[not re-fetched]** Related rules and statute ([CBIC CGST Rules](https://taxinformation.cbic.gov.in/)):
  - Rule 47: services invoices must be issued within 30 days of supply;
  - Rule 48: goods invoices in triplicate ("ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"), services invoices in duplicate;
  - Rule 49: a **bill of supply** (for exempt supplies or composition taxpayers) needs supplier name, address and GSTIN, a ≤16-character serial number, date, recipient details if registered, HSN/SAC, description, value and signature;
  - composition taxpayers must state "composition taxable person, not eligible to collect tax on supplies";
  - CGST Act s.36 requires records to be kept for 72 months from the due date of the annual return.

### Inferences
- India needs a dedicated "GST mode":
  - supplier and recipient GSTIN, validated as 15 characters, where the first 2 digits are the state code;
  - supplier state and place of supply, chosen from state names and codes;
  - automatic split: CGST + SGST at half-rate each when supplier state equals place of supply, otherwise IGST;
  - per-line HSN/SAC;
  - a "Tax payable on reverse charge: Yes/No" line;
  - a 16-character number validator restricted to `[A-Za-z0-9/-]`;
  - an FY-based series (April–March) reset;
  - a "Tax Invoice" / "Bill of Supply" document-title switch;
  - copy labels (Original/Duplicate/Triplicate);
  - an authorised-signatory block.
- SASU cannot generate an IRN or QR code because it is browser-only with no GSP/IRP integration. For users above ₹5 cr it should show a warning that the PDF is not a valid e-invoice.

### Gaps
- Rule 46 verbatim lettering for (c)–(m) and (o) was not verified (there are amendment-driven letter shifts).
- It was not checked whether further e-invoice threshold reductions below ₹5 cr were announced for 2026.

## Q5. US: sales tax practices, typical invoice contents, 1099/W-9

### Takeaway
There is no federal VAT and no federal law on invoice content. Sales tax is state and local (45 states plus DC levy a statewide sales tax), and many services are untaxed. Professional US invoices typically list seller and buyer details, invoice number and date, terms (e.g. Net 30), line items, separately stated sales tax, and remittance info. For freelancers the relevant federal item is Form W-9/1099-NEC: the reporting threshold rose from $600 to **$2,000 for payments made after 31 Dec 2025** under the One Big Beautiful Bill Act (P.L. 119-21, §70433).

### Cited Findings
- The OBBBA §70433 amended IRC §6041(a) to raise the information-reporting threshold from $600 to $2,000 for payments after 31 Dec 2025, and contractors should furnish a W-9 to clients early to avoid backup withholding. [Instead.com, Apr 2026](https://instead.com/resources/blog/w-9-and-backup-withholding-for-contractors-in-2026); [Beancount blog, May 2026](https://beancount.io/blog/2026/05/22/form-1099-nec-filing-season-w9-collection-2000-dollar-threshold-obbba-iris-portal-fire-retirement-backup-withholding-penalties-guide). These are secondary sources; the primary is the [IRS Form 1099-NEC instructions](https://www.irs.gov/forms-pubs/about-form-1099-nec).

### Inferences
- In US mode the invoice should:
  - label tax as "Sales tax" with a jurisdiction field;
  - allow marking line items as non-taxable (services are often exempt);
  - allow a resale or exemption certificate number for the customer;
  - optionally show the seller EIN, though putting an SSN on invoices is a privacy risk and should be discouraged in the UI.
- The existing SASU feature set already covers a typical US invoice. The main US gap is per-line taxability, not legal mentions.

### Gaps
- No state revenue-department pages were fetched. Specific requirements were not verified, such as states requiring sales tax to be separately stated (e.g. Texas Tax Code §151.052) or the seller's permit number on invoices. These are flagged for follow-up.
- No primary IRS page was fetched for the $2,000 threshold.

## Q6. Date formats, numbering, retention and immutability, and their effect on a localStorage tool; jurisdiction-by-field matrix; prioritized SASU changes

### Takeaway
All five regimes need unique, sequential numbering, and the EU, FR, UK and IN regimes treat the series as an audit trail. India adds a 16-character limit and a per-financial-year reset. Retention ranges from 6 years (UK VAT, FR tax) to 10 years (FR commercial), and India's is about 72 months after the annual return. Records must be unaltered, and corrections are made by credit note referencing the original. A localStorage-only tool cannot guarantee retention or immutability. It should enforce numbering, lock issued invoices, support credit notes, and push users to export and archive PDF + JSON.

### Cited Findings
- Sequential numbering: EU art. 226(2) "sequential number, based on one or more series" [not re-fetched] ([EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)); France "numéro unique… chronologique et continue" ([service-public F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808)); UK "sequential identification number" ([reg. 14](https://www.legislation.gov.uk/uksi/1995/2518/regulation/14)); India "consecutive serial number ≤16 characters … unique for a financial year" ([Rule 46 via GSTZen](https://gstzen.in/a/tax-invoice-cgst-rule-46.html)).
- Credit notes must reference the original invoice (EU art. 219 and 226b(e) [not re-fetched], [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101)). India's 30-day IRP limit applies to credit and debit notes too ([GSTN advisory](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf)).
- Date formats: no regime mandates a specific date format. All require a "date of issue" (and supply date where it differs). Any unambiguous format is acceptable. This is an inference from all the sources above; no explicit format rule was found.

### Inferences
- Numbering recommendations:
  - **Series model**: `{prefix}{YYYY or FY}-{seq padded}`, with per-series counters stored and incremented only on "Issue/Finalize", not on draft creation, to avoid gaps;
  - warn on duplicates and on gaps;
  - India: validate ≤16 characters from `[A-Za-z0-9/-]` and reset per FY (1 Apr).
- Immutability recommendations:
  - add an invoice status of draft → issued → paid/cancelled;
  - issued invoices become read-only; edits require a credit note (a new document type with its own series that references the original number and date);
  - "delete" of an issued invoice should be replaced by "cancel via credit note".
- Retention: show a persistent banner that browser storage is not a legal archive (FR 10 years, UK 6, IN ~6+). Offer one-click backup export (JSON plus a PDF zip) and a reminder cadence.
- Dates: store dates as ISO 8601 and render per locale (FR dd/mm/yyyy, UK dd/mm/yyyy, IN dd-mm-yyyy, US mm/dd/yyyy). Labels follow the jurisdiction, e.g. "Date de livraison/prestation", "Tax point", "Date of supply".

### Jurisdiction-by-field matrix
Legend:
- **M** = mandatory
- **C** = conditional
- **R** = recommended or customary
- **–** = not required

| Field | EU (art. 226) | France | UK (VAT reg.) | UK (non-VAT Ltd) | India (Rule 46) | US |
|---|---|---|---|---|---|---|
| Issue date | M | M | M | M | M | R |
| Sequential unique number | M | M (chronological) | M | M (unique) | M (≤16 chars, FY) | R |
| Supply / delivery / tax-point date | C (if differs) | M | M (time of supply) | M (supply date) | – (C via rules 47/48) | R |
| Seller name & address | M | M (+ registered office) | M | M | M | R |
| Seller VAT/GST ID | M | M (except < EUR 150 HT) | M | – | M (GSTIN) | – (seller permit C by state) |
| Seller company reg. no. | – | M SIREN + RCS city [RCS not re-fetched] | – | M (number, reg. office, place of reg.) | – | – |
| Legal form + share capital | – | M (companies) | – | M "Limited/Ltd" (capital C if shown) | – | – |
| Client name & address | M | M | M | M | M (C: delivery addr. ≥ ₹50k B2C) | R |
| Client VAT/GST ID | C (reverse charge, intra-EU) | C (B2B intra-EU) | C (reg. 14(2)) | – | M if registered | – |
| Client SIREN | – | M from 2026/2027 | – | – | – | – |
| Delivery address | – | M if different (2026/27) | – | – | C | – |
| Nature of operation (goods/services) | – | M (2026/27) | – | – | – (implied by HSN/SAC) | – |
| PO number | – | C | – | – | – | R |
| Line description, qty, unit price | M | M | M | M (description) | M (+ unit) | R |
| HSN/SAC per line | – | – | – | – | M (4/6 digits by AATO) | – |
| VAT/GST rate per line | M | M | M | – | M (CGST/SGST/IGST/cess) | C sales tax |
| Taxable amount & VAT per rate | M | M | M | – | M per tax head | C |
| Discounts/rebates | M | M | M (cash discount rate) | – | M (taxable value after discount) | R |
| Totals (net, tax, gross) | M | M HT/TTC | M | M total | M | R |
| VAT in national currency | M (art. 230) | M (EUR) | M (GBP) | – | M (INR) | – |
| Exemption reason | C | C ("TVA non applicable, art. 293 B du CGI", etc.) | C (zero-rated/exempt) | – | C (Bill of Supply) | C (exempt cert.) |
| "Reverse charge" mention | C | C "Autoliquidation" | C | – | M Yes/No flag | – |
| Self-billing / margin scheme | C | C | C | – | – | – |
| Place of supply (state) | – | – | – | – | M (inter-state) | – |
| Payment due date | – | M | – | – | – | R |
| Late penalty rate + EUR 40 indemnity + escompte | – | M (B2B) | – | – | – | – |
| "Débits" VAT option | – | C (2026/27) | – | – | – | – |
| Signature | – | – | – | – | M (not on e-invoice) | – |
| IRN/QR e-invoice | – | (Factur-X, out of scope) | – | – | M if AATO > ₹5 cr | – |
| Credit note referencing original | M (art. 219/226b) | M | M | R | M (s.34 CGST) | R |
| Retention | Member state | 10 yrs (com.) / 6 yrs (tax) | 6 yrs | 6 yrs (Companies Act; not verified) | ~72 months | 3–7 yrs (IRS; not verified) |

### Prioritized SASU change list (effort S/M/L)
1. **Supply / delivery date field** (with "same as issue date" toggle and jurisdiction label: "Date de prestation/livraison", "Tax point", "Date of supply"). Required in EU, FR and UK. **S**
2. **Per-rate VAT summary block**: taxable base, rate and VAT amount for each rate. This replaces the single "VAT (20%)" line, makes per-line tax rates first-class, and covers art. 226(8)–(10) and UK reg. 14. **M**
3. **Legal-mention presets / exemption reason picker** (checkbox list that renders into the footer):
   - "TVA non applicable, art. 293 B du CGI";
   - "Autoliquidation" / "Reverse charge";
   - "Exonération de TVA, art. 262 ter I du CGI" for intra-EU goods [art. not re-fetched];
   - "Autoliquidation – art. 283-2 du CGI" for B2B EU services [not re-fetched];
   - "Self-billing / Autofacturation";
   - the margin-scheme strings;
   - UK "Reverse charge: customer to account for VAT to HMRC";
   - UK zero-rated/exempt;
   - India "Tax payable on reverse charge: Yes/No".
   
   Make the customer VAT ID required whenever reverse charge or intra-EU is chosen. **M**
4. **France SASU profile preset**: structured seller fields (SIREN, SIRET, RCS city, legal form, share capital, FR VAT number) plus auto-generated B2B footer text:
   - penalty rate (default "3 fois le taux d'intérêt légal" or "BCE + 10 points");
   - "Indemnité forfaitaire pour frais de recouvrement : 40 €";
   - "Escompte pour paiement anticipé : néant";
   - suppress the VAT number when franchise en base applies.
   
   Add a validator listing missing mentions. **M**
5. **Issue / lock workflow + sequential numbering per series**: draft → issued (read-only); counters per series; gap and duplicate warnings; India 16-character and FY reset rules. **M**
6. **Credit notes**: a document type with its own series that references the original invoice number and date, carries negative amounts, and is created from an existing invoice. **M**
7. **France 2026/27 e-invoicing fields**: client SIREN, delivery address (if different), operation category (goods / services / mixed), "Option pour le paiement de la taxe d'après les débits" checkbox. Needed for SMEs by 1 Sept 2027, and they map onto Factur-X fields. **S–M**
8. **Multi-currency VAT conversion**: when the invoice currency differs from the seller's tax currency, show the VAT total (and optionally the totals) in EUR, GBP or INR with the rate and its source. Covers art. 230 and UK para 7.6. **S–M**
9. **India GST mode**:
   - GSTIN validation;
   - supplier state and place of supply from state code tables;
   - automatic CGST+SGST or IGST split;
   - per-line HSN/SAC with digit hint by AATO;
   - reverse-charge flag;
   - Tax Invoice / Bill of Supply title;
   - copy labels;
   - signatory block;
   - warning that IRN/QR is not generated (> ₹5 cr).
   
   **L**
10. **UK company preset**: footer with company number, registered office and "Registered in England and Wales", plus a VAT-registered / not-registered toggle that hides VAT lines. **S**
11. **US mode tweaks**: "Sales tax" label, per-line taxable toggle, customer exemption certificate number, EIN field (warn against SSN), and a W-9 hint in notes. **S**
12. **Retention / backup UX**: "browser storage is not a legal archive" notice, one-click JSON+PDF backup, and periodic reminder. **S**
13. **Compliance checker panel**: per-jurisdiction rule set that flags missing mandatory fields before export, built on the matrix above. **M–L** (depends on items 1–9)

### Gaps
- Retention periods for UK non-VAT companies (Companies Act s.388: 3 or 6 years) and the US (IRS 3–7 years) are from researcher knowledge, not fetched.
- French article references for the intra-EU exemption and reverse-charge mention strings (CGI 262 ter I, 283-2) should be verified on Légifrance or BOFiP before they ship as presets.
