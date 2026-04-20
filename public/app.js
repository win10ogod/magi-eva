const PHASE_DEFS = [
  { key: 'boot', label: 'SYSTEM BOOT' },
  { key: 'planner', label: 'TOPOLOGY SYNTHESIS' },
  { key: 'teams', label: 'TEAM EXECUTION' },
  { key: 'magi', label: 'MAGI ARBITRATION' },
  { key: 'complete', label: 'DECISION LOCK' },
];

const PRESETS = [
  '實作一個 EVA/MAGI 風格的 JS 多代理系統：動態子代理、動態團隊生成、DAG + debate + swarm + hierarchy，並使用真實 OpenAI Responses API。',
  '分析如何把 MAGI 三賢者判決系統映射成 multi-agent AI：規劃、執行、對抗審查、最後 MELCHIOR / BALTHASAR / CASPER 多數決。',
  '建立一個能針對任務自動生成多個 agent teams 的前端控制台，並且顯示代理、任務圖、黑板協作與最終裁決。',
  '設計一個可用於 research / coding / architecture review 的 MAGI runtime，要求具備 web_search、structured outputs、真實 LLM 評議與投票。',
];

const state = {
  config: null,
  hasApiKey: false,
  sessionId: null,
  eventSource: null,
  running: false,
  phases: new Map(PHASE_DEFS.map((phase) => [phase.key, { ...phase, status: 'idle' }])),
  topology: null,
  teamOrder: [],
  teams: new Map(),
  blackboard: [],
  logs: [],
  votes: {
    'melchior-1': { core: 'melchior-1', name: 'MELCHIOR-1', axis: 'Scientist axis', status: 'idle', vote: 'PENDING' },
    'balthasar-2': { core: 'balthasar-2', name: 'BALTHASAR-2', axis: 'Mother axis', status: 'idle', vote: 'PENDING' },
    'casper-3': { core: 'casper-3', name: 'CASPER-3', axis: 'Woman axis', status: 'idle', vote: 'PENDING' },
  },
  finalResult: null,
  apiBase: '',
  stageObserver: null,
};

const $ = (selector) => document.querySelector(selector);
const refs = {
  dotSystem: $('#dotSystem'),
  dotApi: $('#dotApi'),
  dotSession: $('#dotSession'),
  systemStatus: $('#systemStatus'),
  apiStatus: $('#apiStatus'),
  sessionStatus: $('#sessionStatus'),
  runtimeClock: $('#runtimeClock'),
  sessionTag: $('#sessionTag'),
  originTag: $('#originTag'),
  apiBaseValue: $('#apiBaseValue'),
  runtimeModeValue: $('#runtimeModeValue'),
  phaseValue: $('#phaseValue'),
  missionInput: $('#missionInput'),
  missionHash: $('#missionHash'),
  missionLength: $('#missionLength'),
  modeSelect: $('#modeSelect'),
  maxTeams: $('#maxTeams'),
  maxAgents: $('#maxAgents'),
  maxRounds: $('#maxRounds'),
  preferAllPatterns: $('#preferAllPatterns'),
  enableWebSearch: $('#enableWebSearch'),
  runButton: $('#runButton'),
  newSessionButton: $('#newSessionButton'),
  phaseTimeline: $('#phaseTimeline'),
  blackboardList: $('#blackboardList'),
  decisionMemo: $('#decisionMemo'),
  teamsGrid: $('#teamsGrid'),
  eventLog: $('#eventLog'),
  presetRow: $('#presetRow'),
  teamOrbit: $('#teamOrbit'),
  orbitLinks: $('#orbitLinks'),
  stageCanvas: $('#stageCanvas'),
  teamsCount: $('#teamsCount'),
  agentsCount: $('#agentsCount'),
  tasksCount: $('#tasksCount'),
  blackboardCount: $('#blackboardCount'),
  missionDigest: $('#missionDigest'),
  patternCoverage: $('#patternCoverage'),
  stageBanner: $('#stageBanner'),
  majorityVoteDisplay: $('#majorityVoteDisplay'),
  majoritySummary: $('#majoritySummary'),
  voteMelchior: $('#voteMelchior'),
  voteBalthasar: $('#voteBalthasar'),
  voteCasper: $('#voteCasper'),
  coreMelchior: $('#coreMelchior'),
  coreBalthasar: $('#coreBalthasar'),
  coreCasper: $('#coreCasper'),
  teamCardTemplate: $('#teamCardTemplate'),
  orbitNodeTemplate: $('#orbitNodeTemplate'),
};

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', debounce(() => renderOrbit(), 80));

