import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_PATH = path.join(__dirname, '.env');

loadEnv(ENV_PATH);

const CLI_PORT = readCliOption('--port', '-p');
const HOST = process.env.HOST || '127.0.0.1';
const PREFERRED_PORT = clampInt(CLI_PORT || process.env.PORT, 1024, 65535, 3000);
let ACTIVE_PORT = null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_MODELS = {
  planner: process.env.MAGI_PLANNER_MODEL || 'gpt-5.4',
  worker: process.env.MAGI_WORKER_MODEL || 'gpt-5.4-mini',
  judge: process.env.MAGI_JUDGE_MODEL || 'gpt-5.4',
  swarm: process.env.MAGI_SWARM_MODEL || 'gpt-5.4-mini',
};

const PATTERNS = ['roundtable', 'experts', 'debate', 'hierarchy', 'swarm', 'dag'];
const MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const sessions = new Map();

const TOPOLOGY_SCHEMA = {
  name: 'magi_topology',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      interpretation: { type: 'string' },
      blackboard_seed: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 8,
      },
      teams: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            goal: { type: 'string' },
            pattern: { type: 'string', enum: PATTERNS },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 6,
            },
            deliverable: { type: 'string' },
            max_rounds: { type: 'integer', minimum: 1, maximum: 3 },
            agents: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  codename: { type: 'string' },
                  role: { type: 'string' },
                  stance: { type: 'string' },
                  focus: { type: 'string' },
                  model: { type: 'string', enum: MODEL_OPTIONS },
                  weight: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['id', 'codename', 'role', 'stance', 'focus', 'model', 'weight'],
              },
            },
          },
          required: ['id', 'name', 'goal', 'pattern', 'depends_on', 'deliverable', 'max_rounds', 'agents'],
        },
      },
      final_arbitration: {
        type: 'object',
        additionalProperties: false,
        properties: {
          method: { type: 'string', enum: ['magi_majority', 'consensus', 'jury'] },
          criteria: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 6,
          },
        },
        required: ['method', 'criteria'],
      },
    },
    required: ['interpretation', 'blackboard_seed', 'teams', 'final_arbitration'],
  },
};

const CONTRIBUTION_SCHEMA = {
  name: 'agent_contribution',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      key_points: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
      },
      proposals: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      verdict: {
        type: 'string',
        enum: ['approve', 'revise', 'reject'],
      },
    },
    required: ['summary', 'key_points', 'risks', 'proposals', 'verdict'],
  },
};

const TASK_GRAPH_SCHEMA = {
  name: 'task_graph',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      tasks: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            objective: { type: 'string' },
            owner_hint: { type: 'string' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 4,
            },
          },
          required: ['id', 'title', 'objective', 'owner_hint', 'depends_on'],
        },
      },
    },
    required: ['summary', 'tasks'],
  },
};

const TEAM_SYNTHESIS_SCHEMA = {
  name: 'team_synthesis',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      deliverable: { type: 'string' },
      conclusions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 6,
      },
      unresolved: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
      },
      recommended_next_steps: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 6,
      },
      readiness: { type: 'string', enum: ['accept', 'revise', 'reject'] },
    },
    required: ['summary', 'deliverable', 'conclusions', 'unresolved', 'recommended_next_steps', 'readiness'],
  },
};

const MAGI_VOTE_SCHEMA = {
  name: 'magi_vote',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      vote: { type: 'string', enum: ['approve', 'hold', 'reject'] },
      rationale: { type: 'string' },
      amendments: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['vote', 'rationale', 'amendments', 'confidence'],
  },
};

const FINAL_REPORT_SCHEMA = {
  name: 'final_report',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      final_answer: { type: 'string' },
      key_decisions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 8,
      },
      implementation_path: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 8,
      },
      residual_risks: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      majority_vote: { type: 'string', enum: ['approve', 'hold', 'reject'] },
    },
    required: ['summary', 'final_answer', 'key_decisions', 'implementation_path', 'residual_risks', 'majority_vote'],
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, uptime: process.uptime() });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        ok: true,
        hasApiKey: Boolean(OPENAI_API_KEY),
        baseUrl: OPENAI_BASE_URL,
        patterns: PATTERNS,
        host: HOST,
        preferredPort: PREFERRED_PORT,
        activePort: ACTIVE_PORT,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      const session = createSession();
      emit(session.id, 'session_init', {
        sessionId: session.id,
        createdAt: session.createdAt,
      });
      return sendJson(res, 200, {
        ok: true,
        sessionId: session.id,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const sessionId = url.searchParams.get('session');
      const session = getSessionOrNull(sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: 'Unknown session.' });
      }
      attachSSE(session, req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await parseJson(req);
      const session = getSessionOrNull(body?.sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: 'Unknown session.' });
      }
      if (session.running) {
        return sendJson(res, 409, { ok: false, error: 'Session already running.' });
      }

      const mission = String(body?.mission || '').trim();
      if (!mission) {
        return sendJson(res, 400, { ok: false, error: 'Mission is required.' });
      }

      const config = normalizeConfig(body?.config || {});
      session.running = true;
      session.state.mission = mission;
      session.state.config = config;

      void runMagiSession(session.id, mission, config)
        .catch((error) => {
          emit(session.id, 'error', {
            message: error?.message || String(error),
            stack: process.env.NODE_ENV === 'development' ? String(error?.stack || '') : '',
          });
        })
        .finally(() => {
          const active = getSessionOrNull(session.id);
          if (active) active.running = false;
        });

      return sendJson(res, 202, {
        ok: true,
        sessionId: session.id,
        mode: config.mode,
      });
    }

    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error?.message || 'Internal server error',
    });
  }
});

void startServer();

async function startServer() {
  try {
    const port = await findAvailablePort(PREFERRED_PORT, HOST, 24);
    ACTIVE_PORT = port;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, HOST);
    });

    const displayHost = formatDisplayHost(HOST);
    console.log(`MAGI server listening on http://${displayHost}:${port}`);
    if (port !== PREFERRED_PORT) {
      console.log(`Preferred port ${PREFERRED_PORT} was busy. Automatically switched to ${port}.`);
    }
    console.log(`OpenAI API configured: ${Boolean(OPENAI_API_KEY)}`);
  } catch (error) {
    console.error('MAGI server failed to start.', error);
    process.exitCode = 1;
  }
}

async function findAvailablePort(startPort, host, maxAttempts = 16) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const port = startPort + index;
    const available = await canBindPort(port, host);
    if (available) return port;
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + maxAttempts - 1}.`);
}

function canBindPort(port, host) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
        resolve(false);
        return;
      }
      reject(error);
    });
    tester.once('listening', () => {
      tester.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(true);
      });
    });
    tester.listen(port, host);
  });
}

function formatDisplayHost(host) {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host;
}


async function runMagiSession(sessionId, mission, config) {
  const startedAt = Date.now();
  emit(sessionId, 'phase', {
    phase: 'boot',
    label: 'SYSTEM BOOT',
    status: 'running',
  });
  emit(sessionId, 'log', {
    level: 'info',
    text: `Mission accepted. Mode=${config.mode}.`,
  });

  let topology;
  if (config.mode === 'demo') {
    topology = buildDemoTopology(mission, config);
    await sleep(260);
  } else {
    topology = await designTopology(sessionId, mission, config);
  }

  emit(sessionId, 'topology', topology);
  if (topology?.health) {
    emit(sessionId, 'topology_audit', topology.health);
  }
  for (const team of topology?.teams || []) {
    if (team.syntheticTeam) {
      emit(sessionId, 'log', {
        level: 'info',
        text: `Synthetic team instantiated: ${team.name} [${team.pattern}].`,
      });
    }
    for (const agent of team.agents || []) {
      if (agent.synthetic) {
        emit(sessionId, 'subagent_generated', {
          teamId: team.id,
          agent,
        });
      }
    }
  }

  topology.blackboard_seed.forEach((note) => {
    addBlackboardNote(sessionId, {
      source: 'system',
      type: 'seed',
      text: note,
    });
  });

  const teamResults = await executeTopology(sessionId, mission, topology, config);
  const magiVotes = await runMagiArbitration(sessionId, mission, topology, teamResults, config);
  const finalReport = await synthesizeFinalReport(sessionId, mission, topology, teamResults, magiVotes, config);

  emit(sessionId, 'phase', {
    phase: 'complete',
    label: 'DECISION LOCK',
    status: 'completed',
  });
  emit(sessionId, 'final_result', {
    report: finalReport,
    votes: magiVotes,
    elapsedMs: Date.now() - startedAt,
  });
  emit(sessionId, 'log', {
    level: 'success',
    text: `MAGI consensus cycle completed in ${(Date.now() - startedAt) / 1000}s.`,
  });
}


async function designTopology(sessionId, mission, config) {
  emit(sessionId, 'phase', {
    phase: 'planner',
    label: 'TOPOLOGY SYNTHESIS',
    status: 'running',
  });

  const instructions = [
    'You are the MAGI meta-orchestrator for an EVA-inspired multi-agent runtime.',
    'Design runtime subagents and multiple collaborating teams for the mission.',
    `You may use these collaboration patterns: ${PATTERNS.join(', ')}.`,
    `Create between 2 and ${config.maxTeams} teams.`,
    `Each team may contain between 1 and ${Math.max(config.maxAgentsPerTeam, 4)} agents.`,
    'Every team must have a concise deliverable, explicit dependencies, and role separation.',
    'Teams should be mutually useful rather than redundant.',
    'Use at least one exploratory team and at least one execution-oriented or verification-oriented team.',
    'For debate teams, include roles equivalent to pro, con, reviewer, and judge.',
    'For hierarchy teams, include director/planner, executor, and validator style roles.',
    'For DAG or swarm teams, include a coordinator or planner role.',
    'Use gpt-5.4 only for critical reasoning, judgment, or orchestration roles. Use gpt-5.4-mini for most workers. Use gpt-5.4-nano only for very small support tasks.',
    'IDs must be short kebab-case strings.',
    'Return only schema-compliant JSON.',
  ].join(' ');

  const input = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Mission:\n${mission}`,
            'Constraints:',
            `- max teams: ${config.maxTeams}`,
            `- max agents per team: ${config.maxAgentsPerTeam}`,
            `- max rounds per team: ${config.maxRounds}`,
            `- prefer all-pattern coverage: ${config.preferAllPatterns}`,
            `- web search enabled: ${config.enableWebSearch}`,
            '- build for an EVA/MAGI-style decision system with visible independence, conflict, blackboard coordination, and final majority arbitration.',
            '- produce a topology that can survive partial model failure through role redundancy and clean dependencies.',
          ].join('\n'),
        },
      ],
    },
  ];

  let rawTopology;
  try {
    const result = await callStructuredModel({
      model: config.models.planner,
      instructions,
      input,
      schema: TOPOLOGY_SCHEMA,
      reasoning: { effort: 'medium' },
      tools: buildOptionalTools(config, { mission, purpose: 'topology' }),
    });
    rawTopology = result.json;
  } catch (error) {
    emit(sessionId, 'log', {
      level: 'warn',
      text: `Planner output fallback engaged: ${error?.message || String(error)}`,
    });
    rawTopology = buildHeuristicTopologyRaw(mission, config);
  }

  const topology = normalizeTopology(rawTopology, mission, config);
  emit(sessionId, 'log', {
    level: 'info',
    text: `Topology stabilized with ${topology.teams.length} team(s), ${topology.health?.agentCount || 0} agent(s), and ${topology.health?.patternCoverage?.length || 0} collaboration pattern(s).`,
  });

  emit(sessionId, 'phase', {
    phase: 'planner',
    label: 'TOPOLOGY SYNTHESIS',
    status: 'completed',
  });
  return topology;
}


