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

export async function downloadTrackAudio(
  streamUrl: string,
  trackUrl: string,
  format: string = 'm4a',
): Promise<string> {
  await ensureDownloadsDir();
  const destPath = `${downloadsDir()}/${localFileNameFor(trackUrl, format)}`;

  const alreadyExists = await ReactNativeBlobUtil.fs.exists(destPath);
  if (alreadyExists) {
    return destPath;
  }

  const res = await ReactNativeBlobUtil.config({
    path: destPath,
  }).fetch('GET', streamUrl);

  return res.path();
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