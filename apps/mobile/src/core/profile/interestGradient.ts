const palette = [
  { colors: ['#E8DCFF', '#BBA4E5'], color: '#302142' },
  { colors: ['#D4F4E4', '#95CFB5'], color: '#193C2D' },
  { colors: ['#FFE6C8', '#EBB885'], color: '#49321E' },
  { colors: ['#D6EEFF', '#99C7E4'], color: '#203C4B' },
  { colors: ['#FFE0EB', '#DFA6BE'], color: '#482A37' },
] as const;

/** Use the displayed label so saved IDs and Preview labels get the same color. */
export function profileInterestGradient(label: string) {
  const hash = Array.from(label.toLowerCase()).reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return palette[hash % palette.length];
}
