import { discoverProfiles, PROFILE_MOVIES, randomMovieCount, randomSample, resolveMovie, seedAroundActivities, writeList } from "./my-list-demo.mjs";

const profiles = await discoverProfiles();
console.log("Seeding PolTV My Lists with real TMDB metadata (4–10 movies per profile)...\n");

let total = 0;
const resolvedByTitle = new Map();
const seededLists = [];
for (const [index, profile] of profiles.entries()) {
  const pool = PROFILE_MOVIES[index % PROFILE_MOVIES.length];
  const titles = randomSample(pool, randomMovieCount());
  const items = [];
  for (const title of titles) {
    let item = resolvedByTitle.get(title);
    if (!item) {
      item = await resolveMovie(title);
      resolvedByTitle.set(title, item);
    }
    items.push(item);
  }
  seededLists.push({ profile, items });
  total += items.length;
}

for (const { profile, items } of seededLists) {
  await writeList(profile.id, items);
  console.log(`${profile.name}: ${items.length} movies saved`);
}

const activityCount = await seedAroundActivities(seededLists);
console.log(`\nSeeded ${total} real movies across ${profiles.length} profiles.`);
console.log(`Synchronized ${activityCount} Around PolTV demo activities.`);
