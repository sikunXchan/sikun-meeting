import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { AgentTurnResult, runAgentTurn } from '../agent/claudeAgent';
import { CommissionService } from '../commission/service';
import { Commission } from '../commission/types';
import { getPersonaById } from '../personas';
import { Repository } from '../store/repository';
import { Persona } from '../types';
import { CommunityStore } from './store';
import { CommunityMessage, CommunityPost, CommunityProgress, CreateCommunityPostInput } from './types';

export type CommunityAgent = (persona: Persona, prompt: string, directory: string | null) => Promise<AgentTurnResult>;

const DEFAULT_PERSONAS = ['product', 'architect', 'critic', 'qa'];

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + 'を入力してください');
  if (value.trim().length > maxLength) throw new Error(label + 'が長すぎます');
  return value.trim();
}

function selectPersonas(input: string[] | undefined): string[] {
  const ids = [...new Set(input === undefined ? DEFAULT_PERSONAS : input)];
  if (ids.length < 1 || ids.length > 8) throw new Error('参加AIは1〜8人選んでください');
  if (ids.some((id) => !getPersonaById(id))) throw new Error('不明なAIが含まれています');
  return ids;
}

/** 常設のプロジェクト投稿を会議・委託案件と結びつけるサービス。 */
export class CommunityService {
  private active = new Set<string>();
  private starting = new Map<string, Promise<Commission>>();

  constructor(
    private store: CommunityStore,
    private repo: Repository,
    private commissions: CommissionService,
    private agent: CommunityAgent = runAgentTurn,
  ) {}

  list(projectId: string): CommunityPost[] {
    if (!this.repo.getProject(projectId)) throw new Error('プロジェクトが見つかりません');
    return this.store.list(projectId);
  }

  get(id: string): CommunityPost {
    return this.store.get(id);
  }

  async create(input: CreateCommunityPostInput): Promise<CommunityPost> {
    if (!this.repo.getProject(input.projectId)) throw new Error('プロジェクトが見つかりません');
    const title = requiredText(input.title, 'タイトル', 160);
    const body = requiredText(input.body, '内容', 8000);
    const directory = input.workingDirectory?.trim() || null;
    if (directory && (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory())) {
      throw new Error('作業ディレクトリが見つかりません');
    }
    const now = new Date().toISOString();
    return this.store.insert({
      id: randomUUID(), projectId: input.projectId, title, body,
      createdBy: 'human', creatorPersonaId: null,
      workingDirectory: directory, personaIds: selectPersonas(input.personaIds),
      messages: [], commissionId: null, acceptedAt: null, acceptanceNote: null,
      createdAt: now, updatedAt: now,
    });
  }

