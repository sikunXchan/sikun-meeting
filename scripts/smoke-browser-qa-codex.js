// 実Codexの読み取り専用QAがブラウザ確認口を利用できるかを任意で確認する。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserReviewSession } = require('../dist/core/commission/browserReview');
const { CodexAgentClient } = require('../dist/core/commission/codexAgent');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-browser-sdk-'));
  const file = path.join(root, 'index.html');
  const original = '<!doctype html><title>QA試験</title><input id="name"><button id="go" onclick="document.querySelector(\'#answer\').textContent=document.querySelector(\'#name\').value">表示</button><div id="answer"></div>';
  fs.writeFileSync(file, original);
  const session = new BrowserReviewSession(root, ['index.html']);
  try {
    await session.start();
    const agent = new CodexAgentClient();
    const response = await agent.run({
      provider: 'codex', phase: 'review', personaId: 'qa', model: 'gpt-6-sol',
      workingDirectory: root, tools: 'full', maxTurns: 15, abortSignal: new AbortController().signal,
      prompt: `index.htmlを独立した実ブラウザで確認してください。/helpと/openを使い、#nameに「実機確認」と入力し、#goをクリックして、#answerにその文字が出るか/stateで調べてください。結果をJSON {"approved":true/false,"note":"実測の根拠"} のみで返してください。${session.instructions()}`,
    });
    const result = JSON.parse(response.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!result.approved || !session.summary().includes('click #go') || !session.summary().includes('state #answer')) throw new Error(`実ブラウザ確認ができませんでした: ${response.text}`);
    if (fs.readFileSync(file, 'utf8') !== original) throw new Error('QAが成果物を変更しました');
    console.log(JSON.stringify({ result, trace: session.summary(), tokens: response.tokens }));
  } finally {
    await session.close();
    const target = path.resolve(root);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('試験フォルダが一時領域の外です');
    fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
