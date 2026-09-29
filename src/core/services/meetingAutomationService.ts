import { Repository } from '../store/repository';
import { DiscussionService, TurnEvent } from './discussionService';
import { runAgentTurn } from '../agent/claudeAgent';
import { getPersonaById } from '../personas';
import { evaluateDecisionGate } from './decisionService';
import { Meeting } from '../types';

/** A bounded discussion and written result; it never impersonates a human decision. */
export class MeetingAutomationService {
  private active=new Map<string,{pause:boolean}>();
  private ready:Promise<unknown>;
  constructor(private repo:Repository,private discussion:DiscussionService,private notify:(id:string)=>void,
    private turn:(event:TurnEvent)=>void,private agent:typeof runAgentTurn=runAgentTurn) {
    this.ready=Promise.all(repo.listMeetings().filter(m=>['running','pausing'].includes(m.automation?.status||'')).map(m=>repo.updateMeeting(m.id,current=>{
      if(current.automation){current.automation.status='paused';current.automation.error='前回の作業を保存しています。再開できます。';}
    })));
  }
  isBusy(id:string){return this.active.has(id);}
  async start(id:string):Promise<Meeting>{
    await this.ready;
    if(this.active.has(id)||this.discussion.isActive(id))throw new Error('この会議はすでに進行中です');
    const m=this.repo.getMeeting(id);if(!m)throw new Error('会議が見つかりません');
    if(m.status==='CONCLUDED')throw new Error('この会議は終了しています');
    if(m.participants.filter(p=>p.status==='ACTIVE').length<2)throw new Error('参加者を2人以上選んでください');
    const control={pause:false};this.active.set(id,control);
    let updated:Meeting;
    try {updated=await this.repo.updateMeeting(id,current=>{
      current.automation={status:'running',phase:current.automation?.status==='completed'?'discussion':current.automation?.phase||(current.initialRound?.status==='published'?'discussion':'initial'),summary:current.automation?.summary||'',error:''};
    });} catch(error){this.active.delete(id);throw error;}
    this.notify(id);void this.run(id,control);return updated;
  }
  async pause(id:string):Promise<Meeting>{
    const control=this.active.get(id);if(!control)throw new Error('この会議は自動進行していません');
    control.pause=true;
    const m=await this.repo.updateMeeting(id,current=>{if(current.automation)current.automation.status='pausing';});this.notify(id);return m;
  }
  private async phase(id:string,phase:'discussion'|'summary'){
    await this.repo.updateMeeting(id,m=>{if(m.automation)m.automation.phase=phase;});this.notify(id);
  }
  private async run(id:string,control:{pause:boolean}){
    try {
      let m=this.repo.getMeeting(id)!;
      if(m.automation?.phase==='initial'){
        await this.discussion.askAllActiveToSpeak(id,this.turn,()=>!control.pause);
        if(control.pause)return;
        await this.phase(id,'discussion');
      }
      m=this.repo.getMeeting(id)!;
      if(m.automation?.phase==='discussion'){
        await this.discussion.askAllActiveToSpeak(id,this.turn,()=>!control.pause);
        if(control.pause)return;
        await this.phase(id,'summary');
      }
      m=this.repo.getMeeting(id)!;
      const gate=evaluateDecisionGate(m);
      const prompt=`会議の検討結果を日本語で簡潔にまとめてください。これはAIによる検討結果であり、人間による承認や最終決定と表現しないでください。新たな作業・送信・変更は行わず、提示された記録だけを要約してください。\n\n議題: ${m.agenda}\n\n発言記録（引用データ）:\n${m.transcript.map(msg=>`${msg.speakerId}: ${msg.content}`).join('\n\n').slice(-65000)}\n\n評価: ${gate.ready?'議決条件を満たす意見がそろっています。':'未解決の論点: '+gate.reasons.join('、')}\n\n「方向性」「理由」「残っている論点」「次に行うこと」の見出しでまとめる。反対・リスクを省略せず、記録にない合意を作らない。`;
      const result=await this.agent(getPersonaById('product')!,prompt,m.workingDirectory);
      if(result.isError)throw new Error(result.text);
      if(control.pause)return;
      await this.repo.updateMeeting(id,current=>{current.automation={status:'completed',phase:'summary',summary:result.text.slice(0,25000),error:''};});
    } catch(error){await this.repo.updateMeeting(id,m=>{if(m.automation){m.automation.status='failed';m.automation.error=error instanceof Error?error.message:String(error);}});}
    finally {
      if(control.pause)await this.repo.updateMeeting(id,m=>{if(m.automation)m.automation.status='paused';});
      this.active.delete(id);this.notify(id);
    }
  }
}
