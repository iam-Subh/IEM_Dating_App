/**
 * Face calibration (PHOTO_VERIFICATION_PLAN.md 8): where should the match line be?
 *
 * Put photos of volunteers (with their consent) in a folder, one sub-folder
 * per person:
 *
 *   faces/
 *     riya/   selfie.jpg  insta1.jpg  group.jpg
 *     ankit/  selfie.jpg  profile.jpg
 *     ...
 *
 *   npm run face:calibrate -- --dir=C:/path/to/faces
 *
 * It sends each photo to the face service (FACE_SERVICE_URL), then compares
 * every pair: same person ("genuine") and different people ("impostor"). For
 * each distance from 0.40 to 0.65 it prints how many genuine pairs would be
 * wrongly refused and how many impostors wrongly accepted. Pick the line where
 * impostors accepted is ~0 and genuine refusals are few; set
 * FACE_MATCH_DISTANCE and FACE_UNSURE_DISTANCE, and note the table in the plan.
 *
 * Nothing is stored; photos never leave this machine and the face service.
 */
import fs from 'fs';
import path from 'path';

const dir = process.argv.find((arg) => arg.startsWith('--dir='))?.split('=')[1];
const service = (process.env.FACE_SERVICE_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: npm run face:calibrate -- --dir=<folder with one sub-folder per person>');
  process.exit(1);
}

type Sample = { person: string; file: string; descriptor: number[] };

const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));

async function descriptorsOf(files: string[]): Promise<(number[] | null)[]> {
  const response = await fetch(`${service}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: files.map((file) => fs.readFileSync(file).toString('base64')) }),
  });
  if (!response.ok) throw new Error(`Face service: ${response.status} ${await response.text()}`);
  const body = await response.json() as { images: { faces: { descriptor: number[] }[] }[] };
  // Only photos with exactly one face are fair samples.
  return body.images.map((image) => (image.faces.length === 1 ? image.faces[0].descriptor : null));
}

(async () => {
  const samples: Sample[] = [];
  const skipped: string[] = [];
  for (const person of fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory())) {
    const files = fs.readdirSync(path.join(dir, person)).filter((name) => /\.(jpe?g|png)$/i.test(name)).map((name) => path.join(dir, person, name));
    for (let start = 0; start < files.length; start += 20) {
      const batch = files.slice(start, start + 20);
      const descriptors = await descriptorsOf(batch);
      batch.forEach((file, index) => {
        const descriptor = descriptors[index];
        if (descriptor) samples.push({ person, file, descriptor });
        else skipped.push(path.relative(dir, file));
      });
    }
  }
  const people = new Set(samples.map((sample) => sample.person));
  const genuine: number[] = [];
  const impostor: number[] = [];
  for (let a = 0; a < samples.length; a++) {
    for (let b = a + 1; b < samples.length; b++) {
      (samples[a].person === samples[b].person ? genuine : impostor).push(distance(samples[a].descriptor, samples[b].descriptor));
    }
  }
  console.log(`${people.size} people, ${samples.length} usable photos (${skipped.length} skipped: not exactly one face)`);
  console.log(`${genuine.length} same-person pairs, ${impostor.length} different-person pairs\n`);
  console.log('Line   Genuine refused   Impostors accepted');
  for (let line = 0.4; line <= 0.651; line += 0.025) {
    const refused = genuine.filter((value) => value > line).length;
    const accepted = impostor.filter((value) => value <= line).length;
    const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '-');
    console.log(`${line.toFixed(3)}  ${`${refused} (${pct(refused, genuine.length)})`.padEnd(17)} ${accepted} (${pct(accepted, impostor.length)})`);
  }
  const sortedImpostor = [...impostor].sort((a, b) => a - b);
  if (sortedImpostor.length) console.log(`\nClosest different-person pair: ${sortedImpostor[0].toFixed(3)} - keep the match line below this.`);
  if (genuine.length) console.log(`Furthest same-person pair: ${Math.max(...genuine).toFixed(3)}`);
  if (skipped.length) console.log(`\nSkipped: ${skipped.join(', ')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