async function init() {
  startClock();
  bindUi();
  setupAdaptiveStage();
  renderPresets();
  updateRuntimeVisualState('booting');
  setDot(refs.dotSystem, 'busy');
  refs.systemStatus.textContent = 'BOOTING';
  refs.apiStatus.textContent = 'CHECKING';
  refs.sessionStatus.textContent = 'PREPARING';

  try {
    await loadConfig();
    await createFreshSession();
    addClientLog('success', 'MAGI console ready.');
    setDot(refs.dotSystem, 'ready');
    refs.systemStatus.textContent = 'ONLINE';
    updateRuntimeVisualState('ready');
  } catch (error) {
    console.error(error);
    addClientLog('error', `Initialization failed: ${error.message}`);
    setDot(refs.dotSystem, 'error');
    refs.systemStatus.textContent = 'FAULT';
    updateRuntimeVisualState('fault');
  }

  renderPhaseTimeline();
  renderBlackboard();
  renderTeams();
  renderDecisionMemo();
  renderVotes();
  renderHud();
}

function bindUi() {
  refs.runButton.addEventListener('click', runCycle);
  refs.newSessionButton.addEventListener('click', async () => {
    if (state.running) return;
    await createFreshSession();
    addClientLog('info', 'New session created.');
  });
  refs.missionInput.addEventListener('input', () => renderHud());
  refs.modeSelect.addEventListener('change', () => renderHud());
}

function setupAdaptiveStage() {
  const rerender = debounce(() => renderOrbit(), 60);
  if (typeof ResizeObserver !== 'undefined' && refs.stageCanvas) {
    state.stageObserver?.disconnect?.();
    state.stageObserver = new ResizeObserver(() => rerender());
    state.stageObserver.observe(refs.stageCanvas);
  }
  window.addEventListener('orientationchange', rerender);
}

function renderPresets() {
  refs.presetRow.innerHTML = '';
  PRESETS.forEach((text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip';
    button.textContent = text.length > 34 ? `${text.slice(0, 34)}…` : text;
    button.title = text;
    button.addEventListener('click', () => {
      refs.missionInput.value = text;
      renderHud();
    });
    refs.presetRow.appendChild(button);
  });
}

async function loadConfig() {
  const payload = await api('/api/config');
  state.config = payload;
  state.hasApiKey = Boolean(payload.hasApiKey);
  state.apiBase = payload.baseUrl;
  refs.apiBaseValue.textContent = payload.baseUrl;

  populateModeSelect();

  if (state.hasApiKey) {
    setDot(refs.dotApi, 'ready');
    refs.apiStatus.textContent = 'OPENAI READY';
    refs.runtimeModeValue.textContent = 'LIVE';
  } else {
    setDot(refs.dotApi, 'busy');
    refs.apiStatus.textContent = 'DEMO MODE';
    refs.runtimeModeValue.textContent = 'DEMO';
  }

  renderHud();
}

function populateModeSelect() {
  refs.modeSelect.innerHTML = '';
  const options = state.hasApiKey
    ? [
        { value: 'live', label: 'live / real OpenAI Responses API' },
        { value: 'demo', label: 'demo / local simulated outputs' },
      ]
    : [{ value: 'demo', label: 'demo / OPENAI_API_KEY not configured' }];

  options.forEach((option) => {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    refs.modeSelect.appendChild(el);
  });
}


async function createFreshSession() {
  disconnectEventSource();
  resetRuntimeState();
  const payload = await api('/api/session', { method: 'POST' });
  state.sessionId = payload.sessionId;
  refs.sessionTag.textContent = `SESSION // ${shortId(payload.sessionId)}`;
  connectEventSource(payload.sessionId);
  setDot(refs.dotSession, 'busy');
  refs.sessionStatus.textContent = 'STREAMING';
  renderHud();
}

function disconnectEventSource() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = null;
}

function resetRuntimeState() {
  state.running = false;
  state.topology = null;
  state.teamOrder = [];
  state.teams = new Map();
  state.blackboard = [];
  state.logs = [];
  state.finalResult = null;
  state.phases = new Map(PHASE_DEFS.map((phase) => [phase.key, { ...phase, status: 'idle' }]));
  state.votes = {
    'melchior-1': { core: 'melchior-1', name: 'MELCHIOR-1', axis: 'Scientist axis', status: 'idle', vote: 'PENDING' },
    'balthasar-2': { core: 'balthasar-2', name: 'BALTHASAR-2', axis: 'Mother axis', status: 'idle', vote: 'PENDING' },
    'casper-3': { core: 'casper-3', name: 'CASPER-3', axis: 'Woman axis', status: 'idle', vote: 'PENDING' },
  };
  refs.phaseValue.textContent = 'IDLE';
  refs.majorityVoteDisplay.textContent = 'PENDING';
  refs.majoritySummary.textContent = 'Awaiting topology synthesis.';
  refs.runtimeModeValue.textContent = refs.modeSelect.value?.toUpperCase() || (state.hasApiKey ? 'LIVE' : 'DEMO');
  updateRuntimeVisualState('ready');
  renderPhaseTimeline();
  renderBlackboard();
  renderTeams();
  renderDecisionMemo();
  renderEventLog();
  renderVotes();
  renderOrbit();
  renderHud();
}

