# 🔗 Reference Project Code

The following code is from **reference projects** that you can use as examples or patterns.

{{#each contexts}}
## Reference: `{{this.project}}`{{#if this.branch}} ({{this.branch}}){{/if}}

**Files** ({{this.stats.filesLoaded}} files, ~{{this.stats.estimatedTokens}} tokens):

{{#each this.files}}
### File: `{{this.path}}`

```
{{this.content}}
```

{{/each}}

---

{{/each}}

## 📋 How to Use Reference Code

1. **Learn Patterns**: See how similar problems are solved in reference projects
2. **Adapt, Don't Copy**: Understand the approach and adapt it to your project
3. **Maintain Consistency**: Your code should fit YOUR project's style, not the reference
4. **Credit When Appropriate**: If using significant portions, consider adding comments
5. **Test Thoroughly**: Reference code may work differently in your context

## ⚠️ Important Notes

- Reference code is for **inspiration and patterns only**
- Do NOT blindly copy-paste without understanding
- Your project may have different requirements or constraints
- Always adapt reference code to fit your architecture
- Ensure any adapted code follows your project's standards

