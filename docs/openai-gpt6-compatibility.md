# OpenAI GPT-6 compatibility review

Date: 2026-11-13. Base: `main` at `9d1b5c49`. Branch: `fix/openai-gpt6-compat`.

## Cause and request path

Model Defaults are resolved by `AIModelProvider._resolveConfig`: organization
category default, provider credentials/version through ProviderKernel, optional
budget-aware model routing, then adapter construction. No environment-key fallback
was added. Budget/governance proxies still surround SDK generation and streaming,
record usage and normalize upstream failures as ProviderUpstreamError.

The OpenAI adapter unconditionally selected Chat Completions for AI SDK models.
That conflicts with the reported GPT-6 restriction on reasoning plus function
tools at that endpoint. Native GPT-6 IDs now select Responses, including GPT-6.1
Terra. GPT-4.1/mini, GPT-4o/mini, GPT-5.2 and o3 keep their existing AI SDK Chat
route. LangChain explicitly selects Responses for GPT-6; its prior SDK routing
for other models remains intact. There is no fallback that silently retries a
request against another API/model or disables reasoning.

Postmill does not explicitly assign `reasoning_effort` in its source. The SDK
serializes caller `providerOptions.openai.reasoningEffort` as Chat
`reasoning_effort` or Responses `reasoning.effort`; when omitted, the model's
upstream default still applies. Reasoning category selection is not itself an
API effort parameter. The reported error does not establish that a literal effort
field was sent; determining the exact production payload requires sanitized
runtime evidence, unavailable in this task.

### Why Luna can appear when High Reasoning is Terra

- `agent`, `generator` and `mcp` resolve High Reasoning. `utility` resolves Low
  Reasoning. Mastra content/analytics specialists use `agent`; ops/media
  specialists deliberately use `utility`. High Reasoning does not select every
  specialist's model. These existing scope choices were preserved.
- The optional model router can replace the configured model when enabled. It is
  off by default. Its working settings were neither read nor changed here.
- Stored defaults are catalog-checked. A missing model can trigger auto-selection.
  The static fallback catalog previously lacked both requested GPT-6 IDs. They
  are now listed, alongside GPT-4.1 mini, so transient model-list failures retain
  these stored selections.
- `governedLanguageModel` previously dropped explicit reasoning options when
  resolving its governance configuration a second time. Those options now remain
  consistent with model construction. This affects governance metadata/config,
  and alone does not prove that the actual request model was changed.

Regression tests separate Luna utility from Terra high defaults, including an
explicit `reasoning:true` utility request. Without production trace/configuration
access, the historical Terra-to-Luna observation cannot be attributed conclusively
to one of the paths above.

## Minimal changes

- Endpoint routing stays within the existing OpenAI adapter. Existing SDKs handle
  text/input_text/output_text, function-call IDs/results, reasoning metadata and
  SSE conversion. No handwritten API client or new scheduler/service was added.
- GPT-6 sampling options are filtered by the AI SDK's model capabilities;
  LangChain construction omits temperature/topP for GPT-6. The Chat SDK v2 still
  forwards reasoning effort on GPT-4, so the adapter removes unsupported explicit
  reasoning effort/summary options for GPT-4 and GPT-3.5 calls.
- Injected safe fetch now covers inference in both SDK factories. Custom base URLs
  fail closed without it. The fetch bridge supports Request inputs, headers,
  bodies and cancellation. SSRF checks, TLS verification and encryption are unchanged.
- SDK versions already in the lockfile suffice; no dependencies were added or upgraded.
- No database/schema, API keys, encryption secrets, server model defaults, Brand
  Studio, Prompt Templates, editorial settings or publishing behavior were changed.
  Local Prisma Client generation updated build artifacts only; no DB operations ran.

## Verification matrix

All results below use synthetic HTTP fixtures and real installed SDKs. **No real
OpenAI requests were made and live model compatibility is not certified.**

| Model | AI SDK route | Text/usage | Two tool rounds | Mastra agent | LangChain text/tools | Text + tool SSE |
|---|---|---|---|---|---|---|
| GPT-4.1 mini | Chat Completions | pass | pass | pass | pass | pass |
| GPT-4.1 | Chat Completions | pass | pass | pass | pass | pass |
| GPT-6 Luna | Responses | pass | pass | pass | pass | pass |
| GPT-6.1 Terra | Responses | pass | pass | pass | pass | pass |

