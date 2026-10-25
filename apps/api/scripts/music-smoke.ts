/**
 * Manual smoke check of the live music sources behind Story music.
 *
 * The JioSaavn API is unofficial and can change shape without notice; this
 * prints what the provider and LRCLIB return today so a change is caught
 * before users see it. It calls the real services and writes the results to
 * the music cache tables, like the app would. Run: npm run music:smoke
 */
import 'dotenv/config';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { MusicService } from '../src/services/music.service';

async function main() {
  const trending = await MusicService.trending();
  console.log(`trending: ${trending.tracks.length} songs, first: ${trending.tracks[0]?.title} by ${trending.tracks[0]?.artists}`);

  const search = await MusicService.search('tum hi ho', 1);
  const song = search.tracks[0];
  console.log(`search: ${search.tracks.length} songs, hasMore=${search.hasMore}, first: ${song?.title} (${song?.id}) ${song?.durationMs} ms`);
  if (!song) throw new Error('Search returned no songs');
  console.log(`streams: preview=${Boolean(song.streams.preview)} standard=${Boolean(song.streams.standard)} artwork=${Boolean(song.artwork.large)}`);

  const stream = await fetch(song.streams.preview!, { headers: { Range: 'bytes=0-1023' } });
  console.log(`stream: HTTP ${stream.status} ${stream.headers.get('content-type')} ranges=${stream.headers.get('accept-ranges') ?? stream.headers.get('content-range')}`);

  const lyrics = await MusicService.lyrics(song.id);
  console.log(`lyrics: ${lyrics.status}, ${lyrics.lines.length} timed lines, first: "${lyrics.lines.find((line) => line.text)?.text}"`);
}

main()
  .catch((error) => {
    console.error('music smoke failed:', error?.code ?? '', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redisClient.quit().catch(() => undefined);
  });
