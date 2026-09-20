import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { VIEWER_PROFILES } from "../../../config/profiles";

type SavedRecommendation = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: number | null;
  genres: string[];
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
};

const DATA_DIR = path.join(process.cwd(), "data", "users");
const locks = new Map<string, Promise<unknown>>();

function isValidProfile(profileId: string) {
  return VIEWER_PROFILES.some((profile) => profile.id === profileId);
}

function fileFor(profileId: string) {
  return path.join(DATA_DIR, `${profileId}.json`);
}

async function readList(profileId: string): Promise<SavedRecommendation[]> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const content = await readFile(fileFor(profileId), "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(fileFor(profileId), "[]\n", "utf8");
    return [];
  }
}

async function writeList(profileId: string, items: SavedRecommendation[]) {
  const target = fileFor(profileId);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function withProfileLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(profileId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(profileId, current);
  void current.then(() => {
    if (locks.get(profileId) === current) locks.delete(profileId);
  }, () => {
    if (locks.get(profileId) === current) locks.delete(profileId);
  });
  return current;
}

function validateItem(value: unknown): SavedRecommendation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SavedRecommendation>;
  if (typeof item.tmdb_id !== "number" || (item.media_type !== "movie" && item.media_type !== "tv") || typeof item.title !== "string") {
    return null;
  }
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    year: item.year ?? null,
    genres: item.genres ?? [],
    overview: item.overview ?? "",
    poster_path: item.poster_path ?? null,
    backdrop_path: item.backdrop_path ?? null,
    poster_url: item.poster_url ?? null,
    backdrop_url: item.backdrop_url ?? null,
  };
}

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") ?? "";
  if (!isValidProfile(profileId)) return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
  return NextResponse.json({ items: await readList(profileId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { profileId?: string; item?: unknown };
    if (!body.profileId || !isValidProfile(body.profileId)) return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
    const item = validateItem(body.item);
    if (!item) return NextResponse.json({ error: "Invalid recommendation." }, { status: 400 });
    const items = await withProfileLock(body.profileId, async () => {
      const current = await readList(body.profileId!);
      if (!current.some((saved) => saved.tmdb_id === item.tmdb_id && saved.media_type === item.media_type)) {
        current.push(item);
        await writeList(body.profileId!, current);
      }
      return current;
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save recommendation." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { profileId?: string; tmdb_id?: number; media_type?: "movie" | "tv" };
    if (!body.profileId || !isValidProfile(body.profileId)) return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
    const items = await withProfileLock(body.profileId, async () => {
      const current = await readList(body.profileId!);
      const next = current.filter((item) => item.tmdb_id !== body.tmdb_id || item.media_type !== body.media_type);
      if (next.length !== current.length) await writeList(body.profileId!, next);
      return next;
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove recommendation." }, { status: 500 });
  }
}
