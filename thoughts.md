# urgent

- do less allocation when creating/comparing manifests getNextManifest(prev, files, evnVars): [diff, next]
- handle failure gracefully
- Add concurrency
- cache outputs
- feed outputs into inputs, and inputs into inputs
- make sure other config options are satisfied
- add --force mode

# features

- validate config with zod?
- print version on launch
- add --runInBand mode
- support json schema and .ts config files
- init script
- Add turbo.json migrator
- Add 'watch' mode with inactivity timeout to wait for things to bootstrap.
- Allow packages to override their own task definitions

# questions

- does npm need --workspace-root equivalent?
- should peer deps, dev deps, and optional deps count towards the dep graph?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
