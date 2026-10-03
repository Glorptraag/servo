// The parent view's "Copy link" (task 5.6) in Chromium, behind the parental gate: by pointer, by touch and by keyboard;
// the "include the build's name" option starts unticked (D21); a device that will not copy shows the link in a field.
// No link holds a child's name or id, and nothing reaches the page's address.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { SHARED_BUILD_NAME, openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import { EXPORT_TEXT } from '../../src/export/index.ts';
import type { ParentHandle } from '../../src/index.ts';

let mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore } | undefined;
const copied: string[] = [];
let refuse = false;

afterEach(() => {
  mounted?.handle.destroy();
  mounted?.host.remove();
  mounted?.store.close();
  mounted = undefined;
  copied.length = 0;
  refuse = false;
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** The clipboard, kept here: headless Chromium's own asks for a permission and the page's focus. */
const stubClipboard = (): void => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (refuse) return Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
};

const tap = async (element: Element): Promise<void> => {
  const box = element.getBoundingClientRect();
  const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const payloadOf = async (url: string): Promise<{ meta: Record<string, unknown> }> => {
  const text = url.slice(url.indexOf('.', url.indexOf('#')) + 1).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(text + '='.repeat((4 - (text.length % 4)) % 4)), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer())) as { meta: Record<string, unknown> };
};

const statusLine = (host: HTMLElement): string | null | undefined => [...host.querySelectorAll('[role="status"]')].at(-1)?.textContent;

describe('Copy link in the parent view', () => {
  it('copies a link with no child in it, by pointer, touch and keyboard, the name only when ticked', async () => {
    stubClipboard();
    const store = await openStore({ name: `servo-parent-${crypto.randomUUID()}` });
    const robin = await store.profiles.create('Robin Achebe');
    await store.forProfile(robin.id).blueprints.create({ name: 'Robin rocket', level: 1, arena: { preset: 'open-floor', props: [] } });
    const host = document.createElement('div');
    document.body.append(host);
    mounted = { handle: mountParentWith(host, store, { random: () => 0 }), host, store };
    const address = location.href;

    // Behind the gate: nothing to share until an adult answers.
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    expect(host.textContent).not.toContain(PARENT_TEXT.copyLink);
    await userEvent.fill(host.querySelector('input') as HTMLInputElement, '72');
    await userEvent.keyboard('{Enter}');
    const copy = (): HTMLButtonElement => {
      const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${PARENT_TEXT.copyLink}: Robin rocket"]`);
      if (!found) throw new Error('no Copy link');
      return found;
    };
    await expect.poll(() => host.querySelector(`button[aria-label="${PARENT_TEXT.copyLink}: Robin rocket"]`)).toBeTruthy();
    const option = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!option) throw new Error('no option');
    expect(option.checked).toBe(false);
    expect(option.closest('label')?.textContent).toBe(PARENT_TEXT.includeName);

    // Both actions sit in the build's own row: 5.3's Parts list, then Copy link, and both still work.
    const row = copy().closest('li');
    const partsList = row?.querySelector<HTMLButtonElement>(`button[aria-label="${EXPORT_TEXT.openFor('Robin rocket')}"]`);
    expect(partsList).toBeTruthy();
    expect([...(row?.querySelectorAll('button') ?? [])].map((found) => found.textContent)).toEqual([EXPORT_TEXT.open, PARENT_TEXT.copyLink]);
    await userEvent.click(partsList as HTMLButtonElement);
    await expect.poll(() => host.querySelector('#servo-parts-list-title')?.textContent).toBe(EXPORT_TEXT.title('Robin rocket'));

    // Pointer, unticked: "Shared build".
    await userEvent.click(copy());
    await expect.poll(() => copied.length).toBe(1);
    expect(statusLine(host)).toBe(PARENT_TEXT.copied);
    expect(copied[0]?.startsWith(`${location.origin}/#share=1.`)).toBe(true);
    expect((await payloadOf(copied[0] ?? '')).meta.name).toBe(SHARED_BUILD_NAME);

    // Keyboard ticks the option, touch copies: the build's name, and still no child.
    option.focus();
    await userEvent.keyboard(' ');
    expect(option.checked).toBe(true);
    await tap(copy());
    await expect.poll(() => copied.length).toBe(2);
    const named = await payloadOf(copied[1] ?? '');
    expect(named.meta.name).toBe('Robin rocket');
    expect(Object.keys(named.meta)).not.toContain('author');

    // A device that will not copy: Enter on the button shows the link in a field, focused and selected.
    refuse = true;
    copy().focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => statusLine(host)).toBe(PARENT_TEXT.copyByHand);
    const field = host.querySelector<HTMLInputElement>('input[readonly]');
    expect(field?.value.startsWith(`${location.origin}/#share=1.`)).toBe(true);
    expect(document.activeElement).toBe(field);

    for (const url of [...copied, field?.value ?? '']) {
      expect(url).not.toContain(robin.id);
      expect(JSON.stringify(await payloadOf(url))).not.toContain('Robin Achebe');
      expect(JSON.stringify(await payloadOf(url))).not.toContain(robin.id);
    }
    expect(location.href).toBe(address);
    vi.restoreAllMocks();
  });
});
