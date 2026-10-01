// The real app, started as the web build's src/main.tsx starts it, but on a database the test names in the address
// (?store=<name>). store.test.tsx loads it in a frame and reloads it for real, and no other test's app page shares
// its database.
import { mountApp } from '../../src/index.ts';

const host = document.getElementById('app');
const name = new URLSearchParams(location.search).get('store');
if (!host || !name) throw new Error('The store test page needs an element with the id "app" and ?store=<database name>.');
void mountApp(host, { store: { name } });
