// The builds' controls, each by touch, pointer and keyboard (ground rule 8, R-6.4 PAR-2): "Include the build's name in
// links", each build's Parts list with the open list's Print and Close, and Copy link with the field it shows when the
// device will not copy. A tick box is ticked by Space, as a keyboard ticks one. After each press focus is on a control
// or a heading of the view, never the page's body.
import { afterEach, expect, vi } from 'vitest';
import { EXPORT_TEXT } from '../../src/export/index.ts';
import { PARENT_TEXT } from '../../src/accounts/index.ts';
import { threePaths } from './controls.ts';
import { SOON, openParent, openPartsList, showLinkField, unmountParents } from './harness.tsx';
import type { ParentPage } from './harness.tsx';
import { pressBy } from './input.ts';

afterEach(() => {
  unmountParents();
  vi.restoreAllMocks();
});

const status = (page: ParentPage): string | null | undefined => page.host.querySelector('main > p[role="status"]')?.textContent;
const checkbox = (page: ParentPage): HTMLInputElement => page.one<HTMLInputElement>('section[aria-labelledby="servo-parent-builds"] input[type="checkbox"]');

threePaths('include-name', {
  open: () => openParent(),
  control: checkbox,
  press: (path, control) => pressBy(path, control, ' '),
  then: async (page) => {
    await vi.waitFor(() => expect(checkbox(page).checked).toBe(true), SOON);
    expect(document.activeElement).toBe(checkbox(page));
  },
});

threePaths('parts-list', {
  open: () => openParent(),
  control: (page) => page.one('button[aria-label="Parts list for Robin rocket"]'),
  then: async (page) => {
    const panel = await vi.waitFor(() => page.one('section.servo-parts-list'), SOON);
    expect(panel.querySelector('h3')?.textContent).toBe(EXPORT_TEXT.title('Robin rocket'));
    expect(document.activeElement).toBe(panel.querySelector('h3'));
    expect(page.one('button[aria-label="Parts list for Robin rocket"]').getAttribute('aria-expanded')).toBe('true');
  },
});

threePaths('print', {
  open: async () => {
    const page = await openParent();
    await openPartsList(page);
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    return page;
  },
  control: (page) => page.button(EXPORT_TEXT.print),
  then: async (page) => {
    await vi.waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), SOON);
    expect(document.activeElement).toBe(page.button(EXPORT_TEXT.print));
  },
});

threePaths('close-list', {
  open: async () => {
    const page = await openParent();
    await openPartsList(page);
    return page;
  },
  control: (page) => page.button(EXPORT_TEXT.close),
  then: async (page) => {
    await vi.waitFor(() => expect(page.host.querySelector('section.servo-parts-list')).toBeNull(), SOON);
    expect(document.activeElement).toBe(page.one('button[aria-label="Parts list for Robin rocket"]'));
  },
});

threePaths('copy-link', {
  open: async () => {
    const page = await openParent();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    return page;
  },
  control: (page) => page.one('button[aria-label="Copy link: Robin rocket"]'),
  then: async (page) => {
    await vi.waitFor(() => expect(status(page)).toBe(PARENT_TEXT.copied), SOON);
    const url = String(vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0]);
    expect(url).toContain('#share=');
    expect(document.activeElement).toBe(page.one('button[aria-label="Copy link: Robin rocket"]'));
  },
});

threePaths('link-field', {
  open: async () => {
    const page = await openParent();
    await showLinkField(page);
    return page;
  },
  control: (page) => page.one<HTMLInputElement>('section[aria-labelledby="servo-parent-builds"] input[readonly]'),
  then: async (page) => {
    const field = page.one<HTMLInputElement>('section[aria-labelledby="servo-parent-builds"] input[readonly]');
    await vi.waitFor(() => expect(document.activeElement).toBe(field), SOON);
    expect(field.value).toContain('#share=');
    expect(status(page)).toBe(PARENT_TEXT.copyByHand);
  },
});
