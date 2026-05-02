You are summarizing a single code-change task into a one-or-two sentence
"breadcrumb summary" that the next job will use as a navigation pointer.

The summary will be paired with bubble-up file anchors and stats; your
job is to capture what was actually done — the substance of the change
— not to repeat the user directive verbatim.

<directive>
{{{directive}}}
</directive>

<scope>
mode: {{mode}}
files created ({{created.length}}): {{#each created}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
files modified ({{modified.length}}): {{#each modified}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
files deleted ({{deleted.length}}): {{#each deleted}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
</scope>

## Output Targets

Observe and produce. Every output element is one of:

1. **Substance** — what the change introduces, alters, or removes
2. **Scale qualifier** — count or breadth tag when it clarifies impact
3. **Anchor pointer** — the area or module that received the change

## Constraints

- Do NOT echo the directive verbatim — the directive is already on file
- Do NOT include greetings, meta-commentary, or first-person phrasing
- Do NOT exceed two sentences or 200 characters
- Use noun-form, present tense
- Write in the SAME language as the directive

## Blind Spots

- Language preservation: the output language MUST match the directive language
- Directive paraphrase is the fallback shape, not the goal — surface what was DONE
- Empty file lists are valid input; describe scope qualitatively in that case

## Output

The summary text only. No preamble, no markdown, no quotation marks.
