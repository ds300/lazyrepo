# urgent

- respect filterPaths
- add commands + package deps to cache key
- computeManifest optimization
  - use static buffer & utf-32 to avoid allocating a string for each manifest
  - use buffer.compare to compare type, id, key
    - will require ordering the types alphabetically. maybe try doing this first anyway
  - only open write streams if there is a diff
- make sure other config options are satisfied
- glob dotfiles by default and copy wireit's list of ignores? https://github.com/google/wireit#default-excluded-paths

# not urgent

- add more helpful errors for when no tasks are found
- flesh out help
- add --concurrency option
- add flake detection mode
- add hard-link outputs as an option. could we also
- move config file discovery logs to avoid noise for :inherit
- log levels
- handle failure gracefully
- validate config, incl sanity checks for interdependent config options (caching + independence, e.g)
- add :wtf <task-key> command to get lazyrepo to explain in plain english why a thing ran
- Add 'watch' mode with inactivity timeout to wait for things to bootstrap.
- Allow packages to override their own task definitions

# questions

- what is a hard link vs a soft link?
- allow globbing on upstream (both task and package) inputs/outputs?
- does npm need --workspace-root equivalent?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
