# Skills

This directory is the **entry point** for repo-specific AI coding assistant skills.

Each skill is a subdirectory containing a `SKILL.md` file:

```
.copilot/skills/
└── <skill-name>/
    └── SKILL.md
```

`SKILL.md` format:

```md
---
description: 'One or two sentences: what the skill does and when the assistant should use it.'
---

# <Skill title>

<Markdown body: rules, context, and instructions for the assistant to follow.>
```

## Adding a new skill

1. Create `.copilot/skills/<skill-name>/SKILL.md` with the format above.
2. Reinstall skills into your local harness config (see the root [`README.md`](../../README.md#ai-coding-assistant-skills)):
   ```bash
   mkdir -p ~/.config/github-copilot/github/leruo-m/abc_bonding/skills
   cp -r .copilot/skills/* ~/.config/github-copilot/github/leruo-m/abc_bonding/skills/
   ```
3. Commit the new `.copilot/skills/<skill-name>/SKILL.md` so other contributors get it too.

## Current skills

| Skill | Purpose |
|---|---|
| [`compile-on-contract-change`](./compile-on-contract-change/SKILL.md) | Run `npx hardhat compile` immediately after the assistant edits any `.sol` file, so deployed bytecode never goes stale. |
