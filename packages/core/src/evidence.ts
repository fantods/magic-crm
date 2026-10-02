import type { NormalizedEmail } from './normalize-email.js';
import type { SourceEvidence } from '@formless/contracts';

export function sourceTextForEvidence(email: NormalizedEmail, source: SourceEvidence['source']) {
  switch (source) {
    case 'subject':
      return email.subject ?? '';
    case 'body':
      return email.body;
    case 'from':
      return email.from ?? '';
    case 'to':
      return email.to ?? '';
  }
}

export function verifyEvidence(
  email: NormalizedEmail,
  evidence: SourceEvidence,
): SourceEvidence | null {
  const sourceText = sourceTextForEvidence(email, evidence.source);
  const startIndex = sourceText.toLowerCase().indexOf(evidence.text.toLowerCase());

  if (startIndex < 0) {
    return null;
  }

  return {
    ...evidence,
    startIndex,
    endIndex: startIndex + evidence.text.length,
  };
}
