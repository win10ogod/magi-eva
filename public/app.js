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

const UI_STORAGE_KEY = 'magi-eva-ui-v4';

const state = {
  config: null,
  hasApiKey: false,
  sessionId: null,
  eventSource: null,
  running: false,
  phases: new Map(PHASE_DEFS.map((phase) => [phase.key, { ...phase, status: 'idle' }])),
  topology: null,
  topologyHealth: null,
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
  ui: {
    collapsedPanels: new Set(),
    foldedSections: new Set(),
    collapsedTeams: new Set(),
    touchedTeamCards: false,
  },
};

const $ = (selector) => document.querySelector(selector);
const refs = {
  layoutRoot: $('#layoutRoot'),
  dotSystem: $('#dotSystem'),
  dotApi: $('#dotApi'),
  dotSession: $('#dotSession'),
  systemStatus: $('#systemStatus'),
  apiStatus: $('#apiStatus'),
  sessionStatus: $('#sessionStatus'),
  runtimeClock: $('#runtimeClock'),
  sessionTag: $('#sessionTag'),
  apiBaseValue: $('#apiBaseValue'),
  runtimeModeValue: $('#runtimeModeValue'),
  phaseValue: $('#phaseValue'),
  topologySummaryValue: $('#topologySummaryValue'),
  patternCoverageValue: $('#patternCoverageValue'),
  missionInput: $('#missionInput'),
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
  clearLogButton: $('#clearLogButton'),
  expandTeamsButton: $('#expandTeamsButton'),
  collapseTeamsButton: $('#collapseTeamsButton'),
  hudTeamCount: $('#hudTeamCount'),
  hudAgentCount: $('#hudAgentCount'),
  hudTaskCount: $('#hudTaskCount'),
  hudPatternCount: $('#hudPatternCount'),
  missionDigest: $('#missionDigest'),
  topologyHealthText: $('#topologyHealthText'),
};

let stageObserver = null;

window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadUiState();
  bindUi();
  renderPresets();
  startClock();
  observeStage();
  applyResponsiveDefaults();
  applyUiState();

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
  } catch (error) {
    console.error(error);
    addClientLog('error', `Initialization failed: ${error.message}`);
    setDot(refs.dotSystem, 'error');
    refs.systemStatus.textContent = 'FAULT';
  }

  renderPhaseTimeline();
  renderBlackboard();
  renderTeams();
  renderDecisionMemo();
  renderVotes();
  renderEventLog();
  renderHud();
}

function bindUi() {
  refs.runButton.addEventListener('click', runCycle);
  refs.newSessionButton.addEventListener('click', async () => {
    if (state.running) return;
    await createFreshSession();
    addClientLog('info', 'New session created.');
  });

  refs.clearLogButton.addEventListener('click', () => {
    state.logs = [];
    renderEventLog();
  });

  refs.expandTeamsButton.addEventListener('click', () => {
    state.ui.collapsedTeams.clear();
    state.ui.touchedTeamCards = true;
    saveUiState();
    renderTeams();
  });

  refs.collapseTeamsButton.addEventListener('click', () => {
    state.teamOrder.forEach((id) => state.ui.collapsedTeams.add(id));
    state.ui.touchedTeamCards = true;
    saveUiState();
    renderTeams();
  });

  refs.missionInput.addEventListener('input', debounce(() => renderHud(), 80));
  refs.modeSelect.addEventListener('change', () => {
    refs.runtimeModeValue.textContent = refs.modeSelect.value.toUpperCase();
  });

  document.addEventListener('click', handleDelegatedClick);
  window.addEventListener('resize', debounce(syncResponsiveLayout, 80));
}

function observeStage() {
  if (!('ResizeObserver' in window)) {
    window.addEventListener('resize', debounce(() => renderOrbit(), 80));
    return;
  }
  stageObserver = new ResizeObserver(
    debounce(() => {
      syncResponsiveLayout();
      renderOrbit();
    }, 60)
  );
  stageObserver.observe(refs.stageCanvas);
}

function handleDelegatedClick(event) {
  const panelToggle = event.target.closest('[data-panel-toggle]');
  if (panelToggle) {
    const panelId = panelToggle.getAttribute('data-panel-toggle');
    togglePanel(panelId);
    return;
  }

  const foldToggle = event.target.closest('[data-fold-toggle]');
  if (foldToggle) {
    const foldId = foldToggle.getAttribute('data-fold-toggle');
    toggleFold(foldId);
    return;
  }

  const presetButton = event.target.closest('[data-preset-value]');
  if (presetButton) {
    refs.missionInput.value = presetButton.getAttribute('data-preset-value') || '';
    renderHud();
    return;
  }

  const teamToggle = event.target.closest('[data-team-toggle]');
  if (teamToggle) {
    const card = teamToggle.closest('[data-team-id]');
    if (!card) return;
    const teamId = card.getAttribute('data-team-id');
    toggleTeamCard(teamId);
  }
}

