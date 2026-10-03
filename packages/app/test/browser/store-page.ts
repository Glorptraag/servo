// The real app, started as the web build's src/main.tsx starts it, but on a database the test names in the address
// (?store=<name>). store.test.tsx loads it in a frame and reloads it for real, and no other test's app page shares
// its database. Two failures the device can bring are made here before the app starts: `?blocked` makes opening
// IndexedDB throw, as when site data is blocked, and `?full` makes every write throw a quota error.
import { mountApp } from '../../src/index.ts';

const host = document.getElementById('app');
const params = new URLSearchParams(location.search);
const name = params.get('store');
if (!host || !name) throw new Error('The store test page needs an element with the id "app" and ?store=<database name>.');
if (params.has('blocked')) {
  IDBFactory.prototype.open = () => {
    throw new DOMException('Site data is blocked on this device.', 'SecurityError');
  };
}
if (params.has('full')) {
  const full = (): never => {
    throw new DOMException('This device has no room left.', 'QuotaExceededError');
  };
  IDBObjectStore.prototype.add = full;
  IDBObjectStore.prototype.put = full;
}
void mountApp(host, { store: { name } });
