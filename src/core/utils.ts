import crypto from 'crypto';
import stringify from 'fast-json-stable-stringify';
import { StepParams } from './db/types';
import fs from 'fs/promises';
import path from 'path';

export function hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function stableStringify(obj: object): string {
  return stringify(obj);
}

export const getDerivationCacheKey = (
  stepParams: StepParams,
  inputContentHashes: string[]
): string => {
  // FIXME cast
  // inputs is omitted from operationSlice for cache key calculation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { inputs, ...operationSlice } = stepParams as Record<string, unknown>;
  const operationSliceString = stableStringify(operationSlice);
  const keyMaterial = `${operationSliceString}|${inputContentHashes.join(',')}`;
  return hash(keyMaterial);
};

export const readFileSafe = async (
  filePath: string
): Promise<{ success: true; file: string } | { success: false }> => {
  try {
    return { success: true, file: await fs.readFile(filePath, 'utf-8') };
  } catch {
    return { success: false };
  }
};

export const isDirectorySafe = async (
  filePath: string
): Promise<'isDir' | 'notDir' | 'missing'> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory() ? 'isDir' : 'notDir';
  } catch {
    return 'missing';
  }
};

export async function getAllFilesRecursive(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getAllFilesRecursive(res) : res;
    })
  );
  return Array.prototype.concat(...files);
}

class WriteMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const writeMutex = new WriteMutex();

export async function writeConfigFileAtomic(filePath: string, data: unknown): Promise<void> {
  await writeMutex.acquire();

  try {
    const jsonContent = JSON.stringify(data, null, 2);

    const tempPath = `${filePath}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, jsonContent, 'utf-8');
    await fs.rename(tempPath, filePath);
  } finally {
    writeMutex.release();
  }
}
