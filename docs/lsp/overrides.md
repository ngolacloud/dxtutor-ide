# Language server overrides (`lsp.json`)

dxtutor knows its languages and language servers from one bundled file, `languages/registry.json`.
Two override files let you change that table without touching the dxtutor source code:

| File | Where | Applies to | Trusted |
|---|---|---|---|
| Your file | the app's config folder: `~/.config/ao.ngolacloud.dxtutor-ide/lsp.json` on Linux | every folder you open | yes |
| The project file | `<project>/.dxtutor/lsp.json` | that folder only | no: a changed command needs your approval |

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
  "servers": [ ... ]     // optional
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
| `oneShot`, `quirks`, `install`, `vscodeExtensions` | as in the bundled registry; `install` is text only |

A field dxtutor does not know is an error (usually a typo).

## Settings

When a server asks `workspace/configuration`, dxtutor answers from `settings`, section by section:
`"section": "rust-analyzer"` gets `settings["rust-analyzer"]`, and `"java.format"` gets `settings.java.format`.
A section with no settings gets `null`. A top-level key with dots counts as nested, like VS Code's
`settings.json`. So `{ "python.analysis.typeCheckingMode": "strict" }` is the same as
`{ "python": { "analysis": { "typeCheckingMode": "strict" } } }`.

dxtutor also sends the settings in `workspace/didChangeConfiguration`:

- when the server starts, if it has settings;
- whenever they change.

Changing only `settings` never restarts the server.

## Examples

Run clippy instead of `cargo check` (in your file or in a project's file):

```jsonc
{ "servers": [ { "id": "rust", "settings": { "rust-analyzer": { "check": { "command": "clippy" } } } } ] }
```

Use basedpyright instead of pyright:

```jsonc
{
  "servers": [
    { "id": "python", "label": "basedpyright", "command": "basedpyright-langserver",
      "install": "pipx install basedpyright" }
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

## Approving a project's command

A project file comes with a repository you may have just cloned. If it **adds a server**, or **changes how one
starts**, that server does not run until you approve it. "How it starts" means `command`, `args`, `resolver`,
`searchDirs` or `envOverride`, compared with the bundled value plus your file.

When you open a file of that language, a banner shows the exact command. **Review…** opens the approval
dialog, which shows:

- the program (the full path dxtutor found);
- its arguments and the folder it runs in;
- the file that asked for it and the fields it changed;
- whether the program lives inside the project folder.

Approve it and the server starts. Deny it and nothing runs. You can review it again later.

- dxtutor writes the decision to the project's audit log **before** anything else. If it cannot record the
  decision, the approval does not count.
- dxtutor keeps approvals in `lsp-trusted.json` in the app's config folder, never in the project. A
  repository cannot ship its own approval.
- An approval covers one project, one server and one exact command: the program file found, every launch field,
  and, for a program inside the project folder, its content. If any of these changes, dxtutor asks again.
- Settings, `initOptions`, `rootMarkers` and the other fields need no approval. Note that some servers run commands
  their settings name (for example rust-analyzer's `check.overrideCommand`). Read a project's settings before you
  trust the project.
- Your own file is trusted. A command set there runs without asking, in every folder.

## Limits

- Overrides apply to the editor's language servers. The agent's one-shot outline client still uses the bundled
  registry.
- An override file is at most 512 KiB.
- dxtutor checks for changes every 2 seconds. A change made by another program is picked up within that time.
