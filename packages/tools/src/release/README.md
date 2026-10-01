# The release pipeline

Task 6.3. A `v*` tag builds a tester release: the web build with its app version and content version baked in, a content bundle with its own version, and the tester invite codes. [.github/workflows/release.yml](../../../../.github/workflows/release.yml) uploads them as workflow artifacts. `pnpm release:dry` makes the same release on your machine. Nothing here uploads or deploys anything. No host has been chosen (D10, D13), so a release has no tester URL yet.

## What a release writes

Everything goes into one folder, `dist/release` by default (gitignored):

| Path | What | Workflow artifact |
| --- | --- | --- |
| `web/` | The app's build (`packages/app/dist`) with the versions and code hashes baked in, plus `web/settings/index.html` | `servo-web-<app version>` |
| `release.json` | The app version, the content version, the commit, whether the working tree had changes, and how many invite codes the build takes. It never holds a code | `servo-web-<app version>` |
| `content/servo-content.json` | The content bundle | `servo-content-<content version>` |
| `private/invite-codes.txt` | The tester invite codes, only when `SERVO_INVITE_SEED` is set | `servo-invite-codes-<app version>`, kept 7 days |

A release removes an earlier release's `web/`, `content/`, `private/` and `release.json` from the folder first, so old codes never outlive it. It refuses a folder that holds anything else (hidden files aside), and one that overlaps `packages/app/dist`.

## Running it

```
pnpm release:dry [--out <folder>] [--invite-count <n>]
SERVO_INVITE_SEED=<secret> pnpm release:dry
pnpm release:preview
```

`pnpm release:dry` runs the steps below in order, and stops with a readable message at the first problem:

1. Checks the content as CI does: `pnpm validate-content`'s checks over `packages/content`, and content's own loader over the bundle's records. Any issue, or no part records at all, stops the release before anything is built.
2. Works out the content version and the bundle.
3. With `SERVO_INVITE_SEED` set, makes the invite codes and their hashes.
4. Runs `pnpm build` (which runs `pnpm art` first) with the versions and hashes in `VITE_SERVO_*` variables and the seed taken out of its environment.
5. Copies `packages/app/dist` to `web/`, adds `web/settings/index.html`, and checks the build: some file must hold the content version and every code's hash (or the variables did not reach Vite), and no file may hold a code or the seed.
6. Writes the bundle, the codes and `release.json`, and prints the app version and the content version.

| Option | Default | |
| --- | --- | --- |
| `--tag <tag>` | none: a dry run | The tag being released, `v<major>.<minor>.<patch>` with an optional pre-release (`v0.1.0`, `v0.1.0-tester.1`). The workflow passes it |
| `--out <folder>` | `dist/release` in the repository | Relative to the folder the command was typed in |
| `--invite-count <n>` | 10 | 1 to 500 |

`pnpm release:preview` serves `dist/release/web` with `vite preview` at http://localhost:4173; add `--host` to reach it from a tablet on the same network. Exit status: 0 when the release is written, 1 when something stops it, 2 when the command is misused.

## Versions

**App version.** The tag without its `v`: `v0.1.0` gives `0.1.0`. A tag that is not a version stops the release. A dry run's app version is `dry-` and the short commit, with `-dirty` when the working tree has changes (`dry-01bd743-dirty`), or `dry` without git.

**Content version.** `<semver>+<short hash>`, for example `0.1.0+9c5fd87f`, a valid semantic version whose build part is the hash:

- `<semver>` is `packages/content/package.json`'s `version`. People bump it; see the questions below.
- `<short hash>` is the first 8 hex digits of the SHA-256 of the canonical JSON of `{ records, terminology }`, the bundle's two maps. Canonical JSON puts every object's keys in code-unit order, at every depth, with no whitespace. Arrays keep their order.
- So the version changes whenever any record, its path or a terminology list changes, even when nobody bumps the semver. Reformatting a file or reordering its keys changes nothing.

**Where they show.** Settings, an adult-facing page at `/settings` ([packages/app/src/release/settings.tsx](../../../app/src/release/settings.tsx)), shows the app version and the content version and nothing else. It is read-only and has no links out (brief Section 13). The parental gate in front of it is task 5.1's (D28). It is reached by its address, not from the child's view: Home has no owner yet (D68). A build made outside the release (`pnpm dev`, `pnpm build`) shows "Not a release build" for both.

