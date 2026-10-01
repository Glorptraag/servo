// The web build's entry (index.html): the app fills the page.
import { mountApp } from './index.ts';

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no element with the id "app".');
void mountApp(host);
