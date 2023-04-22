# v0.0.0-alpha.21 (Sat Apr 22 2023)

#### 🐛 Bug Fix

- Add colors to the diff depending on the diff kind. [#77](https://github.com/ds300/lazyrepo/pull/77) ([@MitjaBezensek](https://github.com/MitjaBezensek))

#### ⚠️ Pushed to `main`

- fix prettier usage in publish-new.js ([@ds300](https://github.com/ds300))
- update logo ([@ds300](https://github.com/ds300))

#### 🏠 Internal

- run prettier before committing changelog [#76](https://github.com/ds300/lazyrepo/pull/76) ([@ds300](https://github.com/ds300))

#### Authors: 2

- David Sheldrick ([@ds300](https://github.com/ds300))
- Mitja Bezenšek ([@MitjaBezensek](https://github.com/MitjaBezensek))

---

# v0.0.0-alpha.20 (Fri Apr 21 2023)

#### 🐛 Bug Fix

- Fix top-level inherit commands [#75](https://github.com/ds300/lazyrepo/pull/75) ([@SomeHats](https://github.com/SomeHats))

#### Authors: 1

- alex ([@SomeHats](https://github.com/SomeHats))

---

# v0.0.0-alpha.19 (Fri Apr 21 2023)

---

# v0.0.0-alpha.18 (Fri Apr 21 2023)

#### 🐛 Bug Fix

- Fix publishing script. [#74](https://github.com/ds300/lazyrepo/pull/74) ([@MitjaBezensek](https://github.com/MitjaBezensek))
- Exit after successfully running commands [#72](https://github.com/ds300/lazyrepo/pull/72) ([@MitjaBezensek](https://github.com/MitjaBezensek) [@ds300](https://github.com/ds300))

#### 🏠 Internal

- don't run check-pr-labels on merged/closed PRs [#73](https://github.com/ds300/lazyrepo/pull/73) ([@ds300](https://github.com/ds300))
- Improve check-pr-labels script [#71](https://github.com/ds300/lazyrepo/pull/71) ([@ds300](https://github.com/ds300))
- add check-pr-labels script [#70](https://github.com/ds300/lazyrepo/pull/70) ([@ds300](https://github.com/ds300))

#### 🧪 Tests

- Change `throwOnError` to `expectError` [#69](https://github.com/ds300/lazyrepo/pull/69) ([@mrkldshv](https://github.com/mrkldshv))

#### Authors: 3

- David Sheldrick ([@ds300](https://github.com/ds300))
- Mark Ladyshau ([@mrkldshv](https://github.com/mrkldshv))
- Mitja Bezenšek ([@MitjaBezensek](https://github.com/MitjaBezensek))

---

# v0.0.0-alpha.17 (Thu Apr 20 2023)

#### 🚀 Enhancement

- Allow ignoring workspaces [#68](https://github.com/ds300/lazyrepo/pull/68) ([@ds300](https://github.com/ds300))

#### Authors: 1

- David Sheldrick ([@ds300](https://github.com/ds300))

---

# v0.0.0-alpha.16 (Thu Apr 20 2023)

#### 🚀 Enhancement

- Improve lazy inherit [#67](https://github.com/ds300/lazyrepo/pull/67) ([@ds300](https://github.com/ds300))

#### 🐛 Bug Fix

- Interpolate <rootDir> in commands [#66](https://github.com/ds300/lazyrepo/pull/66) ([@SomeHats](https://github.com/SomeHats))

#### Authors: 2

- alex ([@SomeHats](https://github.com/SomeHats))
- David Sheldrick ([@ds300](https://github.com/ds300))

---

# v0.0.0-alpha.15 (Thu Apr 20 2023)

#### 🐛 Bug Fix

- Set latest tag when publishing 0.0.0-alpha releases [#65](https://github.com/ds300/lazyrepo/pull/65) ([@ds300](https://github.com/ds300))

#### Authors: 1

- David Sheldrick ([@ds300](https://github.com/ds300))

---

# v0.0.0-alpha.14 (Thu Apr 20 2023)

#### 💥 Breaking Change

- Remove support for config file json format [#51](https://github.com/ds300/lazyrepo/pull/51) ([@mrkldshv](https://github.com/mrkldshv))
- Rename `runType` to `execution` [#50](https://github.com/ds300/lazyrepo/pull/50) ([@mrkldshv](https://github.com/mrkldshv))

#### 🚀 Enhancement

- Support nested workspaces [#55](https://github.com/ds300/lazyrepo/pull/55) ([@ds300](https://github.com/ds300))

#### 🐛 Bug Fix

- add tests for failure handling [#57](https://github.com/ds300/lazyrepo/pull/57) ([@ds300](https://github.com/ds300))
- cli tweaks [#56](https://github.com/ds300/lazyrepo/pull/56) ([@ds300](https://github.com/ds300))
- Replace kleur with picocolors [#54](https://github.com/ds300/lazyrepo/pull/54) ([@mrkldshv](https://github.com/mrkldshv))
- Add run stats. [#53](https://github.com/ds300/lazyrepo/pull/53) ([@MitjaBezensek](https://github.com/MitjaBezensek))
- Test and fix task scheduling for filtered packages [#49](https://github.com/ds300/lazyrepo/pull/49) ([@ds300](https://github.com/ds300))
- Validate config file [#42](https://github.com/ds300/lazyrepo/pull/42) ([@mrkldshv](https://github.com/mrkldshv) [@ds300](https://github.com/ds300))
- Fix getInputFiles [#44](https://github.com/ds300/lazyrepo/pull/44) ([@ds300](https://github.com/ds300))
- [chore] preserve backwards compatibility with old globally-installed versions [#43](https://github.com/ds300/lazyrepo/pull/43) ([@ds300](https://github.com/ds300))
- Refactor to avoid global state [#41](https://github.com/ds300/lazyrepo/pull/41) ([@ds300](https://github.com/ds300))
- Set up integration test framework [#38](https://github.com/ds300/lazyrepo/pull/38) ([@ds300](https://github.com/ds300))
- [feat] refactor CLI implementation and change commands API [#35](https://github.com/ds300/lazyrepo/pull/35) (mark.ladyshau@olx.pl [@ds300](https://github.com/ds300) [@mrkldshv](https://github.com/mrkldshv))
- [fix] make path in stack trace of TS config file clickable [#36](https://github.com/ds300/lazyrepo/pull/36) ([@mrkldshv](https://github.com/mrkldshv))
- [fix] TaskGraph execution [#37](https://github.com/ds300/lazyrepo/pull/37) ([@ds300](https://github.com/ds300))
- [chore] configure ESLint for TypeScript files [#25](https://github.com/ds300/lazyrepo/pull/25) ([@mrkldshv](https://github.com/mrkldshv) [@ds300](https://github.com/ds300))
- [fix] overflow issue in interactive logger [#34](https://github.com/ds300/lazyrepo/pull/34) ([@ds300](https://github.com/ds300))
- Buffer task outputs instead of printing them interleaved [#29](https://github.com/ds300/lazyrepo/pull/29) ([@SomeHats](https://github.com/SomeHats) [@ds300](https://github.com/ds300))
- [fix] PATH construction [#32](https://github.com/ds300/lazyrepo/pull/32) ([@ds300](https://github.com/ds300))
- [feat] support TypeScript configuration file [#4](https://github.com/ds300/lazyrepo/pull/4) ([@mrkldshv](https://github.com/mrkldshv))
- [Breaking changes] Fix a bunch of issues [#27](https://github.com/ds300/lazyrepo/pull/27) ([@ds300](https://github.com/ds300))
- [feat] common cache config [#26](https://github.com/ds300/lazyrepo/pull/26) ([@ds300](https://github.com/ds300))
- Support filter paths [#24](https://github.com/ds300/lazyrepo/pull/24) ([@ds300](https://github.com/ds300))
- feat(pkg): include dev,peer, optional to dependency graph [#23](https://github.com/ds300/lazyrepo/pull/23) ([@judicaelandria](https://github.com/judicaelandria))
- Rename `cwd` to `taskDir` [#22](https://github.com/ds300/lazyrepo/pull/22) ([@mrkldshv](https://github.com/mrkldshv))
- add discord link [#21](https://github.com/ds300/lazyrepo/pull/21) ([@ds300](https://github.com/ds300))
- replace cwd with workspaceRoot [#9](https://github.com/ds300/lazyrepo/pull/9) ([@ds300](https://github.com/ds300))
- Setup CI checks and pre commit hook [#8](https://github.com/ds300/lazyrepo/pull/8) ([@ds300](https://github.com/ds300))
- Manifest construction cleanup [#7](https://github.com/ds300/lazyrepo/pull/7) ([@ds300](https://github.com/ds300))
- Add and configure ESLint [#6](https://github.com/ds300/lazyrepo/pull/6) ([@mrkldshv](https://github.com/mrkldshv))

#### ⚠️ Pushed to `main`

- fix publish-new.yml ([@ds300](https://github.com/ds300))
- fix publish scripts ([@ds300](https://github.com/ds300))
- fix script ([@ds300](https://github.com/ds300))
- Create dependabot.yml ([@ds300](https://github.com/ds300))
- fix canary maybe ([@ds300](https://github.com/ds300))
- bump version ([@ds300](https://github.com/ds300))
- update readme ([@ds300](https://github.com/ds300))
- reinstate manifest logs ([@ds300](https://github.com/ds300))
- thoughts ([@ds300](https://github.com/ds300))
- remove mock-fs ([@ds300](https://github.com/ds300))
- fix a couple of path issues ([@ds300](https://github.com/ds300))
- Update CONTRIBUTING.md ([@ds300](https://github.com/ds300))
- Create .github/FUNDING.yml ([@ds300](https://github.com/ds300))
- add CONTRIBUTING ([@ds300](https://github.com/ds300))
- add code of conduct ([@ds300](https://github.com/ds300))
- bump ([@ds300](https://github.com/ds300))
- fix config path ([@ds300](https://github.com/ds300))
- docs ([@ds300](https://github.com/ds300))
- readme ([@ds300](https://github.com/ds300))
- Update README.md ([@ds300](https://github.com/ds300))
- :force ([@ds300](https://github.com/ds300))
- force option? ([@ds300](https://github.com/ds300))
- update logo ([@ds300](https://github.com/ds300))
- fix compute manifest ([@ds300](https://github.com/ds300))
- make computeManifest fast and good ([@ds300](https://github.com/ds300))
- initial work on new manifest computation ([@ds300](https://github.com/ds300))
- another test why not ([@ds300](https://github.com/ds300))
- :run task ([@ds300](https://github.com/ds300))
- add npm_lifecycle_event to spawned proc ([@ds300](https://github.com/ds300))
- :inherit ([@ds300](https://github.com/ds300))
- readme and thoughts ([@ds300](https://github.com/ds300))
- zero-config ([@ds300](https://github.com/ds300))
- fix bin ([@ds300](https://github.com/ds300))
- independent + use local ([@ds300](https://github.com/ds300))
- add header image ([@ds300](https://github.com/ds300))
- rename things ([@ds300](https://github.com/ds300))
- hash upstream task inputs and outputs ([@ds300](https://github.com/ds300))
- rename ([@ds300](https://github.com/ds300))
- input inheritance for packages ([@ds300](https://github.com/ds300))
- go back to child_process ([@ds300](https://github.com/ds300))
- output prefixing + cleanup ([@ds300](https://github.com/ds300))
- support json config imports ([@ds300](https://github.com/ds300))
- fixes ([@ds300](https://github.com/ds300))
- ignore yarn cache ([@ds300](https://github.com/ds300))
- convert to esm ([@ds300](https://github.com/ds300))
- readme and stuff i dunno ([@ds300](https://github.com/ds300))
- clean up cli ([@ds300](https://github.com/ds300))
- make tasks concurrent ([@ds300](https://github.com/ds300))
- add pnpm support ([@ds300](https://github.com/ds300))
- update bin to use local lazyrepo if found ([@ds300](https://github.com/ds300))
- format ([@ds300](https://github.com/ds300))
- readme stuff + globs ([@ds300](https://github.com/ds300))
- cli commands ([@ds300](https://github.com/ds300))
- truncate + improve diffs ([@ds300](https://github.com/ds300))
- readme, thoughts, minor improvements ([@ds300](https://github.com/ds300))
- pipeline -> tasks ([@ds300](https://github.com/ds300))
- lazyrepo ([@ds300](https://github.com/ds300))
- add TaskGraph ([@ds300](https://github.com/ds300))
- daddyrepo ([@ds300](https://github.com/ds300))
- fix test ([@ds300](https://github.com/ds300))
- initial commit ([@ds300](https://github.com/ds300))

#### 🏠 Internal

- add publish script [#64](https://github.com/ds300/lazyrepo/pull/64) ([@ds300](https://github.com/ds300))
- Add canary publish script [#46](https://github.com/ds300/lazyrepo/pull/46) ([@ds300](https://github.com/ds300))

#### 📝 Documentation

- Chore: remove colon from command [#52](https://github.com/ds300/lazyrepo/pull/52) ([@judicaelandria](https://github.com/judicaelandria))

#### 🧪 Tests

- Remove the directory after the tests ran. [#47](https://github.com/ds300/lazyrepo/pull/47) ([@MitjaBezensek](https://github.com/MitjaBezensek))
- [fix] globbing test name [#45](https://github.com/ds300/lazyrepo/pull/45) ([@ds300](https://github.com/ds300))

#### Authors: 6

- alex ([@SomeHats](https://github.com/SomeHats))
- David Sheldrick ([@ds300](https://github.com/ds300))
- Judicael ([@judicaelandria](https://github.com/judicaelandria))
- Mark (mark.ladyshau@olx.pl)
- Mark Ladyshau ([@mrkldshv](https://github.com/mrkldshv))
- Mitja Bezenšek ([@MitjaBezensek](https://github.com/MitjaBezensek))
