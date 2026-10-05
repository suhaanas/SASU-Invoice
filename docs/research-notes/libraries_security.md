# SASU Invoice: Frontend Library Security, Maintenance and Static-SPA Hardening (as of 2026-10-05)

Method note: Advisory data comes from GitHub Advisory DB, Snyk, NVD mirrors and vendor pages. Registry metadata (latest version, last publish, maintainers, license) comes from `npm view`, run on 2026-10-05 and cited as the npm registry. A local `npm audit` (prod and dev) on the SASU repo returned "found 0 vulnerabilities" on 2026-10-05. A local grep of `src/` shows which jsPDF APIs SASU actually calls.

## 1. Known vulnerabilities, advisories and maintenance health of each dependency

### Takeaway
jsPDF 4.2.1 (2026-03-17) has no known advisories. It is the fix release for the last two 2026 advisories. jsPDF has had about 13 advisories since 2021, 10 of them in Jan to Mar 2026, so it is the highest-risk dependency and needs fast patching. SASU only calls `addImage` (with its own re-encoded logo) and `output('blob')`. Neither is reachable by the 2026 injection bugs as SASU uses them. jspdf-autotable, snapdom and zod 4 have no known advisories. All four are MIT-licensed. Each npm package is published by a single maintainer account, so the bus factor is low.

### Cited Findings

