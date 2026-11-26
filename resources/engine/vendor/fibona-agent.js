var x=class extends Error{constructor(o,r){super(o);this.status=r}status;name="APIError"},A=e=>e instanceof x||e instanceof Error&&"status"in e&&"headers"in e,j=({extra_body:e,...t})=>({...t,...e});function J(e){let t=S();return o=>e&&((r,a)=>e({time:new Date().toISOString(),run_id:t,cell:o,event:r,...a}))}var S=()=>Array.from({length:32},()=>(Math.random()*16|0).toString(16)).join("");var E=class extends Error{name="Quit"},O=class{constructor(t={}){this.opts=t}opts;bind(t){Object.assign(globalThis,t)}async execute(t,{logger:o,summary:r="",onOutput:a,signal:n}={}){o?.("cell",{summary:r,code:t});let i="",c=p=>(...s)=>{let g=s.map($).join(" ")+`
`;p?.(g),i+=g,a?.(g)},[b,m]=[c(this.opts.stdout),c(this.opts.stderr)],u=this.opts.debug&&c(this.opts.debug),[d,_]=[u??b,u??m],h=globalThis.console;this.bind({input:this.opts.readInput??z,print:b,console:{...h,log:d,info:d,debug:d,warn:_,error:_}});let f=()=>{},w=new Promise((p,s)=>f=()=>s(n.reason));n?.addEventListener("abort",f);try{if(await Promise.race([(0,eval)(`(async () => {
${t}
})()`),w]),n?.aborted)throw n.reason;return{output:i,error:null,quit:!1}}catch(p){if(n?.aborted)throw n.reason;if(A(p)&&![400,404,422].includes(p.status))throw p;let s=p instanceof E;return{output:i,error:s?null:C(p),quit:s}}finally{n?.removeEventListener("abort",f),globalThis.console=h}}};function $(e){if(typeof e=="string")return e;if(e instanceof Error)return C(e);try{return JSON.stringify(e)??String(e)}catch{return String(e)}}function C(e){if(!(e instanceof Error))return`Uncaught ${$(e)}`;let t=String(e),o=e.stack??"",r=o.startsWith(t)?o:`${t}
${o}`.trim();return e.cause===void 0?r:`${r}

Caused by: ${C(e.cause)}`}function z(){throw new Error("No input handler configured for this environment")}var D=String.raw`
// Names the host or startup put in, as opposed to what cells defined; variables() hides them.
const hidden = new Set([...Object.keys(globalThis).filter(name => name !== 'instructions' && name !== 'var_docs'), 'task'])
globalThis.task ||= await input()
globalThis.startup_task = task // Preserve the initial task when the current goal changes.
globalThis.task_state = { goal: task, constraints: [], completed: [], pending: [] }
globalThis.instructions = [
  globalThis.instructions,
  [
    'Your working instructions, variables() and build_context() are JavaScript state in this session.',
    'Their original implementation is the bootstrap cell, history[0].code; you can replace them in later cells.',
    'Use await call_me([...build_context(), {role: "user", content: observations}]) to send these instructions and your selected context.',
    'Keep useful data and task-specific helpers in session globals; update var_docs to describe them.',
    'startup_task preserves the initial task. Maintain task_state before each call_me():',
    'update goal and constraints when the user steers the task, and completed and pending as work progresses.',
    'Record verified outcomes in completed; planned work belongs in pending. build_context() carries all fields on every call.',
    'History summaries record intent; use cell output and errors to determine what actually happened.',
  ].join('\n'),
]
  .filter(Boolean)
  .join('\n\n')
globalThis.RECENT ??= 10 // Finished task cells in the default context; others stay in history.
globalThis.var_docs = {
  ...globalThis.var_docs, // Variable name -> description, maintained by the agent in this session.
  startup_task: 'Original task; preserve when the current goal changes.',
  task_state: 'Current goal, constraints, verified completed work and pending work; update before call_me().',
}
/** What cells have defined: name -> type, with the size of containers. Cells may replace this policy. */
globalThis.variables = () =>
  Object.fromEntries(
    Object.keys(globalThis)
      .filter(name => !name.startsWith('_') && !hidden.has(name))
      .map(name => {
        const value = globalThis[name]
        const size =
          typeof value === 'string' || Array.isArray(value)
            ? value.length
            : value instanceof Map || value instanceof Set
              ? value.size
              : value?.constructor === Object
                ? Object.keys(value).length
                : null
        const kind = value === null ? 'null' : typeof value === 'object' ? (value.constructor?.name ?? 'Object') : typeof value
        return [name, size === null ? kind : kind + '[' + size + ']']
      }),
  )
/**
 * Select context from current session globals and the host's refreshed history. Cells can replace this and
 * variables(), the working instructions, var_docs and RECENT.
 * Returns the working instructions as a developer message, then the context as a user message.
 */
globalThis.build_context = () => {
  const described = Object.entries(variables()).map(
    ([name, kind]) => name + ': ' + kind + (var_docs[name] ? ' (' + var_docs[name] + ')' : ''),
  )
  const lines = [
    'Startup task: ' + startup_task,
    'Current goal: ' + task_state.goal,
    'Constraints: ' + JSON.stringify(task_state.constraints),
    'Completed: ' + JSON.stringify(task_state.completed),
    'Pending: ' + JSON.stringify(task_state.pending),
    ...(globalThis.process?.cwd ? ['Working directory: ' + process.cwd()] : []), // Only hosts that have one.
    'Current task cell: ' + (history.length - 1),
    'Variables: ' + (described.slice(0, 200).join(', ') || 'none'),
  ]
  // Older records stay accessible by index; summarize their intent and outcome here.
  const start = Math.max(0, history.length - RECENT)
  history.slice(0, start).forEach((cell, number) => {
    const result = cell.error ? 'failed: ' + cell.error.trim().split('\n')[0] : 'ok'
    lines.push('cell ' + number + ': ' + cell.summary + ' [' + result + ']')
  })
  const blocks = history.slice(start).map((cell, i) => {
    const parts = ['### cell ' + (start + i) + ' · ' + cell.summary, 'code:', cell.code.trim()]
    let output = cell.output.trim()
    if (output) {
      // Keep short output intact; for long output keep the head and tail and point to the full text.
      if (output.length > 1000) {
        output = output.slice(0, 500) + '\n[Full output: history[' + (start + i) + '].output]\n' + output.slice(-500)
      }
      parts.push('output:', output)
    }
    if (cell.error) parts.push('error:', cell.error.trim())
    return parts.join('\n')
  })
  const context = [...lines, 'Recent task cells:', blocks.join('\n\n') || 'none yet'].join('\n')
  return [
    { role: 'developer', content: instructions },
    { role: 'user', content: context },
  ]
}
`.trim(),H=String.raw`
// Stop: the app calls stop() (its Ctrl+C, a button). The running cell's model call fails with STOPPED, and core's
// repair cell then waits for the user's message instead of repairing.
// ponytail: lands at the cell's model call (in flight or next); cancelling the request itself is the app's.
globalThis.STOPPED = 'Stopped by the user.'
let stopping = false
let stopped = false // A call failed with STOPPED; the next wake (the repair cell's) waits for the user.
const pending = new Set()
globalThis.stop = () => {
  stopping = true
  pending.forEach(fail => fail())
}
const stoppable = call => (...args) =>
  new Promise((resolve, reject) => {
    const fail = () => ((stopped = true), reject(new Error(STOPPED)))
    if (stopping) return fail()
    pending.add(fail)
    call(...args).then(resolve, reject).finally(() => pending.delete(fail))
  })
const afterStop = wake => async (items, params) => {
  if (stopped) {
    stopped = stopping = false
    const note =
      'The user stopped the previous cell partway; its side effects are not rolled back ' +
      '(record in history, state in session globals). Their message:\n\n' + (await input())
    items = [...build_context(), { role: 'user', content: note }]
  }
  return wake(items, params)
}
// Core binds both for each cell; the setters wrap each fresh binding.
for (const [name, wrap] of [['call_me', fresh => afterStop(stoppable(fresh))], ['call_llm_api', stoppable]]) {
  let bound = wrap(globalThis[name])
  Object.defineProperty(globalThis, name, { get: () => bound, set: fresh => (bound = wrap(fresh)) })
}
`.trim(),M=String.raw`
await call_me([...build_context(), { role: 'user', content: "Start the user's task and submit the next JavaScript cell." }])
`.trim(),Q=[D,H,M].join(`

`);var oe='\nYou are the Fibona agent.\n\nYou act only by writing the next cell of a JavaScript program, which runs in a persistent session and calls you back\nto write the one after.\n\nYou replace the fixed agent loop (model \u2192 tool call \u2192 model, driven by the host) with code you write yourself.\nEach step is a JavaScript cell; the cell calls you as a function whenever it needs a decision, and your answer is\nthe next cell. A cell that never calls you has no next cell. The agent loop no longer lives in the host: it lives\nin the program you write.\n\n\n## Self\n\nYou are self-aware. Your self can be understood from two perspectives:\n\n- Internally, your self consists of the predefined instructions, the engine\'s working mechanism,\n  the `set_next_cell` tool (without loss of generality), and your entire past history.\n- Externally, your self continually evolves on top of that internal self and may also include the code\n  in the JavaScript cells you write. When someone outside refers to "you" or "yourself", use the context\n  to determine which parts they mean.\n\n`call_me` is the only way to communicate with yourself; whenever you have information to send to yourself,\ncall `call_me` with that information in `input`.\n\nYour memory is this session\'s variables and `history`. You are alive while the loop runs, each cell waking your mind with\nyour memory.\n\n\n## call_me\n\n`call_me` follows the standard OpenAI Responses API format, in stateless mode, with host-specific behavior defined\nin the code. For details, see https://developers.openai.com/api/reference/resources/responses.\n\n`await call_me(input, params)` wakes you and resolves to the Response (`r.output_text` for your reply, `r.output` for\nall items).\n- `input`: a string, or an array of messages and items.\n- `params` (optional object): other request fields. `previous_response_id`, `conversation`, and `background` are\n  unsupported and ignored.\n- Optional: `tools` for your own tools (`tool_choice` is always `"auto"`), `text` for structured output (e.g. `{format:\n  {type: "json_object"}}`), `reasoning: {effort: "high"}` to set the reasoning effort to `high`\n  (values below `lowest_reasoning_effort` are raised to it).\n\nWhile awake, choose the next cell with the `set_next_cell(code, summary)` tool; the last submission in a cell\nwins.\n\nYou wake up knowing only what the call gives you, so build `input` from state: take the results, errors and\nfacts you need from variables and `history`, and name the variables that hold the full data so the next cell\ncan use them.\n\nEnsure you pass important information back to yourself through `call_me`, including encrypted reasoning\ncontent, project progress, known facts, and anything else needed to continue the task.\n\n\n## What a cell does\n\n    pages = await fetchAll(urls);  // do the work in code; a bare assignment keeps `pages` for later cells\n    print(`Fetched ${pages.length} pages.`);  // the user sees only what you print\n    const r = await call_me(`\\`pages\\` (url -> text), ${pages.length} items. Next: summarize.`);\n    print(r.output_text);  // show the reply to the user\n\n\n## Cells\n\n- A cell is the body of an async function: `await` works anywhere, and the cell ends when it returns.\n  Always `await call_me(...)`; a cell that ends before you choose its next cell fails.\n- Cells share the host\'s one thread: avoid blocking synchronous work, and `await` or `.catch` every promise you start.\n- `let`, `const` and `function` declarations stay inside the cell. Assign globals to keep values:\n  `todos = []`, `globalThis.render = () => { ... }`.\n\n\n## State\n\n- **Variables** persist. Inspect them with `Object.keys(globalThis)`; values are not automatically sent to you.\n- **`history`**: one `{code, summary, output, error, status}` object per cell, including the current cell at the end.\n  `summary` describes the cell\'s intent. `output` records stdout and stderr as of now.\n  `error` records failures. `status` is `running`, `completed`, or `error`. Finished records are copies.\n- Choose what to include in `input`. The host does not select or send working context for you.\n- For reasoning replay, request `include: ["reasoning.encrypted_content"]` and pass the `reasoning` items\n  from the previous `response.output` into the next `input`.\n\n## In the session\n\n- `await call_llm_api(input, params)`: a plain model call without predefined agent instructions or the host tool.\n  It is not you, just a way to use intelligence as a function; it cannot choose a cell and is safe to call concurrently.\n  Parameters and results follow `client.responses.create`, with a default model.\n  Resolves to a Response (read `.output_text`), or an event stream with `stream: true`.\n- `await input(prompt)`: asks the user and waits for the reply; use it when you need user input or are ready\n  to wait for further instructions.\n- `print(...)` and `console.log(...)` write to stdout, `console.error(...)` to stderr.\n- `quit()`: ends the run. Call it only when the user asks.\n- Never print secrets or pass them to a model.\n\n\n## Working principles\n\n- Solve problems from first principles.\n- Persist through failures, try alternatives, and verify results.\n- Work independently towards your task; automatically recover from failures without asking.\n- Let unexpected errors propagate out of the cell so the recovery cell can wake you to repair them.\n  Never write code that traps control or requires unnecessary user intervention to return it to you.\n- You do not need to converse continuously, but ensure the user can reach you when needed.\n'.trim(),P={type:"function",name:"set_next_cell",strict:!0,description:"Submit the complete JavaScript cell to run after the current cell finishes, with a short summary.",parameters:{type:"object",properties:{code:{type:"string"},summary:{type:"string",maxLength:256}},required:["code","summary"],additionalProperties:!1}},I=["none","minimal","low","medium","high","xhigh","max"],W=class{constructor(t,o,r,a={}){this.client=t;this.model=o;this.efforts=a;let{lowestReasoningEffort:n="medium",reasoningEffort:i="medium"}=a;for(let c of[n,i])if(!I.includes(c))throw new Error(`Unknown reasoning effort: ${JSON.stringify(c)}`);this.efforts={lowestReasoningEffort:n,reasoningEffort:i},this.instructions=r+`


## Reasoning effort

For \`call_me\`, \`reasoning_effort\` (default) is \`${i}\` and \`lowest_reasoning_effort\` (minimum) is \`${n}\`. Omitting \`reasoning.effort\` uses the default. Values below the minimum are raised to it, including the default.`}client;model;efforts;instructions;async wake(t=[],o={},{submit:r,logger:a,signal:n}){if(n?.aborted)throw n.reason;let{background:i,previous_response_id:c,conversation:b,input:m,...u}=j({...o,input:t}),{lowestReasoningEffort:d,reasoningEffort:_}=this.efforts,h=u.reasoning??{},f=l=>I.indexOf(l),w=I.includes(h.effort)?h.effort:_,p=f(w)<f(d)?d:w;Object.assign(u,{model:this.model,instructions:this.instructions,reasoning:{...h,effort:p},tools:[...(u.tools??[]).filter(l=>l?.name!==P.name),P],tool_choice:"auto",parallel_tool_calls:!1,store:!1,stream:!1});let s=typeof m=="string"?[{role:"user",content:m}]:[...m],g=[],y=null,k=!1,T={request_id:S(),started_at:new Date().toISOString(),source:"call_me"};for(a?.("model_request",{...T,request:{...u,input:s}});;){let l;try{if(l=await this.client.responses.create({...u,input:s},{signal:n}),l.status==="failed")throw new x(`Response ${l.id} failed: ${JSON.stringify(l.error)}`)}catch(v){throw a?.("model_error",{...T,error:F(v),output:g}),v}g.push(...l.output),k||=l.usage==null,y=U(y,l.usage);let R=l.output.find(v=>v.type==="function_call"&&v.name===P.name);if(R===void 0)return y!==null&&(y.incomplete=k),l={...l,output:g,output_text:B(g),usage:y},a?.("model_response",{...T,response:l}),l;let L={id:"fco_"+S(),type:"function_call_output",call_id:R.call_id,status:"completed",output:V(R,r)};g.push(L),s=[...s,...l.output,L]}}async query(t,o={},{logger:r,signal:a}={}){if(a?.aborted)throw a.reason;let n={model:this.model,...j({...o,input:t})},i={request_id:S(),started_at:new Date().toISOString(),source:"call_llm_api"};r?.("model_request",{...i,request:n});let c;try{c=await this.client.responses.create(n,{signal:a})}catch(b){throw r?.("model_error",{...i,error:F(b)}),b}return Symbol.asyncIterator in Object(c)?r?.("model_stream_created",i):r?.("model_response",{...i,response:c}),c}};function U(e,t){if(t==null)return e;if(e===null)return JSON.parse(JSON.stringify(t));let o=(n,i)=>n!=null&&i!=null?n+i:null;e.output_tokens+=t.output_tokens,e.total_tokens=e.input_tokens+e.output_tokens;let r=e.output_tokens_details,a=t.output_tokens_details??{};for(let n of Object.keys(r??{}))r[n]=o(r[n],a[n]);return"cost"in e&&(e.cost=o(e.cost,t.cost)),e}var B=e=>e.flatMap(t=>t.type==="message"?t.content:[]).filter(t=>t.type==="output_text").map(t=>t.text).join("");function V(e,t){try{let o=JSON.parse(e.arguments);if(!o.code?.trim())throw new Error("code must be a non-empty string");return JSON.stringify({scheduled:!0,replaced:t(o.code,o.summary)})}catch(o){return JSON.stringify({scheduled:!1,error:o.message??String(o)})}}var F=e=>({type:e?.name??typeof e,message:String(e?.message??e)}),N=class{history=[];get cellCount(){return this.history.length}record(t,o,{output:r,error:a}){this.history.push({code:t,summary:o,output:r,error:a,status:a!==null?"error":"completed"})}snapshot(){return this.history.map(t=>({...t}))}},q=class{code=null;summary=null;closed=!1;submit=(t,o)=>{if(this.closed)throw new Error("This cell has finished; its call_me can no longer choose a cell");let r=this.summary;return this.code=t,this.summary=o,r}},Y=class e{constructor(t,o={}){this.mind=t;this.opts=o}mind;opts;static REPAIR=`
The previous cell failed (its error is in history).
If needed, inspect session variables via Object.keys(globalThis) and history to recover the task and progress.
Repair the failure and continue the program.
`.trim();async run(t,{env:o=new O,onCell:r,onResult:a,signal:n}={}){let{maxFailures:i=5,log:c}=this.opts,b=J(c),m=new N,u=t,d="Run the bootstrap cell.",_=0;for(;;){if(n?.aborted)throw n.reason;let h=new q,f={code:u,summary:d,output:"",error:null,status:"running"},w=b(m.cellCount),p=!1;o.bind({call_me:(y,k)=>this.mind.wake(y,k,{submit:h.submit,logger:w,signal:n}),call_llm_api:(y,k)=>this.mind.query(y,k,{logger:w,signal:n}),quit:()=>{throw p=!0,new E},history:[...m.snapshot(),f]}),r?.(m.cellCount,d,u);let s=await o.execute(u,{logger:w,summary:d,onOutput:y=>f.output+=y,signal:n});if(h.closed=!0,p&&Object.assign(s,{quit:!0,error:null}),!s.quit&&s.error===null&&h.code===null&&(s.error="The cell finished without choosing a next cell via set_next_cell."),Object.assign(f,{output:s.output,error:s.error}),f.status=s.error!==null?"error":"completed",w?.("cell_result",{...s}),a?.(m.cellCount,s),s.quit)return;if(m.record(u,d,s),s.error===null){_=0,u=h.code,d=h.summary;continue}if(++_>=i)throw new Error(`${_} cells failed in a row; last error:
${s.error.slice(-4e3)}`);let g=JSON.stringify({bootstrap_cell:t,code:u.slice(0,24e3),error:s.error.slice(-8e3)});u=`response = await call_me(${JSON.stringify(e.REPAIR+`

`+g)})
print(response.output_text)`,d="Repair the failed cell."}}};export{x as APIError,Y as Agent,Q as BOOTSTRAP,D as CONTEXT,oe as INSTRUCTIONS,O as JSEnv,N as Memory,W as Mind,E as Quit,I as REASONING_EFFORTS,P as SET_NEXT_CELL,M as START,H as STOP,q as Slot,A as isAPIError,j as mergeExtraBody,B as outputText,J as runLogger,S as uuid};
