## Observable Fallback Principle

**Principle**: A fallback is legitimate only when the failure that triggered it is observable. If this task authors a degraded, placeholder, or default path for a resource that can fail to arrive — fetched over the network, read from disk, parsed, decoded, or resolved at runtime — the failure MUST leave a diagnostic on an observable channel before the degraded path takes over. A failure caught and discarded is prohibited.

### Observation targets

For every fallback this task writes:

| Observation | Target |
|-------------|--------|
| **Failure handler** (catch / error callback / non-OK branch) | MUST report the failure and the identity of the resource that failed. An empty handler, or one whose only statements assign the degraded state, is a violation |
| **Degraded state** | MUST be distinguishable at runtime from the intended state — by the diagnostic, by an exposed flag, or by both. "Looks the same as success" is the defect |
| **Recovery** | If the primary resource can arrive AFTER a consumer already committed to the degraded path, either the consumer re-reads on arrival, or the degraded commitment is documented as permanent for that consumer's lifetime |

### Constraints

- **Do NOT silence the trigger.** Swallowing the error is what makes the fallback indistinguishable from the intended path. This holds even when the fallback is a complete, visually correct substitute — especially then.
- **Do NOT let the fallback stand in for verification.** A fallback that always renders something makes the primary path untestable through the product's own surface: every build, type, and test gate passes while the primary path is dead.
- **Cache the failure, not the silence.** Where a failed load is remembered to avoid retry storms, the remembered value is a recorded failure, not an absence of information.

### Blind spot

⚠️ **Graceful-degradation trap**: a resource is unavailable or malformed, the handler discards the error, and the degraded path renders a plausible result. Nothing in the product reports a problem; every automated gate stays green because the gates observe the code, not the resource. The defect then survives an arbitrary number of subsequent tasks, because each one observes a working build and a rendering product. The trigger is only ever recoverable from the diagnostic the handler was supposed to emit.
