import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CommunityPost } from './types';

function readPosts(file: string): CommunityPost[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('community.json の形式が不正です');
  return parsed as CommunityPost[];
}

/** Communityだけを独立して保存し、既存の会議DBを変更しない。 */
export class CommunityStore {
  private filePath: string;
  private posts: CommunityPost[];
  private queue: Promise<void> = Promise.resolve();
  private recoveredFromBackup = false;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'community.json');
    if (!fs.existsSync(this.filePath)) {
      this.posts = [];
    } else {
      try {
        this.posts = readPosts(this.filePath);
      } catch (error) {
        const backup = this.filePath + '.bak';
        if (!fs.existsSync(backup)) throw error;
        this.posts = readPosts(backup);
        this.recoveredFromBackup = true;
        console.error('[CommunityStore] community.json をバックアップから読み込みました', error);
      }
    }
  }

  list(projectId?: string): CommunityPost[] {
    const selected = projectId ? this.posts.filter((post) => post.projectId === projectId) : this.posts;
    return structuredClone(selected).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): CommunityPost {
    const post = this.posts.find((entry) => entry.id === id);
    if (!post) throw new Error('投稿が見つかりません');
    return structuredClone(post);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async write(next: CommunityPost[]): Promise<void> {
    const temporary = this.filePath + '.' + randomUUID() + '.tmp';
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    if (fs.existsSync(this.filePath) && !this.recoveredFromBackup) {
      await fs.promises.copyFile(this.filePath, this.filePath + '.bak');
    }
    await fs.promises.rename(temporary, this.filePath);
    this.posts = next;
    this.recoveredFromBackup = false;
  }

  insert(post: CommunityPost): Promise<CommunityPost> {
    return this.enqueue(async () => {
      if (this.posts.some((entry) => entry.id === post.id)) throw new Error('投稿IDが重複しています');
      await this.write([...this.posts, structuredClone(post)]);
      return structuredClone(post);
    });
  }

  update(id: string, change: (post: CommunityPost) => void): Promise<CommunityPost> {
    return this.enqueue(async () => {
      const next = structuredClone(this.posts);
      const post = next.find((entry) => entry.id === id);
      if (!post) throw new Error('投稿が見つかりません');
      change(post);
      post.updatedAt = new Date().toISOString();
      await this.write(next);
      return structuredClone(post);
    });
  }
}
