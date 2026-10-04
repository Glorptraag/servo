// The controls of the pages round the child's app, each by touch, pointer and keyboard (ground rule 8, review R-6.4
// APP-3): the parent page's Back to Servo link and its parental gate (packages/parent, served as parent.html), and
// the tester build's invite form. A field is reached by each path and typed into as that hand types: a finger taps
// it and the screen's keyboard inserts the text, a mouse clicks it, a keyboard focuses it.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { hashInviteCode } from '../../src/release/invite-code.ts';
import { INVITE_KEY } from '../../src/release/invite.ts';
import { openThroughInviteGate } from '../../src/release/invite-gate.tsx';
import { SOON } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { keyboard, pointer, touch } from './input.ts';
import type { Path } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** `text` typed into `field` by one path. */
const typeBy = async (path: Path, field: HTMLInputElement, text: string): Promise<void> => {
  if (path === 'touch') {
    await touch(field);
    await vi.waitFor(() => expect(field.ownerDocument.activeElement).toBe(field), SOON);
    await cdp().send('Input.insertText', { text });
  } else if (path === 'pointer') {
    await pointer(field);
    await vi.waitFor(() => expect(field.ownerDocument.activeElement).toBe(field), SOON);
    await userEvent.keyboard(text);
  } else {
    await keyboard(field, text);
  }
};

// The parent page.

interface ParentPage {
  readonly doc: Document;
  one<T extends HTMLElement = HTMLElement>(selector: string): T;
  /** The answer to the gate's question. */
  answer(): string;
  /** Links followed, their navigation held back so the frame stays. */
  readonly followed: string[];
}

const openParent = async (): Promise<ParentPage> => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
  frame.src = '/parent.html';
  document.body.appendChild(frame);
  cleanups.push(() => frame.remove());
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector('main[aria-labelledby="servo-parent-gate"] input')).not.toBeNull(), SOON);
  const doc = frame.contentDocument as Document;
  const followed: string[] = [];
  doc.addEventListener('click', (event) => {
    const link = (event.target as Element).closest('a');
    if (!link) return;
    event.preventDefault();
    followed.push(link.href);
  });
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = doc.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  return {
    doc,
    one,
    followed,
    answer: () => {
      const [, a, b] = /What is (\d+) × (\d+)\?/u.exec(one('main[aria-labelledby="servo-parent-gate"] label').textContent ?? '') ?? [];
      if (!a || !b) throw new Error('no question');
      return String(Number(a) * Number(b));
    },
  };
};

const GATE = 'main[aria-labelledby="servo-parent-gate"]';

threePaths('parent-back', {
  open: openParent,
  control: (page) => page.one('a.parent-back'),
  then: async (page) => {
    await vi.waitFor(() => expect(page.followed).toHaveLength(1), SOON);
    expect(new URL(page.followed[0] ?? '').pathname.endsWith('/')).toBe(true);
  },
});

let typed = '';
threePaths('gate-answer', {
  open: openParent,
  control: (page) => page.one<HTMLInputElement>(`${GATE} input`),
  press: async (path, field, page) => {
    typed = page.answer();
    await typeBy(path, field as HTMLInputElement, typed);
  },
  then: async (page) => {
    await vi.waitFor(() => expect(page.one<HTMLInputElement>(`${GATE} input`).value).toBe(typed), SOON);
  },
});

threePaths('gate-continue', {
  open: async () => {
    const page = await openParent();
    await keyboard(page.one(`${GATE} input`), page.answer());
    await vi.waitFor(() => expect(page.one<HTMLInputElement>(`${GATE} input`).value).toBe(page.answer()), SOON);
    return page;
  },
  control: (page) => page.one(`${GATE} button[type="submit"]`),
  then: async (page) => {
    await vi.waitFor(() => expect(page.doc.querySelector(GATE)).toBeNull(), SOON);
  },
});

// The invite form.

const CODE = 'WXYZ-2345';

interface InvitePage {
  readonly host: HTMLElement;
  readonly opened: () => number;
  field(): HTMLInputElement;
}

const openInvite = async (): Promise<InvitePage> => {
  const remembered = localStorage.getItem(INVITE_KEY);
  localStorage.removeItem(INVITE_KEY);
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  cleanups.push(() => {
    host.remove();
    if (remembered === null) localStorage.removeItem(INVITE_KEY);
    else localStorage.setItem(INVITE_KEY, remembered);
  });
  let opened = 0;
  void openThroughInviteGate(host, [await hashInviteCode(CODE)], () => {
    opened += 1;
  });
  await vi.waitFor(() => expect(host.querySelector('form input.release-input')).not.toBeNull(), SOON);
  return {
    host,
    opened: () => opened,
    field: () => host.querySelector('input.release-input') as HTMLInputElement,
  };
};

threePaths('invite-code', {
  open: openInvite,
  control: (page) => page.field(),
  press: (path, field) => typeBy(path, field as HTMLInputElement, CODE),
  then: async (page) => {
    await vi.waitFor(() => expect(page.field().value).toBe(CODE), SOON);
    expect(page.opened()).toBe(0);
  },
});

threePaths('invite-submit', {
  open: async () => {
    const page = await openInvite();
    await keyboard(page.field(), CODE);
    await vi.waitFor(() => expect(page.field().value).toBe(CODE), SOON);
    return page;
  },
  control: (page) => page.host.querySelector('button.release-button') as HTMLElement,
  then: async (page) => {
    await vi.waitFor(() => expect(page.opened()).toBe(1), SOON);
    expect(localStorage.getItem(INVITE_KEY)).toBe('WXYZ2345');
  },
});
