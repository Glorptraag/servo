// The performance measurement's page (task 6.1, docs/perf.md): the real app, started as main.tsx starts it, on a store
// that opens with content's 25-part busy-workbench fixture as the child's newest build. packages/tools/src/perf/ builds
// it beside the web build, never into it, and times Build and Run frames on it. `?store=<name>` names the database.
import { loadFixtures } from '@servo/content/fixtures';
import { mountApp } from '../index.ts';
import { openStore } from '../store/index.ts';
import { markInteractive } from './marks.ts';

/** The fixture the budgets name: 25 parts (brief Section 7, task 2.6). */
const PERF_FIXTURE = 'busy-workbench';

const host = document.getElementById('app');
if (!host) throw new Error('The perf page needs an element with the id "app".');
const name = new URLSearchParams(location.search).get('store') ?? 'servo-perf';

const seed = async (): Promise<void> => {
  const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === PERF_FIXTURE);
  if (!fixture) throw new Error(`No ${PERF_FIXTURE} fixture.`);
  const store = await openStore({ name });
  try {
    const profile = (await store.profiles.list())[0] ?? (await store.profiles.create('Builder 1'));
    await store.profiles.use(profile.id);
    const copied = await store.forProfile(profile.id).blueprints.copy(fixture.blueprint, PERF_FIXTURE);
    if (!copied.ok) throw new Error(`The ${PERF_FIXTURE} fixture does not load in the store.`);
  } finally {
    store.close();
  }
};

await seed();
await mountApp(host, { store: { name } });
markInteractive();
