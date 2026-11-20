import {
  FilePenLine,
  ListChecks,
  ScanSearch,
  Search,
  Send,
  Workflow,
} from "lucide-react";
const icons = {
  default: Workflow,
  researcher: Search,
  writer: FilePenLine,
  humanizer: ListChecks,
  verifier: ScanSearch,
  publisher: Send,
};
export function AgentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const Icon = icons[id as keyof typeof icons] ?? Workflow;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
