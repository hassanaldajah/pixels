# Contributing

Thanks for looking. A few rules keep the project safe and consistent.

## Set up

```bash
cd server && uv sync              # Python 3.11 is installed for you
pnpm install                      # from the repository root
uv tool install pre-commit && pre-commit install
```

See the [README](README.md#development) for the check commands. Before opening a pull request,
all of these must pass: `ruff`, `black --check`, `mypy`, `pytest`, `tsc`, `eslint`, `prettier --check`,
`vitest`, and the production build.

## Rules

- **No placeholders.** No `TODO` stubs, fake progress bars or simulated results. A tool that is not
  built is shown disabled, with the reason.
- **No AI models.** Tools use ordinary algorithms that run locally; nothing is downloaded at run time.
- **Colours live in `apps/web/src/tokens.ts`.** Everything else uses the `--px-*` variables. ESLint
  rejects hex colours elsewhere, and `tokens.test.ts` guards contrast.
- **Untrusted input.** Anything that reads an image goes through `server/security`. Never use a client-supplied filename as a path.
- **Security changes need tests.** A new check needs a fixture in `server/tests/security/fixtures.py`
  that it rejects, and a valid fixture that it still accepts.
- **No telemetry and no outbound calls.** The backend listens on loopback only.
- **Licences.** Ask before adding a dependency with a non-permissive licence or a paid service.
- **Types everywhere.** TypeScript is `strict`; Python is `mypy --strict`.
- **Smoothness is a feature.** Keep animations on the shared easing tokens, keep the canvas at
  60 fps, and respect `prefers-reduced-motion`.

## Commits

Small, focused commits with a message that says why. Do not commit images, `.pxe` projects,
logs or `.env` files; `.gitignore` and the pre-commit hooks block the usual ones.
