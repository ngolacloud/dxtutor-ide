# Language server overrides (`lsp.json`)

dxtutor knows its languages and language servers from one bundled file, `languages/registry.json`.
Two override files let you change that table without touching the dxtutor source code:

| File | Where | Applies to | Trusted |
|---|---|---|---|
| Your file | the app's config folder: `~/.config/ao.ngolacloud.dxtutor-ide/lsp.json` on Linux | every folder you open | yes |
| The project file | `<project>/.dxtutor/lsp.json` | that folder only | no: changed commands and settings need your approval |

They are merged in this order: **bundled registry → your file → project file**. A later file wins.

Open them from the Command Palette (Ctrl+Shift+P):

- **LSP: Open User Language Server Settings (lsp.json)**
- **LSP: Open Project Language Server Settings (.dxtutor/lsp.json)**
- **LSP: Show Effective Language Server Configuration** shows the merged entry of each server, the layers it
  came from, its settings, and whether it waits for your approval.

A missing file opens with a commented template. Saved changes apply at once: the affected servers restart.
You don't need to restart dxtutor.

## Format

The file uses the same shape as the bundled registry. You can write `//` and `/* */` comments and leave
trailing commas.

```jsonc
{
  "version": 1,          // optional; this build reads version 1
  "languages": [ ... ],  // optional
  "servers": [ ... ],    // optional
  "resources": { ... }   // optional; your file only (see Resources)
}
```

Each entry names the `id` it changes or adds.

- **An entry for a known id changes only the fields you write.** The other fields keep their value.
  - `settings` and `initOptions` merge key by key.
  - Every other field replaces the old value. Lists such as `args`, `extensions` and `rootMarkers` are replaced
    whole.
  - `null` resets a field to its default. Inside `settings` and `initOptions`, `null` removes the key.
- **An entry for a new id is a whole entry.** A new language needs `name`. A new server needs `name`, `label` and
  `command`.

### Language fields

| Field | Meaning |
|---|---|
| `id` | the language id (`python`, `typescriptreact`, …); lowercase letters, digits, `-`, `_` |
| `name` | what the status bar shows |
| `lspLanguageId` | the `languageId` sent to the server; required when `server` is set |
| `extensions` | lowercase, without the dot; matched case-insensitively |
| `filenames` | whole file names (`Dockerfile`, `Makefile`); they win over the extension |
| `firstLine` | a regular expression for the first line (a shebang), tried only when the name says nothing |
| `lineComment` | the Ctrl+/ comment marker |
| `outline` | the language the syntactic outline speaks |
| `server` | the `id` of the server in `servers[]`; `null` turns the language server off for this language |

### Server fields