Additional wire assertions cover supported reasoning effort, rejected Terra
`none` (SDK warning, not forwarded), unsupported sampling parameters, token
limits, two-round reasoning item references, stateless `store:false` encrypted
reasoning, incremental function arguments, tool call IDs, HTTP 400/401/429/500/503
on generate/stream, legacy model routing, fallback catalogs and abort propagation.
The fixture explicitly reproduces the reported GPT-6 Chat/tools restriction.

Installed versions: `@ai-sdk/openai` 2.0.136 (LanguageModelV2), `ai` 6.0.313,
`@langchain/openai` 1.7.0, `@langchain/core` 1.3.0, `@mastra/core` 1.63.0,
`@copilotkit/runtime` 1.69.3. AI SDK's V2 interoperability and real Mastra agent
loops were exercised, not just mocked factory return values. Existing Copilot
controller tests exercise the governed-model path; browser CopilotKit transport
and real OpenAI-backed sessions were not exercised.

Targeted commands:

```bash
pnpm exec vitest run --root libraries/providers openai/src/v1/__tests__
pnpm exec vitest run --root libraries/nestjs-libraries src/ai/ai-model.provider.spec.ts src/ai/defaults src/chat/agents
pnpm exec vitest run --root apps/backend copilot
pnpm run test
pnpm run build:backend
```

Targeted results: OpenAI **75 passed**; facade/defaults/specialists **235 passed**;
Copilot controller **19 passed**. A subsequent facade-only run passed **91** tests
including the governance options assertion. Targeted ESLint and diff checks pass.
The initial `pnpm run test` stopped at commands because this environment lacked
its local link to the existing `provider-demonroute` workspace package. Restoring
that ignored node_modules symlink required no manifest/lockfile or source edits.
Commands and the remaining SDK/extension roots were then run successfully.
Final per-root results (providers rerun after the last adapter/test changes):

| Root | Passed | Skipped |
|---|---:|---:|
| helpers | 81 | 0 |
| providers/kernel | 3916 | 10 |
| nestjs-libraries | 7725 | 7 |
| backend | 1191 | 0 |
| frontend | 3065 | 0 |
| commands | 22 | 0 |
| SDK | 15 | 0 |
| extension | 8 | 0 |
| Total across roots | 16023 | 17 |

These are composed successful package runs, not a claim that the initial root
command exited zero. No test or schema migration was run against a working DB.

### Build limitation

After generating the local Prisma Client for current main, the backend build
reports two TS2322 errors in `initialize.sentry.ts` at lines 138 and 159, caused by
incompatible installed root/nested Sentry transport types (core 10.76.2 vs 10.56.0). A separate unchanged
checkout of `main` reproduces exactly those two errors. No OpenAI type errors
remain. This unrelated build blocker was not masked or repaired by changing
Sentry/dependencies; a clean deployable build is still required before rollout.

## Official references and limits

The OpenAI documentation sites returned proxy CONNECT 403 in this environment.
Official OpenAI sources available on GitHub were inspected instead:

- [API resource documentation](https://github.com/openai/openai-python/blob/main/api.md)
- [Responses create parameters](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_create_params.py)
- [Reasoning options](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/reasoning.py)
- [Model identifiers, including Luna/Terra](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/chat_model.py)
- [OpenAI Cookbook: reasoning items and tools](https://github.com/openai/openai-cookbook/blob/main/examples/responses_api/reasoning_items.ipynb)

Installed SDK source was inspected for model capability filtering, Responses input
conversion and stream decoding. Mocks prove Postmill/SDK protocol handling, not
provider availability, prices, access rights or real generated tool arguments.
Existing token/budget gates remain in place; monetary estimates still depend on
the existing pricing configuration/catalog. No new GPT-6 prices were guessed.
Responses uses its SDK storage default unless the caller requests `store:false`;
both reference-based and encrypted stateless continuations were tested. Current
CopilotKit/Mastra behavior with live reasoning payloads remains a smoke-test item.
