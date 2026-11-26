# Official courses

The source of the official dxtutor course plugins. Each folder is a complete plugin
(`dxtutor-plugin.json` plus `courses/*.toml`) and is published as its own repository, `dxtutor-course-<id>`, in the
[`ngolacloud`](https://github.com/ngolacloud) GitHub organization:

| Folder | Repository | Install |
|---|---|---|
| `rust/` | `ngolacloud/dxtutor-course-rust` | `dxt plugin install rust` |
| `go/` | `ngolacloud/dxtutor-course-go` | `dxt plugin install go` |
| `python/` | `ngolacloud/dxtutor-course-python` | `dxt plugin install python` |
| `cpp/` | `ngolacloud/dxtutor-course-cpp` | `dxt plugin install cpp` |
| `typescript/` | `ngolacloud/dxtutor-course-typescript` | `dxt plugin install typescript` |
| `sql/` | `ngolacloud/dxtutor-course-sql` | `dxt plugin install sql` |
| `java/` | `ngolacloud/dxtutor-course-java` | `dxt plugin install java` |
| `kotlin/` | `ngolacloud/dxtutor-course-kotlin` | `dxt plugin install kotlin` |
| `csharp/` | `ngolacloud/dxtutor-course-csharp` | `dxt plugin install csharp` |
| `swift/` | `ngolacloud/dxtutor-course-swift` | `dxt plugin install swift` |
| `seiva/` (framework, graded in Rust) | `ngolacloud/dxtutor-course-seiva` | `dxt plugin install seiva` |

These TOML files are also the **built-in** courses of the app (every course except Rust and Go: backend only — the browser prototype embeds just Rust and Go, to keep its bundle small):
- the backend embeds them (`crates/tutor-core/src/course.rs`, `include_str!`);
- the browser prototype embeds a JSON projection of them (`ui-app/src/content/courses/*.json`).

A course with `[build] prepare = true` (Seiva) compiles against dependencies that are downloaded
once into a course cache: run `dxt plugin prepare courses/<id>` before `dxt plugin test`.

After editing a course:

```sh
dxt plugin validate courses/rust --strict     # format and content checks
python3 scripts/sync-ui-courses.py            # regenerate the UI JSON
cargo test -p tutor-core                      # includes the TOML ↔ JSON drift check
```

Publishing to `ngolacloud/dxtutor-course-<id>`: `scripts/publish-course.sh <id>` (see the script; the tag comes from the manifest's `version`).
Bump `version` in the plugin's manifest first. A published plugin with the same course id
replaces the built-in course for the learners who install it.

How to write a course: [`docs/plugins/README.md`](../docs/plugins/README.md).
