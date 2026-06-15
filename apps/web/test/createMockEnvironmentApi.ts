import type { EnvironmentApi } from "@t3tools/contracts";
import { vi } from "vite-plus/test";

type EnvironmentApiOverrides = {
  readonly [K in keyof EnvironmentApi]?: Partial<EnvironmentApi[K]>;
};

function rejectedMethod<T>(name: string): T {
  return vi.fn(async () => {
    throw new Error(`Mock EnvironmentApi method was not configured: ${name}`);
  }) as unknown as T;
}

function throwingMethod<T>(name: string): T {
  return vi.fn(() => {
    throw new Error(`Mock EnvironmentApi method was not configured: ${name}`);
  }) as unknown as T;
}

export function createMockEnvironmentApi(overrides: EnvironmentApiOverrides = {}): EnvironmentApi {
  return {
    terminal: {
      open: rejectedMethod("terminal.open"),
      attach: throwingMethod("terminal.attach"),
      write: rejectedMethod("terminal.write"),
      resize: rejectedMethod("terminal.resize"),
      clear: rejectedMethod("terminal.clear"),
      restart: rejectedMethod("terminal.restart"),
      close: rejectedMethod("terminal.close"),
      onMetadata: throwingMethod("terminal.onMetadata"),
      ...overrides.terminal,
    },
    projects: {
      searchEntries: rejectedMethod("projects.searchEntries"),
      writeFile: rejectedMethod("projects.writeFile"),
      ...overrides.projects,
    },
    filesystem: {
      browse: rejectedMethod("filesystem.browse"),
      ...overrides.filesystem,
    },
    assets: {
      createUrl: vi.fn(async ({ resource }) => ({
        relativeUrl: `/api/assets/test/${encodeURIComponent(
          resource._tag === "attachment"
            ? resource.attachmentId
            : resource._tag === "project-favicon"
              ? "favicon.svg"
              : (resource.path.split(/[\\/]/).at(-1) ?? "asset"),
        )}`,
        expiresAt: Date.now() + 60_000,
      })),
      ...overrides.assets,
    },
    sourceControl: {
      lookupRepository: rejectedMethod("sourceControl.lookupRepository"),
      cloneRepository: rejectedMethod("sourceControl.cloneRepository"),
      publishRepository: rejectedMethod("sourceControl.publishRepository"),
      ...overrides.sourceControl,
    },
    vcs: {
      listRefs: rejectedMethod("vcs.listRefs"),
      createWorktree: rejectedMethod("vcs.createWorktree"),
      removeWorktree: rejectedMethod("vcs.removeWorktree"),
      createRef: rejectedMethod("vcs.createRef"),
      switchRef: rejectedMethod("vcs.switchRef"),
      init: rejectedMethod("vcs.init"),
      pull: rejectedMethod("vcs.pull"),
      refreshStatus: rejectedMethod("vcs.refreshStatus"),
      onStatus: throwingMethod("vcs.onStatus"),
      ...overrides.vcs,
    },
    git: {
      resolvePullRequest: rejectedMethod("git.resolvePullRequest"),
      preparePullRequestThread: rejectedMethod("git.preparePullRequestThread"),
      ...overrides.git,
    },
    review: {
      getDiffPreview: rejectedMethod("review.getDiffPreview"),
      ...overrides.review,
    },
    orchestration: {
      dispatchCommand: rejectedMethod("orchestration.dispatchCommand"),
      getTurnDiff: rejectedMethod("orchestration.getTurnDiff"),
      getFullThreadDiff: rejectedMethod("orchestration.getFullThreadDiff"),
      getArchivedShellSnapshot: rejectedMethod("orchestration.getArchivedShellSnapshot"),
      subscribeShell: throwingMethod("orchestration.subscribeShell"),
      subscribeThread: throwingMethod("orchestration.subscribeThread"),
      ...overrides.orchestration,
    },
    preview: {
      open: rejectedMethod("preview.open"),
      navigate: rejectedMethod("preview.navigate"),
      refresh: rejectedMethod("preview.refresh"),
      close: rejectedMethod("preview.close"),
      list: vi.fn(async () => ({ sessions: [] })),
      reportStatus: rejectedMethod("preview.reportStatus"),
      automation: {
        connect: throwingMethod("preview.automation.connect"),
        respond: rejectedMethod("preview.automation.respond"),
        reportOwner: rejectedMethod("preview.automation.reportOwner"),
        clearOwner: rejectedMethod("preview.automation.clearOwner"),
        ...overrides.preview?.automation,
      },
      onEvent: throwingMethod("preview.onEvent"),
      subscribePorts: throwingMethod("preview.subscribePorts"),
      ...overrides.preview,
    },
  };
}
