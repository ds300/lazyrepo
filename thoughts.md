# urgent

- add commands + package deps to cache key
- computeManifest optimization
  - use static buffer & utf-32 to avoid allocating a string for each manifest
  - use buffer.compare to compare type, id, key
    - will require ordering the types alphabetically. maybe try doing this first anyway
- glob dotfiles by default and copy wireit's list of ignores? https://github.com/google/wireit#default-excluded-paths

# not urgent

- add more helpful errors for when no tasks are found
- flesh out help
- add --concurrency option
- add hard-link outputs as an option.
- log levels
- validate config, incl sanity checks for interdependent config options (caching + independence, e.g)
- add :wtf <task-key> command to get lazyrepo to explain in plain english why a thing ran

# questions

- what is a hard link vs a soft link?
- Look at turbo's api, cli options, behavior & make explicit decisions about what to keep/drop/modify.
