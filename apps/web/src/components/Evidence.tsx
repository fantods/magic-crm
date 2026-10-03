import type { SourceEvidence } from '@formless/contracts';

export function EvidenceExcerpts({ evidence }: { evidence: readonly SourceEvidence[] }) {
  if (evidence.length === 0) {
    return <p className="evidence-empty">No source phrase recorded.</p>;
  }
  return (
    <ul className="evidence-list">
      {evidence.map((item, index) => (
        <li key={item.source + String(item.startIndex ?? index)}>
          <blockquote className="evidence-text">“{item.text}”</blockquote>
          <span className="evidence-source">from {item.source}</span>
        </li>
      ))}
    </ul>
  );
}
