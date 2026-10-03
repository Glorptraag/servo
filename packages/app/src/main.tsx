// The web build's entry (index.html): the app fills the page, /settings shows the build's versions instead, and a
// tester build asks for an invite code before either (src/release/start.ts, task 6.3). A production build also
// registers the service worker that keeps the app for offline use (src/offline/, task 5.5). A shared link (a
// `#share=` fragment, task 5.6) opens the shared build's page in place of the child's app, with no store opened.
import { mountApp } from './index.ts';
import { registerOffline } from './offline/index.ts';
import { BUILD_INFO } from './release/build-info.ts';
import { startPage } from './release/start.ts';
import { followShareFragment, isShareFragment, mountSharedPage } from './sharing/index.ts';

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no element with the id "app".');
const openApp = (page: HTMLElement): void => void (isShareFragment(location.hash) ? mountSharedPage(page, location.hash) : mountApp(page));
void startPage(host, { info: BUILD_INFO, pathname: location.pathname, openApp });
followShareFragment(window);
void registerOffline();
