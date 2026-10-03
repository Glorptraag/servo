// The child's app, as the web build starts it, on a database the test names in the address (?store=<name>), for the
// two-page test: the parent view runs in the test's page, and this page is the app open beside it.
import { mountApp } from '@servo/app';

const host = document.getElementById('app');
const name = new URLSearchParams(location.search).get('store');
if (!host || !name) throw new Error('The app page needs an element with the id "app" and ?store=<database name>.');
void mountApp(host, { store: { name } });
