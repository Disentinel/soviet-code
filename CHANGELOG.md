# Changelog

All notable changes to Soviet Code are recorded in this document.
Format follows [Keep a Changelog](https://keepachangelog.com).
The Party remembers everything.

---

## [1.962.0] — 2026-05-08

### Added
- Enox Nomenclature backend (`NomenklaturaBackend` interface)
- `LocalBackend` — wraps existing `nomenklatura.json` (default, fully backward-compatible)
- `EnoxBackend` — routes tribunal verdicts, directive completions, and inspection events to Enox knowledge graph
- `BothBackend` — writes to both simultaneously
- `[nomenklatura] backend = "local"|"enox"|"both"` in `politburo.toml`
- Graceful fallback: Enox unreachable → LocalBackend silently takes over

---

## [1.961.0] — 2026-05-08

### Added
- Initial open-source release
- Full STALIN pipeline: С(plan)→Т(review)→А(allocation)→Л(work)→И(inspect)→Н(nomenklatura)
- 10 CLI commands: `init`, `plan`, `review`, `work`, `inspect`, `nomenklatura`, `purge`, `status`, `blame`, `rehabilitate`
- Three-reviewer Tribunal: Pioneer (Haiku) + Komsomolets (Sonnet) + Politburo (Opus), 2/3 vote gates labor
- `soviet blame` — git blame with Soviet framing and `--theme kremlin` egg
- Three terminal themes: Kremlin, Gazeta, Zavod (set in `politburo.toml`)
- `soviet purge --hard` — full state wipe
- Landing page at `/docs` (GitHub Pages)
- MIT License
