import { Meeting, Participant, Persona } from '../types';
import { getPersonaById } from '../personas';
import { getMeetingTypeById } from '../meetingTypes';

const STANCE_INSTRUCTION =
  '発言の冒頭に必ず、あなたの立場を次のいずれか1つで示すタグを付けてください: ' +
  '【立場: 賛成】【立場: 反対】【立場: 条件付き賛成】【立場: 推奨案】【立場: リスク指摘】。' +
  'その直後から、本文（日本語、3〜6文程度）を続けてください。';

function speakerLabel(m: { speakerType: string; speakerId: string }): string {
  if (m.speakerType === 'HUMAN') return '👤 最高開発者';
  if (m.speakerType === 'SYSTEM') return '🗒 system';
  const persona = getPersonaById(m.speakerId.split('#')[0]);
  return persona ? `${persona.emoji} ${persona.name}` : m.speakerId;
}

function formatTranscript(meeting: Meeting): string {
  if (meeting.transcript.length === 0) {
    return '（まだ発言はありません。あなたが最初の発言者です。）';
  }
  return meeting.transcript
    .map((m) => `- ${speakerLabel(m)}: ${m.content}`)
    .join('\n');
}

export interface PromptContext {
  meeting: Meeting;
  persona: Persona;
  participant: Participant;
  /** ASK_ALL_ACTIVE, ASK_SPECIFIC, REBUTTAL_ROUND のいずれか。 */
  triggerKind: 'ASK_ALL_ACTIVE' | 'ASK_SPECIFIC' | 'REBUTTAL_ROUND';
  /** ASK_SPECIFICで人間から直接質問された場合の質問文。 */
  directQuestion?: string;
}

/** 会議のペルソナ・議題・トランスクリプトから、AIへの1ターン分のプロンプトを組み立てる。 */
export function buildTurnPrompt(ctx: PromptContext): string {
  const meetingType = getMeetingTypeById(ctx.meeting.meetingTypeId);
  const header = [
    `会議タイプ: ${meetingType?.emoji ?? ''} ${meetingType?.name ?? ctx.meeting.meetingTypeId}`,
    `会議タイトル: ${ctx.meeting.title}`,
    `議題: ${ctx.meeting.agenda}`,
    `あなたの役割: ${ctx.persona.emoji} ${ctx.persona.name}（${ctx.persona.roleTitle} / 専門: ${ctx.persona.expertise}）`,
  ].join('\n');

  const transcript = `これまでの発言:\n${formatTranscript(ctx.meeting)}`;

  let instruction: string;
  if (ctx.triggerKind === 'ASK_SPECIFIC' && ctx.directQuestion) {
    instruction = `最高開発者から、あなたに直接この質問がありました: 「${ctx.directQuestion}」\nこれに答えてください。`;
  } else if (ctx.triggerKind === 'REBUTTAL_ROUND') {
    instruction =
      'これまでの議論を踏まえ、反論・追加の懸念・修正意見があれば述べてください。' +
      '特に異論がない場合は、その旨と賛成の理由を簡潔に述べてください。';
  } else {
    instruction = `あなたの専門（${ctx.persona.expertise}）の観点から、この議題について意見を述べてください。`;
  }

  return [header, transcript, instruction, STANCE_INSTRUCTION].join('\n\n');
}
