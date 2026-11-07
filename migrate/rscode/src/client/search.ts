export function matchesSubsequence(query: string, target: string): boolean {
  const text = target.toLowerCase();
  let index = 0;
  for (const ch of query.toLowerCase()) {
    const found = text.indexOf(ch, index);
    if (found === -1) return false;
    index = found + 1;
  }
  return true;
}
