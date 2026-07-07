{{!--
  Game-Art Source Dispatcher (WS2 §3D) — selects ONE interpretation partial
  based on the `gameArtSource` template variable. Mirror of `ui-source-dispatch`
  as a documented Contract-flavoured exception (per AGENTS.md "Post-RAC Template
  Condition SSOT"): the ant canonical schema and the free-form handoff bundle
  have fundamentally different interpretation contracts that Gate alone cannot
  express.

  Game-domain only (D28) — routed here by `AutoInjectionResolver`; the service
  domain uses `ui-source-dispatch` instead.

  Default (ant / figma / null) → the canonical `game-art-source` partial.
  Only `handoff` swaps to the survey-first `game-art-source-handoff` partial.
--}}
{{#if (eq gameArtSource 'handoff')}}
{{> jobs/code/base/injections/game-art-source-handoff}}
{{else}}
{{> jobs/code/base/injections/game-art-source}}
{{/if}}
