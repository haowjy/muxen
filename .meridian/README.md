# Meridian context for muxen

`meridian.toml` points work and KB at the shared docs repository:

- work: `git@github.com:haowjy/docs.git` → `muxen/work/`
- archive: `muxen/archive/work/`
- kb: `muxen/kb/`

Meridian clones the docs repo to `~/.meridian/git/haowjy-docs` and autosyncs it. The
local `.meridian/work`, `.meridian/kb` and `.meridian/archive` directories are ignored
leftovers from the old repository-local setup and are not read.

## Another machine

Pull this repository and start Meridian from its root. `meridian context --verbose`
should resolve work and KB under `~/.meridian/git/haowjy-docs/muxen/`. To attach to
the existing work notes:

```sh
meridian work start tether-mvp
meridian work current
```

(`tether-mvp` is the existing work-item slug from before the rename to muxen.)

Machine-local work status (`__status.json`), raw probe output (`probes/`), logs and
key material are excluded from the docs repo. Restart running Meridian sessions after
changing context paths; they keep the context environment from launch.

Product design stays in [`docs/design/client/README.md`](../docs/design/client/README.md).
