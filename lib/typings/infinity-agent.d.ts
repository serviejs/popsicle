declare module 'infinity-agent' {
  import { Agent } from 'http'

  interface InfinityAgent {
    http: {
      Agent: Agent
      globalAgent: typeof Agent
    }
    https: {
      Agent: Agent
      globalAgent: typeof Agent
    }
  }

  const agent: InfinityAgent

  export = agent
}
