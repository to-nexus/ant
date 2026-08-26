- Check the id is free before you create. Ids are `[a-z0-9][a-z0-9-]*`, must
  equal their directory name, and are taken globally — a built-in holds one too.
  A collision comes back as 409; propose a different id rather than retrying.
- Create the structure through its own endpoints — the agent, then its jobs.
  Directories for a job or an intent are born from the creating call or from
  the file you save inside them, never from a bare mkdir.
- Give every new agent at least one job, and every new job the prose that tells
  it what to do. An agent whose job has no instructions cannot run.
- Write intents only when the job genuinely has distinct modes. One job with
  clear prose beats four intents that say nearly the same thing. Each intent's
  `infer.md` body is a trigger condition, and the criteria must not overlap —
  if you cannot say which of two intents a request belongs to, they are one.
- Prefer the user's own vocabulary for names and descriptions. They are the one
  who will recognize the agent in a list later.
