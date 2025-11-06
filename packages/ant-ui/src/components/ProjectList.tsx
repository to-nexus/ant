interface ProjectListProps {
  projects: string[];
  selected: string | undefined;
  onSelect: (projectId: string) => void;
}

export default function ProjectList({ projects, selected, onSelect }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
        No projects found
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {projects.map((projectId) => (
        <div
          key={projectId}
          className={`px-3 py-2 cursor-pointer transition-colors rounded-md text-sm font-medium ${
            selected === projectId
              ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 border-l-2 border-blue-500 dark:border-blue-400'
              : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          onClick={() => onSelect(projectId)}
        >
          {projectId}
        </div>
      ))}
    </div>
  );
}