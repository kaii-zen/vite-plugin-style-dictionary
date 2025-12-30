# Contributing

Thanks for contributing! This repo uses Conventional Commits for both commit
messages and PR titles.

## Commit and PR title format

Use:

    type(scope): summary

Where `scope` is optional. Examples:

    fix: resolve directory token sources
    docs(readme): clarify usage

Common `type` values:

- feat
- fix
- docs
- chore
- refactor
- test
- ci
- build
- perf
- revert

Breaking changes:

- Add `!` after the type/scope, e.g. `feat!: drop Node 20 support`, or
- Add a `BREAKING CHANGE:` footer in the commit body.

The PR title check enforces this format.

## Local workflow

    npm install
    npm run dev
    npm run test
