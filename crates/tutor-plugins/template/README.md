# {{name}} course for dxtutor

A guided, hands-on {{name}} course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide).

## Install

From the dxtutor app: **Learning Track → Get more languages**, then paste this repository URL.

From the terminal:

```sh
dxt plugin install {{org}}/{{id}}
```

## Develop

```sh
dxt plugin validate .        # check the manifest and every course
dxt plugin install .         # install this working copy locally to try it in the app
```

The course format is documented in the dxtutor repository: `docs/plugins/README.md`.

## Release

1. Bump `version` in `dxtutor-plugin.json`.
2. Tag the commit with the same version (`git tag v0.1.0 && git push --tags`).
3. Users install a fixed version with `dxt plugin install {{org}}/{{id}}@v0.1.0`.