| Field | Meaning |
|---|---|
| `id` | the server id; one server runs per (id, project root) |
| `name`, `label` | the language group (`C/C++`) and the server as people know it (`clangd`) |
| `command` | the program, a bare name with no path (it is looked up, see `resolver`) |
| `args` | its arguments |
| `resolver` | how to find `command`: `path` (default: PATH, then `searchDirs`), `node`, `go`, `rustup` |
| `envOverride` | an `UPPER_CASE` environment variable that, when set, names the binary |
| `searchDirs` | extra folders, absolute or starting with `~/`; one `*` segment picks the highest version |
| `rootMarkers` | file names; a session roots at the nearest folder holding one (else the open folder) |
| `readySignal` | lowercase text marking the end of indexing in the server's progress messages |
| `initOptions` | `initializationOptions` sent once, when the server starts |
| `settings` | the server's settings (see below) |
| `oneShot`, `quirks`, `vscodeExtensions` | as in the bundled registry |
| `install` | how to install it by hand: text only, shown when no recipe applies |
| `recipes` | how dxtutor may install it from the missing-server banner (see [Install recipes](#install-recipes)) |

A field dxtutor does not know is an error (usually a typo).

## Resources

A language server with no open file keeps memory for nothing, and some (jdtls, the Kotlin server) take a lot.
dxtutor stops them for you:

- A server with no open file, unused for `idleMinutes`, stops. It starts again the next time a file needs it.
- At most `maxServers` run at once. When one more starts, the server used least recently that has no open file
  stops. A server with open files is never stopped this way: if every server left has open files, dxtutor tells
  you instead.

```jsonc
{ "resources": { "idleMinutes": 10, "maxServers": 6 } }
```

| Field | Default | Meaning |
|---|---|---|
| `idleMinutes` | `10` | 0 to 1440; `0` keeps idle servers running until you close the folder |
| `maxServers` | `6` | 1 to 32 |

`resources` is read only from your own file. A project file that sets it is an error, and that file is ignored.
The Command Palette entry **LSP: Show Running Language Servers** lists the servers that run now (process id,
folder, open files, idle time, memory), with **Restart** and **Stop**. Their output (stderr and the error, warning
and info messages they log) is in the **Language servers** channel of the Output panel, with secrets masked.

## Settings

When a server asks `workspace/configuration`, dxtutor answers from `settings`, section by section:
`"section": "rust-analyzer"` gets `settings["rust-analyzer"]`, and `"java.format"` gets `settings.java.format`.
A section with no settings gets `null`. A top-level key with dots counts as nested, like VS Code's
`settings.json`. So `{ "python.analysis.typeCheckingMode": "strict" }` is the same as
`{ "python": { "analysis": { "typeCheckingMode": "strict" } } }`.

dxtutor also sends the settings in `workspace/didChangeConfiguration`:

- when the server starts, if it has settings;
- whenever they change.

Changing only `settings` never restarts the server. Settings that come from a project file are applied only
after you approve them (see below).

## Examples

Run clippy instead of `cargo check` (in your file; in a project's file you approve it first):

```jsonc
{ "servers": [ { "id": "rust", "settings": { "rust-analyzer": { "check": { "command": "clippy" } } } } ] }
```

Use basedpyright instead of pyright:

```jsonc
{
  "servers": [
    { "id": "python", "label": "basedpyright", "command": "basedpyright-langserver",
      "install": "pipx install basedpyright",
      "recipes": [ { "manager": "pipx", "packages": ["basedpyright"] } ] }
  ]
}
```

Add a language with its own server:

```jsonc
{
  "languages": [
    { "id": "elixir", "name": "Elixir", "lspLanguageId": "elixir", "extensions": ["ex", "exs"],
      "lineComment": "#", "server": "elixir" }
  ],
  "servers": [
    { "id": "elixir", "name": "Elixir", "label": "elixir-ls", "command": "elixir-ls",
      "rootMarkers": ["mix.exs"] }
  ]
}
```

The bundled registry already lists `elixir` (with no server), so this entry gives it one.

Turn the SQL language server off for a project:

```jsonc
{ "languages": [ { "id": "sql", "server": null } ] }
```

A bundled server that no language uses any more is fine. A **new** server that no language uses is an error,
because it is most likely a typo in an id.

## Install recipes

When a server is missing, the banner offers the ways to install it on this machine. dxtutor builds each
command from the server's `recipes`; it never runs a command you or a file typed. Each recipe names one
`manager`:

| `manager` | What dxtutor does | Fields |
|---|---|---|
| `npm`, `pip`, `pipx`, `go`, `cargo`, `dotnet`, `gem` | runs it in a terminal, after you approve the exact command, into dxtutor's own folder (`<app data>/lsp-servers/<server>`) | `packages`; `version` for `cargo`, `dotnet`, `gem` (one package). A go package needs `@version` |
| `rustup` | runs `rustup component add` in a terminal | `packages` (components) |
| `brew`, `apt` | shows the command for you to run (apt needs sudo; dxtutor never runs either) | `packages` |
| `github` | downloads the release itself, checks its SHA-256 before unpacking, and installs nothing on a mismatch | `assets`: `platform` (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `any`), `url` (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`), `sha256`, `archive` (`zip`, `tar.gz`, `gz`, `none`), `bin` (the folder holding the program, for `zip`/`tar.gz`) |

Only recipes from the bundled registry and from **your** file are offered. A project file's recipes are never
offered, and a server that the project adds, or whose program it changes, is not installed from the banner.
If your file changes a server's `command`, give it its own `recipes` too: the bundled ones install the bundled
program.

dxtutor looks for an installed server in its own folder first (after the `envOverride` variable), so it starts
right after the install, without restarting dxtutor.

## Errors

dxtutor checks each file on its own, with the same rules as the bundled registry: no duplicate ids, no extension
claimed by two languages, no unknown fields, and so on. If a file breaks a rule, dxtutor ignores the **whole
file**, and the files under it still apply. dxtutor then shows a notice with the file and each error, for
example:

```text
servers[1] (`rust`): unknown field `comand`, expected one of `id`, `name`, …
not valid JSON: expected `,` or `]` at line 4 column 3
language `go`: extension `rs` is also claimed by `rust`
```

## Approving what a project changes

A project file comes with a repository you may have just cloned. dxtutor trusts nothing in it that could make a
language server run something:

- **Launch fields.** If the project file adds a server, or changes `command`, `args`, `resolver`, `searchDirs` or
  `envOverride`, that server **does not start** until you approve it.
- **Settings and init options.** If the project file changes a server's `settings` or `initOptions`, the server
  **starts with your settings** (the bundled ones plus your file) and the project's are **not applied** until you
  approve them. Settings can make a server run commands; rust-analyzer's `check.overrideCommand` is one example.

"Changes" means a different value from the bundled registry plus your file. A project that repeats your values,
or only changes fields such as `rootMarkers`, `label` or a language's extensions, needs no approval.

When you open a file of that language, a banner says what waits. **Review…** opens the approval dialog. It
shows:

- the program (the full path dxtutor found);
- its arguments and the folder it runs in;
- the project's `settings` and `initOptions`, and what they replace;
- the file that asked for it and the fields it changed;
- whether the program lives inside the project folder.

Approve, and the server starts, or gets the project's settings (a change to `initOptions` restarts it). Deny, and
nothing the project asked for runs. You can review it again later.

- dxtutor writes the decision to the project's audit log **before** anything else. If it cannot record the
  decision, the approval does not count.
- dxtutor keeps approvals in `lsp-trusted.json` in the app's config folder, never in the project. A
  repository cannot ship its own approval.
- An approval covers one project, one server and one exact configuration: the program file found, every launch
  field, the settings and init options, and, for a program inside the project folder, its content. If any of
  these changes, dxtutor asks again.
- Your own file is trusted. Commands and settings set there apply without asking, in every folder.

## Limits

- Overrides apply to the editor's language servers. The agent's one-shot outline client still uses the bundled
  registry.
- An override file is at most 512 KiB.
- dxtutor checks for changes every 2 seconds. A change made by another program is picked up within that time.
