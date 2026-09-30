/** 活動履歴に残すコマンド・URLから、認証情報らしい値を伏せる。 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd|auth)["']?\s*[=:]\s*["']?)[^\s"'&]+/gi, '$1***')
    .replace(/\b(sk|pk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, '$1-***');
}