async function executeTopology(sessionId, mission, topology, config) {
  emit(sessionId, 'phase', {
    phase: 'teams',
    label: 'TEAM EXECUTION',
    status: 'running',
  });

  const pending = new Map(topology.teams.map((team) => [team.id, team]));
  const completed = new Map();
  const teamResults = [];
  const order = new Map(topology.teams.map((team, index) => [team.id, index]));
  let guard = 0;

  while (pending.size > 0 && guard < Math.max(20, topology.teams.length * 4)) {
    guard += 1;
    const ready = [...pending.values()]
      .filter((team) => team.depends_on.every((dep) => completed.has(dep)))
      .sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));

    if (ready.length === 0) {
      const forced = [...pending.values()].sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0))[0];
      if (!forced) break;
      const previousDeps = forced.depends_on.slice();
      forced.depends_on = [];
      emit(sessionId, 'log', {
        level: 'warn',
        text: `Dependency deadlock detected. Releasing ${forced.name} from [${previousDeps.join(', ') || 'none'}].`,
      });
      ready.push(forced);
    }

    const layerResults = await Promise.all(
      ready.map(async (team) => {
        pending.delete(team.id);
        const upstreamResults = resolveUpstreamTeamResults(team, completed, order);
        const result = await runTeam(sessionId, mission, topology, team, upstreamResults, config);
        completed.set(team.id, result);
        teamResults.push(result);
        return result;
      })
    );

    emit(sessionId, 'team_layer_complete', {
      teams: layerResults.map((item) => item.team.id),
    });
  }

  emit(sessionId, 'phase', {
    phase: 'teams',
    label: 'TEAM EXECUTION',
    status: 'completed',
  });

  return teamResults.sort((a, b) => (order.get(a.team.id) || 0) - (order.get(b.team.id) || 0));
}

async function runTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  emit(sessionId, 'team_spawned', {
    team,
    status: 'running',
  });
  emit(sessionId, 'log', {
    level: 'info',
    text: `Running team ${team.name} [${team.pattern}] with ${team.agents.length} agent(s).`,
  });

  for (const agent of team.agents) {
    emit(sessionId, 'agent_spawned', {
      teamId: team.id,
      agent,
    });
  }

  let output;
  switch (team.pattern) {
    case 'roundtable':
      output = await runRoundtableTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    case 'experts':
      output = await runExpertsTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    case 'debate':
      output = await runDebateTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    case 'hierarchy':
      output = await runHierarchyTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    case 'swarm':
      output = await runSwarmTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    case 'dag':
      output = await runDagTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
    default:
      output = await runExpertsTeam(sessionId, mission, topology, team, priorTeamResults, config);
      break;
  }

  const result = {
    team,
    ...output,
  };

  addBlackboardNote(sessionId, {
    source: team.name,
    teamId: team.id,
    type: 'team-summary',
    text: result.synthesis.summary,
  });

  emit(sessionId, 'team_result', {
    teamId: team.id,
    pattern: team.pattern,
    result,
  });

  emit(sessionId, 'team_spawned', {
    team,
    status: 'completed',
  });

  return result;
}

async function runRoundtableTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const rounds = Math.min(team.max_rounds, config.maxRounds);
  const transcript = [];
  const contributions = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (const agent of team.agents) {
      emit(sessionId, 'agent_activity', {
        teamId: team.id,
        agentId: agent.id,
        status: 'running',
        detail: `Round ${round}`,
      });
      const contribution = await callAgentContribution({
        sessionId,
        mission,
        topology,
        team,
        agent,
        priorTeamResults,
        config,
        extraInstructions: [
          `You are speaking in round ${round} of a roundtable discussion.`,
          'You must add at least one new angle and challenge at least one assumption from prior statements.',
          `Prior roundtable transcript:\n${compactTranscript(transcript, 10)}`,
        ].join('\n\n'),
      });
      transcript.push({ round, agent: agent.codename, contribution });
      contributions.push({ round, agent, contribution });
      emit(sessionId, 'agent_result', {
        teamId: team.id,
        agentId: agent.id,
        round,
        contribution,
      });
      addBlackboardNote(sessionId, {
        source: agent.codename,
        teamId: team.id,
        agentId: agent.id,
        type: 'roundtable',
        text: contribution.summary,
      });
      emit(sessionId, 'agent_activity', {
        teamId: team.id,
        agentId: agent.id,
        status: 'completed',
        detail: `Round ${round}`,
      });
    }
  }

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions,
    extraInstructions: 'Synthesize a roundtable discussion. Preserve disagreements and convergence points.',
  });

  return { contributions, transcript, synthesis };
}

async function runExpertsTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const contributions = await Promise.all(
    team.agents.map(async (agent) => {
      emit(sessionId, 'agent_activity', {
        teamId: team.id,
        agentId: agent.id,
        status: 'running',
        detail: 'Independent expert analysis',
      });
      const contribution = await callAgentContribution({
        sessionId,
        mission,
        topology,
        team,
        agent,
        priorTeamResults,
        config,
        extraInstructions:
          'Work independently. Do not seek consensus. Maximize perspective diversity and specialist precision.',
      });
      emit(sessionId, 'agent_result', {
        teamId: team.id,
        agentId: agent.id,
        contribution,
      });
      addBlackboardNote(sessionId, {
        source: agent.codename,
        teamId: team.id,
        agentId: agent.id,
        type: 'expert',
        text: contribution.summary,
      });
      emit(sessionId, 'agent_activity', {
        teamId: team.id,
        agentId: agent.id,
        status: 'completed',
        detail: 'Independent expert analysis',
      });
      return { agent, contribution };
    })
  );

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions,
    extraInstructions: 'Perform mixture-of-agents aggregation. Merge best ideas and isolate contradictions.',
  });

  return { contributions, synthesis };
}

