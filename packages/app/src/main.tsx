// The web build's entry (index.html): the app fills the page, /settings shows the build's versions instead, and a
// tester build asks for an invite code before either (src/release/start.ts, task 6.3).
import { mountApp } from './index.ts';
import { BUILD_INFO } from './release/build-info.ts';
import { startPage } from './release/start.ts';

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no element with the id "app".');
void startPage(host, { info: BUILD_INFO, pathname: location.pathname, openApp: (page) => void mountApp(page) });
