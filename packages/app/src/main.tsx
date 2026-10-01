// The web build's entry (index.html): the app fills the page, and /settings shows the build's versions instead. A
// tester build asks for an invite code first (src/release/, task 6.3).
import { mountApp } from './index.ts';
import { BUILD_INFO } from './release/build-info.ts';
import { openThroughInviteGate } from './release/invite-gate.tsx';
import { isSettingsPath, mountSettings } from './release/settings.tsx';

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no element with the id "app".');
const open = (): void => {
  if (isSettingsPath(location.pathname)) mountSettings(host, BUILD_INFO);
  else void mountApp(host);
};
if (BUILD_INFO.inviteHashes.length > 0) void openThroughInviteGate(host, BUILD_INFO.inviteHashes, open);
else open();