**jsPDF (parallax/jsPDF): advisory list (GHSA page lists 10 advisories in 2026)**
- GHSA-f8cm-6447-x5h2 / CVE-2025-68428, "Local File Inclusion/Path Traversal", Critical, published 2026-01-03. Affects the **Node.js build** only (fs-based file loading). Fixed in 4.0.0 — [GitHub jsPDF advisories](https://github.com/parallax/jsPDF/security/advisories); [Endor Labs write-up](https://www.endorlabs.com/learn/cve-2025-68428-critical-path-traversal-in-jspdf)
- GHSA-95fx-jjr5-f39c / CVE-2026-24133, DoS via unvalidated BMP dimensions in BMPDecoder, High. Affects <= 4.0.0, fixed 4.1.0 (published 2026-02-02) — [GitHub Advisory](https://github.com/advisories/GHSA-95fx-jjr5-f39c)
- GHSA-cjw8-79x6-5cj4 / CVE-2026-24040, shared-state race condition in `addJS` (cross-user leakage in multi-tenant **server** use), Moderate. Fixed 4.1.0 (2026-02-02) — [SentinelOne CVE-2026-24040](https://www.sentinelone.com/vulnerability-database/cve-2026-24040/); [GitHub advisories](https://github.com/parallax/jsPDF/security/advisories)
- GHSA-vm32-vv63-w422, stored XMP metadata injection (spoofing/integrity), Moderate, 2026-02-02. Fixed 4.1.0 — [GitHub advisories](https://github.com/parallax/jsPDF/security/advisories). IBM also lists CVE-2026-24043 and CVE-2026-24737 in the same batch — [IBM bulletin](https://www.ibm.com/support/pages/security-bulletin-ibm-infosphere-optim-archive-viewer-affected-multiple-vulnerabilities-jspdf-cve-2026-24040-cve-2026-24043-cve-2026-24133-cve-2026-24737-3)
- GHSA-pqxr-3g65-p328, PDF injection in the AcroForm module allowing arbitrary JavaScript execution (in the PDF viewer), High, 2026-02-02 — [GitHub advisories](https://github.com/parallax/jsPDF/security/advisories)
- GHSA-67pg-wm7f-q7fj / CVE-2026-25535, client-side or server-side DoS via malicious GIF dimensions in `addImage` (memory exhaustion), High, 2026-02-19. Fixed 4.1.1/4.2.0 — [GitHub Advisory](https://github.com/advisories/GHSA-67pg-wm7f-q7fj); [SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-25535/)
- GHSA-9vjf-qc39-jprp / CVE-2026-25755, PDF object injection via unsanitized input in `addJS` (AcroJS sandbox bypass, auto-exec on open), Critical, 2026-02-19. Fixed 4.2.0 — [GitHub Advisory](https://github.com/advisories/GHSA-9vjf-qc39-jprp); [PoC repo](https://github.com/absholi7ly/jsPDF-Object-Injection)
- GHSA-p5xg-68wr-hm3m, AcroForm RadioButton children PDF injection leading to JS execution, High, 2026-02-19. Fixed 4.2.0 — [GitHub advisories](https://github.com/parallax/jsPDF/security/advisories)
- GHSA-wfv2-pwc8-crg5 / CVE-2026-31938, HTML injection in `output()` methods, Critical, 2026-03-17. Affects <= 4.2.0, fixed 4.2.1. The vulnerable overloads are `output('pdfobjectnewwindow', {pdfObjectUrl})`, `output('pdfjsnewwindow', {pdfJsUrl, filename})` and `output('dataurlnewwindow', {filename})`, because the options are "JSON-serialized and included verbatim in the generated HTML-string" — [GitHub Advisory](https://github.com/advisories/GHSA-wfv2-pwc8-crg5)
- GHSA-7x6v-j9x4-qf24 / CVE-2026-31898, PDF object injection via the free-text annotation `color` parameter in `createAnnotation`, High. Fixed 4.2.1 (2026-03-17) — [SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-31898/); [GitHub advisories](https://github.com/parallax/jsPDF/security/advisories)
- CVE-2025-29907, ReDoS/CPU DoS when the user controls the first argument of `addImage` (a harmful data URL). `html()` and `addSvgAsImage` are also affected. Fixed 3.0.1 (March 2025) — [TuxCare](https://tuxcare.com/cve-tracker/cve/details/cve-2025-29907/); [Kodem](https://www.kodemsecurity.com/cve-archive/cve-2025-29907)
- CVE-2025-57810, CPU DoS via a corrupt PNG passed to `addImage`. Fixed 3.0.2 (August 2025) — [cvefeed](https://cvefeed.io/vuln/detail/CVE-2025-57810); [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2025-57810)
- Earlier issues: v3.0.0 (Feb 2024) shipped a DOMPurify security update, and v2.5.2 fixed a DOMPurify dependency vulnerability. The jsPDF 2.x line also had the 2021 ReDoS CVE-2021-23353 — [jsPDF releases](https://github.com/parallax/jsPDF/releases). (The release-page fetch reported years shifted by one; Snyk and npm confirm 4.2.1 = 2026-03-17.) CVE-2021-23353 is not cross-verified in this session, so treat it as a gap.
- Snyk: "16 total vulnerabilities, but none affect the latest version (4.2.1)". 4.2.0 still had 2 Medium, and 4.0.0 had 5 High, 3 Medium and 1 Low. Snyk describes the release cadence as "positive"/sustainable — [Snyk jspdf](https://security.snyk.io/package/npm/jspdf)
- npm registry: latest jspdf = 4.2.1, last modified 2026-03-17, a single npm maintainer (`mrjameshall`, Parallax), MIT — npm registry (`npm view jspdf`, 2026-10-05)
- Local check: SASU calls `doc.addImage(style.logo, 'PNG'|'JPEG', …)` (src/ui/pdf.ts:147–149) and `doc.output('blob')` (src/ui/pdf.ts:327). There are no calls to `addJS`, `createAnnotation`, AcroForm, `html()`, `addSvgAsImage` or the `*newwindow` output modes. html2canvas, DOMPurify and canvg are stubbed (src/stubs/unused.ts) — local repo grep

**jspdf-autotable**
- Latest 5.0.8 (2026-05-17). Earlier releases: 5.0.7 on 2026-01-04, and 5.0.0–5.0.2 in Feb 2025 (4.0.0 on 2025-02-25, which moved to jsPDF 3). Single npm maintainer `someatoms` (Simon Bengtsson), MIT — npm registry (`npm view jspdf-autotable time`)
- Releases are bug fixes only, with no security fixes listed. 5.0.5 added jsPDF 4 peer support. 5.0.8 fixes rows being dropped in horizontalPageBreak — [jsPDF-AutoTable releases](https://github.com/simonbengtsson/jsPDF-AutoTable/releases)
- No OSV/GHSA advisory was found for jspdf-autotable. An OSV list query returned "No results" — [OSV](https://osv.dev/list?q=jspdf-autotable&ecosystem=npm)

**@zumer/snapdom**
- Latest stable 3.2.0. Very active: 3.2.1-dev.2…dev.5 were published daily from 2026-10-01 to 2026-10-04. Single npm maintainer `tinchox5`, MIT — npm registry (`npm view @zumer/snapdom`)
- About 8.2k GitHub stars and 28 contributors. The README has no security policy. It warns that with `fromString()`, "inline handlers such as `<img onerror>` run in the caller's origin" and that you should "sanitize untrusted HTML first". SVG output embeds HTML in `<foreignObject>`. Cross-origin images, fonts and stylesheets need CORS-readable resources or a proxy. No eval or `new Function` is documented — [snapdom GitHub](https://github.com/zumerlab/snapdom)
- No advisories were found for @zumer/snapdom (OSV/GHSA searches returned nothing) — [OSV](https://osv.dev/list?q=jspdf-autotable&ecosystem=npm)

**zod**
- The only historical advisory is CVE-2023-4316, a ReDoS in the email validator (zod 3.21.0 to 3.22.2, fixed 3.22.3, CVSS 7.5, disclosed 2023-09-28) — [Snyk SNYK-JS-ZOD-5925617](https://security.snyk.io/vuln/SNYK-JS-ZOD-5925617); [GitLab advisory](https://advisories.gitlab.com/pkg/npm/zod/CVE-2023-4316/); [fast-check blog](https://fast-check.dev/blog/2023/10/05/finding-back-a-redos-vulnerability-in-zod/)
- Latest 4.6.5 (2026-09-13), with frequent releases (4.6.3/4.6.4/4.6.5 within 2 days in Sept 2026). The single npm maintainer is `colinhacks`, MIT — npm registry (`npm view zod`)

**Local audit**
- `npm audit` and `npm audit --omit=dev` in the SASU repo report "found 0 vulnerabilities" (2026-10-05) — local run

### Inferences
- jsPDF 4.2.1 is clear of all published advisories as of 2026-10-05. Its 2026 advisory burst (10 in 11 weeks) shows that researchers are actively auditing it, so more advisories are likely. SASU should expect to patch jsPDF several times a year.
- Most 2026 jsPDF bugs need either a server context (LFI, race) or attacker-controlled input into `addJS`, AcroForm, annotations or `output()` options. SASU uses none of these. Its remaining exposure is the image-decoder DoS class (PNG, GIF, BMP via `addImage`). SASU has already mitigated it by magic-byte checking and re-encoding the logo through canvas, so jsPDF only ever sees canvas-produced PNG/JPEG. Because the data never leaves the browser, the worst case is a self-DoS (one tab hangs on a crafted file), not a server outage.
- A JSON backup restore can reintroduce `style.logo` as a data URL without going through the canvas re-encode. Whether the restore path re-encodes the logo or only zod-validates its string shape needs checking. If it only validates the shape, a crafted backup could feed a malicious PNG to `addImage` (DoS only, on fixed versions).
- Bus factor: each of the four runtime packages is published from a single npm account. A compromised account (see the Shai-Hulud worm below) is a more realistic threat than a CVE.

### Gaps
- No GHSA/CVE for jsPDF's 2021 ReDoS (CVE-2021-23353) was verified in this session.
- The exact patched version of GHSA-pqxr-3g65-p328 and GHSA-vm32-vv63-w422 is inferred from release notes (4.1.0), not from the advisory pages.
- I did not check whether snapdom 3.x ships any `worker`/`blob:` worker code. Its README does not mention workers.

## 2. Gaps in the current CSP/headers vs 2025–2026 best practice

### Takeaway
SASU's policy is already strong (no script allowlist beyond 'self', object-src 'none', frame-ancestors 'none', form-action 'none'). The main gaps are:
- No Trusted Types, which reached Baseline across all major browsers in Feb 2026.
- `'unsafe-inline'` in style-src.
- No violation reporting.
- Obsolete `interest-cohort=()` and legacy X-Frame-Options.
- HSTS without `preload`.
- No COEP (optional).
- GitHub Actions pinned by tag rather than SHA.

### Cited Findings
- Current headers (netlify.toml): the CSP as described, plus `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no preload), COOP same-origin, CORP same-origin. There is no reporting directive — local repo `netlify.toml`
- Trusted Types: Safari added support in Safari 26 (Sept 2025). Firefox completed support in Feb 2026, at which point Trusted Types became Baseline in all major browsers — [CoderCops Baseline 2026](https://blog.codercops.com/blog/baseline-2026-css-features-production-guide); [URIports blog on Trusted Types](https://www.uriports.com/blog/csp-trusted-types/). (These are secondary sources. webstatus.dev/caniuse were not fetched to confirm exact versions.)
- OWASP HTTP Headers cheat sheet: prefer CSP `frame-ancestors` and keep `X-Frame-Options: DENY` only "as fallback for older browsers". For X-XSS-Protection, omit it or set it to `0`. Its example Permissions-Policy is `geolocation=(), camera=(), microphone=()` with no interest-cohort. It recommends COEP `require-corp`, COOP `same-origin`, CORP `same-site`, an explicit Referrer-Policy `strict-origin-when-cross-origin`, and checking hstspreload.org requirements before preload — [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- Netlify: headers can be set in `_headers` or `netlify.toml`, including `Content-Security-Policy-Report-Only` for a dry run. Netlify has a CSP extension that generates per-request nonces for static sites, with built-in violation reporting visible under Logs & Metrics > Functions. If you use both `_headers` and the extension, "two policies means the browser enforces the intersection" — [Netlify CSP docs](https://docs.netlify.com/manage/security/content-security-policy/); [report-uri Netlify guide](https://docs.report-uri.com/platforms/netlify/)
- Report URI example for Netlify: `Content-Security-Policy-Report-Only: …; report-uri https://<id>.report-uri.com/r/d/csp/reportOnly`. Swap to an enforcing header when reports are clean — [report-uri Netlify docs](https://docs.report-uri.com/platforms/netlify/)
- SASU code sets styles only via CSSOM (`style.setProperty('--accent', …)`, `sheet.style.transform`) in src/ui/render.ts, src/ui/sheet.ts, src/landing/hero.ts and src/main-app.ts. No `setAttribute('style')` or `<style>` injection was found — local repo grep

### Inferences
- **Trusted Types:** SASU already bans innerHTML via ESLint and stubs jsPDF's DOMPurify/html2canvas paths. Adding `require-trusted-types-for 'script'; trusted-types 'none'` (or a named policy only if snapdom/Vite need one) is cheap. It turns the lint rule into a browser-enforced guarantee, including for third-party code. Roll it out first as `Content-Security-Policy-Report-Only` to find any sink usage inside snapdom (for example, if it uses `innerHTML` on cloned nodes, a named policy such as `trusted-types snapdom` would be needed). Older browsers ignore the directive, so it is safe to ship.
- **'unsafe-inline' in style-src:** Per the CSP spec, CSSOM writes (`el.style.setProperty`) are not blocked by CSP. Only `style="…"` attributes in parsed markup and `<style>` elements are. SASU's own code therefore likely does not need `'unsafe-inline'`. The likely blockers are (a) snapdom, which builds inline-styled clone markup (but that markup is rasterised as an SVG image, and SVG-as-image documents are generally not governed by the embedding page's CSP; needs testing), (b) any `style=` attributes in index.html/app.html, and (c) Vite dev-mode HMR (production builds emit external CSS). Approach: test `style-src 'self'` in Report-Only. If only attributes break, use `style-src-elem 'self'; style-src-attr 'unsafe-inline'` as an intermediate step. Style injection is a low-severity vector (CSS exfiltration of attribute values), so this is a medium-priority item.
- **strict-dynamic:** This is not relevant. It helps nonce- or hash-based policies with dynamically loaded scripts. SASU serves only same-origin bundled scripts, and `script-src 'self'` with no CDN hosts is already a strong allowlist. The Netlify nonce extension adds complexity without benefit here.
- **COEP:** `require-corp` would block the ProductHunt badge image unless it sends CORP/CORS. COEP is needed only for cross-origin isolation features (SharedArrayBuffer, precise timers), which SASU does not use. Leave it unset or use `credentialless` if ever needed.
- **X-Frame-Options:** It is redundant with `frame-ancestors 'none'` but harmless. Keep it as a fallback per OWASP. `interest-cohort=()` refers to FLoC, which Chrome abandoned, and some browsers log console warnings for unknown features. Remove it.
- **Permissions-Policy additions** (deny-all for unused powerful features): `browsing-topics=(), accelerometer=(), gyroscope=(), magnetometer=(), hid=(), serial=(), bluetooth=(), midi=(), display-capture=(), idle-detection=(), publickey-credentials-get=(), xr-spatial-tracking=(), clipboard-read=()`. Keep `fullscreen=(self)` if it is ever used.
- **CSP tightening:** `connect-src 'self' data: blob:` is needed only if code fetches data/blob URLs (snapdom may fetch blob URLs to inline images). Verify this, and drop `data:` if unused. `worker-src 'self' blob:` should be dropped if no worker is used. `font-src data:` is needed only if fonts are inlined. Consider adding `manifest-src 'self'` and `media-src 'none'`, or rely on default-src.
- **HSTS:** Add `preload` and submit the domain to hstspreload.org once the apex and all subdomains are HTTPS. The policy is already one year with includeSubDomains, which meets the preload minimum.
- **Reporting:** Add `report-to csp` plus `Reporting-Endpoints: csp="https://…"` (the modern Reporting API), and keep `report-uri` for Firefox fallback. Point both at Report URI, URIports, or a small Netlify Function. Watch for third-party noise from browser extensions.

### Gaps
- Exact Trusted Types version numbers per browser were not confirmed against MDN BCD or webstatus.dev in this session. The secondary sources agree on Safari 26 (Sept 2025) and Firefox (Feb 2026).
- I did not verify whether snapdom triggers CSP style violations in the host page.

## 3. localStorage risks for invoice data and mitigations

### Takeaway
The biggest risks are:
- Silent data loss: Safari's 7-day eviction of all script-writable storage, plus best-effort eviction elsewhere.
- Exposure on shared computers.
- Quota pressure from base64 logos.

XSS exfiltration risk is low given SASU's CSP and textContent-only rendering. Recommended mitigations are IndexedDB + `navigator.storage.persist()`, prominent export/backup nudges, and an optional "clear all data" control. Passphrase encryption is optional and only protects at rest.

### Cited Findings
- WebKit ITP: "deleting all of a website's script-writable storage after seven days of Safari use without user interaction on the site". This covers IndexedDB, LocalStorage, Media keys, SessionStorage and Service Worker registrations/cache. Home-screen web apps "have their own counter of days of use", which resets with actual use — [WebKit blog, Full Third-Party Cookie Blocking and More (2020)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- SASU stores the logo as a data URL in state (`s.style.logo = dataUrl`, src/main-app.ts:191) and persists state to localStorage — local repo grep

### Inferences
- **Safari 7-day cap:** Any user who visits SASU, creates invoices, and returns more than 7 Safari-days later without interacting loses everything. IndexedDB is also covered, so switching storage alone does not fix this. Mitigations:
  - Prompt for a JSON backup / "download your data" after each invoice.
  - Encourage "Add to Home Screen" (PWA install) on iOS/macOS Safari.
  - Call `navigator.storage.persist()`. Browsers may grant persistence based on engagement; it is not verified here whether Safari honours it against the ITP cap.
  - Use the File System Access API (Chromium only) so users can save and open a user-owned `.json` workspace file.
- **Quota:** localStorage is synchronous and limited to about 5 MB per origin (in UTF-16 strings). Base64 inflates binary by about 33%, so a 1–2 MB logo plus many invoices can hit `QuotaExceededError`. SASU's canvas re-encode should also downscale (for example, to 600px max) and write failures should be caught. IndexedDB stores Blobs natively with a much larger quota.
- **XSS exfiltration:** localStorage is readable by any script on the origin. SASU's CSP (`script-src 'self'`, no third-party scripts) plus the textContent discipline makes this a low-likelihood risk, and Trusted Types would harden it further. Supply-chain compromise of a bundled dependency is the realistic XSS vector. No storage choice prevents that, but encryption at rest with a non-stored passphrase would.
- **Shared computers:** Invoice data includes client names, addresses, SIRET/VAT numbers and possibly IBAN, which is personal data under GDPR. Provide a visible "Clear all data on this device" button, optionally an "ephemeral session" mode (sessionStorage only), and a privacy note.
- **Optional encryption:** Web Crypto AES-GCM with a key derived by PBKDF2-SHA-256 (≥600k iterations per current OWASP password storage guidance; not re-fetched here), or Argon2id via WASM (requires `'wasm-unsafe-eval'` in script-src). This protects backups and at-rest data against casual local access and storage scraping. It does not protect against live XSS once the data is unlocked. If the passphrase is lost, the data is lost. This is a UX cost; make it opt-in.
- **zod validation on read** is already the right pattern. Keep schema versioning with migrations so validation failures do not wipe user data. Quarantine invalid blobs instead of discarding them.

### Gaps
- I did not fetch MDN or web.dev for exact quota figures, `persist()` behaviour per browser, or whether persistent storage exempts a site from Safari's ITP cap.
- The OWASP PBKDF2 iteration recommendation was not re-verified in this session.

## 4. PDF library alternatives with tradeoffs

### Takeaway
No alternative is clearly better for SASU right now. jsPDF 4.x plus autotable is maintained, CSP-compatible as SASU uses it, and patched. The strongest alternatives are:
- **@cantoo/pdf-lib**, an active fork; original pdf-lib has been unpublished since Nov 2021. Better for low-level PDF and attachments (Factur-X), but no table layout.
- **pdfmake 0.3.x**, declarative tables with an active team, but a large bundle with embedded VFS fonts and a historical eval CVE.
- **@react-pdf/renderer**, which requires React and historically had CSP eval issues via yoga.

### Cited Findings
- pdf-lib: latest 1.17.1, published 2021-11-06, with no release since. Single maintainer `hopding`, MIT — npm registry (`npm view pdf-lib`)
- @cantoo/pdf-lib: latest 2.11.1 (modified 2026-09-15), 6 npm maintainers, MIT — npm registry. It is a fork that adds SVG support and is maintained "as long as needed" pending better upstream maintenance. About 346K weekly downloads and 112 versions. Stirling-PDF migrated from pdf-lib to this fork — [Cantoo fork README](https://unpkg.com/@cantoo/pdf-lib@2.7.1/README.md); [Socket.dev @cantoo/pdf-lib](https://socket.dev/npm/package/@cantoo/pdf-lib/overview/2.7.4); [Stirling-PDF mirror](https://git.laurivan.com/Mirrors/Stirling-PDF/src/commit/0a1d2effdced141494a27691ab821391b4427086)
- pdfmake: latest 0.3.11 (2026-06-12), 4 npm maintainers, MIT — npm registry. CVE-2022-46161: versions <= 0.2.5 performed unsafe evaluation of user-controlled input (arbitrary code execution). Old 0.1.36 violated CSP because it needed `'unsafe-eval'`, and 0.2.7 is reported to work without it — [CVE-2022-46161 (INCIBE)](https://www.incibe.es/en/incibe-cert/early-warning/vulnerabilities/cve-2022-46161); [DataTables forum CSP thread](https://datatables.net/forums/discussion/76194)
- @react-pdf/renderer: latest 4.9.0 (2026-08-27), single npm maintainer `diegomura`, MIT — npm registry. Historically CSP-incompatible because its dependency yoga-layout-prebuilt used eval — [Lightrun: react-pdf CSP issue](https://lightrun.com/answers/diegomura-react-pdf-cant-use-with-content-security-policy)
- PDFKit: latest 0.20.2 (2026-09-07), 4 npm maintainers (including the react-pdf and pdfmake maintainers), MIT — npm registry

### Inferences
| Option | Fit for SASU | Bundle (approx., not measured here) | Unicode/fonts | Tables | PDF/A, attachments (Factur-X) | CSP | Maintenance |
|---|---|---|---|---|---|---|---|
| jsPDF 4.2.1 + autotable 5.0.8 (current) | Good | ~350 KB min jsPDF core; autotable small | Needs embedded TTF via `addFont` for non-Latin-1; WinAnsi standard fonts only by default | autotable is mature | No native PDF/A; file attachments not first-class | OK with html/svg stubs | Active but advisory-heavy, 1 publisher each |
| @cantoo/pdf-lib | Good for Factur-X | Moderate (~500 KB with fontkit) | Full subsetting via @pdf-lib/fontkit | None; build manually | `attach()` supports embedded files; PDF/A-3 needs manual XMP/OutputIntent | No eval known | Active fork, 6 maintainers |
| pdfmake 0.3.x | Good layout | Large (pdfkit + VFS fonts, often >1 MB) | Good (embedded Roboto, custom fonts) | Excellent declarative tables | Limited | Modern versions OK; old eval CVE | Active, 4 maintainers |
| @react-pdf/renderer | Poor (no React in SASU) | Large (yoga WASM/asm) | Good | Flexbox layout | Limited | Historic eval issues; may need `'wasm-unsafe-eval'` | Active, 1 maintainer |
| PDFKit browser build | Medium | Large (needs Node polyfills) | Good | Manual | Some attachment support | OK | Active |
| Typst/WASM renderers | Experimental | Multi-MB WASM | Excellent typesetting | Excellent | Typst supports PDF/A output | Requires `'wasm-unsafe-eval'` | Young |

- For future Factur-X/ZUGFeRD (the PDF/A-3 + embedded XML required by France's e-invoicing reform), a pragmatic path is to keep jsPDF for rendering and post-process the bytes with @cantoo/pdf-lib to attach `factur-x.xml`, add XMP metadata and an sRGB OutputIntent. This hybrid avoids rewriting layout code. True PDF/A-3 conformance (fonts all embedded, no transparency issues) still needs validation with veraPDF.

### Gaps
- Bundle sizes were not measured. The bundlephobia fetch was not performed, so the table figures are estimates and should be verified.
- I did not verify current @react-pdf/renderer CSP status (yoga now ships as WASM) or Typst WASM package names and maturity.
- I did not confirm PDF/A-3 capabilities per library from primary docs.

## (Cross-cutting) Supply-chain hardening for the npm/Vite/Netlify project

### Cited Findings
- The Shai-Hulud self-replicating npm worm (from 2025-09-14) stole maintainer credentials via post-install scripts and republished trojanized packages. GitHub removed 500+ packages. A "Shai-Hulud 2" variant later compromised thousands of packages and CI environments. npm responded with Trusted Publishing (OIDC) and phased out classic tokens on 2025-12-09 — [DevOps.com](https://devops.com/how-github-plans-to-secure-npm-after-recent-supply-chain-attacks/); [VerSprite](https://versprite.com/resources/security/npm-supply-chain-attack-shai-hulud-worm-compromises-500-packages/); [All About Industries, Shai-Hulud 2](https://www.all-about-industries.com/new-worm-variant-compromises-thousands-of-npm-packages-and-ci-environments-a-b20654dbfe46511fe4c252de5a020d33/)
- SASU state: `package-lock.json` is committed. Dependabot runs weekly for npm (with dev deps grouped) and monthly for github-actions. CI uses `actions/checkout@v4` and `actions/setup-node@v4` (tag-pinned, not SHA-pinned). Netlify builds on Node 24 — local repo (`.github/`, `netlify.toml`)

### Inferences
- Use `npm ci` in CI and on Netlify. Run `npm audit signatures` in CI to verify registry signatures and provenance attestations. Consider `--ignore-scripts` (or an allowlist) since lifecycle scripts were the worm's vector.
- Pin GitHub Actions by full commit SHA (Dependabot can still update SHA pins). Set `permissions: contents: read` at the workflow top.
- Add a cooldown or minimum release age for dependency updates. Renovate has `minimumReleaseAge`, and Dependabot added a `cooldown` option in 2025 (not verified here). Most malicious versions are pulled within hours or days.
- Socket.dev's GitHub app flags install scripts, network access and maintainer changes in PRs. It is free for open source.
- SRI does not apply to the ProductHunt `<img>` badge (SRI covers scripts and styles only). Self-host the badge SVG to drop `https://api.producthunt.com` from img-src, which also removes a third-party request that leaks visitor IPs.

## Prioritized recommendations for SASU

1. **Keep jsPDF patched fast and avoid its risky APIs** (S). Never pass user data to `addJS`, `createAnnotation`, AcroForm fields, `setDocumentProperties`/XMP without sanitising, `html()`, `addSvgAsImage`, or `output('*newwindow', opts)`. Add an ESLint `no-restricted-properties` rule for these. Stay on ≥4.2.1. *Why:* 10 jsPDF advisories in Q1 2026, and the critical ones are in APIs SASU doesn't use yet.
2. **Re-encode logos on the backup-restore path too** (S). Route `style.logo` from imported JSON through the same magic-byte check and canvas re-encode (with a max dimension cap) before it reaches `addImage`. *Why:* the PNG/GIF/BMP decoder DoS class (CVE-2025-57810, CVE-2026-25535, CVE-2026-24133) is fed via `addImage`.
3. **Data-loss protection** (M). Show a persistent "Back up your data" reminder and last-backup timestamp. Call `navigator.storage.persist()`. Explain Safari's 7-day eviction and suggest installing the app. Add a "Clear all data on this device" button. *Why:* WebKit ITP deletes all script-writable storage after 7 days without interaction, and shared-computer exposure of client PII is a GDPR concern.
4. **Pin GitHub Actions by SHA, add `npm audit signatures`, use `npm ci --ignore-scripts` where possible, and add a dependency cooldown** (S). *Why:* each runtime package has one npm publisher, and the 2025 Shai-Hulud worms showed account takeover is the realistic threat.
5. **Add CSP reporting, then Trusted Types** (S→M). Ship `Content-Security-Policy-Report-Only` with `require-trusted-types-for 'script'; trusted-types 'none'` and `style-src 'self'`, plus `Reporting-Endpoints` and `report-uri` (Report URI or a Netlify Function). Promote to enforcing after a clean week. *Why:* Trusted Types has been Baseline since Feb 2026 and makes the innerHTML ban browser-enforced.
6. **Remove `'unsafe-inline'` from style-src** (M). SASU code uses CSSOM only. Fall back to `style-src-attr 'unsafe-inline'` only if snapdom or markup needs it. *Why:* it closes the CSS-injection exfiltration class. Lower severity than script.
7. **Header cleanup** (S). Drop `interest-cohort=()`. Expand the Permissions-Policy deny list (browsing-topics, sensors, hid, serial, bluetooth, display-capture, etc.). Add HSTS `preload` and submit the domain. Keep X-Frame-Options as a legacy fallback. Do not add COEP. Trim `connect-src data:` and `worker-src blob:` if unused. Self-host the ProductHunt badge. *Why:* these are cheap alignment fixes with OWASP 2025–26 guidance.
8. **Move storage to IndexedDB with Blob logos** (M). *Why:* this avoids the ~5 MB localStorage quota and base64 bloat, and avoids blocking the main thread. It does not fix ITP eviction on its own.
9. **Optional passphrase-encrypted backups and storage** (M). AES-GCM with PBKDF2 (Web Crypto, no CSP change). *Why:* protects exported backup files and data at rest on shared machines. Opt-in because a lost passphrase means lost data.
10. **Plan Factur-X via a jsPDF + @cantoo/pdf-lib post-processing step instead of a rewrite** (L). Prototype attaching XML, XMP and an OutputIntent, and validate with veraPDF. Do not adopt original `pdf-lib` (no release since 2021-11). *Why:* France's e-invoicing reform makes structured invoices relevant, and the fork is the maintained option with attachment support.
