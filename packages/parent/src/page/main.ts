// The parent page's entry in the web build (D91): packages/app/parent.html loads it, and Home links to that page. The
// app may not import parent, so the parent view is a page of its own beside the child's app, on the same store. It opens
// the store and mounts the parent view, whose parental gate asks first (D28) and again after the page is hidden.
import { openStore } from '@servo/app/store';
import { mountParent } from '../index.ts';

export const PAGE_TEXT = {
  noStore: 'This device is not keeping builds, so there is nothing to show here.',
} as const;

const host = document.getElementById('parent');
if (!host) throw new Error('parent.html has no element with the id "parent".');
openStore().then(
  (store) => void mountParent(host, store),
  () => {
    host.textContent = PAGE_TEXT.noStore;
  },
);
