#!/bin/sh
# Runs the Rust tests and writes an HTML + lcov coverage report into coverage/rust/.
# Requires cargo-llvm-cov (`cargo install cargo-llvm-cov`).
set -eu

cargo llvm-cov --locked --no-report

# tauri-build copies the bundled launcher script (core/cli/kayet) next to the binary. It has the
# crate's name, so cargo-llvm-cov would pass it to llvm-cov as an object file and fail.
rm -f target/llvm-cov-target/debug/kayet

cargo llvm-cov report --html --output-dir coverage/rust
cargo llvm-cov report --lcov --output-path coverage/rust/lcov.info
cargo llvm-cov report --summary-only | tee coverage/rust/summary.txt
