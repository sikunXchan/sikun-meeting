import { randomUUID } from 'crypto';
import { JsonStore } from './jsonStore';
import { Meeting, Project } from '../types';

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Meeting / Project への型付きアクセスを提供するリポジトリ層。 */
export class Repository {
  constructor(private store: JsonStore) {}

  // --- Meetings ---

  listMeetings(): Meeting[] {
    return this.store.getSnapshot().meetings;
  }

  getMeeting(id: string): Meeting | undefined {
    return this.store.getSnapshot().meetings.find((m) => m.id === id);
  }

  async saveMeeting(meeting: Meeting): Promise<Meeting> {
    return this.store.mutate((db) => {
      const idx = db.meetings.findIndex((m) => m.id === meeting.id);
      if (idx >= 0) {
        db.meetings[idx] = meeting;
      } else {
        db.meetings.push(meeting);
      }
      return meeting;
    });
  }

  async updateMeeting(id: string, updater: (meeting: Meeting) => void): Promise<Meeting> {
    return this.store.mutate((db) => {
      const meeting = db.meetings.find((m) => m.id === id);
      if (!meeting) {
        throw new Error(`Meeting not found: ${id}`);
      }
      updater(meeting);
      return meeting;
    });
  }

  // --- Projects ---

  listProjects(): Project[] {
    return this.store.getSnapshot().projects;
  }

  getProject(id: string): Project | undefined {
    return this.store.getSnapshot().projects.find((p) => p.id === id);
  }

  async saveProject(project: Project): Promise<Project> {
    return this.store.mutate((db) => {
      const idx = db.projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        db.projects[idx] = project;
      } else {
        db.projects.push(project);
      }
      return project;
    });
  }

  async updateProject(id: string, updater: (project: Project) => void): Promise<Project> {
    return this.store.mutate((db) => {
      const project = db.projects.find((p) => p.id === id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }
      updater(project);
      return project;
    });
  }
}
