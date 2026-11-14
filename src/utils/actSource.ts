// Who publishes the copy of an Act a link points to, for the link's label.
export function actSourceName(url?: string | null): string {
  let host = '';
  try {
    host = new URL(url || '').hostname.toLowerCase();
  } catch {
    return 'Official copy';
  }
  if (host.endsWith('kenyalaw.org')) return 'Kenya Law';
  if (host.endsWith('parliament.go.ke')) return 'Parliament';
  if (host.endsWith('nairobiassembly.go.ke')) return 'Nairobi City County Assembly';
  if (host.endsWith('transnzoiaassembly.go.ke')) return 'Trans Nzoia County Assembly';
  return 'Official copy';
}