async function runDebateTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const roles = ensureDebateRoles(team);
  const [pro, con, reviewer, judge] = roles;

  const proContributionPromise = callAgentContribution({
    sessionId,
    mission,
    topology,
    team,
    agent: pro,
    priorTeamResults,
    config,
    extraInstructions: 'Argue FOR the strongest viable path. Be assertive and constructive.',
  });

  const conContributionPromise = callAgentContribution({
    sessionId,
    mission,
    topology,
    team,
    agent: con,
    priorTeamResults,
    config,
    extraInstructions: 'Argue AGAINST the proposed path. Attack assumptions, edge cases, and weak links.',
  });

  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: pro.id,
    status: 'running',
    detail: 'Pro argument',
  });
  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: con.id,
    status: 'running',
    detail: 'Con argument',
  });

  const [proContribution, conContribution] = await Promise.all([proContributionPromise, conContributionPromise]);

  emit(sessionId, 'agent_result', {
    teamId: team.id,
    agentId: pro.id,
    contribution: proContribution,
  });
  emit(sessionId, 'agent_result', {
    teamId: team.id,
    agentId: con.id,
    contribution: conContribution,
  });

  addBlackboardNote(sessionId, {
    source: pro.codename,
    teamId: team.id,
    agentId: pro.id,
    type: 'debate-pro',
    text: proContribution.summary,
  });
  addBlackboardNote(sessionId, {
    source: con.codename,
    teamId: team.id,
    agentId: con.id,
    type: 'debate-con',
    text: conContribution.summary,
  });

  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: reviewer.id,
    status: 'running',
    detail: 'Review and audit',
  });
  const review = await callAgentContribution({
    sessionId,
    mission,
    topology,
    team,
    agent: reviewer,
    priorTeamResults,
    config,
    extraInstructions: [
      'Review both sides and audit the quality of evidence, feasibility, and risk exposure.',
      `FOR position:\n${serializeContribution(proContribution)}`,
      `AGAINST position:\n${serializeContribution(conContribution)}`,
    ].join('\n\n'),
  });
  emit(sessionId, 'agent_result', {
    teamId: team.id,
    agentId: reviewer.id,
    contribution: review,
  });
  addBlackboardNote(sessionId, {
    source: reviewer.codename,
    teamId: team.id,
    agentId: reviewer.id,
    type: 'debate-review',
    text: review.summary,
  });
  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: reviewer.id,
    status: 'completed',
    detail: 'Review and audit',
  });

  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: judge.id,
    status: 'running',
    detail: 'Debate judgment',
  });

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions: [
      { agent: pro, contribution: proContribution },
      { agent: con, contribution: conContribution },
      { agent: reviewer, contribution: review },
    ],
    forcedLead: judge,
    extraInstructions:
      'Act as the judge in a structured debate. Render a decisive synthesis and identify the winning path and conditions.',
  });

  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: judge.id,
    status: 'completed',
    detail: 'Debate judgment',
  });

  return {
    contributions: [
      { agent: pro, contribution: proContribution },
      { agent: con, contribution: conContribution },
      { agent: reviewer, contribution: review },
    ],
    synthesis,
  };
}

async function runHierarchyTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const director = team.agents[0];
  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: director.id,
    status: 'running',
    detail: 'Hierarchical decomposition',
  });
  const taskGraph = await callTaskPlanner({
    sessionId,
    mission,
    topology,
    team,
    agent: director,
    priorTeamResults,
    config,
    extraInstructions:
      'Decompose the goal into manager/worker tasks. Keep dependencies explicit and execution-ready.',
  });
  emit(sessionId, 'task_graph', {
    teamId: team.id,
    taskGraph,
  });
  emit(sessionId, 'agent_activity', {
    teamId: team.id,
    agentId: director.id,
    status: 'completed',
    detail: 'Hierarchical decomposition',
  });

  const execution = await executeTaskGraph({
    sessionId,
    mission,
    topology,
    team,
    taskGraph,
    priorTeamResults,
    config,
    style: 'hierarchy',
  });

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions: execution.results,
    forcedLead: director,
    extraInstructions:
      'Synthesize a hierarchical workflow. Emphasize managerial decomposition, execution coverage, and control points.',
  });

  return {
    taskGraph,
    contributions: execution.results,
    tasks: execution.tasks,
    synthesis,
  };
}

async function runSwarmTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const coordinator = team.agents[0];
  const taskGraph = await callTaskPlanner({
    sessionId,
    mission,
    topology,
    team,
    agent: coordinator,
    priorTeamResults,
    config,
    extraInstructions:
      'Design a swarm-style queue. Use small tasks with low coupling and broad parallelizability. This is stigmergic blackboard coordination.',
  });

  emit(sessionId, 'task_graph', {
    teamId: team.id,
    taskGraph,
  });

  const execution = await executeTaskGraph({
    sessionId,
    mission,
    topology,
    team,
    taskGraph,
    priorTeamResults,
    config,
    style: 'swarm',
  });

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions: execution.results,
    forcedLead: coordinator,
    extraInstructions:
      'Synthesize a swarm run. Focus on blackboard coordination, emergent convergence, robustness, and throughput.',
  });

  return {
    taskGraph,
    contributions: execution.results,
    tasks: execution.tasks,
    synthesis,
  };
}

async function runDagTeam(sessionId, mission, topology, team, priorTeamResults, config) {
  const planner = team.agents[0];
  const taskGraph = await callTaskPlanner({
    sessionId,
    mission,
    topology,
    team,
    agent: planner,
    priorTeamResults,
    config,
    extraInstructions:
      'Design a DAG workflow with explicit dependency ordering and clear unlock paths.',
  });

  emit(sessionId, 'task_graph', {
    teamId: team.id,
    taskGraph,
  });

  const execution = await executeTaskGraph({
    sessionId,
    mission,
    topology,
    team,
    taskGraph,
    priorTeamResults,
    config,
    style: 'dag',
  });

  const synthesis = await synthesizeTeam({
    sessionId,
    mission,
    team,
    topology,
    priorTeamResults,
    config,
    contributions: execution.results,
    forcedLead: planner,
    extraInstructions:
      'Synthesize a DAG execution. Explain pipeline order, bottlenecks, and terminal deliverable quality.',
  });

  return {
    taskGraph,
    contributions: execution.results,
    tasks: execution.tasks,
    synthesis,
  };
}

async function executeTaskGraph({
  sessionId,
  mission,
  topology,
  team,
  taskGraph,
  priorTeamResults,
  config,
  style,
}) {
  const tasks = normalizeTaskGraph(taskGraph, team, config);
  const results = [];
  let safetyCounter = 0;

  while (tasks.some((task) => task.status !== 'completed') && safetyCounter < 24) {
    safetyCounter += 1;
    const ready = tasks.filter(
      (task) =>
        task.status === 'pending' &&
        task.depends_on.every((dep) => tasks.some((candidate) => candidate.id === dep && candidate.status === 'completed'))
    );

    if (ready.length === 0) {
      const pendingIds = tasks.filter((task) => task.status === 'pending').map((task) => task.id);
      if (pendingIds.length > 0) {
        const forced = tasks.find((task) => task.status === 'pending');
        if (forced) {
          forced.depends_on = [];
          emit(sessionId, 'log', {
            level: 'warn',
            text: `Task DAG deadlock in ${team.name}. Dependency release forced for ${forced.id}.`,
          });
        }
      }
      continue;
    }

    const batch = ready.slice(0, Math.max(1, Math.min(team.agents.length, config.maxAgentsPerTeam)));
    await Promise.all(
      batch.map(async (task, index) => {
        const agent = selectTaskAgent(team, task, index);
        task.status = 'running';
        emit(sessionId, 'task_started', {
          teamId: team.id,
          task,
          agent,
        });
        emit(sessionId, 'agent_activity', {
          teamId: team.id,
          agentId: agent.id,
          status: 'running',
          detail: `${style.toUpperCase()} task ${task.title}`,
        });

        const contribution = await callAgentContribution({
          sessionId,
          mission,
          topology,
          team,
          agent,
          priorTeamResults,
          config,
          extraInstructions: [
            `Assigned task ID: ${task.id}`,
            `Assigned task title: ${task.title}`,
            `Objective: ${task.objective}`,
            `Execution style: ${style}`,
            `Owner hint: ${task.owner_hint}`,
            `Task dependencies satisfied: ${task.depends_on.join(', ') || 'none'}`,
            'Return a concrete execution update, not abstract commentary.',
          ].join('\n'),
        });

        task.status = 'completed';
        task.result = contribution;
        const payload = { agent, contribution, task };
        results.push(payload);
        emit(sessionId, 'task_result', {
          teamId: team.id,
          task,
          agent,
          contribution,
        });
        addBlackboardNote(sessionId, {
          source: `${team.name}/${task.title}`,
          teamId: team.id,
          agentId: agent.id,
          type: `${style}-task`,
          text: contribution.summary,
        });
        emit(sessionId, 'agent_activity', {
          teamId: team.id,
          agentId: agent.id,
          status: 'completed',
          detail: `${style.toUpperCase()} task ${task.title}`,
        });
      })
    );
  }

  return { tasks, results };
}


