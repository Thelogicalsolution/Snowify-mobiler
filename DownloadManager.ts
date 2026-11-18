import ReactNativeBlobUtil from 'react-native-blob-util';

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function localFileNameFor(trackUrl: string, format: string): string {
  return `snowify_${hashString(trackUrl)}.${format}`;
}

function downloadsDir(): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/downloads`;
}

async function ensureDownloadsDir(): Promise<void> {
  const dir = downloadsDir();
  const exists = await ReactNativeBlobUtil.fs.isDir(dir);
  if (!exists) {
    await ReactNativeBlobUtil.fs.mkdir(dir);
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      await ReactNativeBlobUtil.fs.unlink(path);
    }
  } catch {
    // ignore - nothing to clean up
  }
}

export async function downloadTrackAudio(
  streamUrl: string,
  trackUrl: string,
  format: string = 'm4a',
): Promise<string> {
  await ensureDownloadsDir();
  const destPath = `${downloadsDir()}/${localFileNameFor(trackUrl, format)}`;
  const partPath = `${destPath}.part`;

  // The caller only gets here for songs it has no saved record of, so a file
  // already at the final name is a leftover from an interrupted download and
  // may be cut off. Start clean instead of trusting it.
  await removeIfExists(destPath);
  await removeIfExists(partPath);

  try {
    const res = await ReactNativeBlobUtil.config({ path: partPath }).fetch('GET', streamUrl);
    const info: any = res.info();
    if (info.status < 200 || info.status >= 300) {
      throw new Error('Download failed (HTTP ' + info.status + ')');
    }
    const stat: any = await ReactNativeBlobUtil.fs.stat(partPath);
    const size = Number(stat.size);
    if (!(size > 0)) {
      throw new Error('Downloaded file is empty');
    }
    const headers: Record<string, string> = info.headers || {};
    let expected = 0;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-length') {
        expected = Number(headers[key]) || 0;
      }
    }
    if (expected > 0 && size < expected) {
      throw new Error('Download incomplete');
    }
    // Only a complete file ever gets the real name.
    await ReactNativeBlobUtil.fs.mv(partPath, destPath);
    return destPath;
  } catch (e) {
    await removeIfExists(partPath);
    throw e;
  }
}

export async function deleteDownloadedFile(localPath: string): Promise<void> {
  try {
    const exists = await ReactNativeBlobUtil.fs.exists(localPath);
    if (exists) {
      await ReactNativeBlobUtil.fs.unlink(localPath);
    }
  } catch {
    // ignore - file may already be gone
  }
}