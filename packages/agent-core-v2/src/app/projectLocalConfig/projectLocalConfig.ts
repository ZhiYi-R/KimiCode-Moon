/**
 * `projectLocalConfig` domain — project-local config access.
 *
 * Defines the App-scoped `IProjectLocalConfigService` contract for
 * project-local `.kimi-code/local.toml` access. The service works purely by
 * path: it discovers the project root (the nearest `.git` ancestor) from a
 * working directory and reads/writes the project-local TOML there — it never
 * touches the workspace catalog or a `workspaceId`.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export interface ProjectAdditionalDirsLoadResult {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly additionalDirs: readonly string[];
}

export interface IProjectLocalConfigService {
  readonly _serviceBrand: undefined;

  readAdditionalDirs(workDir: string): Promise<ProjectAdditionalDirsLoadResult>;
  resolveAdditionalDirs(baseDir: string, additionalDirs: readonly string[]): Promise<string[]>;
  appendAdditionalDir(
    workDir: string,
    inputPath: string,
  ): Promise<ProjectAdditionalDirsLoadResult>;
  /**
   * Remove a resolved directory from the project-local `additional_dir` list.
   * `dir` is matched against the resolved on-disk entries (the file stores
   * resolved paths, same as `appendAdditionalDir` writes). Returns the
   * current on-disk state; a non-matching `dir` is a no-op.
   */
  removeAdditionalDir(workDir: string, dir: string): Promise<ProjectAdditionalDirsLoadResult>;
}

export const IProjectLocalConfigService: ServiceIdentifier<IProjectLocalConfigService> =
  createDecorator<IProjectLocalConfigService>('projectLocalConfigService');
