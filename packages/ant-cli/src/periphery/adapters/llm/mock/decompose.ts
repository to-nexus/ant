export function decomposeCodeResponse(): string {
  const tasks = JSON.stringify([
    {
      id: 'mock-setup',
      name: 'Project Setup',
      type: 'setup',
      priority: 100,
      description: 'Initialize project structure with package.json and configuration files.',
      packages: ['mock-app'],
    },
    {
      id: 'mock-feature',
      name: 'Main Feature',
      type: 'feature',
      priority: 200,
      description: 'Implement the main feature as described in the directive.',
      packages: ['mock-app'],
    },
  ]);

  const techTier = JSON.stringify({
    stack: 'frontend',
    stackReasoning: 'Mock: web application environment.',
    language: 'typescript',
    framework: 'react',
  });

  return `<tasks>
${tasks}
</tasks>
<techTier>
${techTier}
</techTier>
<references>[]</references>`;
}

export function decomposeDesignResponse(): string {
  const tasks = JSON.stringify({
    tasks: [
      {
        id: 'mock-design-main',
        name: 'System Design Document',
        type: 'design-system',
        priority: 100,
        description: 'Generate the main system design document.',
        targetFile: 'fe-system-main.md',
      },
    ],
  });

  return `<decompose>
${tasks}
</decompose>`;
}
