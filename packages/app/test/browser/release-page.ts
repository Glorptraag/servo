// A page that starts as main.tsx does, through startPage, for release.test.tsx to load in a frame and reload for real.
// The build's invite hashes come from the address (?hash=…, and ?path= for the path startPage routes on), and a
// stand-in for the child's app marks the page each time it opens.
import { buildInfoFrom } from '../../src/release/build-info.ts';
import { startPage } from '../../src/release/start.ts';

const host = document.getElementById('app');
if (!host) throw new Error('release-page.html has no element with the id "app".');
const params = new URLSearchParams(location.search);
void startPage(host, {
  info: buildInfoFrom({ appVersion: '0.1.0', contentVersion: '0.1.0+9c5fd87f', inviteHashes: params.getAll('hash').join(',') }),
  pathname: params.get('path') ?? '/',
  openApp: (page) => {
    const marker = document.createElement('p');
    marker.dataset.app = 'open';
    marker.textContent = 'The app';
    page.append(marker);
  },
});
