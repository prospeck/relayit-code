# Upstream

RelayIt's `relayit-next` line is built on OpenMausBot (https://github.com/milind-soni/OpenMausBot),
Apache-2.0, Copyright 2026 Milind Soni and OpenMausBot contributors.

- Imported from commit `1a43237` (release 0.1.139).
- `enterprise/` was not imported: it is under a separate licence.
- `LICENSE`, `NOTICE` and `third_party/` must stay in the repo and ship with the app (Apache-2.0 section 4).
- Their names and mascot are trademarks and must not appear in the product (section 6).

To take a later upstream change: `git diff <old-sha> <new-sha> -- . ':!enterprise'` in a clone of
upstream, then `git apply -3` here.
