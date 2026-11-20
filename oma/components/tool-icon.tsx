import { BarChart3, FileText, Hash, Search, Table2 } from "lucide-react";
import { tools, type ToolId } from "@/lib/playbooks";
const icons = {
  search: Search,
  chart: BarChart3,
  table: Table2,
  file: FileText,
  hash: Hash,
};
export function ToolIcon({ id, size = 17 }: { id: ToolId; size?: number }) {
  const Icon = icons[tools[id].icon];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
