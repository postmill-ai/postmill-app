// Runs before any other client code (Next.js client instrumentation hook).
//
// Several client pages build a `classValidatorResolver(...)` over NestJS DTOs that decorate
// nested classes with class-transformer's `@Type` / class-validator's `@ValidateNested`
// (e.g. `/user/me` → `UserDetailDto` → `media.dto.ts` → the provider-kernel social-dtos
// barrel, which evaluates `DevToSettingsDto` & friends). Those decorators call
// `Reflect.getMetadata` at class-evaluation time, so without the `reflect-metadata` polyfill
// the browser bundle throws "Reflect.getMetadata is not a function" the moment the module is
// imported. Loading it here guarantees the global `Reflect` metadata API exists first.
import 'reflect-metadata';
