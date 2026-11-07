import { GithubAuthController } from "./github/auth-controller";
import { FactoryProvider } from "./factory/context";
import { RepositoryDialog } from "./workspace/repository-dialog";
import { WorkspaceProvider, useWorkspace } from "./workspace/context";
import { WorkbenchShell } from "./workbench/shell";

function IdentityBoundWorkbench() {
  const { principal, ownershipGeneration } = useWorkspace();
  return (
    <FactoryProvider key={`${principal.key}:${ownershipGeneration}`}>
      <WorkbenchShell />
    </FactoryProvider>
  );
}

function IdentityBoundRepositoryDialog() {
  const { principal, ownershipGeneration } = useWorkspace();
  return <RepositoryDialog key={`${principal.key}:${ownershipGeneration}`} />;
}

export function WorkbenchApp() {
  return (
    <WorkspaceProvider>
      <GithubAuthController />
      <IdentityBoundWorkbench />
      <IdentityBoundRepositoryDialog />
    </WorkspaceProvider>
  );
}