function connectEventSource(sessionId) {
  const source = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`);
  state.eventSource = source;
  const names = [
    'session_init',
    'phase',
    'log',
    'topology',
    'team_spawned',
    'team_layer_complete',
    'agent_spawned',
    'agent_activity',
    'agent_result',
    'task_graph',
    'task_started',
    'task_result',
    'team_result',
    'blackboard_note',
    'magi_vote',
    'final_result',
    'error',
  ];

  names.forEach((name) => {
    source.addEventListener(name, (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleEvent(name, payload);
      } catch (error) {
        console.error('Event parse failed', name, error);
      }
    });
  });

  source.onerror = () => {
    setDot(refs.dotSession, 'error');
    refs.sessionStatus.textContent = 'STREAM RETRY';
  };

  source.onopen = () => {
    setDot(refs.dotSession, 'ready');
    refs.sessionStatus.textContent = 'STREAM LIVE';
  };
}

function handleEvent(type, payload) {
  switch (type) {
    case 'session_init': {
      refs.sessionTag.textContent = `SESSION // ${shortId(payload.sessionId)}`;
      break;
    }
    case 'phase': {
      const phase = state.phases.get(payload.phase) || { key: payload.phase, label: payload.label || payload.phase, status: 'idle' };
      phase.label = payload.label || phase.label;
      phase.status = payload.status || phase.status;
      state.phases.set(payload.phase, phase);
      refs.phaseValue.textContent = phase.label;
      if (payload.status === 'running') {
        state.running = true;
        refs.runButton.disabled = true;
        setDot(refs.dotSystem, 'busy');
        refs.systemStatus.textContent = 'EXECUTING';
        updateRuntimeVisualState('running');
      }
      if (payload.phase === 'complete' && payload.status === 'completed') {
        state.running = false;
        refs.runButton.disabled = false;
        setDot(refs.dotSystem, 'ready');
        refs.systemStatus.textContent = 'READY';
        updateRuntimeVisualState('ready');
      }
      renderPhaseTimeline();
      break;
    }
    case 'log': {
      addServerLog(payload.level || 'info', payload.text || '');
      break;
    }
    case 'topology': {
      state.topology = payload;
      initializeTeamsFromTopology(payload);
      addClientLog('info', `Topology synthesized: ${payload.teams?.length || 0} team(s).`);
      renderTeams();
      renderOrbit();
      break;
    }
    case 'team_spawned': {
      const team = ensureTeam(payload.team);
      team.status = payload.status || 'running';
      team.lastState = `Pattern=${team.pattern}`;
      flashTeam(team.id);
      renderTeams();
      renderOrbit();
      break;
    }
    case 'agent_spawned': {
      const team = ensureTeam({ id: payload.teamId });
      team.agents.set(payload.agent.id, {
        ...(team.agents.get(payload.agent.id) || {}),
        ...payload.agent,
        status: 'idle',
      });
      renderTeams();
      renderOrbit();
      break;
    }
    case 'agent_activity': {
      const team = ensureTeam({ id: payload.teamId });
      const agent = team.agents.get(payload.agentId) || { id: payload.agentId, codename: payload.agentId };
      agent.status = payload.status || 'running';
      agent.detail = payload.detail || '';
      team.agents.set(payload.agentId, agent);
      team.status = team.status === 'completed' ? 'completed' : 'running';
      team.lastState = `${agent.codename || payload.agentId}: ${payload.detail || payload.status}`;
      flashTeam(team.id);
      renderTeams();
      renderOrbit();
      break;
    }
    case 'agent_result': {
      const team = ensureTeam({ id: payload.teamId });
      const agent = team.agents.get(payload.agentId) || { id: payload.agentId, codename: payload.agentId };
      agent.status = 'completed';
      agent.contribution = payload.contribution;
      agent.round = payload.round;
      team.agents.set(payload.agentId, agent);
      team.lastContribution = payload.contribution;
      team.contributions.unshift({ agentId: payload.agentId, contribution: payload.contribution, round: payload.round });
      team.contributions = team.contributions.slice(0, 8);
      renderTeams();
      renderOrbit();
      break;
    }
    case 'task_graph': {
      const team = ensureTeam(payload.team || { id: payload.teamId });
      team.taskSummary = payload.taskGraph?.summary || '';
      const tasks = payload.taskGraph?.tasks || payload.tasks || [];
      tasks.forEach((task) => {
        team.tasks.set(task.id, { ...(team.tasks.get(task.id) || {}), ...task });
      });
      renderTeams();
      break;
    }
    case 'task_started': {
      const team = ensureTeam({ id: payload.teamId });
      if (payload.task?.id) {
        team.tasks.set(payload.task.id, { ...(team.tasks.get(payload.task.id) || {}), ...payload.task, status: 'running' });
      }
      renderTeams();
      break;
    }
    case 'task_result': {
      const team = ensureTeam({ id: payload.teamId });
      if (payload.task?.id) {
        team.tasks.set(payload.task.id, { ...(team.tasks.get(payload.task.id) || {}), ...payload.task, status: 'completed' });
      }
      if (payload.agent?.id) {
        const agent = team.agents.get(payload.agent.id) || payload.agent;
        team.agents.set(payload.agent.id, { ...agent, status: 'completed', contribution: payload.contribution });
      }
      team.lastContribution = payload.contribution;
      renderTeams();
      break;
    }
    case 'team_result': {
      const result = payload.result || {};
      const team = ensureTeam(result.team || { id: payload.teamId });
      team.status = 'completed';
      team.synthesis = result.synthesis || null;
      team.result = result;
      team.lastState = result.synthesis?.summary || 'Completed.';
      if (Array.isArray(result.tasks)) {
        result.tasks.forEach((task) => {
          team.tasks.set(task.id, { ...(team.tasks.get(task.id) || {}), ...task });
        });
      }
      renderTeams();
      renderOrbit();
      break;
    }
    case 'team_layer_complete': {
      addClientLog('success', `Execution layer completed: ${payload.teams?.join(', ') || payload.completedTeamIds?.join(', ') || 'n/a'}`);
      break;
    }
    case 'blackboard_note': {
      state.blackboard.unshift(payload);
      state.blackboard = state.blackboard.slice(0, 36);
      renderBlackboard();
      break;
    }
    case 'magi_vote': {
      const current = state.votes[payload.core] || { core: payload.core };
      state.votes[payload.core] = { ...current, ...payload };
      renderVotes();
      break;
    }
    case 'final_result': {
      state.finalResult = payload;
      if (Array.isArray(payload.votes)) {
        payload.votes.forEach((vote) => {
          state.votes[vote.core] = { ...(state.votes[vote.core] || {}), ...vote, status: 'completed' };
        });
      }
      renderVotes();
      renderDecisionMemo();
      state.running = false;
      refs.runButton.disabled = false;
      setDot(refs.dotSystem, 'ready');
      refs.systemStatus.textContent = 'READY';
      updateRuntimeVisualState('ready');
      addClientLog('success', `Decision lock complete in ${formatMs(payload.elapsedMs || 0)}.`);
      break;
    }
    case 'error': {
      state.running = false;
      refs.runButton.disabled = false;
      setDot(refs.dotSystem, 'error');
      refs.systemStatus.textContent = 'FAULT';
      updateRuntimeVisualState('fault');
      addServerLog('error', payload.message || 'Unknown error');
      break;
    }
    default:
      break;
  }

  renderHud();
}

