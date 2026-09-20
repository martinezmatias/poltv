import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PROFILES_FILE = path.join(ROOT, "config", "profiles.ts");
const USERS_DIR = path.join(ROOT, "data", "users");
const AROUND_FILE = path.join(ROOT, "data", "around-poltv.json");
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function loadLocalEnv() {
  try {
    const contents = readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function discoverProfiles() {
  const source = await readFile(PROFILES_FILE, "utf8");
  const profiles = [...source.matchAll(/\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g)]
    .map((match) => ({ id: match[1], name: match[2] }));
  if (!profiles.length) throw new Error(`No profiles found in ${path.relative(ROOT, PROFILES_FILE)}.`);
  return profiles;
}

function tmdbToken() {
  loadLocalEnv();
  const token = process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) throw new Error("TMDB_API_KEY (or TMDB_READ_ACCESS_TOKEN) is required to seed real movie metadata.");
  return token;
}

async function tmdbRequest(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${tmdbToken()}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`TMDB request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`TMDB request failed with HTTP ${response.status}. Check TMDB_API_KEY.`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("TMDB returned invalid JSON.");
  return payload;
}

function yearFromDate(value) {
  return typeof value === "string" && /^\d{4}/.test(value) ? Number(value.slice(0, 4)) : null;
}

function imageUrl(pathname, size) {
  return typeof pathname === "string" && pathname
    ? `https://image.tmdb.org/t/p/${size}${pathname}`
    : null;
}

export async function resolveMovie(title) {
  const payload = await tmdbRequest("/search/movie", { query: title, include_adult: false, language: "en-US" });
  const results = Array.isArray(payload.results) ? payload.results : [];
  const normalized = title.toLocaleLowerCase();
  const match = results.find((item) => String(item.title ?? "").toLocaleLowerCase() === normalized) ?? results[0];
  if (!match?.id) throw new Error(`TMDB could not resolve movie “${title}”.`);

  const details = await tmdbRequest(`/movie/${match.id}`, { language: "en-US" });
  if (!details.id || typeof details.title !== "string") throw new Error(`TMDB returned incomplete metadata for “${title}”.`);
  return {
    tmdb_id: details.id,
    media_type: "movie",
    title: details.title,
    year: yearFromDate(details.release_date),
    genres: Array.isArray(details.genres) ? details.genres.map((genre) => String(genre.name)).slice(0, 8) : [],
    overview: String(details.overview ?? "").trim(),
    poster_path: typeof details.poster_path === "string" ? details.poster_path : null,
    backdrop_path: typeof details.backdrop_path === "string" ? details.backdrop_path : null,
    poster_url: imageUrl(details.poster_path, "w500"),
    backdrop_url: imageUrl(details.backdrop_path, "w780"),
  };
}

export async function writeList(profileId, items) {
  await mkdir(USERS_DIR, { recursive: true });
  const target = path.join(USERS_DIR, `${profileId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function seedAroundActivities(seededLists) {
  let existing = [];
  try {
    const parsed = JSON.parse(await readFile(AROUND_FILE, "utf8"));
    existing = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const summaries = [
    "action, crime and high-speed thrills",
    "a classic with unforgettable characters",
    "a warm family adventure",
    "science-fiction and imaginative adventure",
  ];
  const seeded = seededLists.map(({ profile, items }, index) => {
    const item = items[0];
    return {
      event_id: `demo:${profile.id}:${item.media_type}:${item.tmdb_id}`,
      user_id: profile.id,
      user_name: profile.name,
      query_summary: summaries[index % summaries.length],
      tmdb_id: item.tmdb_id,
      media_type: item.media_type,
      title: item.title,
      year: item.year,
      poster_url: item.poster_url,
      timestamp: new Date().toISOString(),
    };
  });
  const seededIds = new Set(seeded.map((event) => event.event_id));
  const withoutOldDemo = existing.filter((event) => !String(event?.event_id ?? "").startsWith("demo:") || seededIds.has(event.event_id));
  const byTitle = new Map(withoutOldDemo.map((event) => [`${event.user_id}:${event.media_type}:${event.tmdb_id}`, event]));
  for (const event of seeded) byTitle.set(`${event.user_id}:${event.media_type}:${event.tmdb_id}`, event);
  await mkdir(path.dirname(AROUND_FILE), { recursive: true });
  await writeFile(AROUND_FILE, `${JSON.stringify([...byTitle.values()].slice(-20), null, 2)}\n`, "utf8");
  return seeded.length;
}

export const PROFILE_MOVIES = [
  ["Terminator 2: Judgment Day", "Heat", "Speed", "Mad Max: Fury Road", "Casino Royale", "The Departed", "Die Hard", "Mission: Impossible - Fallout", "John Wick", "The French Connection"],
  ["Casablanca", "The Apartment", "Roman Holiday", "Singin' in the Rain", "Some Like It Hot", "Rear Window", "12 Angry Men", "The Godfather", "Citizen Kane", "North by Northwest"],
  ["Toy Story", "Finding Nemo", "Cars", "Ratatouille", "The Incredibles", "Paddington", "How to Train Your Dragon", "WALL-E", "Coco", "Up"],
  ["Back to the Future", "Jurassic Park", "The Lord of the Rings: The Fellowship of the Ring", "Spider-Man: Into the Spider-Verse", "The Matrix", "E.T. the Extra-Terrestrial", "The Princess Bride", "Raiders of the Lost Ark", "The Goonies", "Avatar"],
];

export function randomMovieCount() {
  return randomInt(4, 11);
}

export function randomSample(items, count) {
  const remaining = [...items];
  const selected = [];
  while (selected.length < count) {
    selected.push(remaining.splice(randomInt(0, remaining.length), 1)[0]);
  }
  return selected;
}
