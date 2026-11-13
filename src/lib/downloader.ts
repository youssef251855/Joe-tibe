// حفظ الملف: في تطبيق Android ينزل مباشرة من يوتيوب/المنصة إلى الجهاز، وفي المتصفح يبقى السلوك القديم.
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { resolveCached } from "../native/api";
import { extractVideoId } from "../native/youtube";

export const isNativeApp = () => Capacitor.isNativePlatform();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function cleanName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "JoeTube";
}

function extFromMime(mime: string | undefined, fallback: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "audio/mp4" || m === "audio/m4a") return "m4a";
  if (m === "audio/webm" || m === "video/webm") return "webm";
  if (m === "audio/mpeg") return "mp3";
  if (m.startsWith("video/")) return "mp4";
  return fallback;
}

function browserDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** يعيد وصفًا لمكان الحفظ (في التطبيق) أو undefined (في المتصفح). */
export async function saveFile(downloadUrl: string, fileName: string, onProgress?: (percent: number) => void): Promise<string | undefined> {
  if (!isNativeApp()) {
    browserDownload(downloadUrl, fileName);
    return undefined;
  }

  const u = new URL(downloadUrl, window.location.href);
  let remote = u.href;
  let headers: Record<string, string> = { "User-Agent": UA };
  let mime: string | undefined;

  if (u.pathname === "/api/stream") {
    const idOrUrl = u.searchParams.get("id") || u.searchParams.get("url") || "";
    const format = (u.searchParams.get("format") || "m4a").toLowerCase();
    if (/^https?:\/\//i.test(idOrUrl)) {
      // تيك توك / فيسبوك / إنستغرام / X
      remote = idOrUrl;
      headers = { "User-Agent": UA, Referer: `${new URL(idOrUrl).origin}/` };
    } else {
      const videoId = extractVideoId(idOrUrl) || idOrUrl;
      const r = await resolveCached(videoId, format);
      remote = r.url;
      mime = r.mimeType;
      // يوتيوب يخنق الطلبات بلا Range، لذلك نطلب النطاق كاملًا صراحةً.
      headers = { "User-Agent": UA, Accept: "*/*", Range: "bytes=0-" };
    }
  }

  const dot = fileName.lastIndexOf(".");
  const base = cleanName(dot > 0 ? fileName.slice(0, dot) : fileName);
  const ext = extFromMime(mime, dot > 0 ? fileName.slice(dot + 1) : "mp4");
  const relPath = `JoeTube/${base}.${ext}`;

  const handle = onProgress
    ? await Filesystem.addListener("progress", (e: any) => {
        if (e?.contentLength > 0) onProgress(Math.min(100, Math.round((e.bytes / e.contentLength) * 100)));
      })
    : null;

  try {
    await Filesystem.requestPermissions().catch(() => undefined);
    const attempt = async (directory: Directory) =>
      Filesystem.downloadFile({ url: remote, path: relPath, directory, headers, recursive: true, progress: !!onProgress });

    try {
      await attempt(Directory.Documents);
      return `Documents/${relPath}`;
    } catch {
      // بعض إصدارات أندرويد ترفض الكتابة في Documents؛ نحفظ في مجلد التطبيق كخيار أخير.
      await attempt(Directory.External);
      return `Android/data/<التطبيق>/files/${relPath}`;
    }
  } finally {
    await handle?.remove();
  }
}
