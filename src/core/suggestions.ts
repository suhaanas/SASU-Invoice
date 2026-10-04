/**
 * Smart suggestions: an offline phrase library, not AI. It keyword-matches a
 * short description to a professional line-item wording, and fills note
 * templates. Repeated clicks cycle through the variants.
 */

interface Category {
  keywords: string[];
  phrases: string[];
}

const CATEGORIES: Category[] = [
  { keywords: ['web design', 'website design', 'site design'], phrases: ['Custom responsive website design, including wireframes, high-fidelity mockups and two rounds of revisions', 'Website UI design across desktop, tablet and mobile breakpoints'] },
  { keywords: ['landing page'], phrases: ['Design and build of a conversion-focused landing page', 'Landing page copy, layout and responsive implementation'] },
  { keywords: ['web dev', 'website', 'built site', 'build site', 'frontend', 'front-end'], phrases: ['Front-end development of responsive web pages, including cross-browser testing', 'Website build and deployment, including performance and accessibility checks'] },
  { keywords: ['backend', 'back-end', 'api', 'server'], phrases: ['Back-end development and REST API implementation, including documentation', 'Server-side feature development, integration and testing'] },
  { keywords: ['app', 'mobile', 'ios', 'android'], phrases: ['Mobile application development for iOS and Android, including QA builds', 'Mobile app feature development, testing and store submission support'] },
  { keywords: ['ecommerce', 'e-commerce', 'shopify', 'woocommerce', 'store'], phrases: ['E-commerce store setup, including product catalogue, payments and shipping configuration', 'Online store customisation and checkout optimisation'] },
  { keywords: ['wordpress', 'cms'], phrases: ['WordPress theme customisation, plugin configuration and content setup', 'CMS implementation and editor training session'] },
  { keywords: ['bug', 'fix', 'debug'], phrases: ['Investigation and resolution of reported defects, with regression testing', 'Bug fixing and stability improvements'] },
  { keywords: ['maintenance', 'support', 'retainer'], phrases: ['Monthly maintenance retainer: updates, monitoring, backups and minor fixes', 'Technical support and maintenance for the billing period'] },
  { keywords: ['hosting', 'domain'], phrases: ['Web hosting and domain renewal for the billing period', 'Managed hosting, SSL certificate and uptime monitoring'] },
  { keywords: ['seo'], phrases: ['Technical SEO audit, keyword research and on-page optimisation', 'Monthly SEO: content optimisation, link review and ranking report'] },
  { keywords: ['marketing', 'campaign'], phrases: ['Digital marketing campaign strategy, setup and performance reporting', 'Campaign planning, execution and analytics review'] },
  { keywords: ['social', 'instagram', 'facebook', 'linkedin', 'tiktok'], phrases: ['Social media management: content calendar, post creation and scheduling', 'Social media content creation and community management'] },
  { keywords: ['ads', 'ppc', 'google ads', 'adwords'], phrases: ['Paid advertising campaign management and optimisation (ad spend billed separately)', 'PPC campaign setup, A/B testing and monthly reporting'] },
  { keywords: ['email', 'newsletter', 'mailchimp'], phrases: ['Email newsletter design, copywriting and send scheduling', 'Email marketing automation setup and template design'] },
  { keywords: ['copy', 'content', 'writing', 'blog', 'article'], phrases: ['Professional copywriting, including research, drafting and one round of edits', 'Blog article writing, optimised for search and readability'] },
  { keywords: ['translation', 'translate'], phrases: ['Professional translation and proofreading of supplied documents', 'Document translation with terminology review'] },
  { keywords: ['edit', 'proofread'], phrases: ['Copy-editing and proofreading for clarity, grammar and consistency', 'Structural edit and line-by-line proofreading'] },
  { keywords: ['logo'], phrases: ['Logo design: concept sketches, three initial directions and final vector files', 'Logo refresh, including colour and monochrome variants'] },
  { keywords: ['brand', 'branding', 'identity'], phrases: ['Brand identity package: logo, colour palette, typography and usage guidelines', 'Brand strategy workshop and visual identity development'] },
  { keywords: ['graphic', 'design', 'flyer', 'poster', 'banner'], phrases: ['Graphic design of print and digital assets, supplied in print-ready formats', 'Design of marketing collateral, including two rounds of revisions'] },
  { keywords: ['ui', 'ux', 'figma', 'prototype'], phrases: ['UX research, user flows and interactive Figma prototype', 'UI/UX design of key screens, with a reusable component library'] },
  { keywords: ['illustration', 'drawing'], phrases: ['Custom illustration, delivered in high-resolution and vector formats', 'Illustration set designed to brand guidelines'] },
  { keywords: ['photo', 'photography', 'shoot'], phrases: ['Photography session, including editing and delivery of high-resolution images', 'Product photography with retouching and web-optimised exports'] },
  { keywords: ['video', 'filming', 'edit video', 'youtube'], phrases: ['Video production: filming, editing, colour grading and final export', 'Video editing with motion graphics, captions and music licensing'] },
  { keywords: ['animation', 'motion'], phrases: ['Motion graphics and animation, including storyboard and final render', '2D animation for marketing use'] },
  { keywords: ['audio', 'podcast', 'music', 'voice'], phrases: ['Audio editing, mixing and mastering', 'Podcast production: editing, levelling and show notes'] },
  { keywords: ['consult', 'advice', 'advisory', 'strategy'], phrases: ['Strategic consulting sessions, including preparation and written recommendations', 'Advisory services and follow-up summary report'] },
  { keywords: ['meeting', 'call', 'workshop'], phrases: ['Facilitated workshop, including preparation and written outcomes', 'Consultation call and follow-up action notes'] },
  { keywords: ['training', 'course', 'lesson', 'tutor', 'coaching'], phrases: ['Training session, including materials and follow-up resources', 'One-to-one coaching session'] },
  { keywords: ['research', 'analysis', 'report'], phrases: ['Research and analysis, delivered as a written report with recommendations', 'Market research and competitor analysis report'] },
  { keywords: ['data', 'dashboard', 'analytics'], phrases: ['Data analysis and interactive dashboard development', 'Analytics setup, tracking plan and reporting dashboard'] },
  { keywords: ['ai', 'machine learning', 'ml', 'automation'], phrases: ['Workflow automation design and implementation', 'Machine-learning prototype development and evaluation report'] },
  { keywords: ['security', 'audit', 'pentest'], phrases: ['Security assessment with prioritised findings and remediation guidance', 'Security review and hardening of production configuration'] },
  { keywords: ['it', 'network', 'setup', 'install'], phrases: ['IT setup and configuration, including documentation', 'Hardware and software installation with user handover'] },
  { keywords: ['bookkeeping', 'accounting', 'tax return', 'payroll'], phrases: ['Monthly bookkeeping and account reconciliation', 'Preparation of financial statements and tax filing support'] },
  { keywords: ['legal', 'contract'], phrases: ['Contract drafting and review', 'Legal consultation and written advice'] },
  { keywords: ['virtual assistant', 'admin', 'assistant'], phrases: ['Virtual assistance: scheduling, inbox management and admin support', 'Administrative support services for the billing period'] },
  { keywords: ['event', 'wedding', 'party'], phrases: ['Event planning and on-the-day coordination', 'Event services, including setup and breakdown'] },
  { keywords: ['cleaning'], phrases: ['Professional cleaning services', 'Deep-clean service, including materials and equipment'] },
  { keywords: ['repair', 'plumbing', 'electrical', 'handyman'], phrases: ['Repair work, including parts and labour', 'Call-out, diagnosis and repair'] },
  { keywords: ['delivery', 'shipping', 'courier', 'transport'], phrases: ['Delivery and logistics services', 'Courier service, including handling and tracking'] },
  { keywords: ['rent', 'rental', 'hire', 'equipment'], phrases: ['Equipment hire for the agreed period', 'Rental fee for the billing period'] },
  { keywords: ['licen', 'subscription', 'software'], phrases: ['Software licence / subscription for the billing period', 'Annual licence renewal'] },
  { keywords: ['hour', 'hrs', 'time'], phrases: ['Professional services billed at the agreed hourly rate', 'Time and materials for work completed this period'] },
  { keywords: ['deposit', 'upfront', 'advance'], phrases: ['Project deposit, applied against the final invoice', 'Advance payment to secure project scheduling'] },
  { keywords: ['milestone', 'phase', 'stage'], phrases: ['Milestone payment on completion of the agreed project phase', 'Project stage delivery as per statement of work'] },
];

