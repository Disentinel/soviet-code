# Руководство для товарищей-контрибьюторов

Партия приветствует рационализаторские предложения.

## Как принять участие

1. **Fork репо** (выездная виза — Article 44)
2. **Создай ветку** (личная шарашка — Article 29)
3. **Внеси изменения** (стахановский труд — Article 9)
4. **Открой PR** (донесение на рассмотрение Трибунала — Article 51)

```bash
git checkout -b feature/your-directive
# ... stakhanovite labor ...
git commit -m "feat: add soviet terminology for async patterns"
git push origin feature/your-directive
# Open PR → Tribunal reviews
```

## Code standards

- `tsc --noEmit` must pass with zero errors
- All terminal output must follow [IDEOLOGY.md](IDEOLOGY.md) tone (Article 17, 20)
- Soviet terminology required in all user-facing strings (Article 49)
- No new dependencies without justification (Article 43 — import minimalism)
- Every line of code must be simultaneously **funny, useful, and technically correct** (Article 53)

## Commit format

```
feat(scope): add X
fix(scope): correct Y
perf(scope): speed up Z
```

## Anti-patterns to avoid (see IDEOLOGY.md)

- 🌽 **Kukuruzization** — applying one pattern everywhere regardless of context (Article 11)
- 🏚️ **Potemkin Villages** — tests with no assertions, coverage with no verification (Article 12)
- 🏢 **Communal Housing** — shared mutable global state (Article 13)
- 📜 **Bourgeois Formalism** — abstractions for their own sake (Article 15)

## Suggesting new Soviet metaphors

Found a new anti-pattern with no Soviet name? Article 18 obliges you to invent one. Open an issue with the "Рационализаторское предложение" template. The Politburo will deliberate.

## Questions?

Open a GitHub Discussion under "Q&A". The Party will respond in due course.

Слава роботам. ☭