async function runMagiArbitration(sessionId, mission, topology, teamResults, config) {
  emit(sessionId, 'phase', {
    phase: 'magi',
    label: 'MAGI ARBITRATION',
    status: 'running',
  });

  const coreProfiles = [
    {
      id: 'melchior-1',
      name: 'MELCHIOR-1',
      axis: 'Naoko as scientist',
      instructions:
        'You are MELCHIOR-1. Evaluate technical soundness, architecture quality, factual rigor, and execution feasibility. Value correctness over sentiment.',
    },
    {
      id: 'balthasar-2',
      name: 'BALTHASAR-2',
      axis: 'Naoko as mother',
      instructions:
        'You are BALTHASAR-2. Evaluate operator burden, human impact, maintainability, clarity, and long-term care. Value protective judgment and systemic empathy.',
    },
    {
      id: 'casper-3',
      name: 'CASPER-3',
      axis: 'Naoko as woman',
      instructions:
        'You are CASPER-3. Evaluate strategic instinct, adversarial resilience, elegance, and political or psychological hidden costs. Value incisive intuition and strategic sharpness.',
    },
  ];

  const teamSummaryText = teamResults
    .map(
      (result) =>
        `Team ${result.team.name} [${result.team.pattern}]\nSummary: ${result.synthesis.summary}\nDeliverable: ${result.synthesis.deliverable}\nConclusions: ${result.synthesis.conclusions.join('; ')}\nUnresolved: ${result.synthesis.unresolved.join('; ')}`
    )
    .join('\n\n');

  const votes = [];
  for (const core of coreProfiles) {
    emit(sessionId, 'magi_vote', {
      core: core.id,
      status: 'running',
    });

    let payload;
    if (config.mode === 'demo') {
      await sleep(160 + Math.random() * 120);
      payload = {
        core: core.id,
        name: core.name,
        axis: core.axis,
        ...buildDemoMagiVote(core, teamResults),
      };
    } else {
      try {
        const result = await callStructuredModel({
          model: config.models.judge,
          instructions: `${core.instructions} Return only schema-compliant JSON.`,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: [
                    `Mission:\n${mission}`,
                    `Decision criteria: ${topology.final_arbitration.criteria.join(', ')}`,
                    `Compiled team results:\n${teamSummaryText}`,
                    'Vote approve only if the current multi-team result is ready to stand. Vote hold if more iteration is needed. Vote reject if the proposed direction is materially unsound.',
                  ].join('\n\n'),
                },
              ],
            },
          ],
          schema: MAGI_VOTE_SCHEMA,
          reasoning: { effort: 'medium' },
        });

        payload = {
          core: core.id,
          name: core.name,
          axis: core.axis,
          ...result.json,
        };
      } catch (error) {
        emit(sessionId, 'log', {
          level: 'warn',
          text: `${core.name} fallback engaged: ${error?.message || String(error)}`,
        });
        payload = {
          core: core.id,
          name: core.name,
          axis: core.axis,
          ...buildDemoMagiVote(core, teamResults),
        };
      }
    }

    emit(sessionId, 'magi_vote', {
      ...payload,
      status: 'completed',
    });
    addBlackboardNote(sessionId, {
      source: core.name,
      type: 'magi-vote',
      text: `${payload.vote.toUpperCase()}: ${payload.rationale}`,
    });
    votes.push(payload);
  }

  emit(sessionId, 'phase', {
    phase: 'magi',
    label: 'MAGI ARBITRATION',
    status: 'completed',
  });
  return votes;
}


async function synthesizeFinalReport(sessionId, mission, topology, teamResults, magiVotes, config) {
  const majorityVote = computeMajorityVote(magiVotes);
  const instructions = [
    'You are the final MAGI report synthesizer.',
    'Produce the final answer after multiple teams and the MELCHIOR/BALTHASAR/CASPER chamber have finished deliberation.',
    'Honor the majority vote exactly.',
    'The final answer must be concrete, implementation-grade, and directly usable as an execution blueprint.',
    'Return only schema-compliant JSON.',
  ].join(' ');

  const input = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Mission:\n${mission}`,
            `Majority vote: ${majorityVote}`,
            `Arbitration criteria: ${topology.final_arbitration.criteria.join(', ')}`,
            `Team outputs:\n${teamResults
              .map(
                (result) =>
                  `- ${result.team.name} [${result.team.pattern}] => ${result.synthesis.summary} | Deliverable: ${result.synthesis.deliverable}`
              )
              .join('\n')}`,
            `MAGI chamber:\n${magiVotes
              .map((vote) => `- ${vote.name}: ${vote.vote} (${vote.confidence}) => ${vote.rationale}`)
              .join('\n')}`,
            'Write the final answer as a system decision memo for implementation.',
          ].join('\n\n'),
        },
      ],
    },
  ];

  if (config.mode === 'demo') {
    return buildDemoFinalReport(mission, teamResults, magiVotes);
  }

  try {
    const report = await callStructuredModel({
      model: config.models.judge,
      instructions,
      input,
      schema: FINAL_REPORT_SCHEMA,
      reasoning: { effort: 'medium' },
    });
    return report.json;
  } catch (error) {
    emit(sessionId, 'log', {
      level: 'warn',
      text: `Final report fallback engaged: ${error?.message || String(error)}`,
    });
    return buildDemoFinalReport(mission, teamResults, magiVotes);
  }
}


async function callAgentContribution({
  sessionId,
  mission,
  topology,
  team,
  agent,
  priorTeamResults,
  config,
  extraInstructions,
}) {
  if (config.mode === 'demo') {
    await sleep(220 + Math.random() * 180);
    return buildDemoContribution(agent, team, mission, extraInstructions);
  }

  const instructions = buildAgentInstructions(agent, team, config, extraInstructions);
  const input = buildAgentInput(mission, topology, team, priorTeamResults, sessionId);

  try {
    const result = await callStructuredModel({
      model: agent.model || config.models.worker,
      instructions,
      input,
      schema: CONTRIBUTION_SCHEMA,
      reasoning: { effort: 'low' },
      tools: buildOptionalTools(config, { mission, purpose: team.goal, team, agent }),
    });
    return result.json;
  } catch (error) {
    emit(sessionId, 'log', {
      level: 'warn',
      text: `Contribution fallback engaged for ${team.name}/${agent.codename}: ${error?.message || String(error)}`,
    });
    return buildDemoContribution(agent, team, mission, extraInstructions);
  }
}


async function callTaskPlanner({
  sessionId,
  mission,
  topology,
  team,
  agent,
  priorTeamResults,
  config,
  extraInstructions,
}) {
  if (config.mode === 'demo') {
    await sleep(300);
    return buildDemoTaskGraph(team);
  }

  const instructions = [
    buildAgentInstructions(agent, team, config, extraInstructions),
    'Produce an execution graph with explicit task dependencies. Favor concise, high-signal tasks.',
  ].join('\n\n');

  const input = buildAgentInput(mission, topology, team, priorTeamResults, sessionId);
  try {
    const result = await callStructuredModel({
      model: agent.model || config.models.worker,
      instructions,
      input,
      schema: TASK_GRAPH_SCHEMA,
      reasoning: { effort: 'low' },
      tools: buildOptionalTools(config, { mission, purpose: team.goal, team, agent }),
    });

    return result.json;
  } catch (error) {
    emit(sessionId, 'log', {
      level: 'warn',
      text: `Task planner fallback engaged for ${team.name}/${agent.codename}: ${error?.message || String(error)}`,
    });
    return buildDemoTaskGraph(team);
  }
}


async function synthesizeTeam({
  sessionId,
  mission,
  team,
  topology,
  priorTeamResults,
  config,
  contributions,
  extraInstructions,
  forcedLead,
}) {
  if (config.mode === 'demo') {
    await sleep(280);
    return buildDemoSynthesis(team, contributions);
  }

  const lead = forcedLead || team.agents[0];
  const instructions = [
    buildAgentInstructions(lead, team, config, extraInstructions),
    'You are the team synthesizer. Merge contributions into one decisive team deliverable while preserving unresolved risks.',
  ].join('\n\n');

  const contributionText = contributions
    .map(({ agent, contribution }, index) => {
      const name = agent?.codename || `Agent-${index + 1}`;
      return `Contributor: ${name}\n${serializeContribution(contribution)}`;
    })
    .join('\n\n');

  const input = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Mission:\n${mission}`,
            `Team:\n${team.name} [${team.pattern}]`,
            `Team goal:\n${team.goal}`,
            `Requested deliverable:\n${team.deliverable}`,
            `Relevant upstream team results:\n${compactPriorTeamResults(priorTeamResults)}`,
            `Team contributions:\n${contributionText}`,
          ].join('\n\n'),
        },
      ],
    },
  ];

  try {
    const result = await callStructuredModel({
      model: config.models.judge,
      instructions,
      input,
      schema: TEAM_SYNTHESIS_SCHEMA,
      reasoning: { effort: 'medium' },
    });
    return result.json;
  } catch (error) {
    emit(sessionId, 'log', {
      level: 'warn',
      text: `Team synthesis fallback engaged for ${team.name}: ${error?.message || String(error)}`,
    });
    return buildDemoSynthesis(team, contributions);
  }
}

async function callStructuredModel({ model, instructions, input, schema, reasoning, tools }) {
  try {
    const response = await openAIResponse({
      model,
      instructions,
      input,
      reasoning,
      tools,
      text: {
        format: {
          type: 'json_schema',
          name: schema.name,
          strict: true,
          schema: schema.schema,
        },
      },
    });
    return {
      raw: response,
      text: extractOutputText(response),
      json: extractOutputJson(response),
    };
  } catch (error) {
    const fallbackResponse = await openAIResponse({
      model,
      instructions: [
        instructions,
        'Return ONLY valid JSON. Do not wrap it in markdown fences.',
        `JSON schema to follow exactly:\n${JSON.stringify({
          name: schema.name,
          schema: schema.schema,
        })}`,
      ].join('\n\n'),
      input,
      reasoning,
      tools,
    });

    const text = extractOutputText(fallbackResponse);
    return {
      raw: fallbackResponse,
      text,
      json: parseJsonText(text),
      fallbackReason: error?.message || String(error),
    };
  }
}