const cursors = new Map<string, number>();

function cycle<T>(key: string, list: readonly T[]): T {
  const i = cursors.get(key) ?? 0;
  cursors.set(key, i + 1);
  return list[i % list.length] as T;
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function matches(text: string, keyword: string): boolean {
  // Whole-word match for short keywords so "it" doesn't match "edit".
  if (keyword.length <= 3) return new RegExp(String.raw`\b${keyword}\b`).test(text);
  return text.includes(keyword);
}

/** A professional rewording of a short line-item description, or null. */
export function suggestDescription(input: string): string | null {
  const text = normalise(input);
  if (!text) return null;
  // Prefer the most specific match: "web design" beats plain "design".
  let best = 0;
  let pool: string[] = [];
  for (const c of CATEGORIES) {
    const len = Math.max(0, ...c.keywords.filter((k) => matches(text, k)).map((k) => k.length));
    if (len > best) {
      best = len;
      pool = [...c.phrases];
    } else if (len > 0 && len === best) {
      pool.push(...c.phrases);
    }
  }
  if (pool.length === 0) {
    const cleaned = input.trim().replace(/\.$/, '');
    const cap = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return cycle(`fallback|${text}`, [
      `${cap} — professional services as agreed`,
      `${cap}, including project management and delivery`,
    ]);
  }
  return cycle(`desc|${text}`, pool);
}

export const NOTE_TONES = ['friendly', 'formal', 'reminder'] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

export interface NoteContext {
  client: string;
  business: string;
  dueDate: string;
  total: string;
  number: string;
}

const NOTES: Record<NoteTone, string[]> = {
  friendly: [
    'Hi {client}, it has been a pleasure working with you! Let me know if you have any questions about this invoice.',
    'Thanks so much, {client}! I really enjoyed this project and look forward to the next one.',
    'Thank you for your business, {client}. Payment of {total} by {due} would be much appreciated.',
  ],
  formal: [
    'Dear {client}, please find enclosed invoice {number} for services rendered. Kindly remit {total} by {due}.',
    'Thank you for your continued business. Please reference invoice {number} with your payment.',
    'We appreciate your prompt payment within the agreed terms. Please contact us with any queries regarding this invoice.',
  ],
  reminder: [
    'Dear {client}, this is a friendly reminder that invoice {number} for {total} is due on {due}.',
    'Hi {client}, our records show invoice {number} ({total}) is still outstanding. We would be grateful for payment at your earliest convenience.',
    'Reminder: payment of {total} for invoice {number} was due on {due}. If you have already paid, please disregard this note.',
  ],
};

export function suggestNote(tone: NoteTone, ctx: NoteContext): string {
  const tpl = cycle(`note|${tone}`, NOTES[tone]);
  const fill: Record<string, string> = {
    client: ctx.client || 'there',
    business: ctx.business || 'us',
    due: ctx.dueDate || 'the due date',
    total: ctx.total,
    number: ctx.number ? `#${ctx.number}` : '',
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => fill[k] ?? '').replace(/\s{2,}/g, ' ');
}

/** Exposed for tests. */
export function _resetSuggestionCycle(): void {
  cursors.clear();
}
