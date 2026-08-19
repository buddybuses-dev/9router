# Workflows

These four workflow files are the 24/7 engine. **While this project lives inside the
9router repository they do not run** — GitHub only reads workflows from
`.github/workflows/` at the repository root.

To activate them, either:

- move `content-engine/` into its own repository (recommended — see the repo README), or
- copy these four files to the repository root's `.github/workflows/`, and add
  `working-directory: content-engine` to every `run:` step.

| Workflow | Schedule (UTC) | Job |
| --- | --- | --- |
| `pipeline.yml` | every 3 hours | source → script → render, then commit the queue |
| `publish.yml` | 13:00 and 19:00 | publish the next ready video |
| `stats.yml` | 06:30 daily | collect performance |
| `health.yml` | 07:00 daily | watchdog; opens an issue when the channel is going dark |

All four share the `content-queue` concurrency group, because every one of them commits
the queue back to the branch and they must never run at the same time.