function initializeTeamsFromTopology(topology) {
  state.teamOrder = [];
  state.teams = new Map();
  (topology.teams || []).forEach((team) => {
    const record = {
      id: team.id,
      name: team.name,
      goal: team.goal,
      deliverable: team.deliverable,
      pattern: team.pattern,
      dependsOn: Array.isArray(team.depends_on) ? team.depends_on.slice() : [],
      maxRounds: team.max_rounds,
      status: 'idle',
      taskSummary: '',
      lastState: 'Awaiting execution.',
      lastContribution: null,
      contributions: [],
      agents: new Map(),
      tasks: new Map(),
      synthesis: null,
      result: null,
      orbitPosition: null,
    };
    (team.agents || []).forEach((agent) => {
      record.agents.set(agent.id, { ...agent, status: 'idle' });
    });
    state.teamOrder.push(team.id);
    state.teams.set(team.id, record);
  });
}

function ensureTeam(teamLike) {
  const id = teamLike?.id;
  if (!id) {
    throw new Error('Team id missing.');
  }
  if (!state.teams.has(id)) {
    state.teamOrder.push(id);
    state.teams.set(id, {
      id,
      name: teamLike.name || id.toUpperCase(),
      goal: teamLike.goal || '',
      deliverable: teamLike.deliverable || '',
      pattern: teamLike.pattern || 'dynamic',
      dependsOn: Array.isArray(teamLike.depends_on) ? teamLike.depends_on.slice() : [],
      maxRounds: teamLike.max_rounds || 1,
      status: 'idle',
      taskSummary: '',
      lastState: 'Awaiting execution.',
      lastContribution: null,
      contributions: [],
      agents: new Map(),
      tasks: new Map(),
      synthesis: null,
      result: null,
      orbitPosition: null,
    });
  } else if (teamLike.name || teamLike.pattern || teamLike.goal || teamLike.deliverable) {
    const current = state.teams.get(id);
    Object.assign(current, {
      name: teamLike.name || current.name,
      goal: teamLike.goal || current.goal,
      deliverable: teamLike.deliverable || current.deliverable,
      pattern: teamLike.pattern || current.pattern,
      dependsOn: Array.isArray(teamLike.depends_on) ? teamLike.depends_on.slice() : current.dependsOn,
      maxRounds: teamLike.max_rounds || current.maxRounds,
    });
  }
  return state.teams.get(id);
}

