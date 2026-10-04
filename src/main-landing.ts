/**
 * Landing page entry. Every visual on the page is rendered by the editor's own
 * modules (sheet renderer, calc engine, formatter, phrase library), so it
 * updates automatically whenever the app changes.
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './styles/sheet.css';
import './styles/landing.css';

import { initFeatures } from './landing/features';
import { initHero } from './landing/hero';
import { initHow } from './landing/how';

initHero();
initFeatures();
initHow();

// Nav gains a hairline once the page scrolls.
const nav = document.querySelector('.nav');
if (nav) {
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Smooth in-page navigation (instant when reduced motion is requested).
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href')!.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  });
});
