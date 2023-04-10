# urgent

- add stuff to global cache key
- add commands + package deps to cache key
- add extra args to cache key
- do new cli format
- rearchitect to avoid prop drilling
- consistent way to set defaults. we need a TaskConfig vs Task and so on.
- cache outputs
- computeManifest optimization
  - use static buffer & utf-32 to avoid allocating a string for each manifest
  - use buffer.compare to compare type, id, key
    - will require ordering the types alphabetically. maybe try doing this first anyway
  - only open write streams if there is a diff
- make cwd be a path filter if lazy is invoked in non-root dir
- make sure other config options are satisfied
- test
- add --concurrency option
- more docs in readme
- should peer deps, dev deps, and optional deps count towards the dep graph?
- glob dotfiles by default and copy wireit's list of ignores? https://github.com/google/wireit#default-excluded-paths

# not urgent

- flesh out help
- add eslint
- combine globs? you can pass multiple in at once
- add flake detection mode
- add hard-link outputs as an option. could we also
- move config file discovery logs to avoid noise for :inherit
- log levels
- --filter
- general cli args parsing improvement (add --help)
- handle failure gracefully
- validate config, incl sanity checks for interdependent config options (caching + independence, e.g)
- print version on launch
- add :wtf <task-key> command to get lazyrepo to explain in plain english why a thing ran
- support json schema and .ts config files
- Add turbo.json migrator
- Add 'watch' mode with inactivity timeout to wait for things to bootstrap.
- Allow packages to override their own task definitions

# questions

- what is a hard link vs a soft link?
- allow globbing on upstream (both task and package) inputs/outputs?
- does npm need --workspace-root equivalent?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
