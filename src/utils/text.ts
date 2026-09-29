export function normalizeModelName(rawModel: string): string {
  if (!rawModel) return 'unknown-model';
  let m = rawModel.trim().toLowerCase();

  // Strip vendor prefixes like anthropic/, openai/, crosery/, openrouter/, minimax-cn/
  if (m.includes('/')) {
    const parts = m.split('/');
    m = parts[parts.length - 1];
  }

  // Strip common routing prefixes like cline-, qcn-, fox-, crosery-
  m = m.replace(/^(cline|qcn|fox|crosery|openrouter)-/, '');

  // Strip tags like :free, [1m], [128k], etc.
  m = m.replace(/:free$/, '');
  m = m.replace(/\[\d+[mk]?\]/i, '');

  // Strip snapshot date suffixes like -20241022, -20250219, -20260424, @2025-01-01
  m = m.replace(/[-_@](202[4-9]\d{4}|202[4-9]-\d{2}-\d{2})$/, '');

  // Harmonize minor version dots vs dashes for common families
  if (m.startsWith('claude-3.5-')) {
    m = m.replace('claude-3.5-', 'claude-3-5-');
  } else if (m.startsWith('claude-3.7-')) {
    m = m.replace('claude-3.7-', 'claude-3-7-');
  }

  return m.trim();
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return 'unknown';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