async function openAIResponse(payload) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        store: false,
        ...payload,
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`OpenAI returned non-JSON payload: ${rawText.slice(0, 500)}`);
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI error ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAgentInstructions(agent, team, config, extraInstructions) {
  return [
    'You are a MAGI runtime subagent in an EVA-inspired orchestration system.',
    `Codename: ${agent.codename}.`,
    `Role: ${agent.role}.`,
    `Stance: ${agent.stance}.`,
    `Focus: ${agent.focus}.`,
    `Team: ${team.name}.`,
    `Pattern: ${team.pattern}.`,
    'Operating rules:',
    '- Stay inside your role boundary.',
    '- Be direct, specific, and execution-grade.',
    '- Preserve uncertainty as explicit risk instead of evasion.',
    '- Do not write prose outside the schema.',
    extraInstructions || '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAgentInput(mission, topology, team, priorTeamResults, sessionId) {
  const blackboard = getSessionOrNull(sessionId)?.state?.blackboard || [];
  return [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Mission:\n${mission}`,
            `System interpretation:\n${topology.interpretation}`,
            `Team goal:\n${team.goal}`,
            `Team deliverable:\n${team.deliverable}`,
            `Upstream team outputs:\n${compactPriorTeamResults(priorTeamResults)}`,
            `Blackboard snapshot:\n${compactBlackboard(blackboard, 10)}`,
          ].join('\n\n'),
        },
      ],
    },
  ];
}

function buildOptionalTools(config, context = {}) {
  if (!config.enableWebSearch) return undefined;
  const searchable = [context.mission, context.purpose, context?.team?.goal]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const shouldSearch = /research|latest|api|docs|compare|benchmark|pricing|news|release|search|調研|最新|文件|比較|研究/.test(
    searchable
  );
  return shouldSearch ? [{ type: 'web_search' }] : undefined;
}


function normalizeTopology(raw, mission, config) {
  const source = raw && typeof raw === 'object' ? raw : buildHeuristicTopologyRaw(mission, config);
  return stabilizeTopology(basicNormalizeTopology(source, mission, config), mission, config);
}

function basicNormalizeTopology(raw, mission, config) {
  const teams = Array.isArray(raw?.teams) ? raw.teams.slice(0, config.maxTeams) : [];
  const seenTeamIds = new Set();
  const normalizedTeams = teams.map((team, teamIndex) => {
    const teamId = uniqueSlug(team?.id || team?.name || `team-${teamIndex + 1}`, seenTeamIds);
    const agentsSeen = new Set();
    const rawAgents = Array.isArray(team?.agents) ? team.agents.slice(0, Math.max(config.maxAgentsPerTeam, 4)) : [];
    const agents = rawAgents.map((agent, agentIndex) => ({
      id: uniqueSlug(agent?.id || agent?.codename || `${teamId}-agent-${agentIndex + 1}`, agentsSeen),
      codename: sanitizeCodename(agent?.codename || `${teamId}-${agentIndex + 1}`),
      role: String(agent?.role || ''),
      stance: String(agent?.stance || ''),
      focus: String(agent?.focus || ''),
      model: MODEL_OPTIONS.includes(agent?.model) ? agent.model : config.models.worker,
      weight: clampNumber(agent?.weight, 0.1, 1, 0.65),
      synthetic: Boolean(agent?.synthetic),
    }));

    return {
      id: teamId,
      name: String(team?.name || `Team ${teamIndex + 1}`),
      goal: String(team?.goal || mission),
      pattern: PATTERNS.includes(team?.pattern) ? team.pattern : derivePatternFromIndex(teamIndex),
      depends_on: Array.isArray(team?.depends_on) ? team.depends_on.map((dep) => slugify(dep)).filter(Boolean) : [],
      deliverable: String(team?.deliverable || 'Team recommendation'),
      max_rounds: Math.max(1, Math.min(config.maxRounds, Number(team?.max_rounds) || 1)),
      agents,
      syntheticTeam: Boolean(team?.syntheticTeam),
      meta: {
        generatedAgentCount: 0,
      },
    };
  });

  const blackboardSeed = Array.isArray(raw?.blackboard_seed)
    ? raw.blackboard_seed.slice(0, 8).map((item) => String(item))
    : ['Mission ingested.', 'Topology stabilizing.', 'MAGI arbitration pending.'];

  return {
    interpretation: String(raw?.interpretation || 'Mission decomposed into multiple collaborating teams.'),
    blackboard_seed: blackboardSeed.length ? blackboardSeed : ['Mission ingested.'],
    teams: normalizedTeams,
    final_arbitration: {
      method:
        raw?.final_arbitration?.method === 'consensus' || raw?.final_arbitration?.method === 'jury'
          ? raw.final_arbitration.method
          : 'magi_majority',
      criteria: Array.isArray(raw?.final_arbitration?.criteria)
        ? raw.final_arbitration.criteria.slice(0, 6).map((item) => String(item))
        : ['technical validity', 'human impact', 'strategic resilience'],
    },
  };
}

function stabilizeTopology(topology, mission, config) {
  let teams = topology.teams.slice();
  const initialTeamCount = teams.length;
  const targetTeamCount = inferTargetTeamCount(mission, config, teams.length);

  if (teams.length === 0) {
    teams = basicNormalizeTopology(buildHeuristicTopologyRaw(mission, config), mission, config).teams;
  }

  teams = ensureTopologyTeamCoverage(teams, mission, config, targetTeamCount);
  teams = repairTeamDependencies(teams);
  let generatedAgentsTotal = 0;
  teams = teams.map((team, index) => {
    const expanded = expandTeamAgents(team, mission, config, index);
    generatedAgentsTotal += expanded.generatedAgentCount;
    return expanded.team;
  });

  const health = summarizeTopologyHealth(teams, initialTeamCount, generatedAgentsTotal);
  return {
    ...topology,
    teams,
    health,
  };
}

function inferTargetTeamCount(mission, config, currentCount = 0) {
  let score = 2;
  const normalizedMission = String(mission || '').toLowerCase();
  if (normalizedMission.length > 120) score += 1;
  if (/research|study|analy|compare|benchmark|design|architecture|review|audit|debate|validate|workflow|team|agent|swarm|dag|hierarchy|研究|分析|比較|設計|架構|審查|驗證|工作流|團隊|代理/.test(normalizedMission)) {
    score += 1;
  }
  if (config.preferAllPatterns) {
    score = Math.max(score, Math.min(config.maxTeams, PATTERNS.length));
  }
  return Math.max(2, Math.min(config.maxTeams, Math.max(currentCount, score)));
}

function ensureTopologyTeamCoverage(teams, mission, config, targetTeamCount) {
  const result = teams.map((team) => ({ ...team, syntheticTeam: Boolean(team.syntheticTeam), meta: { ...(team.meta || {}) } }));
  const usedPatterns = new Set(result.map((team) => team.pattern));
  const priority = getPatternPriorityForMission(mission);

  while (result.length < targetTeamCount && result.length < config.maxTeams) {
    const pattern = priority.find((item) => !usedPatterns.has(item)) || priority[result.length % priority.length];
    result.push(buildSupplementalTeam(pattern, mission, result.length, config));
    usedPatterns.add(pattern);
  }

  if (result.length < 2) {
    result.push(buildSupplementalTeam('debate', mission, result.length, config));
  }

  return result.slice(0, config.maxTeams);
}

function repairTeamDependencies(teams) {
  const ordered = teams
    .map((team, index) => ({ ...team, __order: index }))
    .sort((a, b) => {
      const pa = getPatternExecutionPriority(a.pattern);
      const pb = getPatternExecutionPriority(b.pattern);
      if (pa !== pb) return pa - pb;
      return a.__order - b.__order;
    });

  for (let index = 0; index < ordered.length; index += 1) {
    const team = ordered[index];
    const earlier = ordered.slice(0, index);
    const allowed = new Set(earlier.map((item) => item.id));
    let deps = Array.isArray(team.depends_on) ? team.depends_on.filter((dep) => allowed.has(dep) && dep !== team.id) : [];
    if (index === 0) {
      deps = [];
    } else if (deps.length === 0) {
      deps = suggestDependencies(team, earlier);
    }
    team.depends_on = Array.from(new Set(deps)).slice(0, 3);
  }

  return ordered.map(({ __order, ...team }) => team);
}

function suggestDependencies(team, earlierTeams) {
  if (!earlierTeams.length) return [];
  if (team.pattern === 'roundtable' || team.pattern === 'experts') return [];
  if (team.pattern === 'debate') return earlierTeams.slice(-2).map((item) => item.id);
  if (team.pattern === 'dag' || team.pattern === 'hierarchy' || team.pattern === 'swarm') {
    const exploratory = [...earlierTeams].reverse().find((item) => item.pattern === 'roundtable' || item.pattern === 'experts');
    return [exploratory?.id || earlierTeams[earlierTeams.length - 1].id].filter(Boolean);
  }
  return [earlierTeams[earlierTeams.length - 1].id];
}

function expandTeamAgents(team, mission, config, teamIndex = 0) {
  const blueprint = getPatternBlueprint(team.pattern, mission);
  const minimumAgents = getPatternMinimumAgents(team.pattern);
  const targetCount = Math.max(minimumAgents, Math.min(Math.max(config.maxAgentsPerTeam, minimumAgents), blueprint.length));
  const agentsSeen = new Set();
  const agents = [];
  let generatedAgentCount = 0;

  (team.agents || []).slice(0, targetCount).forEach((agent, index) => {
    const spec = blueprint[index] || blueprint[blueprint.length - 1] || buildGenericAgentSpec(team.pattern, index);
    agents.push({
      id: uniqueSlug(agent?.id || agent?.codename || `${team.id}-agent-${index + 1}`, agentsSeen),
      codename: sanitizeCodename(agent?.codename || spec.codename || `${team.id}-${index + 1}`),
      role: String(agent?.role || spec.role),
      stance: String(agent?.stance || spec.stance),
      focus: String(agent?.focus || spec.focus || mission),
      model: MODEL_OPTIONS.includes(agent?.model) ? agent.model : resolveModelTier(spec.modelTier, config),
      weight: clampNumber(agent?.weight, 0.1, 1, spec.weight ?? 0.65),
      synthetic: Boolean(agent?.synthetic),
    });
  });

  while (agents.length < targetCount) {
    const index = agents.length;
    const spec = blueprint[index] || buildGenericAgentSpec(team.pattern, index);
    agents.push(createSyntheticAgent(team, spec, agentsSeen, config));
    generatedAgentCount += 1;
  }

  normalizeAgentWeights(agents);

  return {
    team: {
      ...team,
      agents,
      meta: {
        ...(team.meta || {}),
        generatedAgentCount,
      },
    },
    generatedAgentCount,
  };
}

function createSyntheticAgent(team, spec, seen, config) {
  const rawCodename = spec.codename || spec.role || `${team.pattern}-agent`;
  return {
    id: uniqueSlug(`${team.id}-${rawCodename}`, seen),
    codename: sanitizeCodename(rawCodename),
    role: spec.role || 'Synthetic specialist',
    stance: spec.stance || 'neutral',
    focus: spec.focus || team.goal || 'mission execution',
    model: resolveModelTier(spec.modelTier, config),
    weight: clampNumber(spec.weight, 0.1, 1, 0.66),
    synthetic: true,
  };
}

function normalizeAgentWeights(agents) {
  const total = agents.reduce((sum, agent) => sum + clampNumber(agent.weight, 0.1, 1, 0.65), 0) || 1;
  agents.forEach((agent, index) => {
    const normalized = Number((clampNumber(agent.weight, 0.1, 1, 0.65) / total).toFixed(3));
    agent.weight = normalized > 0 ? normalized : Number((1 / Math.max(agents.length, 1)).toFixed(3));
    if (!agent.codename) {
      agent.codename = sanitizeCodename(agent.role || `AGENT-${index + 1}`);
    }
  });
}

function getPatternMinimumAgents(pattern) {
  return {
    roundtable: 3,
    experts: 3,
    debate: 4,
    hierarchy: 4,
    swarm: 4,
    dag: 4,
  }[pattern] || 3;
}

function getPatternBlueprint(pattern, mission) {
  const missionFocus = compactMissionDescriptor(mission);
  const blueprints = {
    roundtable: [
      { codename: 'ARCHIVIST', role: 'System researcher', stance: 'analytic', focus: `Requirements and precedent for ${missionFocus}`, modelTier: 'worker', weight: 0.72 },
      { codename: 'ARCHITECT', role: 'Systems architect', stance: 'constructive', focus: `Solution framing for ${missionFocus}`, modelTier: 'planner', weight: 0.76 },
      { codename: 'CRITIC', role: 'Failure analyst', stance: 'skeptical', focus: `Blind spots and failure modes for ${missionFocus}`, modelTier: 'worker', weight: 0.7 },
      { codename: 'SYNTH', role: 'Synthesis moderator', stance: 'integrative', focus: `Convergence and option ranking for ${missionFocus}`, modelTier: 'judge', weight: 0.74 },
    ],
    experts: [
      { codename: 'DOMAIN', role: 'Domain expert', stance: 'specialist', focus: `Domain constraints for ${missionFocus}`, modelTier: 'worker', weight: 0.7 },
      { codename: 'BUILDER', role: 'Implementation expert', stance: 'builder', focus: `Execution design for ${missionFocus}`, modelTier: 'worker', weight: 0.72 },
      { codename: 'AUDITOR', role: 'Risk expert', stance: 'skeptical', focus: `Risk, quality, and control for ${missionFocus}`, modelTier: 'worker', weight: 0.7 },
      { codename: 'LEAD', role: 'Lead synthesizer', stance: 'integrative', focus: `Evidence fusion for ${missionFocus}`, modelTier: 'judge', weight: 0.76 },
    ],
    debate: [
      { codename: 'ADVOCATE', role: 'Pro advocate', stance: 'pro', focus: `Best-case argument for ${missionFocus}`, modelTier: 'worker', weight: 0.68 },
      { codename: 'DISSENTER', role: 'Con advocate', stance: 'con', focus: `Counter-case and attack surface for ${missionFocus}`, modelTier: 'worker', weight: 0.73 },
      { codename: 'REVIEWER', role: 'Reviewer', stance: 'review', focus: `Evidence audit for ${missionFocus}`, modelTier: 'worker', weight: 0.71 },
      { codename: 'JUDGE', role: 'Judge', stance: 'judge', focus: `Decision synthesis for ${missionFocus}`, modelTier: 'judge', weight: 0.82 },
    ],
    hierarchy: [
      { codename: 'DIRECTOR', role: 'Director', stance: 'managerial', focus: `Decomposition and command for ${missionFocus}`, modelTier: 'judge', weight: 0.8 },
      { codename: 'PLANNER', role: 'Workflow planner', stance: 'structural', focus: `Work package planning for ${missionFocus}`, modelTier: 'planner', weight: 0.74 },
      { codename: 'EXECUTOR', role: 'Executor', stance: 'builder', focus: `Execution details for ${missionFocus}`, modelTier: 'worker', weight: 0.72 },
      { codename: 'VALIDATOR', role: 'Validator', stance: 'review', focus: `Gate checks for ${missionFocus}`, modelTier: 'worker', weight: 0.71 },
    ],
    swarm: [
      { codename: 'COORD', role: 'Swarm coordinator', stance: 'coordinator', focus: `Blackboard orchestration for ${missionFocus}`, modelTier: 'swarm', weight: 0.77 },
      { codename: 'SCOUT', role: 'Scout', stance: 'explorer', focus: `Parallel discovery for ${missionFocus}`, modelTier: 'worker', weight: 0.68 },
      { codename: 'BUILDER', role: 'Builder', stance: 'builder', focus: `Rapid task execution for ${missionFocus}`, modelTier: 'worker', weight: 0.7 },
      { codename: 'CHECKER', role: 'Validator', stance: 'review', focus: `Convergence and robustness for ${missionFocus}`, modelTier: 'worker', weight: 0.71 },
    ],
    dag: [
      { codename: 'PLANNER', role: 'Workflow planner', stance: 'planner', focus: `Task graph design for ${missionFocus}`, modelTier: 'planner', weight: 0.78 },
      { codename: 'EXECUTOR', role: 'Executor', stance: 'builder', focus: `Primary execution for ${missionFocus}`, modelTier: 'worker', weight: 0.7 },
      { codename: 'INTEGRATOR', role: 'Integrator', stance: 'integration', focus: `Artifact integration for ${missionFocus}`, modelTier: 'worker', weight: 0.72 },
      { codename: 'VERIFIER', role: 'Verifier', stance: 'review', focus: `Dependency correctness for ${missionFocus}`, modelTier: 'worker', weight: 0.72 },
    ],
  };
  return blueprints[pattern] || [buildGenericAgentSpec(pattern, 0), buildGenericAgentSpec(pattern, 1), buildGenericAgentSpec(pattern, 2)];
}

function buildGenericAgentSpec(pattern, index = 0) {
  return {
    codename: `${sanitizeCodename(pattern || 'agent')}-${index + 1}`,
    role: `Specialist ${index + 1}`,
    stance: 'neutral',
    focus: `${pattern || 'general'} execution`,
    modelTier: 'worker',
    weight: 0.66,
  };
}

function resolveModelTier(tier, config) {
  if (tier === 'judge') return config.models.judge;
  if (tier === 'planner') return config.models.planner;
  if (tier === 'swarm') return config.models.swarm;
  return config.models.worker;
}

function getPatternPriorityForMission(mission) {
  const lower = String(mission || '').toLowerCase();
  if (/swarm|blackboard|parallel|並行|黑板/.test(lower)) {
    return ['roundtable', 'swarm', 'dag', 'debate', 'hierarchy', 'experts'];
  }
  if (/review|audit|critic|risk|審查|風險|批判/.test(lower)) {
    return ['experts', 'roundtable', 'dag', 'debate', 'hierarchy', 'swarm'];
  }
  if (/implement|build|code|js|frontend|ui|實作|實現|程式|介面/.test(lower)) {
    return ['roundtable', 'dag', 'hierarchy', 'debate', 'swarm', 'experts'];
  }
  return ['roundtable', 'experts', 'dag', 'hierarchy', 'swarm', 'debate'];
}

function getPatternExecutionPriority(pattern) {
  return {
    roundtable: 1,
    experts: 1,
    hierarchy: 2,
    dag: 2,
    swarm: 2,
    debate: 3,
  }[pattern] || 4;
}

function derivePatternFromIndex(index) {
  return PATTERNS[index % PATTERNS.length];
}

function buildSupplementalTeam(pattern, mission, index, config) {
  const idBase = {
    roundtable: 'research-council',
    experts: 'expert-array',
    dag: 'execution-grid',
    hierarchy: 'command-lattice',
    swarm: 'swarm-cell',
    debate: 'adversarial-jury',
  }[pattern] || `team-${index + 1}`;

  const name = {
    roundtable: 'RESEARCH COUNCIL',
    experts: 'EXPERT ARRAY',
    dag: 'EXECUTION GRID',
    hierarchy: 'COMMAND LATTICE',
    swarm: 'SWARM CELL',
    debate: 'ADVERSARIAL JURY',
  }[pattern] || `TEAM ${index + 1}`;

  const goal = {
    roundtable: `Frame the mission and expand the option space for: ${mission}`,
    experts: `Produce independent specialist analyses for: ${mission}`,
    dag: `Convert the strongest path into an executable dependency graph for: ${mission}`,
    hierarchy: `Decompose delivery ownership and control gates for: ${mission}`,
    swarm: `Distribute low-coupling tasks through blackboard coordination for: ${mission}`,
    debate: `Challenge the candidate solution through structured conflict and judgment for: ${mission}`,
  }[pattern] || mission;

  const deliverable = {
    roundtable: 'Problem framing, options, and fault lines',
    experts: 'Independent specialist findings and synthesis inputs',
    dag: 'Actionable DAG and execution sequence',
    hierarchy: 'Command plan, work packages, and review gates',
    swarm: 'Parallelized work queue and convergence report',
    debate: 'Go/no-go critique with amendments',
  }[pattern] || 'Team recommendation';

  return {
    id: idBase,
    name,
    goal,
    pattern,
    depends_on: [],
    deliverable,
    max_rounds: pattern === 'roundtable' ? Math.min(2, config.maxRounds) : 1,
    agents: [],
    syntheticTeam: true,
    meta: {
      generatedAgentCount: 0,
    },
  };
}

function summarizeTopologyHealth(teams, initialTeamCount, generatedAgentsTotal) {
  const patternCoverage = [...new Set(teams.map((team) => team.pattern))];
  const agentCount = teams.reduce((sum, team) => sum + (team.agents?.length || 0), 0);
  const dependencyCount = teams.reduce((sum, team) => sum + (team.depends_on?.length || 0), 0);
  const syntheticTeams = teams.filter((team) => team.syntheticTeam).length;
  return {
    teamCount: teams.length,
    agentCount,
    dependencyCount,
    syntheticTeams,
    syntheticAgents: generatedAgentsTotal,
    patternCoverage,
    summary: `Topology stable // ${teams.length} team(s) // ${agentCount} agent(s) // ${patternCoverage.length} pattern(s) // ${generatedAgentsTotal} synthetic subagent(s)`,
    grewFrom: initialTeamCount,
  };
}

function resolveUpstreamTeamResults(team, completed, orderMap) {
  const ids = Array.isArray(team?.depends_on) && team.depends_on.length > 0 ? team.depends_on : [];
  return ids
    .map((id) => completed.get(id))
    .filter(Boolean)
    .sort((a, b) => (orderMap.get(a.team.id) || 0) - (orderMap.get(b.team.id) || 0));
}

function sanitizeCodename(value) {
  const tokens = String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const joined = tokens.join('-').toUpperCase();
  return (joined || 'AGENT').slice(0, 18);
}

function compactMissionDescriptor(mission) {
  const text = String(mission || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'the mission';
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function buildHeuristicTopologyRaw(mission, config) {
  const patterns = getPatternPriorityForMission(mission).slice(
    0,
    Math.max(2, Math.min(config.maxTeams, config.preferAllPatterns ? PATTERNS.length : 3))
  );
  const teams = patterns.map((pattern, index) => buildSupplementalTeam(pattern, mission, index, config));
  return {
    interpretation:
      'The mission is decomposed into exploratory, execution, and adversarial decision cells that can be stabilized into a MAGI-style runtime.',
    blackboard_seed: [
      'Mission accepted into MAGI queue.',
      'Dynamic team generation authorized.',
      'Shared blackboard initialized for stigmergic coordination.',
    ],
    teams,
    final_arbitration: {
      method: 'magi_majority',
      criteria: ['technical validity', 'operator burden', 'strategic resilience'],
    },
  };
}

function normalizeTaskGraph(taskGraph, team, config) {
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks.slice(0, 8) : [];
  const seen = new Set();
  const normalized = tasks.map((task, index) => ({
    id: uniqueSlug(task?.id || task?.title || `task-${index + 1}`, seen),
    title: String(task?.title || `Task ${index + 1}`),
    objective: String(task?.objective || 'Produce a concrete result.'),
    owner_hint: String(task?.owner_hint || team.agents[index % team.agents.length]?.codename || 'any'),
    depends_on: Array.isArray(task?.depends_on) ? task.depends_on.map((dep) => slugify(dep)).filter(Boolean) : [],
    status: 'pending',
  }));
  const validIds = new Set(normalized.map((task) => task.id));
  normalized.forEach((task, index) => {
    task.depends_on = task.depends_on.filter((dep) => dep !== task.id && validIds.has(dep));
    if (index === 0 && task.depends_on.length > 0) task.depends_on = [];
  });

  if (normalized.length === 0) {
    return [
      {
        id: 'task-1',
        title: 'Primary execution',
        objective: 'Deliver the main result.',
        owner_hint: team.agents[0]?.codename || 'lead',
        depends_on: [],
        status: 'pending',
      },
      {
        id: 'task-2',
        title: 'Validation and hardening',
        objective: 'Stress-test and refine the primary result.',
        owner_hint: team.agents[1]?.codename || team.agents[0]?.codename || 'lead',
        depends_on: ['task-1'],
        status: 'pending',
      },
    ];
  }

  return normalized.slice(0, Math.max(2, Math.min(8, config.maxAgentsPerTeam * 2)));
}


function selectTaskAgent(team, task, index = 0) {
  const hint = String(task?.owner_hint || '').trim().toLowerCase();
  const direct = team.agents.find(
    (agent) =>
      agent.id?.toLowerCase() === hint ||
      agent.codename?.toLowerCase() === hint ||
      agent.role?.toLowerCase() === hint
  );
  if (direct) return direct;

  const fuzzy = team.agents.find(
    (agent) =>
      agent.codename?.toLowerCase().includes(hint) ||
      agent.role?.toLowerCase().includes(hint) ||
      hint.includes(agent.codename?.toLowerCase() || '')
  );
  if (fuzzy) return fuzzy;

  return team.agents[index % team.agents.length];
}

function ensureDebateRoles(team) {
  const baseAgents = team.agents.slice(0, 4);
  while (baseAgents.length < 4) {
    baseAgents.push({
      id: `${team.id}-synthetic-${baseAgents.length + 1}`,
      codename: `${team.name.toUpperCase().slice(0, 6)}-${baseAgents.length + 1}`,
      role: ['Pro advocate', 'Con advocate', 'Reviewer', 'Judge'][baseAgents.length],
      stance: ['pro', 'con', 'review', 'judge'][baseAgents.length],
      focus: team.goal,
      model: DEFAULT_MODELS.worker,
      weight: 0.7,
    });
  }

  baseAgents[0] = { ...baseAgents[0], role: 'Pro advocate', stance: 'pro' };
  baseAgents[1] = { ...baseAgents[1], role: 'Con advocate', stance: 'con' };
  baseAgents[2] = { ...baseAgents[2], role: 'Reviewer', stance: 'review' };
  baseAgents[3] = { ...baseAgents[3], role: 'Judge', stance: 'judge', model: DEFAULT_MODELS.judge };
  return baseAgents;
}

function computeMajorityVote(votes) {
  const counts = { approve: 0, hold: 0, reject: 0 };
  for (const vote of votes) {
    if (vote && counts[vote.vote] !== undefined) counts[vote.vote] += 1;
  }
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ordered[0]?.[0] || 'hold';
}

function serializeContribution(contribution) {
  return [
    `Summary: ${contribution.summary}`,
    `Key points: ${contribution.key_points.join('; ')}`,
    `Risks: ${contribution.risks.join('; ')}`,
    `Proposals: ${contribution.proposals.join('; ')}`,
    `Verdict: ${contribution.verdict}`,
  ].join('\n');
}

function compactTranscript(transcript, limit = 8) {
  if (!Array.isArray(transcript) || transcript.length === 0) return 'No prior transcript.';
  return transcript
    .slice(-limit)
    .map((item) => `[R${item.round}] ${item.agent}: ${item.contribution.summary}`)
    .join('\n');
}

function compactPriorTeamResults(priorTeamResults) {
  if (!Array.isArray(priorTeamResults) || priorTeamResults.length === 0) {
    return 'No upstream team results yet.';
  }
  return priorTeamResults
    .slice(-6)
    .map(
      (result) =>
        `${result.team.name} [${result.team.pattern}] => ${result.synthesis.summary} | Conclusions: ${result.synthesis.conclusions.join('; ')}`
    )
    .join('\n');
}

function compactBlackboard(blackboard, limit = 10) {
  if (!Array.isArray(blackboard) || blackboard.length === 0) return 'Blackboard empty.';
  return blackboard
    .slice(-limit)
    .map((item) => `[${item.type}] ${item.source}: ${item.text}`)
    .join('\n');
}

function addBlackboardNote(sessionId, note) {
  const session = getSessionOrNull(sessionId);
  if (!session) return;
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: note.source || 'unknown',
    teamId: note.teamId || null,
    agentId: note.agentId || null,
    type: note.type || 'note',
    text: note.text || '',
  };
  session.state.blackboard.push(entry);
  session.state.blackboard = session.state.blackboard.slice(-80);
  emit(sessionId, 'blackboard_note', entry);
}

function createSession() {
  const session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    history: [],
    clients: new Set(),
    state: {
      blackboard: [],
      mission: '',
      config: null,
    },
    running: false,
  };
  sessions.set(session.id, session);
  return session;
}

function getSessionOrNull(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) return null;
  return sessions.get(sessionId);
}

