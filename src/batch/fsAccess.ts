import { baseName, isNative, joinPath, listDir, makeDir, pickFolder, readFile, writeFile } from '../platform/native'

/**
 * A folder of photos: the export folder, a batch's input and output. In the
 * desktop app it is a path on disk, read and written directly; in a browser
 * it is a File System Access handle, which the browser lets the page keep
 * but asks permission for again after a restart (Chrome and Edge only).
 */
export interface Folder {
  name: string
  /** A path in the app; absent in a browser, which keeps the handle instead. */
  path?: string
  /** The browser's handle, for keeping in IndexedDB. */
  handle?: FileSystemDirectoryHandle
  /** Whether it can be read now, without asking. */
  canRead(): Promise<boolean>
  /** Ask for access (browser: only works in answer to a click). */
  requestAccess(mode: 'read' | 'readwrite'): Promise<boolean>
  /** A file in it by name, or null. */
  file(name: string): Promise<File | null>
  /** Its files whose names pass `accept`, by name. */
  files(accept: (name: string) => boolean): Promise<FolderFile[]>
  write(name: string, blob: Blob): Promise<void>
  /** A folder inside it; made if `create`, else null when absent. */
  folder(name: string, create: boolean): Promise<Folder | null>
  isSame(other: Folder): Promise<boolean>
}

export interface FolderFile {
  name: string
  getFile(): Promise<File>
}

export function supportsFolders(): boolean {
  return isNative() || typeof (window as any).showDirectoryPicker === 'function'
}

/** Ask the user for a folder; throws if they cancel. */
export async function pickDirectory(mode: 'read' | 'readwrite', id: string): Promise<Folder> {
  if (isNative()) {
    const path = await pickFolder(mode === 'read' ? 'Choose a folder of photos' : 'Choose a folder to save into')
    if (!path) throw new Error('cancelled')
    return nativeFolder(path)
  }
  return browserFolder(await (window as any).showDirectoryPicker({ mode, id, startIn: 'pictures' }))
}

export async function ensureWritePermission(folder: Folder): Promise<boolean> {
  return folder.requestAccess('readwrite')
}

export async function listImageFiles(folder: Folder, accept: (name: string) => boolean): Promise<FolderFile[]> {
  return folder.files(accept)
}

export function nativeFolder(path: string): Folder {
  const fileAt = async (name: string) => {
    const bytes = await readFile(joinPath(path, name))
    return bytes ? new File([bytes], name) : null
  }
  return {
    name: baseName(path),
    path,
    canRead: async () => true,
    requestAccess: async () => true,
    file: fileAt,
    files: async (accept) =>
      (await listDir(path))
        .filter((e) => e.isFile && accept(e.name))
        .map((e) => ({
          name: e.name,
          getFile: async () => {
            const f = await fileAt(e.name)
            if (!f) throw new Error(`${e.name} could not be read`)
            return f
          },
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    write: (name, blob) => writeFile(joinPath(path, name), blob),
    folder: async (name, create) => {
      const inner = joinPath(path, name)
      if (create) await makeDir(inner)
      else if (!(await listDir(path)).some((e) => !e.isFile && e.name === name)) return null
      return nativeFolder(inner)
    },
    isSame: async (other) => other.path === path,
  }
}

type Permissioned = {
  queryPermission?: (o: object) => Promise<string>
  requestPermission?: (o: object) => Promise<string>
}

export function browserFolder(handle: FileSystemDirectoryHandle): Folder {
  const h = handle as unknown as Permissioned & FileSystemDirectoryHandle
  return {
    name: handle.name,
    handle,
    canRead: async () => ((await h.queryPermission?.({ mode: 'read' })) ?? 'granted') === 'granted',
    requestAccess: async (mode) => {
      if ((await h.queryPermission?.({ mode })) === 'granted') return true
      try {
        return (await h.requestPermission?.({ mode })) === 'granted'
      } catch {
        return false
      }
    },
    file: async (name) => {
      try {
        return await (await handle.getFileHandle(name)).getFile()
      } catch {
        return null
      }
    },
    files: async (accept) => {
      const out: FolderFile[] = []
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'file' && accept(entry.name)) {
          const fh = entry as FileSystemFileHandle
          out.push({ name: fh.name, getFile: () => fh.getFile() })
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },
    write: async (name, blob) => {
      const fh = await handle.getFileHandle(name, { create: true })
      const writable = await (fh as any).createWritable()
      await writable.write(blob)
      await writable.close()
    },
    folder: async (name, create) => {
      try {
        return browserFolder(await handle.getDirectoryHandle(name, { create }))
      } catch {
        return null
      }
    },
    isSame: async (other) => (other.handle ? !!(await (handle as any).isSameEntry?.(other.handle)) : false),
  }
}
