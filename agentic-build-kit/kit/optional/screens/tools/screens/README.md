# The screen check's capture

The screen check has the lead compare every screen a wave builds or changes with its frozen design, from the Android emulator, in both themes, before the wave merges. Most frozen states can't be reached with real data (an offline banner, a usage error, an approval sheet are moments, not places you can open), so the app's development build carries a screen gallery that draws each frozen state from fixed data, with no sign-in.

`capture.mjs` opens each gallery entry on the emulator, in each theme, saves a screenshot, and writes `index.html`, which sets each capture beside its frozen design. The lead compares the pairs by eye and files the differences. It compares no pixels: a design tool's HTML and Android never agree on fonts or anti-aliasing.

No dependency: Node's own modules, `adb` and the emulator. What it knows about the app comes from the `screens` section of `agentkit.config.json` (below), read through `tools/guardrails/lib/config.mjs` and checked by `lib/settings.mjs`.

This module is optional. It fits an Expo (React Native) app on Android; another stack keeps the idea (a development-only gallery, a ready mark, a page of pairs) and replaces `lib/device.mjs` and the Metro step.

## What the app provides

The script drives the app; it builds nothing in it. The app's development build must have:

- **A gallery route** at `<linkScheme>://<galleryPath>?screen=<id>&theme=<dark|light>` that draws one frozen state, named by its design folder (`S03-thread-offline`), in the theme the link asks for. It sends no request and needs no sign-in.
- **`ids.json`** (`idsFile`): the gallery's entries, one id each, in the order to capture them.
- **A ready mark:** once the entry has laid out in the asked theme, the gallery writes `gallery-ready <id> <theme>` to `readyFile` in the app's own storage. The script reads it with `adb exec-out run-as <appId> cat <readyFile>`, which a debuggable build allows, and deletes it before each pair's first open.
- **No gallery in release builds,** proven by a check rather than by hiding it.

### The worked example

The source project's gallery (its decision 0027, built in its spec 13) is the model to copy:
- **The route** is `src/app/dev/gallery.tsx`, outside the signed-in group. Each entry draws the real screen components over a query cache of its own, seeded with the design's sample content, inside a live-stream provider whose socket never connects.
- **Left out of release builds:** the gallery enters the app through one module, and Metro's resolver swaps it for a small stub ("There's no such page.") when it bundles with `NODE_ENV=production`. The proof is the source map: a release export's map lists no source under the gallery's folder, and a development export's map lists them, which shows the check can see them. The maps go to a temporary folder and never into a build.
- **Every frozen state has an entry, and none sends a request,** held by one test. It fails when a design folder has no gallery entry, apart from a named list of exceptions, each with its reason, that shrinks as later waves add their entries. It fails when an entry reaches the network: every JavaScript way out (`fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`, image prefetch, upload tasks) is replaced by a stand-in that records and throws, and no seeded value may hold an `http://` or `https://` address, since an `<Image>` with a remote `uri` loads natively, outside JavaScript.
- **Each wave that adds or changes a frozen state adds or changes its entry** in the same wave, so the check covers it.

## Settings

The `screens` section of `agentkit.config.json`. Four keys are required; a missing one, or a key the module doesn't know, stops the run with its name.

| Key | Default | What it is | The worked example |
|---|---|---|---|
| `appId` | required | The Android package of the development build | `com.acme.app` |
| `linkScheme` | required | The app's link scheme | `acme` |
| `avd` | required | The emulator image to use or boot | `acme-pixel8-api35`, a Pixel 8 (1080×2400, 420 dpi) on Android 35 |
| `idsFile` | required | The gallery's `ids.json`, as a repository path | `apps/mobile/src/dev/gallery/ids.json` |
| `galleryPath` | `dev/gallery` | The gallery's path in a link | `dev/gallery` |
| `devClientScheme` | `exp+<linkScheme>` | The Expo dev client's link scheme | `exp+acme` |
| `appDir` | `apps/mobile` | Where `npx expo start` and `npx expo run:android` run | `apps/mobile` |
| `readyFile` | `files/gallery-ready` | The ready mark's file, in the app's own storage | `files/gallery-ready` |
| `designRoot` | `design/screens` | The frozen designs, one folder per id | `design/screens` |
| `designFiles` | `{ "dark": "screen.png", "light": "screen-light.png" }` | Each theme's design file in an id's folder | the default |
| `comparedWith` | `{}` | Entries with no design folder of their own, and the design each is compared with | `{ "S03-thread-login": "S03-thread" }`: the sign-in card follows the thread's cards |
| `idPattern` | `^S\d{2}-[a-z0-9-]+$` | What an id looks like. It must match the whole id; a pattern that lets an empty id, `..`, a slash or a space through is refused, since an id names a folder and a file | the default |
| `metroPort` | `8081` | Metro's port, reversed onto the device | `8081` |
| `settleMs` | `2000` | How long to wait after the ready mark before the screenshot | `2000` |

