import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkflowCanvas } from "../features/workflow/components/WorkflowCanvas";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkflowCanvas />
    </QueryClientProvider>
  );
}