function renderPresets() {
  refs.presetRow.innerHTML = '';
  PRESETS.forEach((text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip';
    button.textContent = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    button.title = text;
    button.dataset.presetValue = text;
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
  state.topologyHealth = null;
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
  refs.topologySummaryValue.textContent = 'PENDING';
  refs.patternCoverageValue.textContent = '0';
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
    'topology_audit',
    'subagent_generated',
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
    source.addEventListener(name, (evt) => {
      try {
        const payload = JSON.parse(evt.data);
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
      }
      if (payload.phase === 'complete' && payload.status === 'completed') {
        state.running = false;
        refs.runButton.disabled = false;
        setDot(refs.dotSystem, 'ready');
        refs.systemStatus.textContent = 'READY';
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
      state.topologyHealth = payload.health || null;
      initializeTeamsFromTopology(payload);
      applyTeamDensityStrategy();
      addClientLog('info', `Topology synthesized: ${payload.teams?.length || 0} team(s).`);
      renderTeams();
      renderOrbit();
      renderHud();
      break;
    }
    case 'topology_audit': {
      state.topologyHealth = payload;
      renderHud();
      break;
    }
    case 'subagent_generated': {
      const team = ensureTeam({ id: payload.teamId });
      if (payload.agent?.id) {
        team.agents.set(payload.agent.id, {
          ...(team.agents.get(payload.agent.id) || {}),
          ...payload.agent,
          status: team.agents.get(payload.agent.id)?.status || 'idle',
        });
      }
      addClientLog('info', `Sub-agent generated: ${payload.agent?.codename || payload.agent?.id || 'n/a'} / ${team.name}`);
      renderTeams();
      renderOrbit();
      renderHud();
      break;
    }
    case 'team_spawned': {
      const team = ensureTeam(payload.team);
      team.status = payload.status || 'running';
      team.lastState = `Pattern=${team.pattern}`;
      flashTeam(team.id);
      renderTeams();
      renderOrbit();
      renderHud();
      break;
    }
    case 'agent_spawned': {
      const team = ensureTeam({ id: payload.teamId });
      team.agents.set(payload.agent.id, {
        ...(team.agents.get(payload.agent.id) || {}),
        ...payload.agent,
        status: team.agents.get(payload.agent.id)?.status || 'idle',
      });
      renderTeams();
      renderOrbit();
      renderHud();
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
      team.contributions = team.contributions.slice(0, 10);
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
      renderHud();
      break;
    }
    case 'task_started': {
      const team = ensureTeam({ id: payload.teamId });
      if (payload.task?.id) {
        team.tasks.set(payload.task.id, { ...(team.tasks.get(payload.task.id) || {}), ...payload.task, status: 'running' });
      }
      renderTeams();
      renderHud();
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
      renderHud();
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
      renderHud();
      break;
    }
    case 'team_layer_complete': {
      addClientLog('success', `Execution layer completed: ${payload.teams?.join(', ') || 'n/a'}`);
      break;
    }
    case 'blackboard_note': {
      state.blackboard.unshift(payload);
      state.blackboard = state.blackboard.slice(0, 40);
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
      addClientLog('success', `Decision lock complete in ${formatMs(payload.elapsedMs || 0)}.`);
      break;
    }
    case 'error': {
      state.running = false;
      refs.runButton.disabled = false;
      setDot(refs.dotSystem, 'error');
      refs.systemStatus.textContent = 'FAULT';
      addServerLog('error', payload.message || 'Unknown error');
      break;
    }
    default:
      break;
  }
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
      syntheticTeam: Boolean(team.syntheticTeam),
      generatedAgentCount: Number(team?.meta?.generatedAgentCount || 0),
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
      syntheticTeam: Boolean(teamLike.syntheticTeam),
      generatedAgentCount: Number(teamLike?.meta?.generatedAgentCount || 0),
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
      syntheticTeam: Boolean(teamLike.syntheticTeam ?? current.syntheticTeam),
      generatedAgentCount: Number(teamLike?.meta?.generatedAgentCount || current.generatedAgentCount || 0),
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
    return;
  }

  state.teamOrder.forEach((teamId) => {
    const team = state.teams.get(teamId);
    if (!team) return;
    const fragment = refs.teamCardTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.team-card');
    const collapsed = state.ui.collapsedTeams.has(team.id);
    root.dataset.teamId = team.id;
    root.classList.add(team.status || 'idle');
    root.classList.toggle('is-collapsed', collapsed);
    fragment.querySelector('.team-card__name').textContent = team.name;
    fragment.querySelector('.team-card__meta').textContent = `${team.pattern.toUpperCase()} / DEP ${team.dependsOn.length} / ROUNDS ${team.maxRounds}`;
    fragment.querySelector('.team-card__status').textContent = (team.status || 'idle').toUpperCase();
    fragment.querySelector('[data-team-toggle]').textContent = collapsed ? 'OPEN' : 'FOLD';

    const statsEl = fragment.querySelector('.team-card__stats');
    statsEl.innerHTML = [
      makeBadge(team.syntheticTeam ? 'SYNTH TEAM' : 'LIVE TEAM', team.syntheticTeam ? 'warn' : 'ok'),
      makeBadge(`${team.agents.size} AGENT`, 'neutral'),
      makeBadge(`${team.tasks.size} TASK`, 'neutral'),
      makeBadge(`${countSyntheticAgents(team)} SYNTH AGENT`, countSyntheticAgents(team) ? 'warn' : 'neutral'),
    ].join('');

    fragment.querySelector('.team-card__goal').innerHTML = `<strong>Goal</strong> ${escapeHtml(team.goal || '')}`;
    fragment.querySelector('.team-card__deliverable').innerHTML = `<strong>Deliverable</strong> ${escapeHtml(team.deliverable || '')}`;
    fragment.querySelector('.team-card__deps').innerHTML = `<strong>Dependencies</strong> ${escapeHtml(team.dependsOn.join(', ') || 'none')}`;

    const agentsEl = fragment.querySelector('.team-card__agents');
    const agents = Array.from(team.agents.values());
    if (agents.length === 0) {
      agentsEl.innerHTML = '<span class="agent-pill">No agents</span>';
    } else {
      agents.forEach((agent) => {
        const pill = document.createElement('span');
        pill.className = `agent-pill ${agent.status || 'idle'}${agent.synthetic ? ' synthetic' : ''}`;
        pill.textContent = `${agent.codename || agent.id} / ${agent.role || agent.status || 'idle'}`;
        agentsEl.appendChild(pill);
      });
    }

    const tasksEl = fragment.querySelector('.team-card__tasks');
    const tasks = Array.from(team.tasks.values());
    if (tasks.length > 0) {
      tasks.forEach((task) => {
        const pill = document.createElement('span');
        pill.className = `task-pill ${task.status || 'pending'}`;
        pill.textContent = `${task.title || task.id}${task.owner_hint ? ` / ${task.owner_hint}` : ''}`;
        tasksEl.appendChild(pill);
      });
    } else if (team.taskSummary) {
      const pill = document.createElement('span');
      pill.className = 'task-pill';
      pill.textContent = team.taskSummary;
      tasksEl.appendChild(pill);
    } else {
      tasksEl.innerHTML = '<div class="empty-inline">No tasks yet.</div>';
    }

    const resultEl = fragment.querySelector('.team-card__result');
    if (team.synthesis) {
      resultEl.innerHTML = `
        <div><strong>Summary</strong> ${escapeHtml(team.synthesis.summary || '')}</div>
        <div style="margin-top:6px;"><strong>Readiness</strong> ${escapeHtml((team.synthesis.readiness || 'unknown').toUpperCase())}</div>
        ${Array.isArray(team.synthesis.conclusions) ? `<div style="margin-top:8px;">${team.synthesis.conclusions.map((item) => `<div>• ${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      `;
    } else if (team.lastContribution?.summary) {
      resultEl.textContent = team.lastContribution.summary;
    } else {
      resultEl.textContent = team.lastState || 'Awaiting execution.';
    }

    refs.teamsGrid.appendChild(fragment);
  });
}

function renderOrbit() {
  refs.teamOrbit.innerHTML = '';
  refs.orbitLinks.innerHTML = '';

  const teams = state.teamOrder.map((id) => state.teams.get(id)).filter(Boolean);
  if (teams.length === 0) return;

  const rect = refs.stageCanvas.getBoundingClientRect();
  const width = rect.width || 1000;
  const height = Math.max(rect.height || 760, 520);
  refs.orbitLinks.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const mode = getOrbitLayoutMode(width, height, teams.length);
  refs.stageCanvas.dataset.layoutMode = mode;
  refs.stageCanvas.style.setProperty('--core-size', `${Math.round(clamp(Math.min(width, height) * (mode === 'stack' ? 0.34 : 0.42), 220, 380))}px`);
  refs.stageCanvas.style.minHeight = `${computeStageMinHeight(teams.length, width)}px`;

  const center = {
    x: width / 2,
    y: mode === 'stack' ? Math.max(170, height * 0.33) : height / 2,
  };

  const positions = computeOrbitPositions(teams.length, width, height, center, mode);
  teams.forEach((team, index) => {
    const point = positions[index];
    team.orbitPosition = point;
    const fragment = refs.orbitNodeTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.orbit-node');
    root.dataset.teamId = team.id;
    root.classList.add(team.status || 'idle');
    root.style.left = `${point.x}px`;
    root.style.top = `${point.y}px`;
    fragment.querySelector('.orbit-node__name').textContent = team.name;
    fragment.querySelector('.orbit-node__pattern').textContent = team.pattern.toUpperCase();
    fragment.querySelector('.orbit-node__meta').innerHTML = `
      <span>${team.agents.size} AG</span>
      <span>${team.tasks.size} TK</span>
      <span>${countSyntheticAgents(team)} SYN</span>
    `;
    const stateEl = fragment.querySelector('.orbit-node__state');
    stateEl.textContent = team.synthesis?.summary || team.lastState || team.goal || 'Awaiting execution.';
    const agentsEl = fragment.querySelector('.orbit-node__agents');
    Array.from(team.agents.values())
      .slice(0, 5)
      .forEach((agent) => {
        const pill = document.createElement('span');
        pill.className = `agent-pill ${agent.status || 'idle'}${agent.synthetic ? ' synthetic' : ''}`;
        pill.textContent = agent.codename || agent.id;
        agentsEl.appendChild(pill);
      });

    refs.teamOrbit.appendChild(fragment);
    refs.orbitLinks.appendChild(makeLine(center.x, center.y, point.x, point.y, 'team-link'));
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

function renderHud() {
  const teams = state.teamOrder.map((id) => state.teams.get(id)).filter(Boolean);
  const agentCount = teams.reduce((sum, team) => sum + team.agents.size, 0);
  const taskCount = teams.reduce((sum, team) => sum + team.tasks.size, 0);
  const patterns = [...new Set(teams.map((team) => team.pattern))];

  refs.hudTeamCount.textContent = String(teams.length);
  refs.hudAgentCount.textContent = String(agentCount);
  refs.hudTaskCount.textContent = String(taskCount);
  refs.hudPatternCount.textContent = String(patterns.length);
  refs.topologySummaryValue.textContent = state.topologyHealth?.summary || (teams.length ? `${teams.length} TEAM(S)` : 'PENDING');
  refs.patternCoverageValue.textContent = String(patterns.length);
  refs.missionDigest.textContent =
    state.topology?.interpretation || compactText(refs.missionInput.value.trim(), 180) || 'Awaiting mission input.';
  refs.topologyHealthText.textContent =
    state.topologyHealth?.summary ||
    (teams.length ? `Topology live // ${teams.length} team(s) // ${agentCount} agent(s)` : 'Topology health pending.');
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
  addClientLog('info', 'MAGI cycle started.');

  try {
    const payload = {
      sessionId: state.sessionId,
      mission,
      config: {
        mode: refs.modeSelect.value,
        maxTeams: Number(refs.maxTeams.value || 6),
        maxAgentsPerTeam: Number(refs.maxAgents.value || 4),
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
    addClientLog('error', `Run failed: ${error.message}`);
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
  state.logs = state.logs.slice(0, 220);
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

function togglePanel(panelId) {
  if (!panelId) return;
  if (state.ui.collapsedPanels.has(panelId)) {
    state.ui.collapsedPanels.delete(panelId);
  } else {
    state.ui.collapsedPanels.add(panelId);
  }
  saveUiState();
  applyUiState();
  syncResponsiveLayout();
  renderOrbit();
}

function toggleFold(foldId) {
  if (!foldId) return;
  if (state.ui.foldedSections.has(foldId)) {
    state.ui.foldedSections.delete(foldId);
  } else {
    state.ui.foldedSections.add(foldId);
  }
  saveUiState();
  applyUiState();
}

function toggleTeamCard(teamId) {
  if (!teamId) return;
  state.ui.touchedTeamCards = true;
  if (state.ui.collapsedTeams.has(teamId)) {
    state.ui.collapsedTeams.delete(teamId);
  } else {
    state.ui.collapsedTeams.add(teamId);
  }
  saveUiState();
  renderTeams();
}

function applyUiState() {
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const collapsed = state.ui.collapsedPanels.has(panel.id);
    panel.classList.toggle('is-collapsed', collapsed);
  });

  document.querySelectorAll('.fold-block[data-fold]').forEach((block) => {
    const foldId = block.getAttribute('data-fold');
    block.classList.toggle('is-collapsed', state.ui.foldedSections.has(foldId));
  });

  document.querySelectorAll('[data-panel-toggle]').forEach((button) => {
    const panelId = button.getAttribute('data-panel-toggle');
    if (!panelId) return;
    const active = state.ui.collapsedPanels.has(panelId);
    button.classList.toggle('is-active', active);
  });
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.ui.collapsedPanels = new Set(parsed.collapsedPanels || []);
    state.ui.foldedSections = new Set(parsed.foldedSections || []);
    state.ui.collapsedTeams = new Set(parsed.collapsedTeams || []);
    state.ui.touchedTeamCards = Boolean(parsed.touchedTeamCards);
  } catch (error) {
    console.warn('Failed to load UI state', error);
  }
}

function saveUiState() {
  try {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        collapsedPanels: [...state.ui.collapsedPanels],
        foldedSections: [...state.ui.foldedSections],
        collapsedTeams: [...state.ui.collapsedTeams],
        touchedTeamCards: state.ui.touchedTeamCards,
      })
    );
  } catch (error) {
    console.warn('Failed to save UI state', error);
  }
}

function applyResponsiveDefaults() {
  if (window.innerWidth <= 900) {
    ['presets', 'blackboard', 'eventsPanel'].forEach((id) => {
      if (id.endsWith('Panel')) {
        state.ui.collapsedPanels.add(id);
      } else {
        state.ui.foldedSections.add(id);
      }
    });
  }
  saveUiState();
}

function syncResponsiveLayout() {
  const controlsCollapsed = state.ui.collapsedPanels.has('controlsPanel');
  const telemetryCollapsed = state.ui.collapsedPanels.has('telemetryPanel');
  const teamsCollapsed = state.ui.collapsedPanels.has('teamsPanel');
  const eventsCollapsed = state.ui.collapsedPanels.has('eventsPanel');

  const root = document.documentElement;
  root.style.setProperty('--controls-col', controlsCollapsed && window.innerWidth > 1420 ? '118px' : '350px');
  root.style.setProperty(
    '--right-col',
    telemetryCollapsed && eventsCollapsed && window.innerWidth > 1420 ? '118px' : '350px'
  );

  refs.layoutRoot.classList.toggle('teams-panel-collapsed', teamsCollapsed);
}

function applyTeamDensityStrategy() {
  if (state.ui.touchedTeamCards) return;
  if (window.innerWidth <= 980 || state.teamOrder.length >= 4) {
    state.ui.collapsedTeams = new Set(state.teamOrder.slice(2));
    saveUiState();
  }
}

function getOrbitLayoutMode(width, height, teamCount) {
  if (width < 720) return 'stack';
  if (width < 1120 || teamCount >= 5) return 'belt';
  return 'ellipse';
}

function computeStageMinHeight(teamCount, width) {
  if (width < 720) return Math.max(760, 420 + teamCount * 140);
  if (width < 1120) return Math.max(620, 420 + teamCount * 70);
  return Math.max(560, 420 + teamCount * 40);
}

function computeOrbitPositions(teamCount, width, height, center, mode) {
  if (mode === 'stack') {
    const cols = width < 540 ? 1 : 2;
    const marginX = cols === 1 ? width / 2 : 130;
    const gapX = cols === 1 ? 0 : Math.max(220, width - 260);
    const startY = Math.max(height * 0.56, center.y + 170);
    return Array.from({ length: teamCount }, (_, index) => {
      const col = cols === 1 ? 0 : index % cols;
      const row = cols === 1 ? index : Math.floor(index / cols);
      const x = cols === 1 ? width / 2 : marginX + col * gapX;
      const y = startY + row * 130;
      return { x, y };
    });
  }

  const rx = clamp(width * (mode === 'belt' ? 0.36 : 0.38), 200, width / 2 - 110);
  const ry = clamp(height * (mode === 'belt' ? 0.28 : 0.32), 160, height / 2 - 110);
  const startAngle = -Math.PI / 2;
  const step = (Math.PI * 2) / Math.max(teamCount, 1);

  return Array.from({ length: teamCount }, (_, index) => {
    const angle = startAngle + step * index;
    return {
      x: center.x + Math.cos(angle) * rx,
      y: center.y + Math.sin(angle) * ry,
    };
  });
}

function countSyntheticAgents(team) {
  return Array.from(team.agents.values()).filter((agent) => agent.synthetic).length;
}

function compactText(text, max = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeBadge(text, tone = 'neutral') {
  return `<span class="status-badge ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}