The worked example's section:

```json
"screens": {
  "appId": "com.acme.app",
  "linkScheme": "acme",
  "avd": "acme-pixel8-api35",
  "idsFile": "apps/mobile/src/dev/gallery/ids.json",
  "comparedWith": { "S03-thread-login": "S03-thread" }
}
```

`project` (at the top of `agentkit.config.json`) names the page and the builds folder, `<project>-builds`. Set it in the file: a build clone's folder name isn't the project's.

## What it assumes

- **The Android SDK** is at `$ANDROID_HOME`, or else `~/Library/Android/sdk`: `platform-tools/adb` and `emulator/emulator`.
- **The device is chosen by name, not by count.** `--serial <serial>`, or `ANDROID_SERIAL` in the environment, uses that device alone: the run fails if it isn't attached, saying where the serial came from. Without one, the first attached emulator whose image is `--avd` is used, and if there is none the image is booted. Several devices attached are fine; a phone or any other serial is never used unless it's named, and nothing but `emu avd name` (reading an emulator's image name from its console) reaches a device the run doesn't use.
- **The development build is installed** on the emulator (`appId`). The script doesn't build it. If it's missing, run `npx expo run:android` in `appDir`.
- **The emulator's app is signed out,** when the app sends a signed-in device away from a state. In the worked example, the welcome screen redirects a signed-in device home, so on a signed-in build its capture showed home, with no warning. The gallery needs no sign-in.
- **A development build loads its JavaScript from Metro.** If nothing answers on `metroPort`, the script starts `npx expo start --dev-client --port <metroPort>` in `appDir` (its log is `metro.log` in the output folder), waits for `packager-status:running`, and runs `adb reverse`. Then it opens the dev client on Metro's address before the first pair: a gallery link lands in the dev client's launcher until a bundle is loaded.
- **The gallery's entries** are the ids in `idsFile`.
- **The frozen designs** are `<designRoot>/<id>/<designFiles.dark>` and `<designFiles.light>`. A state frozen in dark alone has no light file, and the page says so.

## The command

```sh
node tools/screens/capture.mjs [--only S03-thread,S08-approval] [--themes dark,light] [--avd <image>] [--serial <serial>] [--out <dir>] [--settle-ms <ms>]
```

- `--only`: some ids. An id that isn't in `ids.json` is a usage error that names it.
- `--themes`: `dark`, `light` or both (the default).
- `--avd`: the image to use, running or booted; `avd` by default. An attached emulator of that image is used; if there is none, it's booted.
- `--serial`: the device to use, alone, with `--serial` winning over `ANDROID_SERIAL`. A serial that isn't attached fails the run, naming where the serial came from.
- `--out`: where to write. The default is `<builds>/screens/<YYYY-MM-DD-HHmmss>/`, where `<builds>` is the repository's parent folder when that folder is named `<project>-builds` (a build clone), and a sibling `<project>-builds` beside the repository otherwise: `/work/acme` and `/work/acme-builds/build-spec-07-wave-04` both write to `/work/acme-builds/screens/…`. A folder inside the repository is refused. A relative `--out` is taken from the folder you run the script in, so run it from the repository root.
- `--settle-ms`: how long to wait after the ready mark before the screenshot, for animations to settle (a positive whole number, `settleMs` by default). At 400, the worked example's second live run caught avatars not yet painted and the dev client's "Refreshing…" banner. Raise it on a slow emulator.
- `--help` prints the usage line. A usage error prints its reason and the usage line on stderr, and exits 2. A broken `screens` section or a missing `ids.json` prints what's wrong and exits 1.

It exits 0 when every pair was captured and 1 when any pair or step failed. Each failure says which, in plain words, and none can hang: adb gets 20 seconds per call, the emulator 3 minutes to boot, Metro 2 minutes to report running, and an entry 15 seconds to mark itself ready — the run's first pair 2 minutes, since it also waits out the bundle loading, with its gallery link opened again every 10 seconds meanwhile.

### An example run

```
$ node tools/screens/capture.mjs --only S02-home --themes dark
Captured 1 of 1. file:///Users/you/work/acme-builds/screens/2026-10-23-140509/index.html
```

It writes `<id>.dark.png`, `<id>.light.png` and `index.html` to the folder, then stops what it started (Metro and the emulator), each by its process group and only if this run started it. It never stops anything by name or by port.

## Reading `index.html`

Each id has a heading, and under it one row per theme: the capture on the left and the frozen design on the right, both 390 px wide, which is each one's width in points on the worked example's phone, so they line up. Its capture is 1080×2400 and its design 780×1768, so compare layout, spacing, color and content, not pixels.

- **"no capture"** means that pair failed. The script printed why.
- **"no frozen design"** means the design folder has no file for that theme.
- **"S03-thread-login (compared with S03-thread)"** is an entry with no design of its own, set beside the design `comparedWith` names.

The page links the captures by paths relative to its folder, and the designs the same way, going up into the repository. The design column therefore shows only while the output folder and the checkout stay where the run found them (the default keeps both under `<project>-builds`). Rerun the script rather than moving the folder.

The status bar is pinned with Android's demo mode during a run (12:00, full battery and signal, no notifications), and released afterwards, as the designs show a fixed status bar.

## adb hangs

On 2026-10-23, adb 37.0.1 on the lead's Mac forked its server, logged its version and never bound `tcp:5037` from the agent's session, inside or outside its sandbox. The emulator booted, but nothing could drive it. The script spawns every adb call with a timer and says `adb didn't answer within 20 seconds` instead of hanging. If it happens, the owner does this, in their own terminal:

1. Run `~/Library/Android/sdk/platform-tools/adb start-server`. If macOS asks to allow local network access, allow it. Then `adb devices` should answer at once.
2. If it starts there, tell the agent: a permission granted to the terminal may not cover the app the agent runs in, so the agent checks again from its own session.
3. If it hangs there too, run `adb nodaemon server` in the foreground. It prints what the server does, so the lines before it stops show where it hangs. Stop it with Ctrl-C, update the platform tools (Android Studio's SDK Manager, or `sdkmanager "platform-tools"`), and try again. Note the version that works.

By the first live run, a day later, adb answered again.

## Adding an entry

An entry belongs to the app's gallery, not to this script: add it there (its entry, its registry line and its id in `ids.json`), and the script picks it up from `ids.json`. A frozen state with no design folder of its own goes in `comparedWith`, with the design it's compared with.

## The tests

`node --test "tools/screens/test/*.test.mjs"` (part of `npm run verify` once the module is installed) covers what the script decides: the settings, the arguments, the pairs, the page, and the adb calls against a stand-in `adb`. It doesn't run `capture.mjs`'s own sequence: starting Metro, pairing demo mode on with off, and the cleanup that stops only what the run started. A reviewer reads those in `capture.mjs`, and the first live run checks them.

## Checklist for the first live run

The lead runs this once in a new project and records what it showed.

- [ ] Metro starts and is reached through `adb reverse`.
- [ ] Demo mode turns on, and then off again.
- [ ] After the run, and after one stopped with Ctrl-C, nothing the run started is still running (`pgrep -fl "expo start"`, and the emulator, if the run booted it).
- [ ] The dev client link (`<devClientScheme>://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081…`) is opened first, after `adb reverse` and before the first pair, so the bundle is loaded before a gallery link opens.
- [ ] The script sees `gallery-ready <id> <theme>` for a plain entry, an entry with a sheet open, and a screen whose content keeps changing, each in dark and light.

## Lessons from the worked example's live runs

**The first run, 2026-10-24: 0 of 46 pairs captured.**
- A cold gallery link opened the dev client's server list, not the gallery: a gallery link lands only once a bundle is loaded. The fix loads the dev client's own link first, with its onboarding, floating gear and launch menu disabled, and gives the run's first pair a 2-minute ready wait with its gallery link reopened every 10 seconds.
- The ready mark, then an accessibility label on a 1×1 view at `opacity: 0`, never appeared in `uiautomator dump`. Android leaves a view whose alpha is 0 out of the dump, and an entry with a sheet open draws the sheet in a `Modal`, a window of its own, while the dump reads only the active window.

**The second run, the same day: 48 of 54, then 54 of 54.**
- Entries with a live run card failed now and then, and a rerun of them missed 9 of 10. `uiautomator dump` answered `ERROR: could not get idle state.`: it waits for the screen to go idle, and a spinner and a timer that keep changing never do. Android's animation scales at 0 didn't change that, and a failed dump left the previous entry's dump file to be read.
- **The fix:** the mark is read from the ready file, through `run-as`, instead of from the screen. With it, every entry captured.
- **The settle time:** at 400 ms, some captures caught avatars not yet painted and the dev client's "Refreshing…" banner over the header. At 2.5 s, neither showed, so the default is 2 seconds.
- **A stale `node_modules`** in the main checkout failed the bundle, and every entry then timed out. Run `npm ci` before a capture.

### Notes for a first local build

- It installed the NDK 27.1, CMake 3.22.1, build-tools 36 and 37 and platform 37 (about 3 GB), and created `~/.gradle` (about 5 GB).
- It took 14 minutes.
- Fixture times use the device's real clock, not demo mode's 12:00.
