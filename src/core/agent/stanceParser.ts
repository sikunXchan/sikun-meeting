import { Stance } from '../types';

const STANCE_TAG_RE = /^【立場[:：]\s*(賛成|反対|条件付き賛成|推奨案|リスク指摘)】\s*/;

/** AIの応答テキストから先頭の立場タグを抽出し、本文から取り除く。 */
export function parseStance(rawText: string): { stance: Stance; content: string } {
  const match = rawText.match(STANCE_TAG_RE);
  if (!match) {
    return { stance: null, content: rawText.trim() };
  }
  return {
    stance: match[1] as Stance,
    content: rawText.slice(match[0].length).trim(),
  };
}
