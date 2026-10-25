// The shared email proves membership in the Kolkata group, not its college.
export function canChooseSharedCollege(email: string | undefined, from: string | undefined, to: string) {
  const colleges = ['IEM-KOLKATA', 'UEM-KOLKATA'];
  return !!email?.toLowerCase().endsWith('@iem.edu.in')
    && !!from && colleges.includes(from) && colleges.includes(to);
}