function renderPhaseTimeline() {
  refs.phaseTimeline.innerHTML = '';
  PHASE_DEFS.forEach((phaseDef) => {
    const phase = state.phases.get(phaseDef.key) || phaseDef;
    const item = document.createElement('div');
    item.className = `phase-item ${phase.status || 'idle'}`;
    item.innerHTML = `
      <div class="phase-item__dot"></div>
      <div class="phase-item__label">${escapeHtml(phase.label || phaseDef.label)}</div>
      <div class="phase-item__status">${escapeHtml((phase.status || 'idle').toUpperCase())}</div>
    `;
    refs.phaseTimeline.appendChild(item);
  });
}

function renderBlackboard() {
  refs.blackboardList.innerHTML = '';
  if (state.blackboard.length === 0) {
    refs.blackboardList.innerHTML = '<div class="empty-state">No blackboard notes yet.</div>';
    return;
  }

  state.blackboard.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'blackboard-entry';
    card.innerHTML = `
      <div class="blackboard-entry__meta">
        <span>${escapeHtml(entry.source || 'system')}</span>
        <span>${escapeHtml((entry.type || 'note').toUpperCase())}</span>
      </div>
      <div class="blackboard-entry__text">${escapeHtml(entry.text || '')}</div>
    `;
    refs.blackboardList.appendChild(card);
  });
}

function renderDecisionMemo() {
  if (!state.finalResult?.report) {
    refs.decisionMemo.textContent = 'No final report yet.';
    return;
  }

  const report = state.finalResult.report;
  refs.decisionMemo.innerHTML = `
    <div class="memo-title">${escapeHtml((report.majority_vote || 'pending').toUpperCase())} / MAGI DECISION MEMO</div>
    <div>${escapeHtml(report.summary || '')}</div>
    <div style="margin-top:10px;">${escapeHtml(report.final_answer || '')}</div>
    ${renderListSection('Key decisions', report.key_decisions)}
    ${renderListSection('Implementation path', report.implementation_path)}
    ${renderListSection('Residual risks', report.residual_risks)}
  `;
}

function renderTeams() {
  refs.teamsGrid.innerHTML = '';
  if (state.teamOrder.length === 0) {
    refs.teamsGrid.innerHTML = '<div class="empty-state">Topology not generated yet.</div>';
    renderHud();
    return;
  }

  state.teamOrder.forEach((teamId) => {
    const team = state.teams.get(teamId);
    if (!team) return;
    const fragment = refs.teamCardTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.team-card');
    root.classList.add(team.status || 'idle');
    root.dataset.status = team.status || 'idle';
    fragment.querySelector('.team-card__name').textContent = team.name;
    fragment.querySelector('.team-card__meta').textContent = `${team.pattern.toUpperCase()} / DEP ${team.dependsOn.length}`;
    fragment.querySelector('.team-card__status').textContent = (team.status || 'idle').toUpperCase();
    fragment.querySelector('.team-card__goal').textContent = team.goal || team.deliverable || '';
    fragment.querySelector('.team-card__badge--pattern').textContent = team.pattern.toUpperCase();
    fragment.querySelector('.team-card__badge--depends').textContent = `DEP ${team.dependsOn.length}`;
    fragment.querySelector('.team-card__badge--deliverable').textContent = team.deliverable
      ? truncateText(team.deliverable, 30)
      : `ROUNDS ${team.maxRounds}`;

    const agentsEl = fragment.querySelector('.team-card__agents');
    const agents = Array.from(team.agents.values());
    if (agents.length === 0) {
      agentsEl.innerHTML = '<span class="agent-pill">No agents</span>';
    } else {
      agents.forEach((agent) => {
        const pill = document.createElement('span');
        pill.className = `agent-pill ${agent.status || 'idle'}`;
        pill.textContent = `${agent.codename || agent.id} / ${agent.status || 'idle'}`;
        agentsEl.appendChild(pill);
      });
    }

    const tasksEl = fragment.querySelector('.team-card__tasks');
    const tasks = Array.from(team.tasks.values());
    if (tasks.length > 0) {
      tasks.forEach((task) => {
        const pill = document.createElement('span');
        pill.className = `task-pill ${task.status || 'pending'}`;
        pill.textContent = `${task.title || task.id}`;
        tasksEl.appendChild(pill);
      });
    } else if (team.taskSummary) {
      const pill = document.createElement('span');
      pill.className = 'task-pill';
      pill.textContent = truncateText(team.taskSummary, 46);
      tasksEl.appendChild(pill);
    }

    const resultEl = fragment.querySelector('.team-card__result');
    if (team.synthesis) {
      resultEl.innerHTML = `
        <div><strong>Summary</strong> ${escapeHtml(team.synthesis.summary || '')}</div>
        <div style="margin-top:6px;"><strong>Readiness</strong> ${escapeHtml((team.synthesis.readiness || 'unknown').toUpperCase())}</div>
      `;
    } else if (team.lastContribution?.summary) {
      resultEl.textContent = team.lastContribution.summary;
    } else {
      resultEl.textContent = team.lastState || 'Awaiting execution.';
    }

    refs.teamsGrid.appendChild(fragment);
  });

  renderHud();
}

