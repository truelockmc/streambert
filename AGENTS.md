# AGENTS.md

## Global Ollama Queue Rule

All repeatable local Ollama, Gemma, Qwen, or other local-model jobs from this
repo must run through the shared Codex Ollama queue:

```sh
/Users/chadwilliams/.codex/local-bin/codex-ollama-queue.mjs status
/Users/chadwilliams/.codex/local-bin/codex-ollama-queue.mjs run --project "<project>" --job-name "<job>" -- <command> [args...]
```

Source/runbook:
`/Users/chadwilliams/CodexWorkspaces/codex-global-operating-policy/docs/codex-ollama-queue.md`.

Do not start project-local `ollama`, `llama-server`, Gemma, Qwen, or analyst-worker
loops directly outside this queue. Keep local-model settings conservative on
this Mac: `concurrency=1`, explicit `num_ctx`, explicit `num_predict`,
bounded timeouts, and unload after each job.
