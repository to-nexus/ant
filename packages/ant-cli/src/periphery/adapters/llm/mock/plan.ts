export function planResponse(): string {
  const plan = JSON.stringify({
    task: { id: 'mock-feature', goal: 'Implement the feature as described in the directive.' },
    prescribedPackages: [],
    implementation: {
      create: [
        { path: 'src/index.ts', description: 'Main entry point' },
      ],
      modify: [],
      assets: [],
    },
  });

  return `<analysis>
Mock analysis: The task requires creating a simple project structure with one entry file.
No external dependencies needed. Straightforward implementation.
</analysis>
<plan>
${plan}
</plan>`;
}
