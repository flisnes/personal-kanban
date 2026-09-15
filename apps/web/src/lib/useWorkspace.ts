import { GitHubClient, type Workspace } from '@kanban/core';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Credentials } from './credentials.js';

export interface LoadedWorkspace {
  workspace: Workspace;
  sha: string;
}

export function useClient(credentials: Credentials): GitHubClient {
  return useMemo(
    () => new GitHubClient(credentials),
    [credentials.owner, credentials.repo, credentials.token],
  );
}

export function useWorkspace(client: GitHubClient): UseQueryResult<LoadedWorkspace> {
  return useQuery({
    queryKey: ['workspace'],
    queryFn: () => client.loadWorkspace(),
    // The board is one request; refetching when the tab regains focus keeps it current enough
    // without polling. Cheap freshness checks land with the write path.
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
  });
}
