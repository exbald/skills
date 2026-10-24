# The screen check

An opt-in gate for projects with a UI built from frozen designs: before a wave that builds or changes a screen merges, the lead captures each screen it touched, in both themes, and compares it by eye with its frozen design. Differences go on the pull request and are fixed first. Install the capture tool with `init.mjs --with-screens` (`tools/screens`, plus a `screens` section in `agentkit.config.json` to check). The tool's own manual is [../kit/optional/screens/tools/screens/README.md](../kit/optional/screens/tools/screens/README.md).

## Why it needs a gallery: the check that never ran

The source project's decision 0024 (2026-10-23) made the screen check a merge gate: capture from the Android emulator, compare with `design/screens/<id>/screen.png` and `screen-light.png`. It never ran: not for spec 03's six waves, not for spec 12's last. Trying it showed why it couldn't have run as written (decision 0027):

- **Every screen after the welcome needs a signed-in session,** which on the emulator meant the owner's Firebase setup and Google account.
- **Real data can't show most frozen states.** An offline banner, a spend cap, an approval sheet, a usage error are moments, not places you can open.
- **adb didn't start** from the agent's session on the owner's Mac.

A gate that can't run gets skipped silently, and seven waves merged without it. The lesson: before you adopt a gate, run it once; and a gate that's missed gets a backlog issue and a decision, not a quiet catch-up.

## What the app must provide

The capture drives the app; it builds nothing in it. Write these into the spec that adds the gallery (the source project's spec 13 is the worked example):

- **A development-only gallery route,** `<linkScheme>://<galleryPath>?screen=<id>&theme=<dark|light>`, that draws one frozen state, named by its design folder, in the asked theme. It draws the **real screen components** over a data cache of its own, seeded with the design's sample content, inside a live connection that never connects. It sends no request and needs no sign-in.
- **`ids.json`:** the entries, in capture order.
- **A ready mark:** once the entry has laid out in the asked theme, the gallery writes `gallery-ready <id> <theme>` to a file in the app's own storage, which the tool reads with `adb exec-out run-as <appId> cat <readyFile>` and deletes before each pair.
- **No gallery in release builds, proven:** in the worked example, Metro's resolver swaps the gallery's one entry module for a stub when it bundles for production. The proof is the source map: a release export's map lists no gallery source, and a development export's map does, which shows the check can see them.
- **A coverage test:** it fails when a design folder has no gallery entry (apart from a named list of exceptions, each with its reason, that shrinks as later waves add their entries), and when any entry reaches the network: every JavaScript way out replaced by a stand-in that records and throws, and no seeded value holding an `http(s)://` address, since a remote image loads natively, outside JavaScript.
- **Each wave that adds or changes a frozen state adds or changes its entry** in the same wave.

## How a check runs

1. After the builder's wave is approved and green, the lead runs `node tools/screens/capture.mjs --only <ids the wave touched>` from the wave's clone or the main checkout, after `npm ci`.
2. The tool picks the device by name (`--serial`, `ANDROID_SERIAL`, or an emulator of the configured image, booted if none), starts Metro if needed, opens the dev client first so a bundle is loaded, pins the status bar with demo mode, and for each id and theme: clears the ready file, opens the link, waits for the mark, waits `settleMs`, takes the screenshot. It writes `<id>.<theme>.png` and an `index.html` of pairs beside the repository (`<project>-builds/screens/<time>/`), then stops only what it started, by process group.
3. The lead compares each pair **by eye**: layout, spacing, color and content, not pixels. A design tool's HTML and Android never agree on fonts or anti-aliasing, so a pixel diff only produces noise. A vision-capable model can do the comparing (the worked example uses Sonnet; a text-only builder like GLM 5.3 can't).
4. Differences go on the PR, are fixed in the wave, and are captured again.

The capture can't run in CI as shipped: it needs an emulator. The source project deferred running it on a CI Android emulator until the gallery existed; the script runs the same against any adb.

## Lessons from the live runs (the source project, 2026-10-24)

- **A cold gallery link lands in the dev client's launcher.** The first run captured 0 of 46. Open the dev client's own link first (with its onboarding, floating gear and launch menu disabled), and give the first pair a long ready wait with its link reopened every 10 seconds.
- **`uiautomator dump` hides what you'd mark with.** A view at `opacity: 0` is left out of the dump; a sheet drawn in a `Modal` is a window of its own, which the dump doesn't read; and a screen with a spinner or timer never goes idle, so the dump answers `ERROR: could not get idle state.` (animation scales at 0 didn't help, and a failed dump left the previous entry's file to be read). Read the ready mark from a file through `run-as` instead. With that, 54 of 54.
- **Settle before the shot.** At 400 ms, avatars weren't painted yet and the dev client's "Refreshing…" banner covered six headers; at 2.5 s, neither. The default is 2 seconds.
- **adb can hang.** On 2026-10-23 adb 37.0.1 never bound its port from the agent's session. Every adb call gets a timer, so the run says so instead of hanging; the fix steps are the owner's (the tool README, "adb hangs").
- **A stale `node_modules` fails the bundle,** and every entry then times out. Run `npm ci` before a capture.
- **The device is chosen by name, never by count,** so a phone left plugged in is never used by accident.
- **A signed-in emulator shows the wrong state** where the app redirects signed-in users; keep its app signed out.

## Settings

The `screens` section's keys, defaults and the worked example's values are in the tool README's Settings table. The required ones are `appId`, `linkScheme`, `avd` and `idsFile`; set `project` at the top of the config too, since it names the builds folder and the page.

The module fits an Expo app on Android. Another stack keeps the idea (a dev-only gallery, a ready mark, a page of pairs) and replaces `lib/device.mjs` and the Metro step (see [adapting.md](adapting.md#what-isnt-generalized)).
