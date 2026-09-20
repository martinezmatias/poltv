import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GENERATED_VIDEO_DIR = path.join(process.cwd(), "resources", "generated-videos");

function extensionFor(contentType: string, sourceUrl: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("mpeg")) return "mpeg";
  const sourceExtension = path.extname(new URL(sourceUrl).pathname).replace(".", "");
  return sourceExtension || "mp4";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string; actionId?: string; backend?: string };
    if (!body.url) {
      return NextResponse.json({ error: "A video URL is required." }, { status: 400 });
    }

    const sourceUrl = new URL(body.url);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
      return NextResponse.json({ error: "Only HTTP(S) video URLs can be saved." }, { status: 400 });
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return NextResponse.json({ error: `Video download failed (${response.status}).` }, { status: 502 });
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 512 * 1024 * 1024) {
      return NextResponse.json({ error: "Video is larger than the 512 MB local-save limit." }, { status: 413 });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const safeActionId = (body.actionId ?? "manual").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const backend = (body.backend ?? "video").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
    const extension = extensionFor(response.headers.get("content-type") ?? "", body.url);
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${backend}-${safeActionId}.${extension}`;

    await mkdir(GENERATED_VIDEO_DIR, { recursive: true });
    const filePath = path.join(GENERATED_VIDEO_DIR, filename);
    await writeFile(filePath, bytes);

    return NextResponse.json({
      saved: true,
      filename,
      path: path.relative(process.cwd(), filePath),
      bytes: bytes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
