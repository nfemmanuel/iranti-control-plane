# Provider Authority Model

## Operator Summary

Provider settings in the control plane are instance-scoped.

- The selected instance is the authority for Provider Manager reads and writes.
- Runtime credentials live in `~/.iranti-runtime/instances/<name>/.env`.
- Project `.env.iranti` files are bindings. They are not the runtime authority for `LLM_PROVIDER`, `LLM_PROVIDER_FALLBACK`, or provider API keys.

## Canonical Provider IDs

Iranti uses `claude` as the Anthropic provider ID.

- `LLM_PROVIDER=claude`
- `LLM_PROVIDER_FALLBACK=claude,openai`
- `ANTHROPIC_API_KEY` remains the credential env var name

The control plane accepts legacy `anthropic` values for compatibility, normalizes them to `claude`, and warns when an instance still stores the legacy ID.

## UI / CLI Equivalence

- Set Claude as default: `iranti add api-key claude --instance <name> --set-default`
- Set OpenAI as default: `iranti add api-key openai --instance <name> --set-default`
- Review live instance env: `~/.iranti-runtime/instances/<name>/.env`
- Restart after provider changes: `iranti run --instance <name>`

Provider writes in the control plane now return `restartRequired: true` because the running Iranti process reads these values at startup.

## Maintainer Notes

Routes and components rebuilt around explicit instance authority:

- `src/server/routes/control-plane/providers.ts`
- `src/server/routes/control-plane/setup.ts`
- `src/client/src/components/providers/ProviderManager.tsx`
- `src/client/src/components/providers/RoutingEditor.tsx`
- `src/client/src/components/health/ProviderStatus.tsx`

Test coverage for this slice:

- `src/server/tests/unit/providers-scope.test.ts`
- `src/server/tests/unit/setup-scope.test.ts`
