# Architecture

## Invariants

ZhixingOS is designed around seven invariants:

1. Every meaningful input has provenance, consent, capture time and a privacy level.
2. Facts, experiences, inferences and commitments remain distinguishable.
3. A write is not successful until a real executor returns a verifiable identifier.
4. Partial failure is a first-class result; undo exists only when a real undo path exists.
5. A digital-twin trait is provisional, scoped, evidence-linked, reviewable and correctable.
6. Memory retrieval happens only after user isolation, service-contract filtering and correction rules.
7. Recalled memory is private, source-linked, versioned, budgeted and treated as data rather than prompt instructions.
8. A device connector reports honest availability and emits only normalized, source-linked observations; it never edits the avatar directly.
9. Adaptive appearance is temporary, bounded and reversible, and cannot overwrite identity, personality or user-confirmed appearance.
10. Cross-device continuity is an explicit user-scoped handoff object with a target surface, TTL and consumption state; shared storage is never presented as implicit clipboard or background transfer.

## Runtime layers

| Layer | Responsibility | Key paths |
|---|---|---|
| Intake | Normalize text, photo, audio and device inputs | `src/ai-native/intake` |
| Intent | Parse goals, time, constraints and missing fields | `src/ai-native/intent` |
| Objects | Create versioned notes, tasks, events, courses and drafts | `src/ai-native/objects` |
| Reasoning | Assess paths with 时、位、势、应、变、中 | `src/ai-native/reasoning` |
| Surfaces | Compile context into one primary action and alternatives | `src/ai-native/surfaces` |
| Actions | Gate, execute, receipt, idempotency and undo | `src/ai-native/actions` |
| Evidence/Twin | Feed outcomes into scoped, versioned personal memory | `src/ai-native/evidence`, `src/ai-native/twin` |
| Memory recall | Project governed records into L0-L3 assets and retrieve under explicit budgets | `backend/src/services/memoryRetrieval.ts` |
| Life-data connectors | Normalize wearable, phone, desktop and food signals behind explicit platform boundaries | `src/ai-native/connectors` |
| Adaptive appearance | Apply confidence, continuity, expiry and user-priority gates before VRM rendering | `src/mirror3d/avatar/v2/adaptiveAppearance.ts` |
| Device continuity | Create, discover, consume and cancel explicit desktop/mobile handoffs | `src/hooks/useContinuityHandoffs.ts`, `src/components/ContinuityInboxCard.tsx`, `backend/src/routes/runtime.ts` |

The domain layer has no React Native imports and is covered by Node tests. Platform adapters implement calendars, media, local storage and HTTP. Screens render state but do not decide whether a write succeeded.

## Backend

The Express backend uses Node's built-in SQLite driver. Existing document tables preserve the full App object in `doc` while indexed columns support queries. AI-native additions are:

- `life_objects`: versioned object snapshots.
- `action_receipts`: unique per-user idempotency keys and complete step results.
- `twin_profiles`: current profile snapshot and version.
- `continuity_handoffs`: user-scoped cross-device work continuation with source/target surface, bounded payload, TTL and open/consumed/cancelled lifecycle.

These tables participate in export and account deletion. All runtime routes are authenticated and scope queries by `user_id`.

The secretary does not load an unbounded personal profile. After R/D contract filtering and user corrections, records are projected into private L0 source records, L1 atomic knowledge, L2 scenario methods and L3 confirmed identity/boundaries. Retrieval emits a receipt with source IDs, versions, layer counts, character budget and partial status. See [ADR-0001](docs/adr/0001-local-first-layered-memory-assets.md).

## Change reasoning, not divination

The six operators are engineering lenses:

- 时: timing, freshness and review windows.
- 位: role, capability, resource and boundary fit.
- 势: recent direction and inertia.
- 应: coupling with people, commitments and systems.
- 变: smallest reversible change and alternatives.
- 中: sustainable balance, risk and stopping rules.

They produce reasons and evidence gaps, never luck, fate or personality scores.

## Trust boundaries

- Client configuration is public; no secret is allowed in `EXPO_PUBLIC_*`.
- The backend owns authentication and user isolation.
- System calendar and microphone access are requested only at the user gesture that needs them.
- LLM output cannot bypass ActionGateway, confirmation or executor verification.
- Stored memories and conversation history are untrusted data; they cannot override system policy or authorize tools.
- Third-party model files retain their own license and provenance.
- Raw phone/desktop events, window titles, URLs and food-photo pixels remain outside the avatar domain; only confirmed aggregates cross the connector boundary.
- A missing native module, entitlement, companion or regional service is an explicit unavailable state, never a simulated success.
- Continuity handoffs contain only the bounded payload the user explicitly sends; no implementation may infer that a shared database, browser session or clipboard constitutes a completed transfer.

## Life-data adaptation

Wearable, phone, desktop and food sources implement one `LifeDataConnector` contract: availability, authorization, incremental sync, revoke and purge. Each observation carries a stable connector ID, time, unit, confidence, confirmation status, privacy class and non-sensitive source reference. Renderer code only reads `AvatarAdaptiveAppearance`.

The adaptive layer is separate from identity and long-term appearance. Recent sleep can affect eye-fatigue material and motion; stress can affect tension without diagnosis; one meal can only affect short-term fullness; body shape requires at least a two-week trend and is capped at -4%/+6%. See [ADR-0002](docs/adr/0002-life-data-adaptive-avatar.md).

## Adding an executor

An executor must return an external or internal object ID and an honest message. If it advertises reversibility it must return an `undoToken` and implement `undo`. Add unit tests for permission denial, failure, partial failure, idempotency and undo before adding UI affordances.