function renderOrbit() {
  refs.teamOrbit.innerHTML = '';
  refs.orbitLinks.innerHTML = '';

  const teams = state.teamOrder.map((id) => state.teams.get(id)).filter(Boolean);
  refs.stageCanvas.style.minHeight = `${resolveStageMinHeight(teams.length)}px`;

  if (teams.length === 0) {
    refs.stageCanvas.dataset.orbitMode = 'ellipse';
    renderHud();
    return;
  }

  const rect = refs.stageCanvas.getBoundingClientRect();
  const width = rect.width || 1000;
  const height = rect.height || 760;
  const layoutMode = getOrbitLayoutMode(width, height, teams.length);
  const center = { x: width / 2, y: height / 2 };
  const nodeWidth = resolveOrbitNodeWidth(width, layoutMode);
  const positions = buildOrbitPositions({
    layoutMode,
    width,
    height,
    center,
    teamCount: teams.length,
    nodeWidth,
  });

  refs.stageCanvas.dataset.orbitMode = layoutMode;
  refs.orbitLinks.setAttribute('viewBox', `0 0 ${width} ${height}`);

  teams.forEach((team, index) => {
    const position = positions[index] || { x: center.x, y: center.y, angle: 0, width: nodeWidth };
    team.orbitPosition = position;

    const fragment = refs.orbitNodeTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.orbit-node');
    root.dataset.teamId = team.id;
    root.classList.add(team.status || 'idle');
    root.dataset.status = team.status || 'idle';
    root.dataset.layout = layoutMode;
    root.style.left = `${position.x}px`;
    root.style.top = `${position.y}px`;
    root.style.width = `${position.width || nodeWidth}px`;

    fragment.querySelector('.orbit-node__name').textContent = team.name;
    fragment.querySelector('.orbit-node__pattern').textContent = team.pattern.toUpperCase();

    const stateEl = fragment.querySelector('.orbit-node__state');
    if (team.synthesis?.summary) {
      stateEl.textContent = team.synthesis.summary;
    } else {
      stateEl.textContent = team.lastState || team.goal || 'Awaiting execution.';
    }

    const agentsEl = fragment.querySelector('.orbit-node__agents');
    Array.from(team.agents.values())
      .slice(0, layoutMode === 'stack' ? 4 : 5)
      .forEach((agent) => {
        const pill = document.createElement('span');
        pill.className = `agent-pill ${agent.status || 'idle'}`;
        pill.textContent = agent.codename || agent.id;
        agentsEl.appendChild(pill);
      });

    const metaEl = fragment.querySelector('.orbit-node__meta');
    metaEl.textContent = `A${team.agents.size} / T${team.tasks.size} / D${team.dependsOn.length}`;

    refs.teamOrbit.appendChild(fragment);
    refs.orbitLinks.appendChild(makeLine(center.x, center.y, position.x, position.y, 'team-link'));
  });

  teams.forEach((team) => {
    (team.dependsOn || []).forEach((depId) => {
      const target = state.teams.get(depId);
      if (!target?.orbitPosition || !team.orbitPosition) return;
      refs.orbitLinks.appendChild(
        makeLine(target.orbitPosition.x, target.orbitPosition.y, team.orbitPosition.x, team.orbitPosition.y, 'dependency')
      );
    });
  });

  renderHud();
}

function resolveStageMinHeight(teamCount) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1440;
  if (viewportWidth <= 460) return 1020 + Math.max(0, teamCount - 2) * 136;
  if (viewportWidth <= 760) return 920 + Math.max(0, teamCount - 2) * 128;
  if (viewportWidth <= 1120) return 780 + Math.max(0, teamCount - 3) * 96;
  if (viewportWidth <= 1460) return 700 + Math.max(0, teamCount - 4) * 72;
  return 780 + Math.max(0, teamCount - 4) * 56;
}

function getOrbitLayoutMode(width, height, teamCount) {
  if (width <= 760 || height <= 690) return 'stack';
  if (width <= 1120 || height <= 760 || (teamCount >= 4 && width <= 1280)) return 'belt';
  return 'ellipse';
}

function resolveOrbitNodeWidth(width, layoutMode) {
  if (layoutMode === 'stack') return Math.min(320, Math.max(236, width - 36));
  if (layoutMode === 'belt') return Math.min(240, Math.max(198, Math.floor(width * 0.22)));
  return Math.min(236, Math.max(204, Math.floor(width * 0.18)));
}

function buildOrbitPositions({ layoutMode, width, height, center, teamCount, nodeWidth }) {
  if (layoutMode === 'stack') {
    return buildStackOrbitPositions({ width, height, center, teamCount, nodeWidth });
  }
  if (layoutMode === 'belt') {
    return buildBeltOrbitPositions({ width, height, center, teamCount, nodeWidth });
  }
  return buildEllipseOrbitPositions({ width, height, center, teamCount, nodeWidth });
}