The release passes the values to Vite as `VITE_SERVO_APP_VERSION`, `VITE_SERVO_CONTENT_VERSION` and `VITE_SERVO_INVITE_HASHES` (comma-separated), which Vite writes into the bundle where [build-info.ts](../../../app/src/release/build-info.ts) names them. The seed never has a `VITE_` name and never reaches the build.

`web/settings/index.html` is a copy of `index.html`, so `/settings/` opens on any static host, not only one that serves `index.html` for every path. That works because Vite's default base, `/`, makes every asset URL absolute; the release refuses an `index.html` with relative URLs.

## The content bundle

`content/servo-content.json` holds every record the app's loader reads, so curriculum can later ship apart from an app release (brief Section 6):

```json
{
  "format": "servo-content-bundle",
  "formatVersion": 1,
  "version": "0.1.0+9c5fd87f",
  "semver": "0.1.0",
  "sha256": "9c5fd87f…",
  "records": { "parts/level-1/dc-motor.json": { "id": "dc-motor" } },
  "terminology": { "terminology/banned.json": { } }
}
```

- `records` and `terminology` are keyed by each file's path inside `packages/content`, exactly what content's `contentFrom(files)` takes. Records are every `.json` file outside `art/`, `fixtures/`, `test/`, terminology folders, hidden folders and `node_modules`, and not `package.json` or a tsconfig: what `loadContent()` reads. A test proves `contentFrom(bundle)` gives the same parts, arenas, kits, challenges and terminology as `loadContent()`, with no issues.
- A reader checks a bundle by working out the SHA-256 of the canonical JSON of `{ records, terminology }` and comparing it with `sha256`.
- Art is not in the bundle. Placeholders are drawn from the records at build time (`pnpm art`), and final art (D6) does not exist yet.
- The app does not load the bundle yet: each app build bakes in the content it was built with, which is the same content and the same version. Loading a newer bundle at run time needs a host to fetch it from (D10).

## Invite codes

A soft gate, not security. The check runs in the browser, and the hash of an 8-character code can be undone by trying every code, so anyone who reads the web build's code can get past it. The codes keep a tester URL from being opened by chance, and protect nothing.

- **Made from a seed.** Code number `n` is the first 40 bits of HMAC-SHA256(seed, `servo-invite:<n>`), written as 8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0, 1, I or O) and printed in two groups of four, such as `7KQ2-M9XD`. Codes are all different. The same seed gives the same codes in every release, and a larger `--invite-count` keeps the smaller one's codes first, so testers keep their codes from release to release. A new seed replaces every code.
- **The seed** is the repository secret `SERVO_INVITE_SEED`, at least 16 characters (`openssl rand -hex 32` makes one). Without it the release makes no codes, the build has no invite gate, and the summary says so. A release built that way should not go to a public address.
- **Only hashes in the build.** The build holds the lower-case hex SHA-256 of each code's 8 characters. The codes go only into `private/invite-codes.txt` and its artifact, which everyone with read access to the repository can download, so keep the repository private (D3).
- **In the app** ([packages/app/src/release/](../../../app/src/release/)). A build with hashes opens on a plain page with one field, Invite code, before anything else, `/settings` included. It is the page, not a dialog box (ground rule 9), and a wrong code is a line of text under the field. The app upper-cases what is typed, takes out spaces and dashes, hashes it with the browser's Web Crypto and compares. A match is remembered on the device in localStorage under `servo.invite.code`, and the app opens; the next launch checks the remembered code again, so a new seed asks again. A build with no hashes has no gate.
- **Secure pages only.** Web Crypto works only on https and on localhost. On a plain http address, such as a laptop's address on the home network, the gate says codes can be checked only on a secure address. Try a gated build on localhost, or make one without a seed.

## The workflow

