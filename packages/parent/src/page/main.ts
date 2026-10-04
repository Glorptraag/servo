// The parent page's entry in the web build (D91): packages/app/parent.html loads it, and Home links to that page. The
// app may not import parent, so the parent view is a page of its own beside the child's app, on the same store. It opens
// the store and mounts the parent view, whose parental gate asks first (D28) and again after the page is hidden. The
// page follows this device's access options (task 7.5): the view does, and so does the body round it, the Back to
// Servo link and the page's ground included.
import { AccessStore, openStore, pageStorage } from '@servo/app/store';
import { applyAccess, mountParentWith } from '../accounts/index.ts';

export const PAGE_TEXT = {
  noStore: 'This device is not keeping builds, so there is nothing to show here.',
} as const;

const host = document.getElementById('parent');
if (!host) throw new Error('parent.html has no element with the id "parent".');

const access = new AccessStore(pageStorage());
access.follow(window);
document.body.classList.add('release-page');
const follow = () => applyAccess(document.body, access.prefs);
follow();
access.subscribe(follow);

openStore().then(
  (store) => void mountParentWith(host, store, { access }),
  () => {
    host.textContent = PAGE_TEXT.noStore;
  },
);
