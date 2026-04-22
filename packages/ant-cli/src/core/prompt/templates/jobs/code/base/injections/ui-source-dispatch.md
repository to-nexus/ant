{{!--
  UI Source Dispatcher — selects ONE of three interpretation partials
  based on the `uiSource` template variable. This is the single SSOT
  authored by `.cursorrules` "Post-RAC Template Condition SSOT" as a
  documented Contract-flavoured exception: each source has a distinct
  interpretation contract that Gate (`hasUi`) alone cannot express.
--}}
{{#if uiSource}}
{{#if (eq uiSource 'ant')}}
{{> jobs/code/base/injections/ui-source-ant}}
{{/if}}
{{#if (eq uiSource 'figma')}}
{{> jobs/code/base/injections/ui-source-figma}}
{{/if}}
{{#if (eq uiSource 'handoff')}}
{{> jobs/code/base/injections/ui-source-handoff}}
{{/if}}
{{/if}}
