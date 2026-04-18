# Zaoyoe Studio Workspace Guide

This repository is now the main working root for both the studio site and the
embedded `sub2api` service.

## Working root

Open Codex in:

- `/Volumes/chao/AI/xianyu_profit_calculator`

Do not use `/Volumes/chao/AI` as the long-term working root. It is too broad and
causes unnecessary scanning across unrelated projects.

## Repo layout

- `.`: Zaoyoe Studio main site
- `server/`: local Node service code used by the main site
- `services/sub2api/`: embedded `sub2api` service code

## Git behavior

There is now one main Git repository for day-to-day work:

- `/Volumes/chao/AI/xianyu_profit_calculator`

That means:

- main site changes and `services/sub2api` changes are committed together here
- one `git push` from this repo pushes both kinds of changes

The old standalone `sub2api` repo can be kept as a backup/reference while the
migration settles, but it should no longer be your default daily workspace.

## Handy commands

From this repo root:

```bash
npm run sub2api:frontend:install
npm run sub2api:frontend:build
npm run sub2api:docker:restart
npm run sub2api:health
```

## Deployment note

`sub2api` is still an independent runtime service even though its code now lives
inside this repository. The recommended long-term setup is:

- one Git repo
- separate runtime services
- path-based CI/CD later

That keeps editing simple without forcing the studio site and `sub2api` into the
same application process.
