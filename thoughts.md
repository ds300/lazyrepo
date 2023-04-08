# urgent

- do new cli format
- use `:init` and `:clean` style for lazy commands
- rearchitect to avoid prop drilling
- consistent way to set defaults. we need a TaskConfig vs Task and so on.
- do less allocation when creating/comparing manifests getNextManifest(prev, files, evnVars): [diff, next] THIS IS ACTUALLY CRITICAL FOR MAKING DIFFS MINIMAL
- usesOutputFromDependencies + independent
- cache outputs
- make sure other config options are satisfied
- add --force mode
- test
- add --concurrency option
- more docs in readme

# not urgent

- move config file discovery logs to avoid noise for :inherit
- log levels
- --filter
- general cli args parsing improvement (add --help)
- handle failure gracefully
- validate config, incl sanity checks for interdependent config options (caching + independence, e.g)
- print version on launch
- support json schema and .ts config files
- Add turbo.json migrator
- Add 'watch' mode with inactivity timeout to wait for things to bootstrap.
- Allow packages to override their own task definitions

# questions

- allow globbing on upstream (both task and package) inputs/outputs?
- does npm need --workspace-root equivalent?
- should peer deps, dev deps, and optional deps count towards the dep graph?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
