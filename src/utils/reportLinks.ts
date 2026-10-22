const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function reportDocumentHref(report: { id: string; source_url?: string; source_document_ref?: string }): string | undefined {
  if (isHttpUrl(report.source_url)) return report.source_url;
  if (isHttpUrl(report.source_document_ref)) return report.source_document_ref;
  if (!API_BASE) return undefined;
  return `${API_BASE}/reports/${encodeURIComponent(report.id)}/document`;
}
