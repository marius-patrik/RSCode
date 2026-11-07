import type { GithubRef, GithubRepository } from "@/github/client";
import type { WorkspaceSnapshot } from "./model";

/** GitHub identities are immutable numeric provider IDs, never account login strings. */
export type PrincipalKey = `gh:github.com:${number}` | `anon:${string}`;
export type GithubPrincipal = {
  kind: "github";
  key: `gh:github.com:${number}`;
  userId: number;
};
export type AnonymousPrincipal = {
  kind: "anonymous";
  key: `anon:${string}`;
  profileId: string;
};
export type Principal = GithubPrincipal | AnonymousPrincipal;
export type RepositoryKey = `gh:github.com:repo:${number}`;
export type GitRef = `refs/heads/${string}` | `refs/tags/${string}` | `sha:${string}`;
export type RepositoryIdentity = { key: RepositoryKey; id: number; fullName: string };
export type WorkspaceIdentity = { id: string; principalKey: PrincipalKey };
export type RepositorySessionIdentity = {
  id: string;
  principalKey: PrincipalKey;
  workspaceId: string;
  repositoryKey: RepositoryKey;
  ref: GitRef;
};
export type ResourceIdentity = {
  principalKey: PrincipalKey;
  sessionId: string;
  resourceId: string;
  kind: "document" | "blob" | "overlay" | "staged" | "commit" | "layout";
};
export type OwnershipGeneration = { principalKey: PrincipalKey; generation: number };
export type OwnedWorkspaceIdentity = {
  principalKey: PrincipalKey;
  workspace: WorkspaceIdentity;
  session: RepositorySessionIdentity;
};

const PROFILE_KEY = "ghcode-anonymous-profile-v1";
const OWNED_PREFIX = "ghcode-owned-v2:";

/** The anonymous profile is explicit, stable and independent of GitHub login. */
export function anonymousPrincipal(): AnonymousPrincipal {
  let id: string | null = null;
  try {
    id = localStorage.getItem(PROFILE_KEY);
  } catch {}
  if (!id || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(PROFILE_KEY, id);
    } catch {
      // Without storage the profile is session-only, but never takes another profile's identity.
    }
  }
  return { kind: "anonymous", profileId: id, key: `anon:${id}` };
}

export function githubPrincipal(id: number): GithubPrincipal {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("GitHub /user has no valid numeric ID.");
  return { kind: "github", userId: id, key: `gh:github.com:${id}` };
}

export function repositoryIdentity(repository: GithubRepository): RepositoryIdentity {
  if (!Number.isSafeInteger(repository.id) || repository.id <= 0)
    throw new Error("Repository is missing a valid immutable GitHub ID.");
  return {
    key: `gh:github.com:repo:${repository.id}`,
    id: repository.id,
    fullName: repository.full_name,
  };
}

export function canonicalGitRef(name: string, refs: GithubRef[]): GitRef {
  if (/^refs\/(heads|tags)\/.+/.test(name)) return name as GitRef;
  if (/^[0-9a-f]{40}$/i.test(name)) return `sha:${name.toLowerCase()}`;
  if (!name || name.startsWith("refs/")) throw new Error("Unsupported Git ref.");
  const options = refs.filter((ref) => ref.name === name);
  if (options.length > 1) throw new Error("Ambiguous branch/tag name. Select an explicit Git ref.");
  return options[0]?.kind === "tag" ? `refs/tags/${name}` : `refs/heads/${name}`;
}

export function createOwnedWorkspaceIdentity(
  principal: Principal,
  repository: RepositoryIdentity,
  ref: GitRef,
): OwnedWorkspaceIdentity {
  const workspace: WorkspaceIdentity = { id: crypto.randomUUID(), principalKey: principal.key };
  const session: RepositorySessionIdentity = {
    id: crypto.randomUUID(),
    principalKey: principal.key,
    workspaceId: workspace.id,
    repositoryKey: repository.key,
    ref,
  };
  return { principalKey: principal.key, workspace, session };
}

export function ownedWorkspaceId(ownership: OwnedWorkspaceIdentity): string {
  return `${OWNED_PREFIX}${encodeURIComponent(ownership.principalKey)}:${ownership.session.id}`;
}

export function isOwnedWorkspaceId(id: string): boolean {
  return id.startsWith(OWNED_PREFIX) && id.length > OWNED_PREFIX.length;
}

