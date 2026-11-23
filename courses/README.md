# Official courses

The source of the official dxtutor course plugins. Each folder is a complete plugin
(`dxtutor-plugin.json` plus `courses/*.toml`) and is published as its own repository in the
[`dxtutor-courses`](https://github.com/dxtutor-courses) GitHub organization:

| Folder | Repository | Install |
|---|---|---|
| `rust/` | `dxtutor-courses/rust` | `dxt plugin install rust` |
| `go/` | `dxtutor-courses/go` | `dxt plugin install go` |
| `python/` | `dxtutor-courses/python` | `dxt plugin install python` |
| `cpp/` | `dxtutor-courses/cpp` | `dxt plugin install cpp` |

These TOML files are also the **built-in** courses of the app (Python and C++: backend only — the browser prototype embeds just Rust and Go, to keep its bundle small):
- the backend embeds them (`crates/tutor-core/src/course.rs`, `include_str!`);
- the browser prototype embeds a JSON projection of them (`ui-app/src/content/courses/*.json`).

After editing a course:

```sh
dxt plugin validate courses/rust --strict     # format and content checks
python3 scripts/sync-ui-courses.py            # regenerate the UI JSON
cargo test -p tutor-core                      # includes the TOML ↔ JSON drift check
```

Publishing to `dxtutor-courses/<id>`: `scripts/publish-course.sh <id> <version>` (see the script).
Bump `version` in the plugin's manifest first. A published plugin with the same course id
replaces the built-in course for the learners who install it.

How to write a course: [`docs/plugins/README.md`](../docs/plugins/README.md).
