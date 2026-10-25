export const MAX_SELECTED_CLUBS = 5;

export function toggleClubSelection(current: string[], club: string): string[] {
  if (current.includes(club)) return current.filter(value => value !== club);
  if (current.length >= MAX_SELECTED_CLUBS) return current;
  return [...current, club];
}