/** Only explicitly marked, newly created records can be restored before the v3 migration. */
export function isOwnedWorkspace(
  snapshot: WorkspaceSnapshot | null | undefined,
  principalKey: PrincipalKey,
  repo?: RepositoryIdentity,
  gitRef?: GitRef,
): snapshot is WorkspaceSnapshot & { ownership: OwnedWorkspaceIdentity } {
  if (!snapshot || !snapshot.ownership) return false;
  const parsed = parseOwnedWorkspaceId(snapshot.id);
  if (!parsed || parsed.principalKey !== principalKey) return false;
  const { ownership } = snapshot;
  const recordedRef = ownership.session.ref;
  const refName = recordedRef.startsWith("sha:")
    ? recordedRef.slice(4)
    : recordedRef.replace(/^refs\/(heads|tags)\//, "");
  return (
    Number.isSafeInteger(snapshot.repository.id) && snapshot.repository.id > 0 &&
    (snapshot.ref === refName || snapshot.ref === recordedRef) &&
    validResourceRef(recordedRef) &&
    parsed.sessionId === ownership.session.id &&
    ownership.principalKey === principalKey &&
    ownership.workspace.principalKey === principalKey &&
    ownership.session.principalKey === principalKey &&
    ownership.session.workspaceId === ownership.workspace.id &&
    ownedWorkspaceId(ownership) === snapshot.id &&
    ownership.session.repositoryKey === `gh:github.com:repo:${snapshot.repository.id}` &&
    (repo === undefined || ownership.session.repositoryKey === repo.key) &&
    (gitRef === undefined || ownership.session.ref === gitRef)
  );
}

export function sameOwnership(active: OwnershipGeneration, captured: OwnershipGeneration): boolean {
  return active.generation === captured.generation && active.principalKey === captured.principalKey;
}

const DOCUMENT_PREFIX = "ghcode-document-v1";
const SHA40 = /^[0-9a-f]{40}$/;
const OWNED_ID_PATTERN = /^ghcode-owned-v2:([^:]+):([0-9a-f]{8}-[0-9a-f-]{27,})$/i;

function canonicalPrincipalKey(value: string): value is PrincipalKey {
  if (/^gh:github\.com:[1-9][0-9]*$/.test(value)) {
    return Number.isSafeInteger(Number(value.slice("gh:github.com:".length)));
  }
  return /^anon:[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

export function parseOwnedWorkspaceId(value: string): {
  principalKey: PrincipalKey;
  sessionId: string;
} | null {
  const match = OWNED_ID_PATTERN.exec(value);
  if (!match) return null;
  let principal: string;
  try { principal = decodeURIComponent(match[1]); } catch { return null; }
  if (encodeURIComponent(principal) !== match[1] || !canonicalPrincipalKey(principal))
    return null;
  return { principalKey: principal, sessionId: match[2] };
}

export type DocumentResourceIdentity = {
  type: "document";
  principalKey: PrincipalKey;
  workspaceId: string;
  sessionId: string;
  repositoryKey: RepositoryKey;
  ref: GitRef;
  baseSha: string;
  path: string;
};

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function validDocumentPath(path: string): boolean {
  return !!path && path.length <= 4096 && path === path.normalize("NFC") &&
    !path.startsWith("/") && !path.endsWith("/") &&
    !path.includes("\\") && !hasControlCharacters(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validResourceRef(value: string): value is GitRef {
  if (/^sha:[0-9a-f]{40}$/.test(value)) return true;
  return /^refs\/(heads|tags)\/\S+$/.test(value) &&
    !hasControlCharacters(value) && !value.includes("..") &&
    !value.includes("\\") && !value.endsWith("/") && !value.includes("@{");
}

/**
 * Canonical document identity includes immutable repository ID and source revision.
 * Each component is percent-encoded, then compared against its canonical encoding
 * when read. No raw substring is ever used to establish resource ownership.
 */
export function encodeDocumentResourceId(snapshot: WorkspaceSnapshot, path: string): string {
  const ownership = snapshot.ownership;
  if (!ownership || !isOwnedWorkspace(snapshot, ownership.principalKey))
    throw new Error("Document cannot be bound to an unattributed workspace.");
  if (!validDocumentPath(path) || !validResourceRef(ownership.session.ref) ||
      !SHA40.test(snapshot.baseSha) ||
      !Number.isSafeInteger(snapshot.repository.id) || snapshot.repository.id <= 0)
    throw new Error("Invalid document path, repository ref or source revision.");
  const parts = [
    ownership.principalKey, snapshot.id, ownership.session.id,
    ownership.session.repositoryKey, ownership.session.ref, snapshot.baseSha, path,
  ];
  return `${DOCUMENT_PREFIX}:${parts.map(encodeURIComponent).join(":")}`;
}

export function parseDocumentResourceId(value: string): DocumentResourceIdentity | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 8 || parts[0] !== DOCUMENT_PREFIX) return null;
  const values: string[] = [];
  try {
    for (const part of parts.slice(1)) {
      const decoded = decodeURIComponent(part);
      if (encodeURIComponent(decoded) !== part) return null;
      values.push(decoded);
    }
  } catch { return null; }
  const [principalKey, workspaceId, sessionId, repositoryKey, ref, baseSha, path] = values;
  const workspace = parseOwnedWorkspaceId(workspaceId);
  const repo = /^gh:github\.com:repo:([1-9][0-9]*)$/.exec(repositoryKey);
  if (!workspace || !canonicalPrincipalKey(principalKey) ||
      workspace.principalKey !== principalKey || workspace.sessionId !== sessionId ||
      !repo || !Number.isSafeInteger(Number(repo[1])) ||
      !validResourceRef(ref) || !SHA40.test(baseSha) || !validDocumentPath(path))
    return null;
  return {
    type: "document", principalKey, workspaceId, sessionId,
    repositoryKey: repositoryKey as RepositoryKey, ref, baseSha, path,
  };
}
