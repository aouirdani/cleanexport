# Local agent setup — qwen3.6:27b

## 1. The model

```bash
ollama pull qwen3.6:27b
```

Note the **period**, not a comma. `qwen3,6:27b` will not resolve.

Roughly 17 GB of weights at Q4_K_M, 256K maximum context, coding-tuned quant tags
available. Q4_K_M is the right quantisation: below Q4 code quality degrades sharply, above
it you pay VRAM for little gain.

### VRAM arithmetic

Real usage = weights + KV cache. The KV cache is what people forget, and it scales with
context length.

| Context | Approx. total on a 24 GB card | Verdict |
|---|---|---|
| 8K | ~19 GB | Too small for agentic work |
| 32K | ~21–22 GB | **Start here.** Fits, and covers a task + 3–4 files |
| 64K | ~24 GB+ | Tight. Test before relying on it |
| 256K | Nowhere near a consumer card | Marketing number, not your working number |

If you spill into system RAM, throughput collapses. Check with `ollama ps` — it reports
the CPU/GPU split. Anything not at 100% GPU means you are running far slower than you
should be.

### Environment

```bash
export OLLAMA_FLASH_ATTENTION=1     # lower memory, faster attention
export OLLAMA_KV_CACHE_TYPE=q8_0    # halves KV cache memory
# If code quality drops on long sessions, switch to f16 and lower num_ctx instead:
# export OLLAMA_KV_CACHE_TYPE=f16
```

Sources disagree on `q8_0` vs `f16` — `q8_0` buys context, `f16` buys precision. Try
`q8_0` first; if the agent starts producing subtly wrong edits late in a session, that is
your signal to switch.

## 2. Pin the parameters in a Modelfile

Do not rely on defaults. Ollama's default context is small and **truncates your prompt
silently** — this is the number one cause of "the model ignored my instructions".

```dockerfile
# ./Modelfile
FROM qwen3.6:27b

PARAMETER num_ctx 32768
PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.05
PARAMETER num_predict 4096
```

```bash
ollama create cleanexport-dev -f Modelfile
ollama run cleanexport-dev "print hello world in typescript"
```

Temperature 0.1, not 0.7. For code you want the most probable token, not a creative one.

## 3. The harness

Ollama exposes a model at `http://localhost:11434`. An agent is what turns that into
file edits, shell commands, and a review loop.

### Recommendation: Aider

For a 27B local model specifically, Aider is the strongest pick, for reasons that matter
more with a weak model than a strong one:

- **Git-native.** Every change is an automatic commit, so a bad edit is `git reset --hard`
  away. With a local model you will do this often. This alone justifies the choice.
- **Repo map** rather than dumping the whole tree into context — critical when your usable
  context is 32K, not 200K.
- **Smallest surface area** of the mature agents. Fewer moving parts means fewer places
  for a weak model to get confused.
- **Diff-based loop.** You see exactly what changed before it lands.

```bash
python -m pip install aider-install && aider-install
export OLLAMA_API_BASE=http://127.0.0.1:11434

aider --model ollama_chat/cleanexport-dev \
      --read CONVENTIONS.md \
      --read specs/05-EXPORT-ENGINE.md \
      --auto-commits \
      lib/export/sanitize.ts tests/export/sanitize.test.ts
```

Note `--read` for reference files (loaded, never edited) versus positional arguments for
files the agent may modify. Keeping that distinction strict is the single most effective
guard against a local model wandering off and rewriting your specs.

### If you prefer VS Code

**Cline** — model-agnostic, works with Ollama, has Plan/Act separation and step-by-step
approval. Heavier context footprint than Aider, which costs you on a 32K window.

**OpenCode** — terminal, 75+ providers, larger community. Fine choice; more surface than
Aider.

Avoid Roo Code: it was archived in May 2026.

## 4. What a 27B will and will not do well

This is the honest calibration. It is not the same table as for a frontier model.

| Give it | Why it works |
|---|---|
| Pure functions with tests written first | Machine-checkable target, single file |
| `lib/export/sanitize.ts`, `typeMap.ts` | Table-driven, fully specified in the spec |
| React components, forms, Tailwind | Enormous training corpus, errors are visible |
| CRUD route handlers from the contract | Mechanical, repetitive |
| Prisma schema transcription | Copying, not designing |
| Test cases from a signature you provide | Its best mode |

| Write yourself, or review line by line | Why |
|---|---|
| `lib/crypto.ts` | A subtly wrong AES-GCM implementation looks identical to a right one |
| `lib/hubspot/client.ts` (rate limiter, token refresh) | Timing and retry bugs surface weeks later, at a customer |
| `app/api/webhooks/stripe/route.ts` | Signature verification is security, and it "works" when broken |
| `lib/export/writer.ts` streaming loop | Memory bugs appear only at 50k rows |
| Anything spanning 4+ files | This is where a 27B drifts most |

The pattern: delegate where a bug is **loud and immediate**, keep what fails **silently**.

## 5. Non-negotiable operating loop

1. `git commit` before starting. Always. Your undo button.
2. One task from `07-TASKS.md` per session. Never two.
3. Add only the files the task touches. Add specs with `--read`.
4. Tests first: have it write the test from the spec, **you read the test**, then implement.
5. `pnpm typecheck && pnpm test` after every task.
6. Read the diff. Every line. A 27B produces plausible code that does the wrong thing more
   often than it produces code that fails to compile.
7. Start a fresh session for the next task. Do not let context accumulate — quality decays
   noticeably past roughly 60% of the window.