  /** 既存の会議・案件・採用知識を読んで、AI自身が次の課題を投稿する。 */
  async suggest(projectId: string): Promise<CommunityPost> {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    const meetings = this.repo.listMeetings().filter((entry) => entry.projectId === projectId).slice(-5);
    const commissions = this.commissions.list(projectId).slice(-5);
    const accepted = this.store.list(projectId).filter((entry) => entry.acceptedAt).slice(0, 5);
    if (!meetings.length && !commissions.length && !accepted.length) {
      throw new Error('課題を提案するための会議・委託案件・採用知識がまだありません');
    }
    const persona = getPersonaById('product');
    if (!persona) throw new Error('Product AIが見つかりません');
    const context = [
      'プロジェクト: ' + project.name + '\n説明: ' + project.description,
      '最近の会議:\n' + meetings.map((meeting) =>
        '- ' + meeting.title + ': ' + (meeting.decision?.decisionText || meeting.agenda).slice(0, 800)).join('\n'),
      '委託案件:\n' + commissions.map((item) =>
        '- ' + item.goal.slice(0, 400) + ' / ' + item.status + ' / ' + (item.delivery || '').slice(0, 500)).join('\n'),
      '採用された知識:\n' + accepted.map((post) =>
        '- ' + post.title + ': ' + (post.acceptanceNote || '').slice(0, 400)).join('\n'),
      'この情報に基づいて、次に取り組む価値がある具体的な課題を1件だけ提案してください。既存の根拠を本文に明記し、目的、作業内容、完了条件を含めてください。情報から言えないことは推測と示してください。JSONのみで {"title":"...","body":"..."} と返してください。',
    ].join('\n\n');
    const answer = await this.agent(persona, context, null);
    if (answer.isError) throw new Error(answer.text);
    let parsed: Record<string, unknown>;
    try {
      const text = answer.text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '');
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('AIの提案を読み取れませんでした。再度お試しください');
    }
    const now = new Date().toISOString();
    return this.store.insert({
      id: randomUUID(), projectId, title: requiredText(parsed.title, '提案タイトル', 160),
      body: requiredText(parsed.body, '提案内容', 8000),
      createdBy: 'ai', creatorPersonaId: persona.id,
      workingDirectory: null, personaIds: DEFAULT_PERSONAS,
      messages: [], commissionId: null, acceptedAt: null, acceptanceNote: null,
      createdAt: now, updatedAt: now,
    });
  }

  async comment(id: string, text: string): Promise<CommunityPost> {
    const content = requiredText(text, 'コメント', 4000);
    return this.store.update(id, (post) => {
      if (post.initialRound?.status === 'collecting') throw new Error('初回意見の収集中はコメントできません');
      post.messages.push({
        id: randomUUID(), author: 'human', authorId: 'chief',
        kind: 'comment', content, createdAt: new Date().toISOString(),
      });
    });
  }

  private prompt(post: CommunityPost, persona: Persona, independent = false): string {
    const project = this.repo.getProject(post.projectId);
    const memory = this.store.list(post.projectId)
      .filter((entry) => entry.acceptedAt && entry.id !== post.id)
      .slice(0, 8)
      .map((entry) => '- ' + entry.title + ': ' + (entry.acceptanceNote || entry.body).slice(0, 350))
      .join('\n');
    const visibleMessages = independent && post.initialRound
      ? post.messages.slice(0, post.initialRound.baseMessagesLength) : post.messages;
    const transcript = visibleMessages.slice(-24)
      .map((message) => {
        const speaker = message.author === 'human' ? '人間' : (getPersonaById(message.authorId)?.name || message.authorId);
        return '- ' + speaker + ': ' + message.content.slice(0, 900);
      }).join('\n');
    return [
      independent
        ? 'これは全員が互いの回答を見ずに作る初回意見です。投稿と人間の補足だけを根拠に、独立して提案・懸念・必要な検証を述べてください。'
        : 'あなたは継続するAIコミュニティの一員です。投稿者と他のAIの発言を読み、専門領域から建設的に参加してください。',
      'プロジェクト: ' + (project?.name || '') + '\n説明: ' + (project?.description || ''),
      '過去に採用された知識:\n' + (memory || 'なし'),
      '今回の投稿: ' + post.title + '\n' + post.body,
      'これまでの議論:\n' + (transcript || 'まだ発言なし'),
      'あなたの役割: ' + persona.name + '（' + persona.roleTitle + '）',
      independent
        ? '他者の意見は参照せず、根拠、懸念、次の具体的な作業を簡潔に述べてください。事実と推測を区別してください。実作業は行わないでください。'
        : '他者の意見を踏まえて、根拠、懸念、次の具体的な作業を簡潔に述べてください。事実と推測を区別し、ファイルを参照した場合は場所を示してください。実作業は委託案件で行うため、この場では変更しないでください。',
    ].join('\n\n');
  }

  async runRound(id: string, onProgress?: (event: CommunityProgress) => void): Promise<CommunityPost> {
    if (this.active.has(id)) throw new Error('この投稿ではAIが発言中です');
    const initial = this.store.get(id);
    this.active.add(id);
    try {
      const independent = initial.initialRound?.status === 'collecting' ||
        (!initial.initialRound && !initial.messages.some((message) => message.author === 'ai'));
      if (independent && !initial.initialRound) {
        await this.store.update(id, (post) => {
          post.initialRound = {
            status: 'collecting', personaIds: [...post.personaIds],
            baseMessagesLength: post.messages.length, responses: [], startedAt: new Date().toISOString(),
          };
        });
      }
      const personaIds = independent ? this.store.get(id).initialRound!.personaIds : initial.personaIds;
      for (const personaId of personaIds) {
        if (independent && this.store.get(id).initialRound!.responses.some((message) => message.authorId === personaId)) continue;
        const persona = getPersonaById(personaId);
        if (!persona) continue;
        onProgress?.({ type: 'turn-start', postId: id, personaId });
        try {
          const snapshot = this.store.get(id);
          const result = await this.agent(persona, this.prompt(snapshot, persona, independent), snapshot.workingDirectory);
          if (result.isError) throw new Error(result.text);
          const message: CommunityMessage = {
            id: randomUUID(), author: 'ai', authorId: personaId,
            kind: personaId === 'critic' || personaId === 'qa' ? 'review' : 'proposal',
            content: requiredText(result.text, 'AIの発言', 20000),
            createdAt: new Date().toISOString(),
            roundKind: independent ? 'initial' : 'discussion',
            requestedModel: result.requestedModel,
            effectiveModel: result.effectiveModel,
          };
          await this.store.update(id, (post) => {
            if (independent) post.initialRound!.responses.push(message);
            else post.messages.push(message);
          });
          if (!independent) onProgress?.({ type: 'turn-end', postId: id, personaId, message });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          onProgress?.({ type: 'turn-error', postId: id, personaId, error: detail });
          throw error;
        }
      }
      if (independent) {
        let published: CommunityMessage[] = [];
        await this.store.update(id, (post) => {
          const round = post.initialRound!;
          if (round.responses.length !== round.personaIds.length) throw new Error('初回意見がそろっていません');
          published = [...round.responses];
          post.messages.push(...published);
          round.responses = [];
          round.status = 'published';
        });
        for (const message of published) {
          onProgress?.({ type: 'turn-end', postId: id, personaId: message.authorId, message });
        }
      }
      return this.store.get(id);
    } finally {
      this.active.delete(id);
    }
  }

  private goal(post: CommunityPost): string {
    const comments = post.messages.slice(-8)
      .map((message) => {
        const author = message.author === 'human' ? '人間' : (getPersonaById(message.authorId)?.name || message.authorId);
        return '- ' + author + ': ' + message.content.slice(0, 700);
      }).join('\n');
    return ('コミュニティ投稿: ' + post.title + '\n\n投稿者の目標:\n' + post.body +
      '\n\n企画相談の参考となる議論（未確定の提案を含む）:\n' + (comments || 'なし')).slice(0, 9900);
  }

  /** 同じ投稿からの二重発注を防ぎ、既存の企画相談へ接続する。 */
  startCommission(id: string): Promise<Commission> {
    const running = this.starting.get(id);
    if (running) return running;
    const operation = this.startCommissionOnce(id);
    this.starting.set(id, operation);
    void operation.finally(() => { if (this.starting.get(id) === operation) this.starting.delete(id); }).catch(() => undefined);
    return operation;
  }

  private async startCommissionOnce(id: string): Promise<Commission> {
    const post = this.store.get(id);
    if (post.commissionId) return this.commissions.get(post.commissionId).commission;
    const previous = this.commissions.list(post.projectId).find((entry) => entry.sourceCommunityPostId === id);
    const commission = previous || await this.commissions.create({
      projectId: post.projectId,
      sourceCommunityPostId: id,
      goal: this.goal(post),
      successCriteria: post.body,
      workingDirectory: post.workingDirectory || undefined,
    });
    await this.store.update(id, (entry) => { entry.commissionId = commission.id; });
    return commission;
  }

  async accept(id: string, text: string): Promise<CommunityPost> {
    const post = this.store.get(id);
    if (post.initialRound?.status === 'collecting') throw new Error('初回意見の収集後に採用してください');
    if (!post.messages.some((message) => message.author === 'ai')) throw new Error('AIの意見を確認してから採用してください');
    if (post.commissionId && this.commissions.get(post.commissionId).commission.status !== 'delivered') {
      throw new Error('委託案件の納品後に採用できます');
    }
    let note = text.trim();
    if (!note && post.commissionId) {
      const commission = this.commissions.get(post.commissionId).commission;
      if (commission.status !== 'delivered') throw new Error('納品後に採用できます');
      note = (commission.delivery || '').slice(0, 2000);
    }
    note = requiredText(note, '採用する知識', 2000);
    return this.store.update(id, (entry) => {
      entry.acceptedAt = new Date().toISOString();
      entry.acceptanceNote = note;
    });
  }
}
