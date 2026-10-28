import { modeForName, type ProjectFile } from '../projectFiles';

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface CloudFileRow {
  id: string;
  path: string;
  content: string;
  mode: string;
  version: number;
  updated_at: string;
}

export interface CloudFileInsert {
  project_id: string;
  path: string;
  content: string;
  mode: string;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function projectFileToRow(file: ProjectFile, projectId: string): CloudFileInsert {
  return {
    project_id: projectId,
    path: file.name,
    content: file.content,
    mode: file.mode,
  };
}

export function rowToProjectFile(row: CloudFileRow): ProjectFile {
  return {
    id: row.id,
    name: row.path,
    mode: modeForName(row.path),
    content: row.content,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  };
}

export function assertTextSize(name: string, content: string): void {
  if (utf8Bytes(content) > MAX_TEXT_BYTES) {
    throw new Error(`${name} is larger than 2 MB. Split it before syncing.`);
  }
}
