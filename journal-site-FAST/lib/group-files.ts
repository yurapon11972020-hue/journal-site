import path from 'node:path';

export function filenameToGroupName(fileName: string): string {
  return fileName.replace(/\.(xlsx|xlsm|xls)$/i, '').trim();
}

export function groupPathToId(filePath: string): string {
  return Buffer.from(filePath, 'utf8').toString('base64url');
}

export function idToGroupPath(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

export function basenameFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/^disk:/, '');
  return path.posix.basename(normalized) || path.basename(filePath);
}
