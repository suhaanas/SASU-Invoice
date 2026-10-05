import { byId, el } from './dom';

let timer: ReturnType<typeof setTimeout> | undefined;

export type ToastKind = 'ok' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export function showToast(message: string, kind: ToastKind = 'ok', action?: ToastAction): void {
  const t = byId('toast');
  t.replaceChildren(el('span', { text: message }));
  if (action) {
    const btn = el('button', { class: 'toast-action', text: action.label, attrs: { type: 'button' } });
    btn.addEventListener('click', () => {
      t.classList.remove('show');
      action.run();
    });
    t.append(btn);
  }
  t.classList.toggle('error', kind === 'error');
  t.classList.toggle('has-action', Boolean(action));
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), action ? 10000 : kind === 'error' ? 5000 : 3000);
}
