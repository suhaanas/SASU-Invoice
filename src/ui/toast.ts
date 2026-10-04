import { byId } from './dom';

let timer: ReturnType<typeof setTimeout> | undefined;

export type ToastKind = 'ok' | 'error';

export function showToast(message: string, kind: ToastKind = 'ok'): void {
  const t = byId('toast');
  t.textContent = message;
  t.classList.toggle('error', kind === 'error');
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 5000 : 3000);
}