[.github/workflows/release.yml](../../../../.github/workflows/release.yml) runs on every pushed `v*` tag: install, `node packages/tools/src/release/main.ts --tag "$GITHUB_REF_NAME"`, then one upload per artifact (actions/upload-artifact, pinned by commit SHA), then the deploy step or a note that it was skipped. The release step writes the versions and whether there are codes to the job summary (never a code), and the outputs `app-version`, `content-version` and `invite-codes` that name the artifacts. CI ([ci.yml](../../../../.github/workflows/ci.yml)) runs on the same push: check it is green before sharing a build.

| Setting | Kind | What |
| --- | --- | --- |
| `SERVO_INVITE_SEED` | secret | The seed the codes come from. Absent: no codes, no gate |
| `SERVO_INVITE_COUNT` | variable | How many codes; 10 when not set |
| `DEPLOY_TOKEN` | secret | The host's deploy token. Absent: the deploy step is skipped and the summary says so |
| `TESTER_URL` | variable | The address the host serves the build at, printed once a deploy succeeds |

## Serving a release without a host

Until a host is chosen, a release is a set of artifacts:

- **On this machine.** `pnpm release:dry`, then `pnpm release:preview`. For a release from the workflow, download its `servo-web-<version>` artifact, unzip it into `dist/release` (so its `web/` folder lands at `dist/release/web`), then `pnpm release:preview`.
- **On any static host.** Upload the contents of `web/` to the site's root. It is plain files: `index.html`, `assets/` and `settings/index.html`. Serve it over https so the invite gate can check codes. The build expects to sit at the root of its address (Vite's base `/`).

## Deploying

Waits for a host (D10, D13). When Drew picks one, its deploy command goes into the workflow's Deploy step: a CLI pinned in `pnpm-lock.yaml`, or a third-party action pinned by commit SHA, never a tag. It uploads `dist/release/web` with `DEPLOY_TOKEN`, and `TESTER_URL` names the address. Until then, setting `DEPLOY_TOKEN` makes the Deploy step fail with "no deploy command", so a token never looks like a deploy. Gate a real deploy on CI passing for the same commit.

## Tests

- `test/release-content.test.ts`: canonical JSON, the content version's form and what changes it, a known answer worked out with `shasum`, the bundle of `packages/content` against `loadContent()`, what is read and left out, and content the release refuses.
- `test/release-invite-codes.test.ts`: known codes and hashes worked out independently (Python's `hmac`, `shasum`), so a change that would lock testers out fails; the alphabet; the same codes from the same seed; seed and count limits; hashing however a code is typed.
- `test/release-cli.test.ts`: whole releases in a copy of the content with a stand-in for `pnpm build`. The files and variables, codes only in the private file, the tag and dry-run versions, refusing bad content before building, a build without the versions or with a code, relative URLs, the release folder's rules, the build environment without the seed, the command's output, workflow outputs and summary, and misuse.
- `pnpm release:dry` runs the real build end to end.

The app's gate and Settings were checked by hand in a browser on a `release:dry` build with a seed: the gate on first launch, an empty and a wrong code, a right code typed in lower case with a space, the code remembered across a reload, a remembered code that no longer matches, `/settings` and `/settings/` behind the gate, no console errors, 44 px targets at phone width. The app has no automated test for them yet: `packages/app/test` was outside this task's files.

## Decisions and open questions

Taken here, as the most conservative reading:

1. The content semver starts at `0.1.0`. Proposed rule: bump the patch for text fixes, the minor for new or changed records, the major when content needs a newer app. Who bumps it, and when, is for Drew.
2. The app version is the tag. `packages/app/package.json` stays at `0.0.0`, and nothing checks the two agree.
3. Settings sits at `/settings`, reached by its address, with no entry in the child's view, and behind the invite gate in a tester build.
4. Codes: 8 characters, 10 by default, the same every release for one seed, remembered per device. One code per family, not per child or device.
5. A tester build that cannot reach Web Crypto (a plain http address) keeps the gate closed rather than open.
6. Retention: 7 days for the codes artifact, the repository's default for the others.

For Drew:

1. Which host, and so the tester URL and the deploy step (D10, D13).
2. Should the deploy step refuse a release with no invite seed, so an ungated build never reaches a public address?
3. When does the app load a newer content bundle at run time, and from where?
4. Should Settings be reachable from Home (D68) behind the parental gate (task 5.1, D28)?
5. Art in the content bundle once final art lands (D6).
