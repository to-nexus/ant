import { Card } from '@/ui';

interface ProjectListProps {
  projects: string[];
  selected: string | undefined;
  onSelect: (projectId: string) => void;
}

export default function ProjectList({ projects, selected, onSelect }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No projects found
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {projects.map((projectId) => (
        <Card
          key={projectId}
          className={`p-4 cursor-pointer transition-colors hover:bg-gray-50 ${
            selected === projectId
              ? 'border-primary-500 bg-primary-50 shadow-md'
              : 'border-gray-200'
          }`}
          onClick={() => onSelect(projectId)}
        >
          <div className="font-medium text-gray-900 dark:text-white">{projectId}</div>
        </Card>
      ))}
    </div>
  );
}