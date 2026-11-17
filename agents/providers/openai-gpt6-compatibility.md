# OpenAI GPT-6 compatibility

## Routing

The OpenAI adapter routes native `gpt-6` and `gpt-6.x` model IDs through the Responses API for both AI SDK and LangChain models. GPT-6 reasoning and function tools require this API rather than Chat Completions.

Earlier models retain their existing behavior: AI SDK models use Chat Completions, and LangChain keeps its previous SDK routing. There is no silent retry against another API or model and no change to Postmill's configured model defaults.

GPT-6 Responses calls default to `store: false`. Earlier answers, function calls, and encrypted reasoning are sent inline so persisted Postmill threads do not depend on OpenAI-retained response objects. A caller that explicitly sets `providerOptions.openai.store` keeps its chosen value. LangChain enables the equivalent `zdrEnabled` behavior only for GPT-6. Earlier Chat Completions models do not gain a `store` field.

The fallback catalog includes `gpt-6-luna` and `gpt-6.1-terra`, so stored selections remain available when the live model list cannot be loaded. Live model-list results still take precedence according to the existing catalog merge rules.

## Model resolution and governance

`governedLanguageModel` passes its reasoning options through both model construction and governance configuration. This keeps the raw model and its governance wrapper on the same resolved model when a caller explicitly requests high reasoning.

ProviderKernel resolution, per-organization encrypted credentials, budget checks, guardrails, usage recording, and upstream-error normalization are unchanged. No environment API-key fallback is introduced.

## Endpoint transport

Canonical OpenAI endpoints retain the SDK's default fetch behavior.

An organization-supplied custom base URL uses Postmill's SSRF-safe fetch in both AI SDK and LangChain inference factories. Construction fails closed if that fetch is unavailable. The bridge:

- preserves the request URL, method, headers, body, redirect mode, and abort signal;
- uses a 300-second timeout for long-running generation and streaming requests;
- retains safe-fetch redirect validation and cross-origin credential stripping.

Credential validation and live model listing continue to use the same injected safe fetch.

## Fixture coverage and limits

`libraries/providers/openai/src/v1/__tests__/api-routing.int-spec.ts` exercises the installed SDKs against synthetic HTTP fixtures. Coverage includes:

- Responses and Chat Completions routing;
- text, usage, reasoning metadata, and unsupported sampling options;
- two-round function-tool calls and tool-result correlation;
- stored and stateless encrypted-reasoning continuations;
- text and function-call streaming;
- Mastra and LangChain agent/tool loops;
- upstream HTTP errors, abort propagation, and custom-endpoint transport.

**These fixtures never call OpenAI.** They verify Postmill's SDK protocol handling, not live model availability, account access, pricing, or generated output. A separately authorized live smoke test is still required to certify behavior against a real OpenAI account.

Run the package suite with:

```bash
pnpm exec vitest run --root libraries/providers/openai
```

Official references:

- [OpenAI model identifiers](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/chat_model.py)
- [Responses create parameters](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_create_params.py)
- [Reasoning options](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/reasoning.py)
- [OpenAI Cookbook: reasoning items and tools](https://github.com/openai/openai-cookbook/blob/main/examples/responses_api/reasoning_items.ipynb)