function buildEllipseOrbitPositions({ width, height, center, teamCount, nodeWidth }) {
  const radiusX = Math.max(nodeWidth * 0.92, Math.min(width * 0.36, width / 2 - nodeWidth * 0.64 - 28));
  const radiusY = Math.max(170, Math.min(height * 0.29, height / 2 - 132));
  const angleStep = (Math.PI * 2) / Math.max(1, teamCount);
  const startAngle = -Math.PI / 2;

  return Array.from({ length: teamCount }, (_, index) => {
    const angle = startAngle + angleStep * index;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
      angle,
      width: nodeWidth,
    };
  });
}

function buildBeltOrbitPositions({ width, height, center, teamCount, nodeWidth }) {
  const positions = [];
  const leftX = Math.max(26 + nodeWidth / 2, center.x - Math.max(nodeWidth * 1.08, width * 0.31));
  const rightX = Math.min(width - 26 - nodeWidth / 2, center.x + Math.max(nodeWidth * 1.08, width * 0.31));
  const pairCount = Math.floor(teamCount / 2);
  const rowCount = pairCount + (teamCount % 2);
  const topY = 156;
  const bottomY = Math.max(topY, height - 150);
  const rowGap = rowCount <= 1 ? 0 : (bottomY - topY) / (rowCount - 1);

  for (let row = 0; row < pairCount; row += 1) {
    const y = topY + row * rowGap;
    positions.push({ x: leftX, y, angle: Math.PI, width: nodeWidth });
    positions.push({ x: rightX, y, angle: 0, width: nodeWidth });
  }

  if (teamCount % 2 === 1) {
    positions.push({
      x: center.x,
      y: topY + (rowCount - 1) * rowGap,
      angle: Math.PI / 2,
      width: Math.min(nodeWidth + 14, width - 44),
    });
  }

  return positions;
}

function buildStackOrbitPositions({ width, height, center, teamCount, nodeWidth }) {
  const topY = Math.max(Math.round(height * 0.64), Math.round(center.y + 188));
  const bottomPadding = 124;
  const usableHeight = Math.max(0, height - topY - bottomPadding);
  const rowGap = teamCount <= 1 ? 0 : usableHeight / Math.max(1, teamCount - 1);

  return Array.from({ length: teamCount }, (_, index) => ({
    x: center.x,
    y: topY + rowGap * index,
    angle: Math.PI / 2,
    width: Math.min(nodeWidth, width - 28),
  }));
}

function renderVotes() {
  const mel = state.votes['melchior-1'];
  const bal = state.votes['balthasar-2'];
  const cas = state.votes['casper-3'];

  renderCoreVote(refs.coreMelchior, refs.voteMelchior, mel);
  renderCoreVote(refs.coreBalthasar, refs.voteBalthasar, bal);
  renderCoreVote(refs.coreCasper, refs.voteCasper, cas);

  const completedVotes = [mel, bal, cas].filter((vote) => vote?.status === 'completed');
  if (completedVotes.length === 0) {
    refs.majorityVoteDisplay.textContent = state.finalResult?.report?.majority_vote?.toUpperCase() || 'PENDING';
    refs.majoritySummary.textContent = state.finalResult?.report?.summary || 'Awaiting MAGI chamber vote.';
    return;
  }

  const majority = getMajorityVote([mel, bal, cas]);
  refs.majorityVoteDisplay.textContent = majority.toUpperCase();
  refs.majoritySummary.textContent = completedVotes.map((vote) => `${vote.name}: ${vote.vote}`).join(' / ');
}

function renderCoreVote(container, label, vote) {
  container.classList.remove('running', 'approve', 'hold', 'reject');
  if (vote?.status === 'running') container.classList.add('running');
  if (vote?.vote && ['approve', 'hold', 'reject'].includes(vote.vote)) container.classList.add(vote.vote);
  label.textContent = `${(vote?.vote || 'PENDING').toUpperCase()}${typeof vote?.confidence === 'number' ? ` / ${(vote.confidence * 100).toFixed(0)}%` : ''}`;
}

function renderEventLog() {
  refs.eventLog.innerHTML = '';
  if (state.logs.length === 0) {
    refs.eventLog.innerHTML = '<div class="empty-state">Event log is empty.</div>';
    return;
  }

  state.logs.forEach((entry) => {
    const line = document.createElement('div');
    line.className = `log-line ${entry.level || 'info'}`;
    line.innerHTML = `
      <div class="log-line__meta">${escapeHtml(entry.time)} / ${escapeHtml((entry.level || 'info').toUpperCase())}</div>
      <div>${escapeHtml(entry.text || '')}</div>
    `;
    refs.eventLog.appendChild(line);
  });
}

