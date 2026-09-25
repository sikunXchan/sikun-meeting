import { AgentClient, AgentRequest, AgentResponse } from './types';
import { SdkAgentClient } from './agent';
import { CodexAgentClient } from './codexAgent';

export class RoutedAgentClient implements AgentClient {
  constructor(
    private claude: AgentClient = new SdkAgentClient(),
    private codex: AgentClient = new CodexAgentClient(),
  ) {}

  run(request: AgentRequest): Promise<AgentResponse> {
    return (request.provider === 'codex' ? this.codex : this.claude).run(request);
  }
}
