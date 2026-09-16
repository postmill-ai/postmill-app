# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- AI: system prompts were sent as a parts array instead of a string (LanguageModelV2 shape), which Gemini rejects with `Unknown name "text" at 'system_instruction.parts[0]'` — dashboard brief, structured output and every `system`-prompted call on Google models failed. `generateTextWithModel` / `generateObjectWithModel` also silently dropped their `system` argument, and alt-text vision used the SDK v1 `{type:'image'}` part.

## [1.0.0] - 2026-09-16

### Added

- Initial public release.
