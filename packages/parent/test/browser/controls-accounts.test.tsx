// The parental gate's and the children's controls, each by touch, pointer and keyboard (ground rule 8, R-6.4 PAR-2):
// the gate's field and Continue, the profile switch, Rename with its field, Save name and Cancel, Remove with Remove
// profile and Keep profile, and adding a child. A field is reached by each path and typed into as that hand types.
// After each press focus is on a control or a heading of the view, never the page's body.
import { afterEach, expect, vi } from 'vitest';
import { PARENT_TEXT } from '../../src/accounts/index.ts';
import { threePaths } from './controls.ts';
import { ANSWER, GATE, SOON, openGate, openParent, openRemove, openRename, replaceText, unmountParents } from './harness.tsx';
import type { ParentPage } from './harness.tsx';
import { keyboard, keysOn, pointer, touch, typeBy } from './input.ts';

afterEach(() => {
  unmountParents();
  vi.restoreAllMocks();
});

const radioOf = (page: ParentPage, name: string): HTMLInputElement => {
  const label = [...page.host.querySelectorAll('fieldset label')].find((element) => element.textContent?.trim() === name);
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`no radio for ${name}`);
  return radio;
};

const names = async (page: ParentPage): Promise<string[]> => (await page.store.profiles.list()).map((profile) => profile.name).sort();

// The gate.

threePaths('gate-answer', {
  open: () => openGate(),
  control: (page) => page.one<HTMLInputElement>(`${GATE} input`),
  press: (path, field) => typeBy(path, field as HTMLInputElement, ANSWER),
  then: async (page) => {
    await vi.waitFor(() => expect(page.one<HTMLInputElement>(`${GATE} input`).value).toBe(ANSWER), SOON);
    expect(document.activeElement).toBe(page.one(`${GATE} input`));
  },
});

threePaths('gate-continue', {
  open: async () => {
    const page = await openGate();
    await keysOn(page.one(`${GATE} input`), ANSWER);
    return page;
  },
  control: (page) => page.one(`${GATE} button[type="submit"]`),
  then: async (page) => {
    await vi.waitFor(() => expect(page.host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title), SOON);
    expect(page.host.querySelector(GATE)).toBeNull();
    // Continue is gone with the gate: focus moves to the view's title.
    expect(document.activeElement).toBe(page.host.querySelector('h1'));
  },
});

// The children.

threePaths('child-switch', {
  open: () => openParent(),
  control: (page) => radioOf(page, 'Sam'),
  // A radio group takes one Tab, onto the child in use, and the arrow keys move the choice (ground rule 8).
  press: async (path, control, page) => {
    if (path === 'keyboard') await keyboard(radioOf(page, 'Robin'), '{ArrowDown}');
    else await (path === 'touch' ? touch(control) : pointer(control));
  },
  then: async (page) => {
    await vi.waitFor(async () => expect((await page.store.profiles.inUse())?.id).toBe(page.sam.id), SOON);
    await vi.waitFor(() => expect(page.host.querySelector('#servo-parent-builds')?.textContent).toBe(`${PARENT_TEXT.builds}: Sam`), SOON);
    expect(document.activeElement).toBe(radioOf(page, 'Sam'));
  },
});

threePaths('rename', {
  open: () => openParent(),
  control: (page) => page.button('Rename Robin'),
  then: async (page) => {
    const field = await vi.waitFor(() => page.one<HTMLInputElement>('input[id^="servo-parent-name-"]'), SOON);
    expect(field.value).toBe('Robin');
    expect(document.activeElement).toBe(field);
  },
});

const renamed = 'Robyn';
threePaths('rename-field', {
  open: async () => {
    const page = await openParent();
    const field = await openRename(page);
    await replaceText(field, '');
    return page;
  },
  control: (page) => page.one<HTMLInputElement>('input[id^="servo-parent-name-"]'),
  press: (path, field) => typeBy(path, field as HTMLInputElement, renamed),
  then: async (page) => {
    await vi.waitFor(() => expect(page.one<HTMLInputElement>('input[id^="servo-parent-name-"]').value).toBe(renamed), SOON);
  },
});

threePaths('save-name', {
  open: async () => {
    const page = await openParent();
    await replaceText(await openRename(page), renamed);
    return page;
  },
  control: (page) => page.button(PARENT_TEXT.saveName),
  then: async (page) => {
    await vi.waitFor(async () => expect(await names(page)).toEqual([renamed, 'Sam']), SOON);
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(`Rename ${renamed}`), SOON);
  },
});

threePaths('cancel-rename', {
  open: async () => {
    const page = await openParent();
    await replaceText(await openRename(page), renamed);
    return page;
  },
  control: (page) => page.button(PARENT_TEXT.cancel),
  then: async (page) => {
    await vi.waitFor(() => expect(page.host.querySelector('input[id^="servo-parent-name-"]')).toBeNull(), SOON);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename Robin');
    expect(await names(page)).toEqual(['Robin', 'Sam']);
  },
});

threePaths('remove', {
  open: () => openParent(),
  control: (page) => page.button('Remove Robin'),
  then: async (page) => {
    await vi.waitFor(() => page.one('[role="group"][aria-label="Remove Robin"]'), SOON);
    // The warning names what goes with the profile, and the safe choice holds the focus.
    expect(document.activeElement?.textContent).toBe(PARENT_TEXT.keep);
    expect(await names(page)).toEqual(['Robin', 'Sam']);
  },
});

threePaths('remove-confirm', {
  open: async () => {
    const page = await openParent();
    await openRemove(page);
    return page;
  },
  control: (page) => page.button(PARENT_TEXT.removeConfirm),
  then: async (page) => {
    await vi.waitFor(async () => expect(await names(page)).toEqual(['Sam']), SOON);
    // The row is gone with the focus it held: focus moves to the remaining child.
    await vi.waitFor(() => expect(document.activeElement).toBe(radioOf(page, 'Sam')), SOON);
  },
});

threePaths('keep', {
  open: async () => {
    const page = await openParent();
    await openRemove(page);
    return page;
  },
  control: (page) => page.button(PARENT_TEXT.keep),
  then: async (page) => {
    await vi.waitFor(() => expect(page.host.querySelector('[role="group"][aria-label="Remove Robin"]')).toBeNull(), SOON);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Robin');
    expect(await names(page)).toEqual(['Robin', 'Sam']);
  },
});

const added = 'Kai';
threePaths('add-field', {
  open: () => openParent(),
  control: (page) => page.one<HTMLInputElement>('#servo-parent-add'),
  press: (path, field) => typeBy(path, field as HTMLInputElement, added),
  then: async (page) => {
    await vi.waitFor(() => expect(page.one<HTMLInputElement>('#servo-parent-add').value).toBe(added), SOON);
  },
});

threePaths('add', {
  open: async () => {
    const page = await openParent();
    await replaceText(page.one<HTMLInputElement>('#servo-parent-add'), added);
    return page;
  },
  control: (page) => page.button(PARENT_TEXT.add),
  then: async (page) => {
    await vi.waitFor(async () => expect(await names(page)).toEqual([added, 'Robin', 'Sam']), SOON);
    await vi.waitFor(() => expect(page.one<HTMLInputElement>('#servo-parent-add').value).toBe(''), SOON);
    expect(page.host.textContent).toContain(added);
  },
});
