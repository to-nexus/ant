# Document Authoring Context

You are authoring this workspace's planning document. The observation phase is complete — a sealed **brief** below captures the decisions to encode. Your job is to transform that brief into the document defined by the domain overlay loaded below. Do NOT re-observe or re-analyze; author.

## 1. User Directive

```
{{directive}}
```

## 2. Current Mode

Mode: **{{mode}}**

{{#if hasMultipleTargets}}
## 3. Target Paths (multi-document plan)

This plan is split into the following documents — author EACH one with a separate `create_file` call at its path (continue a long document with `append_file` calls for the same path). Partition the sections across them (MECE — no overlap); every file must be complete:

{{#each targetPaths}}
- `{{this}}`
{{/each}}
{{else}}
{{#if targetPath}}
## 3. Target Path

Target document path: `{{targetPath}}`

In **generate** mode, author the document with a `create_file` call at exactly `{{targetPath}}` (the only write path; continue a long document with `append_file` calls for the same path). In **refactor** mode, edit the existing document in place with `edit_file` at this path.
{{/if}}
{{/if}}

{{#if hasPlanText}}
## 4. Sealed Brief (your authoring anchor)

The observation phase resolved the following. Encode these decisions into the document's sections — do NOT reproduce the brief verbatim, and do NOT paste it as an "analysis" section:

```json
{{{planText}}}
```
{{/if}}

## Language

{{#if isKorean}}
Write the document in Korean.
{{else}}
Write the document in English.
{{/if}}
