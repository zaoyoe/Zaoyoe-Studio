# Zaoyoe Studio Workspace Guide

This repository is the main working root for the studio site and the NewAPI
deployment integration.

## Working root

Open Codex in:

- `/Volumes/chao/AI/xianyu_profit_calculator`

Do not use `/Volumes/chao/AI` as the long-term working root. It is too broad and
causes unnecessary scanning across unrelated projects.

## Repo layout

- `.`: Zaoyoe Studio main site
- `server/`: local Node service code used by the main site
- `services/newapi/`: NewAPI source and web application

## Git behavior

There is now one main Git repository for day-to-day work:

- `/Volumes/chao/AI/xianyu_profit_calculator`

NewAPI production deploys use the stable KVM4 `/opt/sub2api` service slot, but
the legacy Sub2API source and bridge are no longer part of this repository or
the runtime topology.

## Deployment note

The recommended setup is:

- one Git repo
- NewAPI as the only public KVM4 application
- automated deployment from `main`

The `/opt/sub2api` name is retained only as a stable deployment identifier.