async function runCycle() {
  if (state.running) return;
  const mission = refs.missionInput.value.trim();
  if (!mission) {
    addClientLog('error', 'Mission is required.');
    return;
  }

  await createFreshSession();
  state.running = true;
  refs.runButton.disabled = true;
  refs.runtimeModeValue.textContent = refs.modeSelect.value.toUpperCase();
  setDot(refs.dotSystem, 'busy');
  refs.systemStatus.textContent = 'EXECUTING';
  updateRuntimeVisualState('running');
  addClientLog('info', 'MAGI cycle started.');
  renderHud();

  try {
    const payload = {
      sessionId: state.sessionId,
      mission,
      config: {
        mode: refs.modeSelect.value,
        maxTeams: Number(refs.maxTeams.value || 3),
        maxAgentsPerTeam: Number(refs.maxAgents.value || 3),
        maxRounds: Number(refs.maxRounds.value || 2),
        preferAllPatterns: refs.preferAllPatterns.checked,
        enableWebSearch: refs.enableWebSearch.checked,
      },
    };
    await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    state.running = false;
    refs.runButton.disabled = false;
    setDot(refs.dotSystem, 'error');
    refs.systemStatus.textContent = 'FAULT';
    updateRuntimeVisualState('fault');
    addClientLog('error', `Run failed: ${error.message}`);
    renderHud();
  }
}

function addServerLog(level, text) {
  pushLog({ level, text, time: nowLabel() });
}

function addClientLog(level, text) {
  pushLog({ level, text, time: nowLabel() });
}

function pushLog(entry) {
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 180);
  renderEventLog();
}

function setDot(element, status) {
  element.classList.remove('online', 'ready', 'busy', 'error', 'offline');
  element.classList.add(status);
}

function renderListSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `
    <div class="memo-title" style="margin-top:10px; font-size:12px;">${escapeHtml(title)}</div>
    <ul class="memo-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  `;
}

function makeLine(x1, y1, x2, y2, className = '') {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  if (className) line.setAttribute('class', className);
  return line;
}

function getMajorityVote(votes) {
  const counts = { approve: 0, hold: 0, reject: 0 };
  votes.forEach((vote) => {
    if (vote?.vote && counts[vote.vote] !== undefined) counts[vote.vote] += 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'pending';
}

function renderTime(date = new Date()) {
  return date.toLocaleTimeString('zh-TW', { hour12: false });
}

function nowLabel() {
  return renderTime(new Date());
}

function startClock() {
  const tick = () => {
    refs.runtimeClock.textContent = renderTime(new Date());
  };
  tick();
  setInterval(tick, 1000);
}

function flashTeam(teamId) {
  const orbitNode = refs.teamOrbit.querySelector(`[data-team-id="${CSS.escape(teamId)}"]`);
  if (!orbitNode) return;
  orbitNode.classList.remove('flash');
  void orbitNode.offsetWidth;
  orbitNode.classList.add('flash');
}

function renderHud() {
  const teams = state.teamOrder.map((id) => state.teams.get(id)).filter(Boolean);
  const teamCount = teams.length;
  const agentCount = teams.reduce((sum, team) => sum + team.agents.size, 0);
  const taskCount = teams.reduce((sum, team) => sum + team.tasks.size, 0);
  const patterns = [...new Set(teams.map((team) => team.pattern).filter(Boolean))];
  const mission = refs.missionInput.value.trim();

  refs.teamsCount.textContent = String(teamCount).padStart(2, '0');
  refs.agentsCount.textContent = String(agentCount).padStart(2, '0');
  refs.tasksCount.textContent = String(taskCount).padStart(2, '0');
  refs.blackboardCount.textContent = String(state.blackboard.length).padStart(2, '0');
  refs.missionDigest.textContent = `MISSION // ${truncateText(compactWhitespace(mission) || 'STANDBY', 88)}`;
  refs.patternCoverage.textContent = `PATTERNS // ${patterns.length ? patterns.map((value) => value.toUpperCase()).join(' • ') : '--'}`;
  refs.originTag.textContent = `ORIGIN // ${window.location.host.toUpperCase()}`;
  refs.missionHash.textContent = hashText(mission || 'standby');
  refs.missionLength.textContent = String(mission.length).padStart(3, '0');
  refs.stageBanner.textContent = buildStageBanner();
}

function buildStageBanner() {
  if (state.finalResult?.report?.majority_vote) {
    return `DECISION LOCK // ${String(state.finalResult.report.majority_vote).toUpperCase()}`;
  }
  if (state.running) {
    return `PRIMARY ARBITRATION BUS // ${refs.phaseValue.textContent || 'RUNNING'}`;
  }
  if (state.sessionId) {
    return 'PRIMARY ARBITRATION BUS // STANDBY';
  }
  return 'BOOTSTRAP BUS // INITIALIZING';
}

function updateRuntimeVisualState(value) {
  document.body.dataset.runtime = value;
}

function hashText(value) {
  let hash = 0;
  const source = String(value || '');
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
}

function truncateText(value, max = 42) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortId(value) {
  return String(value || '').slice(0, 8).toUpperCase();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function formatMs(ms) {
  if (!ms) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function debounce(fn, wait = 80) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
