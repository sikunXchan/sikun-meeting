/**
 * ドメイン型定義。
 * Project → Meeting → Discussion(Message) → Decision → ActionItem という
 * 「議論 → 意思決定 → 実行」の循環を表現する。
 */

export type ParticipantStatus = 'ACTIVE' | 'INACTIVE';

export type Stance = '賛成' | '反対' | '条件付き賛成' | '推奨案' | 'リスク指摘' | null;

export type SpeakerType = 'HUMAN' | 'AI' | 'SYSTEM';

export type MeetingStatus = 'CREATED' | 'IN_PROGRESS' | 'CONCLUDED';

/** AIの役割定義（会議ごとに複数体を招集できるテンプレート）。 */
export interface Persona {
  id: string;
  name: string;
  emoji: string;
  roleTitle: string;
  expertise: string;
  /** Claude Agent SDK の systemPrompt に渡す、この役割の人格・視点・話し方。 */
  systemPrompt: string;
  /** src/renderer/assets/personas/ 配下のファイル名（拡張子込み）。 */
  avatar: string;
}

/** 会議に招集された、あるペルソナの実体（ACTIVE/INACTIVEを持つ）。 */
export interface Participant {
  id: string;
  personaId: string;
  status: ParticipantStatus;
  invitedAt: string;
  deactivatedAt?: string;
}

/** 発言・議論エンジンが生成する1メッセージ。 */
export interface Message {
  id: string;
  meetingId: string;
  speakerType: SpeakerType;
  /** HUMANなら 'chief'、AIなら `${personaId}#${participantId}`、SYSTEMなら 'system'。 */
  speakerId: string;
  content: string;
  stance: Stance;
  createdAt: string;
  /** ある発言への直接の応答・反対等の場合に参照元を残す。 */
  inReplyToMessageId?: string;
  /** 賛成/反対のリアクション（円陣UIでの簡易集計用）。 */
  reactions?: { agree: number; disagree: number };
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  done: boolean;
}

/** 会議終了時に確定する意思決定の記録。 */
export interface Decision {
  decisionText: string;
  reasoning: string[];
  disagreements: { participantId: string; stance: Stance; note?: string }[];
  actionItems: ActionItem[];
  decidedBy: 'chief';
  decidedAt: string;
}

/** 会議タイプごとの進行ルール（発言順・回数・投票有無等）。 */
export interface MeetingProtocolConfig {
  id: string;
  name: string;
  description: string;
  /** 対応する protocol 実装の id（src/core/protocol/protocols.ts で解決）。 */
  turnStrategy: 'structuredRounds' | 'roundRobin' | 'freeForm';
  /** 各AIが最初の意見表明で最大何回連続発言できるか等の目安。 */
  maxAutoRoundsPerAsk: number;
  allowRebuttal: boolean;
  votingEnabled: boolean;
}

export interface MeetingType {
  id: string;
  name: string;
  emoji: string;
  description: string;
  focusAreas: string[];
  /** この会議タイプにデフォルトで招集されるペルソナid。 */
  defaultPersonaIds: string[];
  protocol: MeetingProtocolConfig;
}

export interface Meeting {
  id: string;
  projectId: string | null;
  meetingTypeId: string;
  title: string;
  agenda: string;
  status: MeetingStatus;
  participants: Participant[];
  transcript: Message[];
  decision: Decision | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Architect/DevOps 等が実プロジェクトのコードを読んで発言する際の対象ディレクトリ。 */
  workingDirectory: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  meetingIds: string[];
  /** 会議のDecisionから転記された、プロジェクト側で追跡するアクションアイテム。 */
  actionItems: (ActionItem & { meetingId: string; sourceMeetingTitle: string })[];
  createdAt: string;
}

export interface DB {
  projects: Project[];
  meetings: Meeting[];
}
