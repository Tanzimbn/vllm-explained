import { defineSim } from './createSim'

/**
 * One request's journey through the engine, component by component.
 *
 * This is a guided tour rather than a dynamical system: each tick advances to
 * the next stage of the pipeline and names the object being handed onward.
 * The point is to attach the class names to a mental picture before stages
 * 03-05 open each box up.
 */

const PHASES = [
  {
    node: 'user',
    title: 'llm.generate(prompt)',
    detail:
      'A prompt string enters the engine. It gets a unique request ID and an arrival timestamp — the clock that TTFT will later be measured against.',
    produces: 'str',
    edge: null,
  },
  {
    node: 'processor',
    title: 'Processor validates & tokenizes',
    detail:
      'The input preprocessor tokenizes the prompt and returns prompt, prompt_token_ids, and a type (text / tokens / embeds). Sampling params, priority and metadata get packed alongside it.',
    produces: 'EngineCoreRequest',
    edge: 'user->processor',
  },
  {
    node: 'client',
    title: 'Engine core client hands it off',
    detail:
      'In the offline single-process case the client is an InprocClient, which is essentially the EngineCore itself — a direct function call. Online, this same seam becomes a ZMQ socket to another process (stage 12).',
    produces: 'EngineCoreRequest',
    edge: 'processor->client',
  },
  {
    node: 'sched',
    title: 'Wrapped as a Request, status = WAITING',
    detail:
      'EngineCore wraps it in a Request object and appends it to the scheduler\'s waiting queue — append if the policy is FCFS, heap-push if priority.',
    produces: 'Request(WAITING)',
    edge: 'client->sched',
  },
  {
    node: 'sched',
    title: 'step() 1/3 — schedule',
    detail:
      'The scheduler picks who runs this step: decodes from the running queue first, then prefills from waiting, all against a fixed token budget.',
    produces: 'SchedulerOutput',
    edge: null,
    phase: 'step',
  },
  {
    node: 'kv',
    title: 'allocate_slots reserves KV blocks',
    detail:
      'The KV-cache manager computes how many 16-token blocks this request needs, pulls them off free_block_queue, and records them in req_to_blocks. If the pool is empty, something gets preempted.',
    produces: 'list[KVCacheBlock]',
    edge: 'sched->kv',
    phase: 'step',
  },
  {
    node: 'exec',
    title: 'step() 2/3 — forward pass',
    detail:
      'The model executor drives execute_model. Here that is a UniProcExecutor with one Worker on one GPU; by stage 11 it will be a MultiProcExecutor fanning out over eight, with the engine none the wiser.',
    produces: 'logits',
    edge: 'sched->exec',
    phase: 'step',
  },
  {
    node: 'exec',
    title: 'Sample a token',
    detail:
      'Hidden states at each sequence\'s final position are gathered, logits computed, and one token sampled per sequence according to the sampling config — greedy, temperature, top-p, top-k.',
    produces: 'token_id',
    edge: null,
    phase: 'step',
  },
  {
    node: 'outproc',
    title: 'step() 3/3 — postprocess',
    detail:
      'The token is appended to the Request, detokenized, and checked against the stop conditions. Not finished? Back to schedule for another step.',
    produces: 'EngineCoreOutputs',
    edge: 'exec->outproc',
    phase: 'step',
  },
  {
    node: 'kv',
    title: 'Finished — blocks returned',
    detail:
      'On a stop condition the request is cleaned up and its KV-cache blocks go back to free_block_queue, ready for whoever is next in line.',
    produces: 'freed blocks',
    edge: 'outproc->kv',
  },
  {
    node: 'user',
    title: 'RequestOutput returned',
    detail:
      'The output processor converts raw EngineCoreOutputs into the RequestOutput you actually see. In streaming mode the tokens would have been leaving all along.',
    produces: 'RequestOutput',
    edge: 'outproc->user',
  },
]

export default defineSim({
  name: 'engine',
  params: {},

  init() {
    return { tick: 0, i: 0, loops: 0, tokens: 0 }
  },

  step(s) {
    // After postprocess, loop back to schedule until the request is "finished".
    const isPostprocess = s.i === 8
    const shouldLoop = isPostprocess && s.loops < 2
    if (shouldLoop) {
      return { tick: s.tick + 1, i: 4, loops: s.loops + 1, tokens: s.tokens + 1 }
    }
    return {
      tick: s.tick + 1,
      i: Math.min(s.i + 1, PHASES.length - 1),
      loops: s.loops,
      tokens: s.tokens + (s.i === 7 ? 1 : 0),
    }
  },

  isDone(s) {
    return s.i === PHASES.length - 1
  },

  invariants: [(s) => (s.i >= 0 && s.i < PHASES.length) || 'phase index out of range'],
})

export { PHASES }

export const ENGINE_NODES = [
  { id: 'user', label: 'LLM', sub: 'user-facing API', x: 20, y: 8, w: 108, h: 38 },
  { id: 'processor', label: 'Processor', sub: 'tokenize', x: 20, y: 78, w: 108, h: 38 },
  { id: 'client', label: 'InprocClient', sub: 'engine core client', x: 20, y: 148, w: 108, h: 38 },
  { id: 'sched', label: 'Scheduler', sub: 'waiting / running', x: 210, y: 148, w: 118, h: 38 },
  { id: 'kv', label: 'KVCacheManager', sub: 'free_block_queue', x: 210, y: 232, w: 118, h: 38 },
  { id: 'exec', label: 'ModelExecutor', sub: 'UniProcExecutor', x: 400, y: 148, w: 122, h: 38 },
  { id: 'outproc', label: 'OutputProcessor', sub: 'detokenize', x: 400, y: 78, w: 122, h: 38 },
  { id: 'som', label: 'StructuredOutput', sub: 'grammar bitmask', x: 400, y: 232, w: 122, h: 38 },
]

export const ENGINE_EDGES = [
  { from: 'user', to: 'processor' },
  { from: 'processor', to: 'client' },
  { from: 'client', to: 'sched' },
  { from: 'sched', to: 'kv' },
  { from: 'sched', to: 'exec' },
  { from: 'exec', to: 'outproc' },
  { from: 'outproc', to: 'user' },
  { from: 'outproc', to: 'kv', dashed: true },
  { from: 'som', to: 'exec', dashed: true },
]

export const ENGINE_GROUPS = [
  { label: 'EngineCore', x: 196, y: 128, w: 340, h: 162 },
]
