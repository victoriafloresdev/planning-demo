
const DATA = window.PLANNING_REVIEW_DATA;
const ORDER = DATA.displayOrder;
const MODEL = DATA.models;
const state = { section: "overview", caseId: null, step: 0 };

const $ = (selector, root = document) => root.querySelector(selector);
const groupBy = (rows, fn) => rows.reduce((acc, row) => {
  const key = fn(row);
  (acc[key] ||= []).push(row);
  return acc;
}, {});
const byCase = groupBy(DATA.executed, row => row.episode_id);
const decisionsByCase = groupBy(DATA.decisions, row => row.episode_id);
const candidatesByKey = groupBy(DATA.candidates, row => `${row.episode_id}|${row.t}|${row.algo}`);
const stepsByCandidate = groupBy(DATA.candidateSteps, row => `${row.episode_id}|${row.t}|${row.algo}|${row.candidate_rank}`);

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (typeof value === "number") return value.toFixed(digits);
  return String(value);
}

function parseMaybeJson(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stateName(id) {
  if (id === null || id === undefined) return "estado nao observado";
  const value = Number(id);
  if (value === 713) return "episodio terminou em obito";
  if (value === 714) return "episodio terminou com sobrevivencia";
  if (value === 715) return "episodio encerrado";
  return `fenotipo clinico ${value}`;
}

function sofaBand(sofa) {
  if (sofa === null || sofa === undefined) return ["sem SOFA", "muted"];
  const value = Number(sofa);
  if (value <= 0) return ["desfecho/sem SOFA", "muted"];
  if (value < 4) return ["gravidade baixa", "low"];
  if (value < 8) return ["gravidade moderada", "medium"];
  if (value < 12) return ["gravidade alta", "high"];
  return ["gravidade muito alta", "critical"];
}

function outcome(row) {
  const reward = Number(row.reward || 0);
  const next = Number(row.next_state_id);
  if (next === 714 || reward >= 1) return ["sobrevivencia no simulador", "good"];
  if (next === 713 && row.done) return ["obito no simulador", "bad"];
  if (row.done) return ["episodio encerrou sem sobrevivencia", "bad"];
  return ["continua", "warn"];
}

function resultLabel(value, done) {
  if (value === null || value === undefined) return "nao avaliado";
  const numeric = Number(value);
  if (numeric >= 1) return "sobrevivencia";
  if (numeric <= -1) return "obito";
  return done ? "terminou sem sobrevivencia" : "continua";
}

function asBool(value) {
  return value === true || value === "True" || value === "true" || value === 1 || value === "1";
}

function sofaDelta(before, after) {
  if (before === null || before === undefined || after === null || after === undefined) {
    return { cls: "sofa-flat", label: "SOFA sem leitura suficiente", short: "SOFA sem leitura" };
  }
  const delta = Number(after) - Number(before);
  if (Number.isNaN(delta)) return { cls: "sofa-flat", label: "SOFA sem leitura suficiente", short: "SOFA sem leitura" };
  if (delta <= -0.05) return { cls: "sofa-down", label: `SOFA caiu ${fmt(Math.abs(delta), 2)}`, short: `SOFA caiu ${fmt(Math.abs(delta), 1)}` };
  if (delta >= 0.05) return { cls: "sofa-up", label: `SOFA subiu ${fmt(delta, 2)}`, short: `SOFA subiu ${fmt(delta, 1)}` };
  return { cls: "sofa-flat", label: "SOFA ficou igual", short: "SOFA igual" };
}

function terminalStateReason(nextStateId, reward, done) {
  const terminal = asBool(done);
  const next = nextStateId === null || nextStateId === undefined ? null : Number(nextStateId);
  const numericReward = reward === null || reward === undefined ? null : Number(reward);
  if (!terminal) {
    return {
      done: false,
      cls: "warn",
      badge: "ainda continua",
      why: "O simulador nao marcou desfecho terminal e abre outro bloco de 4 horas.",
    };
  }
  if (next === 714 || numericReward >= 1) {
    return {
      done: true,
      cls: "good",
      badge: "termina em sobrevivencia",
      why: "O simulador termina aqui porque entrou em sobrevivencia.",
    };
  }
  if (next === 713 || numericReward <= -1) {
    return {
      done: true,
      cls: "bad",
      badge: "termina em obito",
      why: "O simulador termina aqui porque entrou em obito.",
    };
  }
  if (next === 715) {
    return {
      done: true,
      cls: "bad",
      badge: "episodio encerrado",
      why: "O simulador termina aqui porque marcou o episodio como encerrado.",
    };
  }
  return {
    done: true,
    cls: "bad",
    badge: "desfecho terminal",
    why: "O simulador termina aqui porque marcou um desfecho terminal.",
  };
}

function modelExpectationInfo(step) {
  const reward = step.predicted_reward;
  const continueProb = step.predicted_continue_prob;
  if (reward !== null && reward !== undefined && Number(reward) >= 1) {
    return {
      cls: "good",
      badge: "modelo preve termino",
      detail: "Neste passo o proprio valor previsto ja fecha em sobrevivencia.",
    };
  }
  if (reward !== null && reward !== undefined && Number(reward) <= -1) {
    return {
      cls: "bad",
      badge: "modelo preve termino",
      detail: "Neste passo o proprio valor previsto ja fecha em obito.",
    };
  }
  if (continueProb === null || continueProb === undefined || Number.isNaN(Number(continueProb))) {
    return {
      cls: "muted",
      badge: "continuidade incerta",
      detail: "Nao ha probabilidade de continuidade suficiente para interpretar este passo.",
    };
  }
  const prob = Number(continueProb);
  if (prob < 0.35) {
    return {
      cls: "warn",
      badge: "pode terminar em breve",
      detail: `Chance estimada de continuar apos este passo: ${Math.round(prob * 100)}%. O modelo ve o episodio perto de um desfecho terminal.`,
    };
  }
  return {
    cls: "muted",
    badge: "modelo espera continuidade",
    detail: `Chance estimada de continuar apos este passo: ${Math.round(prob * 100)}%. O modelo ainda espera novos blocos depois daqui.`,
  };
}

function simulatorReplayInfo(step) {
  if (step.counterfactual_reward === null || step.counterfactual_reward === undefined) {
    return {
      unavailable: true,
      done: false,
      cls: "muted",
      badge: "simulador ja terminou",
      detail: "Este passo nao foi reexecutado porque o simulador ja havia encerrado o episodio em um bloco anterior.",
    };
  }
  const end = terminalStateReason(step.counterfactual_next_state_id, step.counterfactual_reward, step.counterfactual_done);
  const nextState = stateName(step.counterfactual_next_state_id);
  return {
    unavailable: false,
    done: end.done,
    cls: end.cls,
    badge: end.done ? "termina aqui" : end.badge,
    detail: `${end.why} Proximo estado no replay: ${nextState}.`,
  };
}

function dose(level) {
  const n = Number(level);
  return `<div class="dose-bar">${[0,1,2,3,4].map(i => {
    const cls = n === 0 && i === 0 ? "zero" : (n > 0 && i <= n ? "on" : "");
    return `<span class="dose-cell ${cls}"></span>`;
  }).join("")}</div>`;
}

function actionCard(row, prefix = "", compact = false) {
  const action = Number(row[`${prefix}action_idx`] ?? row.action_idx);
  const label = row[`${prefix}clinical_action_label`] ?? row.clinical_action_label;
  const fluidRange = row[`${prefix}fluid_range`] ?? row.fluid_range;
  const vasoRange = row[`${prefix}vaso_range`] ?? row.vaso_range;
  const fluid = Number(row[`${prefix}fluid_bin`] ?? row.fluid_bin ?? 0);
  const vaso = Number(row[`${prefix}vaso_bin`] ?? row.vaso_bin ?? 0);
  return `
    <div class="action-card ${compact ? "compact" : ""}">
      <div class="action-badge">C${action}</div>
      <div class="action-body">
        <strong>${label}</strong>
        <span>Fluido IV: ${fluidRange}</span>
        <span>Vasopressor: ${vasoRange}</span>
        <div class="dose-line"><small>Fluido</small>${dose(fluid)}</div>
        <div class="dose-line"><small>Vaso</small>${dose(vaso)}</div>
      </div>
    </div>
  `;
}

function stateCard(row, before = true) {
  const id = before ? row.state_id : row.next_state_id;
  const sofa = before ? row.sofa_score : row.next_sofa_score;
  const [band, cls] = sofaBand(sofa);
  return `
    <div class="state-card">
      <span class="label">${before ? "quadro antes da conduta" : "quadro depois da conduta"}</span>
      <strong>${stateName(id)}</strong>
      <span>SOFA medio do grupo: ${fmt(sofa, 2)}</span>
      <span class="severity ${cls}">${band}</span>
    </div>
  `;
}

function caseRows(caseId) {
  return (byCase[caseId] || []).sort((a, b) => ORDER.indexOf(a.algo) - ORDER.indexOf(b.algo) || a.t - b.t);
}

function decisionRows(caseId, step = state.step) {
  return (decisionsByCase[caseId] || [])
    .filter(row => Number(row.t) === Number(step))
    .sort((a, b) => ORDER.indexOf(a.algo) - ORDER.indexOf(b.algo));
}

function initialRows(caseId) {
  return decisionRows(caseId, 0);
}

function caseSummary(caseId) {
  const rows = caseRows(caseId);
  const first = rows[0] || {};
  const initial = initialRows(caseId);
  const distinct = Math.max(...initial.map(row => Number(row.num_distinct_actions || 1)), 1);
  const maxSteps = Math.max(...rows.map(row => Number(row.t || 0)), 0) + 1;
  return { rows, first, initial, distinct, maxSteps };
}

function renderApp() {
  const root = $("#app");
  const caseIds = Object.keys(byCase).map(Number).sort((a, b) => a - b);
  if (state.caseId === null && caseIds.length) state.caseId = caseIds[0];
  root.innerHTML = `
    <main class="app-shell">
      ${renderHero(caseIds)}
      ${renderTabs(caseIds)}
      <section class="section ${state.section === "overview" ? "active" : ""}" id="overview">
        ${renderOverview(caseIds)}
      </section>
      <section class="section ${state.section === "case" ? "active" : ""}" id="case">
        ${renderCase(state.caseId)}
      </section>
      <section class="section ${state.section === "guide" ? "active" : ""}" id="guide">
        ${renderGuide()}
      </section>
    </main>
  `;
  bindEvents();
}

function renderHero(caseIds) {
  return `
    <section class="hero">
      <div class="hero-main">
        <span class="kicker">Auditoria qualitativa dos modelos ICU-Sepsis</span>
        <h1>Prontuario visual das decisoes planejadas e executadas</h1>
        <p>Use esta tela para comparar como os modelos Azul, Vermelho e Roxo imaginam os proximos blocos de 4 horas, qual conduta aplicam agora e como o paciente simulado evolui depois. O foco e facilitar revisao clinica, nao prescricao.</p>
        <div class="metric-grid">
          <div class="metric"><span>casos exibidos</span><strong>${caseIds.length}</strong></div>
          <div class="metric"><span>estado usado</span><strong>${DATA.clinicalBackendLabel}</strong></div>
          <div class="metric"><span>horizonte mental</span><strong>${DATA.metadata.cem_horizon} blocos</strong></div>
          <div class="metric"><span>modelos</span><strong>Azul, Vermelho, Roxo</strong></div>
        </div>
      </div>
      <aside class="hero-side panel">
        <div class="legend-list">
          <div class="legend-item"><div class="legend-icon">P</div><div><strong>Paciente simulado</strong><span>Um grupo clinico historico do ICU-Sepsis, com SOFA medio daquele grupo.</span></div></div>
          <div class="legend-item"><div class="legend-icon">C</div><div><strong>Conduta C0-C24</strong><span>Combinacao discretizada de fluido IV e vasopressor no bloco de 4 horas.</span></div></div>
          <div class="legend-item"><div class="legend-icon">R</div><div><strong>Resultado</strong><span>Sinal do simulador: +1 sobrevivencia, -1 obito, 0 episodio ainda em andamento.</span></div></div>
          <div class="legend-item"><div class="legend-icon">?</div><div><strong>Planos</strong><span>Trajetorias que o modelo avaliou antes de escolher apenas a primeira conduta.</span></div></div>
        </div>
      </aside>
    </section>
  `;
}

function renderTabs(caseIds) {
  return `
    <nav class="tabs">
      <button class="tab ${state.section === "overview" ? "active" : ""}" data-section="overview">Visao geral</button>
      <button class="tab ${state.section === "case" ? "active" : ""}" data-section="case">Prontuario do caso</button>
      <button class="tab ${state.section === "guide" ? "active" : ""}" data-section="guide">Como interpretar</button>
      ${caseIds.map(id => `<button class="tab ${state.section === "case" && state.caseId === id ? "active" : ""}" data-case="${id}">Caso ${id}</button>`).join("")}
    </nav>
  `;
}

function renderOverview(caseIds) {
  return `
    <div class="panel">
      <h2>Casos para revisao</h2>
      <p class="muted">Estes exemplos foram escolhidos porque os modelos tomam condutas diferentes, o que ajuda a discutir diferencas de raciocinio.</p>
    </div>
    <div class="overview-grid">
      ${caseIds.map(renderCaseCard).join("")}
    </div>
  `;
}

function renderCaseCard(caseId) {
  const summary = caseSummary(caseId);
  const first = summary.first;
  return `
    <article class="case-card ${state.caseId === caseId ? "active" : ""}" data-case="${caseId}">
      <div class="case-head">
        <div>
          <span class="kicker">seed ${first.eval_seed}</span>
          <h3>Caso ${caseId}</h3>
        </div>
        <span class="pill ${summary.distinct > 1 ? "warn" : "good"}">${summary.distinct} condutas iniciais distintas</span>
      </div>
      <div class="summary-row"><span>Fenotipo inicial</span><strong>${stateName(first.state_id)}</strong></div>
      <div class="summary-row"><span>SOFA inicial</span><strong>${fmt(first.sofa_score, 2)}</strong></div>
      <div class="summary-row"><span>Duração max. observada</span><strong>${summary.maxSteps} blocos de 4h</strong></div>
      <div class="case-actions">
        ${summary.initial.map(row => `
          <div class="mini-action" style="--model:${modelColor(row.algo)};--model-soft:${modelSoft(row.algo)}">
            <span><i class="model-dot"></i>${MODEL[row.algo].short}</span>
            <strong class="action-code">C${row.chosen_action_idx}</strong>
            <span>${row.chosen_clinical_action_label}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function modelColor(algo) {
  return algo === "azul" ? "#1d6fb8" : algo === "vermelho" ? "#b73a3f" : "#7048b8";
}
function modelSoft(algo) {
  return algo === "azul" ? "#e8f2fb" : algo === "vermelho" ? "#faebec" : "#f0ecfa";
}

function renderCase(caseId) {
  if (caseId === null || !byCase[caseId]) return `<div class="empty">Nenhum caso selecionado.</div>`;
  const summary = caseSummary(caseId);
  const steps = [...new Set((decisionsByCase[caseId] || []).map(row => Number(row.t)))].sort((a, b) => a - b);
  const rowsAtStep = decisionRows(caseId);
  if (!steps.includes(state.step)) state.step = steps[0] || 0;
  return `
    <div class="patient-layout">
      <aside class="patient-sidebar">
        <div class="panel">
          <span class="kicker">Prontuario simulado</span>
          <h2>Caso ${caseId}</h2>
          <div class="clinical-summary">
            <div class="summary-row"><span>Identificador</span><strong>seed ${summary.first.eval_seed}</strong></div>
            <div class="summary-row"><span>Fenotipo inicial</span><strong>${stateName(summary.first.state_id)}</strong></div>
            <div class="summary-row"><span>SOFA inicial</span><strong>${fmt(summary.first.sofa_score, 2)}</strong></div>
            <div class="summary-row"><span>Por que este caso</span><strong>${summary.distinct} condutas iniciais distintas</strong></div>
          </div>
        </div>
        <div class="panel">
          <h3>Escolher bloco</h3>
          <p class="muted">Cada bloco representa 4 horas. Ao trocar o bloco, voce ve o que cada modelo pensou antes de agir naquele momento.</p>
          <div class="step-picker">${steps.map(step => `<button class="step-button ${step === state.step ? "active" : ""}" data-step="${step}">t=${step}</button>`).join("")}</div>
        </div>
      </aside>
      <div>
        <div class="panel">
          <h2>Linha do tempo executada</h2>
          <p class="muted">Esta e a trajetoria que de fato ocorreu no simulador depois que cada modelo aplicou suas condutas. As linhas alternativas aparecem abaixo, em "planos considerados".</p>
          ${renderExecutedTimelines(caseId)}
        </div>
        <div class="panel" style="margin-top:16px">
          <h2>Pensamento dos modelos no bloco t=${state.step}</h2>
          <p class="muted">Cada painel mostra o quadro atual, a conduta escolhida agora e as trajetorias que o modelo avaliou para os proximos blocos.</p>
          ${renderDecisionComparison(rowsAtStep)}
          <div class="model-compare">${rowsAtStep.map(renderModelDecision).join("")}</div>
        </div>
      </div>
    </div>
  `;
}

function renderExecutedTimelines(caseId) {
  const rowsByModel = groupBy(caseRows(caseId), row => row.algo);
  return `<div class="timeline-board">${ORDER.map(algo => {
    const rows = rowsByModel[algo] || [];
    return `
      <div class="timeline-row model-panel ${MODEL[algo].class}">
        <div class="timeline-row-head">
          <strong>${MODEL[algo].name}</strong>
          <span class="pill">${rows.length} blocos de 4h</span>
        </div>
        <div class="trajectory">
          ${rows.map(row => {
            const [text, cls] = outcome(row);
            const sofaInfo = sofaDelta(row.sofa_score, row.next_sofa_score);
            return `
              <div class="trajectory-node">
                <div class="time">t=${row.t}</div>
                <strong>${stateName(row.state_id)}</strong>
                <p>SOFA ${fmt(row.sofa_score, 2)}</p>
                <span class="sofa-badge ${sofaInfo.cls}">${sofaInfo.label}</span>
                <p><b>C${row.action_idx}</b> ${row.clinical_action_label}</p>
                <span class="pill ${cls}">${text}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("")}</div>`;
}

function renderDecisionComparison(rows) {
  if (!rows.length) return "";
  const same = rows.every(row => Number(row.chosen_action_idx) === Number(rows[0].chosen_action_idx));
  if (same) {
    return `
      <div class="compare-strip same">
        <strong>Conduta igual nos 3 modelos neste bloco:</strong>
        ${rows.map(row => `<span class="compare-chip same">${MODEL[row.algo].short}: C${row.chosen_action_idx}</span>`).join("")}
      </div>
    `;
  }
  return `
    <div class="compare-strip diff">
      <strong>Condutas diferentes neste bloco:</strong>
      ${rows.map(row => `<span class="compare-chip diff">${MODEL[row.algo].short}: C${row.chosen_action_idx}</span>`).join("")}
    </div>
  `;
}

function renderModelAgreement(row) {
  const current = Number(row.chosen_action_idx);
  const actions = ORDER.map(algo => ({ algo, action: Number(row[`${algo}_action_idx`]) }))
    .filter(item => !Number.isNaN(item.action));
  const matching = actions.filter(item => item.action === current).map(item => MODEL[item.algo].short);
  const others = actions.filter(item => item.action !== current).map(item => `${MODEL[item.algo].short}: C${item.action}`);
  if (matching.length === actions.length) {
    return `<div class="compare-note same">Esta mesma conduta aparece nos tres modelos: <b>C${current}</b>.</div>`;
  }
  const allied = matching.filter(name => name !== MODEL[row.algo].short);
  const intro = allied.length ? `Coincide com ${allied.join(" e ")} em <b>C${current}</b>.` : `So este modelo escolheu <b>C${current}</b>.`;
  return `<div class="compare-note diff">${intro} Diferencas neste bloco: ${others.join(" | ")}.</div>`;
}

function renderModelDecision(row) {
  const algo = row.algo;
  const candidates = (candidatesByKey[`${row.episode_id}|${row.t}|${algo}`] || [])
    .sort((a, b) => Number(a.candidate_rank) - Number(b.candidate_rank));
  const chosen = candidates.find(item => item.chosen) || candidates[0];
  const admissible = parseMaybeJson(row.admissible_actions, []);
  return `
    <article class="model-panel ${MODEL[algo].class}">
      <div class="model-title">
        <strong>${MODEL[algo].name}</strong>
        <span class="pill">${admissible.length} condutas possiveis</span>
      </div>
      ${stateCard(row, true)}
      ${actionCard(row, "chosen_")}
      ${renderModelAgreement(row)}
      ${renderWhy(row, chosen, candidates)}
      <div class="path-list">
        ${candidates.map(candidate => renderCandidate(row, candidate)).join("") || `<div class="empty">Sem planos capturados.</div>`}
      </div>
    </article>
  `;
}

function renderWhy(row, chosen, candidates) {
  if (!chosen) {
    return `<div class="why-card"><span class="label">justificativa visivel</span><p>Sem planos suficientes para explicar a escolha.</p></div>`;
  }
  const firstActions = [...new Set(candidates.map(c => parseMaybeJson(c.sequence, [])[0]).filter(v => v !== undefined))];
  return `
    <div class="why-card">
      <span class="label">por que este caminho foi escolhido</span>
      <p>Entre os planos exibidos, o modelo priorizou o plano iniciado por <b>C${row.chosen_action_idx}</b>. A regra aqui nao e uma justificativa medica: e a maior <b>pontuacao estimada</b> pelo modelo para comparar futuros possiveis.</p>
      <p>Primeiras condutas alternativas vistas neste bloco: ${firstActions.map(a => `C${a}`).join(", ")}.</p>
    </div>
  `;
}

function renderCandidate(decision, candidate) {
  const key = `${candidate.episode_id}|${candidate.t}|${candidate.algo}|${candidate.candidate_rank}`;
  const steps = (stepsByCandidate[key] || []).sort((a, b) => Number(a.horizon_step) - Number(b.horizon_step));
  const sequence = parseMaybeJson(candidate.sequence, []);
  const simulated = resultLabel(candidate.counterfactual_total_reward, candidate.counterfactual_terminated);
  return `
    <div class="path-card ${candidate.chosen ? "chosen open" : ""}" data-toggle-path>
      <div class="path-head">
        <div class="path-head-left">
          <h4>Plano ${candidate.candidate_rank} ${candidate.chosen ? "- caminho escolhido" : "- alternativa explorada"}</h4>
          <p>${candidate.chosen ? "A primeira conduta deste plano foi aplicada agora." : "Este caminho foi avaliado, mas nao foi a conduta aplicada neste bloco."}</p>
        </div>
        <div class="score-stack">
          <span class="score">pontuacao ${fmt(candidate.predicted_total_score, 2)}</span>
          <span class="score">se simulado: ${simulated}</span>
        </div>
      </div>
      <div class="plan-chain">
        ${sequence.map((action, idx) => {
          const step = steps[idx];
          const label = step ? step.clinical_action_label : `conduta C${action}`;
          const simInfo = step ? simulatorReplayInfo(step) : null;
          const note = step
            ? `<em class="plan-action-note ${simInfo.unavailable ? "muted" : (simInfo.done ? "terminal" : "muted")}">${simInfo.unavailable ? "nao rodou" : (simInfo.done ? "termina aqui" : sofaDelta(step.counterfactual_sofa_score, step.counterfactual_next_sofa_score).short)}</em>`
            : "";
          const extraClass = simInfo ? `${simInfo.done ? "terminal" : ""} ${simInfo.unavailable ? "ghost" : ""}`.trim() : "";
          return `<div class="plan-action ${extraClass}"><strong>C${action}</strong><span>+${idx * 4}h</span><span>${label}</span>${note}</div>`;
        }).join("")}
      </div>
      <div class="plan-details">
        ${steps.map(renderPlanStep).join("")}
      </div>
    </div>
  `;
}

function renderPlanStep(step) {
  const modelResult = resultLabel(step.predicted_reward, false);
  const simResult = resultLabel(step.counterfactual_reward, step.counterfactual_done);
  const continueProb = step.predicted_continue_prob === null ? "-" : `${Math.round(Number(step.predicted_continue_prob) * 100)}%`;
  const modelInfo = modelExpectationInfo(step);
  const simInfo = simulatorReplayInfo(step);
  const sofaInfo = sofaDelta(step.counterfactual_sofa_score, step.counterfactual_next_sofa_score);
  return `
    <div class="plan-step ${simInfo.done ? "terminal-step" : ""} ${simInfo.unavailable ? "inactive-step" : ""}">
      <div class="step-time">+${Number(step.horizon_step) * 4}h</div>
      <div class="step-content">
        ${actionCard(step, "", true)}
        <div class="step-explain">
          <div class="explain-mini ${modelInfo.cls}">
            <span>leitura do modelo</span>
            <strong>${modelResult}</strong>
            <div class="mini-pill-row">
              <span class="mini-pill ${modelInfo.cls}">${modelInfo.badge}</span>
              <span class="mini-pill muted">continua ${continueProb}</span>
            </div>
            <span>${modelInfo.detail}</span>
          </div>
          <div class="explain-mini ${simInfo.cls}">
            <span>replay no simulador estatistico</span>
            <strong>${simResult}</strong>
            <div class="mini-pill-row">
              <span class="mini-pill ${simInfo.cls}">${simInfo.badge}</span>
              <span class="mini-pill ${sofaInfo.cls}">${sofaInfo.short}</span>
            </div>
            <span>${simInfo.detail}</span>
            <span>${simInfo.unavailable ? "Resultado numerico indisponivel porque o replay terminou antes." : `SOFA ${fmt(step.counterfactual_sofa_score, 2)} -> ${fmt(step.counterfactual_next_sofa_score, 2)}. Resultado numerico: ${fmt(step.counterfactual_reward, 1)}.`}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGuide() {
  return `
    <div class="explain-grid">
      <article class="explain-card">
        <h3>O que e o simulador estatistico?</h3>
        <p>O ICU-Sepsis usado aqui e uma tabela de transicoes aprendida de dados historicos. Ele responde: em pacientes parecidos, depois de uma conduta parecida, qual proximo grupo clinico apareceu nos dados?</p>
        <ul><li>Nao e fisiologia individual.</li><li>Nao e uma recomendacao terapeutica.</li><li>Serve para auditoria qualitativa dos modelos.</li></ul>
      </article>
      <article class="explain-card">
        <h3>O que e resultado?</h3>
        <p>Resultado e o sinal numerico do ambiente: +1 quando o episodio termina com sobrevivencia, -1 quando termina em obito e 0 quando o episodio continua. Por isso nao deve ser lido como probabilidade clinica.</p>
      </article>
      <article class="explain-card">
        <h3>O que e pontuacao estimada?</h3>
        <p>E a nota que o modelo usa para ordenar trajetorias futuras. Ela combina sinais previstos ao longo dos proximos blocos. Valores maiores tendem a ser preferidos pelo modelo, mas nao sao justificativa medica por si so.</p>
      </article>
      <article class="explain-card">
        <h3>Chance de continuar o episodio</h3>
        <p>Segundo o modelo, esta e a chance de o episodio ainda nao ter chegado a sobrevivencia/obito apos esse passo planejado. Em outras palavras, o modelo imagina que o caso continuaria aberto para novos blocos de 4 horas.</p>
      </article>
      <article class="explain-card">
        <h3>Como avaliar clinicamente</h3>
        <ul><li>Compare se a intensidade de fluido IV e vasopressor parece coerente com o SOFA medio do grupo.</li><li>Veja se o modelo muda de estrategia quando o fenotipo muda.</li><li>Compare os caminhos alternativos que ele rejeitou.</li></ul>
      </article>
      <article class="explain-card">
        <h3>Limites importantes</h3>
        <p>Os exemplos atuais usam checkpoints demonstrativos. Eles validam a visualizacao e a captura de trajetorias, mas nao devem ser interpretados como desempenho clinico final.</p>
      </article>
    </div>
    <details class="dictionary" open>
      <summary>Dicionario das 25 condutas C0-C24</summary>
      <div class="dictionary-grid">
        ${DATA.actionDictionary.map(action => `
          <div class="dictionary-item">
            <strong>C${action.action_idx}</strong>${action.clinical_action_label}
            <span>Fluido IV: ${action.fluid_range}</span>
            <span>Vasopressor: ${action.vaso_range}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => {
    state.section = button.dataset.section;
    renderApp();
  }));
  document.querySelectorAll("[data-case]").forEach(button => button.addEventListener("click", () => {
    state.caseId = Number(button.dataset.case);
    state.section = "case";
    state.step = 0;
    renderApp();
  }));
  document.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
    state.step = Number(button.dataset.step);
    renderApp();
  }));
  document.querySelectorAll("[data-toggle-path] .path-head").forEach(head => head.addEventListener("click", () => {
    head.closest("[data-toggle-path]").classList.toggle("open");
  }));
}

renderApp();
