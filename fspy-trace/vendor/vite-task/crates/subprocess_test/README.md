# subprocess_test

Provides the `command_for_fn!` macro for running functions in separate processes during tests.

This crate is shared by both `fspy` and `vite_*` crates, so it uses no prefix.

## Usage

To use `command_for_fn!`, you need to add `ctor` as a dependency (usually dev-dependency for tests):

```toml
[dev-dependencies]
ctor = { workspace = true }
subprocess_test = { workspace = true }
```

Then use the macro in your tests:

```rust
use subprocess_test::command_for_fn;

let cmd = command_for_fn!(42u32, |arg: u32| {
    println!("{}", arg);
});

// Convert to std::process::Command and execute
let output = std::process::Command::from(cmd).output().unwrap();
```
