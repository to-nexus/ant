export function planResponse(): string {
  const plan = JSON.stringify({
    task: { id: 'mock-feature', goal: 'Implement the feature as described in the directive.' },
    implementation: {
      create: [
        { path: 'src/index.ts', description: 'Main entry point' },
      ],
      modify: [],
      assets: [],
    },
  });

  return `<plan>
${plan}
</plan>`;
}
