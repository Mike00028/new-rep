/**
 * Sanitize/normalize LLM Markdown-ish output for TTS.
 * Goal: remove formatting markers (**, *, _, ~~ strike, backticks, code fences)
 * while keeping readable content. Optionally collapses bullet lists into
 * a semicolon-separated phrase for more natural speech.
 */
export function sanitizeForTTS(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // 1. Summarize fenced code blocks instead of deleting
  // Support forms: ```lang\ncode...``` OR ```lang code...``` (no newline)
  text = text.replace(/```(\w+)?(?:\s+)?\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const language = (lang || 'code').toLowerCase();
  const lines = code.trim().split(/\n/).filter((l: string) => l.trim()).length;
    return ` ${language} code snippet `;
  });

  // 1b. Handle PARTIAL (streaming) code fences without closing backticks (avoid reading raw HTML/JS)
  // Detect an opening fence that hasn't closed yet and summarize the remainder.
  if (/```[\w-]*[\s\S]*$/m.test(text) && !/```[\w-]*[\s\S]*```/m.test(text)) {
    text = text.replace(/```(\w+)?[\s\S]*$/m, (_m, lang) => ` ${(lang || 'code')} code snippet continuing. `);
  }

  // 1c. If raw HTML without fences dominates (>40% angle-bracket tokens), summarize to prevent verbose tag reading
  const angleCount = (text.match(/<[^>]+>/g) || []).length;
  const charCount = text.length;
  if (angleCount > 8 && (angleCount * 10) > charCount) {
    // Replace clusters of tags with a short summary retaining any meaningful visible text outside tags.
    const visible = text.replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]*>/g, ' ') // drop remaining tags
                        .replace(/\s+/g, ' ')     // normalize
                        .trim();
    const snippet = visible.slice(0, 120);
    text = `HTML content snippet. ${snippet}${visible.length > 120 ? '…' : ''}`;
  }

  // 2. Strikethrough: remove the struck content completely (skip speaking)
  text = text.replace(/~~.*?~~/g, '');

  // 3. Inline code: keep inner content but add verbal cue if short token
  text = text.replace(/`([^`]+)`/g, (_m, inner) => {
    const token = inner.trim();
    if (token.length <= 24 && /^[A-Za-z0-9_.$-]+$/.test(token)) {
      return ` variable ${token} `;
    }
    return ` ${token} `;
  });

  // 4. Bold/italic markers: preserve content, drop markers
  for (let i = 0; i < 2; i++) {
    text = text.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2'); // bold
    text = text.replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2');     // italic
  }

  // 5. Remove leftover formatting artifacts
  text = text.replace(/[*_]{2,}/g, '');

  // 6. Normalize bullet lists: speak each item separately for clarity.
  const lines = text.split(/\r?\n/);
  const processed: string[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length) {
      for (const item of bulletBuffer) {
        const spoken = item.trim();
        if (spoken) processed.push(spoken + '.');
      }
      bulletBuffer = [];
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^(\s*([-*+]|\d+[.)]))\s+(.*)$/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[3]);
    } else {
      flushBullets();
      processed.push(line);
    }
  }
  flushBullets();

  text = processed.join(' ');

  // EXTRA HTML STRIPPING (post bullet normalization): remove DOCTYPE and structural tags if any leaked
  text = text.replace(/<!DOCTYPE[^>]*>/gi, ' ')
             .replace(/<script[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
             .replace(/<\/?(html|head|body|main|meta|link|title)[^>]*>/gi, ' ')
             .replace(/<[^>]+>/g, ' ');

  // 7. Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // 8. Remove blockquote markers
  text = text.replace(/(^|\s)>\s*/g, ' ');

  // 9. Safety cap
  const MAX_LEN = 4000;
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN) + '…';

  return text;
}

/**
 * Optional helper: split sanitized text into smaller TTS-sized sentences.
 * (Not currently used, but available for future refinements.)
 */
export function splitForTTS(text: string, maxChars = 280): string[] {
  const sentences: string[] = [];
  let buffer = '';
  const parts = text.match(/[^.!?]+[.!?]?/g) || [text];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if ((buffer + ' ' + trimmed).trim().length > maxChars) {
      if (buffer) sentences.push(buffer.trim());
      buffer = trimmed;
    } else {
      buffer = (buffer ? buffer + ' ' : '') + trimmed;
    }
  }
  if (buffer) sentences.push(buffer.trim());
  return sentences;
}