function emit(sessionId, event, payload) {
  const session = getSessionOrNull(sessionId);
  if (!session) return;
  const entry = {
    id: session.history.length + 1,
    event,
    payload,
    ts: Date.now(),
  };
  session.history.push(entry);
  session.history = session.history.slice(-800);
  for (const client of session.clients) {
    writeSSE(client, entry);
  }
}

function attachSSE(session, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 1000\n\n`);

  session.clients.add(res);
  for (const entry of session.history) {
    writeSSE(res, entry);
  }

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    session.clients.delete(res);
  });
}

function writeSSE(res, entry) {
  res.write(`id: ${entry.id}\n`);
  res.write(`event: ${entry.event}\n`);
  res.write(`data: ${JSON.stringify(entry.payload)}\n\n`);
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (!(filePath === publicRoot || filePath.startsWith(`${publicRoot}${path.sep}`))) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
  }
  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      return serveStatic(path.join(requested, 'index.html'), res);
    }
    const ext = path.extname(filePath).toLowerCase();
    const content = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

async function parseJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) {
      throw new Error('Request too large.');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        parts.push(content.text);
      }
      if (content?.type === 'text' && typeof content?.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractOutputJson(response) {
  const text = extractOutputText(response);
  return parseJsonText(text);
}

function parseJsonText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Model returned empty text; JSON expected.');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try {
      return JSON.parse(fenced);
    } catch {
      const firstBrace = fenced.indexOf('{');
      const lastBrace = fenced.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(fenced.slice(firstBrace, lastBrace + 1));
      }
      throw new Error(`Unable to parse model JSON: ${text.slice(0, 500)}`);
    }
  }
}


function normalizeConfig(input) {
  const mode = String(input.mode || 'live').toLowerCase() === 'demo' ? 'demo' : 'live';
  return {
    mode,
    maxTeams: clampInt(input.maxTeams, 2, 6, 6),
    maxAgentsPerTeam: clampInt(input.maxAgentsPerTeam, 2, 4, 4),
    maxRounds: clampInt(input.maxRounds, 1, 3, 2),
    preferAllPatterns: Boolean(input.preferAllPatterns ?? true),
    enableWebSearch: Boolean(input.enableWebSearch ?? false),
    models: {
      planner: DEFAULT_MODELS.planner,
      worker: DEFAULT_MODELS.worker,
      judge: DEFAULT_MODELS.judge,
      swarm: DEFAULT_MODELS.swarm,
    },
  };
}

function sanitizeModel(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function uniqueSlug(value, seen) {
  let base = slugify(value) || 'item';
  let candidate = base;
  let counter = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }
  seen.add(candidate);
  return candidate;
}

function readCliOption(...keys) {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    for (const key of keys) {
      if (value === key) {
        return args[index + 1] || '';
      }
      if (value.startsWith(`${key}=`)) {
        return value.slice(key.length + 1);
      }
    }
  }
  return '';
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function buildDemoTopology(mission, config) {
  return normalizeTopology(buildHeuristicTopologyRaw(mission, config), mission, {
    ...config,
    preferAllPatterns: true,
  });
}

function buildDemoMagiVote(core, teamResults) {
  const readiness = teamResults.map((result) => result?.synthesis?.readiness || 'accept');
  const anyReject = readiness.includes('reject');
  const anyRevise = readiness.includes('revise');

  if (anyReject) {
    return {
      vote: 'reject',
      rationale: `${core.name} detects a material weakness in the current multi-team outcome and blocks release pending redesign.`,
      amendments: [
        'Rebuild the team topology around a narrower objective boundary.',
        'Increase validation depth before final exposure.',
        'Tighten role separation and decision contracts.',
      ],
      confidence: 0.74,
    };
  }

  const maps = {
    'melchior-1': {
      vote: 'approve',
      rationale:
        'Technical architecture, team decomposition, and arbitration mechanics are coherent enough to proceed to implementation.',
      amendments: [
        'Lock schemas for every agent response.',
        'Add tracing around planner and team synthesis steps.',
        'Keep OpenAI credentials server-side only.',
      ],
      confidence: 0.86,
    },
    'balthasar-2': {
      vote: anyRevise ? 'hold' : 'approve',
      rationale:
        'Human-operational burden is acceptable, but observability and maintainability should be strengthened before exposure to production traffic.',
      amendments: [
        'Surface blackboard state and per-team cost telemetry in the UI.',
        'Add clearer operator controls for rerun, hold, and audit.',
        'Document failure modes for each collaboration pattern.',
      ],
      confidence: anyRevise ? 0.71 : 0.78,
    },
    'casper-3': {
      vote: 'approve',
      rationale:
        'The topology is strategically resilient because it combines parallel teams, adversarial review, and a final three-core arbitration chamber.',
      amendments: [
        'Retain a debate lane for hostile review.',
        'Allow selective escalation to stronger models for critical nodes.',
        'Persist decision deltas for postmortem analysis.',
      ],
      confidence: 0.83,
    },
  };

  return maps[core.id] || {
    vote: 'hold',
    rationale: `${core.name} requests one more review cycle before release.`,
    amendments: ['Repeat arbitration with stricter constraints.'],
    confidence: 0.66,
  };
}

function buildDemoContribution(agent, team, mission, extraInstructions) {
  const cue = String(extraInstructions || '').split('\n')[0] || team.goal;
  return {
    summary: `${agent.codename} isolates a mission-relevant perspective for ${team.name}: ${cue.toLowerCase()}.`,
    key_points: [
      `${agent.codename} identifies a primary control surface for the mission.`,
      `${agent.codename} reframes ${team.pattern} work around concrete output quality.`,
      `${agent.codename} narrows ambiguity into explicit interfaces and checks.`,
    ],
    risks: [
      'Integration may drift without a shared contract.',
      'Parallel work can duplicate effort if dependencies remain vague.',
      'Final arbitration can stall if unresolved risks are not surfaced early.',
    ],
    proposals: [
      'Codify an explicit schema for each agent deliverable.',
      'Keep a shared blackboard that records assumptions and decision deltas.',
      'Use a final chamber vote before exposing the answer externally.',
    ],
    verdict: ['approve', 'revise', 'reject'][Math.floor(Math.random() * 3)],
  };
}

function buildDemoTaskGraph(team) {
  return {
    summary: `${team.name} generates a compact execution graph.`,
    tasks: [
      {
        id: `${team.id}-plan`,
        title: 'Shape execution contract',
        objective: 'Define the exact output contract and interfaces for this team.',
        owner_hint: team.agents[0]?.codename || 'lead',
        depends_on: [],
      },
      {
        id: `${team.id}-build`,
        title: 'Execute main workstream',
        objective: 'Produce the concrete team deliverable with implementable detail.',
        owner_hint: team.agents[1]?.codename || team.agents[0]?.codename || 'lead',
        depends_on: [`${team.id}-plan`],
      },
      {
        id: `${team.id}-verify`,
        title: 'Stress-test result',
        objective: 'Challenge assumptions, catch contradictions, and prepare amendments.',
        owner_hint: team.agents[2]?.codename || team.agents[0]?.codename || 'lead',
        depends_on: [`${team.id}-build`],
      },
    ],
  };
}

function buildDemoSynthesis(team, contributions) {
  const names = contributions.map((item) => item.agent?.codename).filter(Boolean);
  return {
    summary: `${team.name} converges on a usable result after combining ${names.join(', ')}.`,
    deliverable: `${team.name} delivers a ${team.pattern}-driven output with explicit actions and constraints.`,
    conclusions: [
      'The strongest path is one with explicit schemas and visible role isolation.',
      'Team-level synthesis should happen after independent specialist work.',
      'Final arbitration benefits from three different decision axes rather than one monolithic agent.',
    ],
    unresolved: [
      'Model cost must be tuned against orchestration depth.',
      'Tool-enabled agents need tighter approval and auditing policies.',
    ],
    recommended_next_steps: [
      'Lock the agent schemas and event contracts.',
      'Run the full topology with a real OpenAI key.',
      'Instrument traces and usage metrics per team.',
    ],
    readiness: 'accept',
  };
}

function buildDemoFinalReport(mission, teamResults, magiVotes) {
  const majorityVote = computeMajorityVote(magiVotes);
  return {
    summary: 'The MAGI chamber accepts the multi-team result with targeted amendments.',
    final_answer: `For the mission “${mission}”, the system should use a planner-driven topology generator, multiple specialized teams with distinct collaboration patterns, a shared blackboard, and a final MELCHIOR/BALTHASAR/CASPER majority vote.`,
    key_decisions: [
      'Use dynamic team generation instead of a fixed pipeline.',
      'Combine roundtable, DAG, debate, and MAGI majority arbitration in one runtime.',
      'Keep the OpenAI API strictly server-side and broadcast only orchestration events to the UI.',
      'Represent final decision readiness as approve/hold/reject rather than a single scalar score.',
    ],
    implementation_path: [
      'Generate topology from the mission using structured outputs.',
      'Spawn runtime subagents with isolated prompts and explicit roles.',
      'Execute independent teams in dependency-aware layers.',
      'Maintain a blackboard for stigmergic coordination and visible UI telemetry.',
      'Run MELCHIOR, BALTHASAR, and CASPER as the final three-agent chamber.',
    ],
    residual_risks: [
      'Latency and token cost rise with broader team topologies.',
      'Poor schemas can collapse role separation and reduce diversity.',
      'Without observability, failures in team synthesis can be hard to diagnose.',
    ],
    majority_vote: majorityVote,
  };
}
