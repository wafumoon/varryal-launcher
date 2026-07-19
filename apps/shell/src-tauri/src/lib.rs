// Tauri 2 desktop: lib.rs re-exports modules so the [[bin]] and [lib]
// targets share the same module tree.  Mobile targets use this lib entry;
// desktop uses the [[bin]] entry.  Both compile the same code.

pub mod auth;
pub mod config;
mod dns_policy;
pub mod jre;
pub mod paths;
pub mod portal;
pub mod runner;
pub mod ipc_proxy;
