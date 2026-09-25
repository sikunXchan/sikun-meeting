export type CommunityAuthor = 'human' | 'ai';
export type CommunityMessageKind = 'comment' | 'proposal' | 'review';

export interface CommunityMessage {
  id: string;
  author: CommunityAuthor;
  authorId: string;
  kind: CommunityMessageKind;
  content: string;
  createdAt: string;
  roundKind?: 'initial' | 'discussion';
  requestedModel?: string;
  effectiveModel?: string;
}

export interface CommunityPost {
  id: string;
  projectId: string;
  createdBy: CommunityAuthor;
  creatorPersonaId: string | null;
  title: string;
  body: string;
  workingDirectory: string | null;
  personaIds: string[];
  messages: CommunityMessage[];
  commissionId: string | null;
  acceptedAt: string | null;
  acceptanceNote: string | null;
  createdAt: string;
  updatedAt: string;
  initialRound?: {
    status: 'collecting' | 'published';
    personaIds: string[];
    baseMessagesLength: number;
    responses: CommunityMessage[];
    startedAt: string;
  };
}

export interface CreateCommunityPostInput {
  projectId: string;
  title: string;
  body: string;
  workingDirectory?: string | null;
  personaIds?: string[];
}

export type CommunityProgress =
  | { type: 'turn-start'; postId: string; personaId: string }
  | { type: 'turn-end'; postId: string; personaId: string; message: CommunityMessage }
  | { type: 'turn-error'; postId: string; personaId: string; error: string };
