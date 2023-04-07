# urgent

- cache outputs
- feed outputs into inputs, and inputs into inputs
- make sure other config options are satisfied
- add --force mode
- test
- add --concurrency option
- more docs in readme

# not urgent

- log levels
- --filter
- general cli args parsing improvement
- do less allocation when creating/comparing manifests getNextManifest(prev, files, evnVars): [diff, next]
- handle failure gracefully
- validate config
- print version on launch
- support json schema and .ts config files
- Add turbo.json migrator
- Add 'watch' mode with inactivity timeout to wait for things to bootstrap.
- Allow packages to override their own task definitions

# questions

- does npm need --workspace-root equivalent?
- should peer deps, dev deps, and optional deps count towards the dep graph?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
