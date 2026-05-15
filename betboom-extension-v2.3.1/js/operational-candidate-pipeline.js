/**
 * Operational Candidate Pipeline
 * Substituição do querySelector heurístico
 *
 * Pipeline obrigatório:
 * collectCandidates → mapOperationalContext → scoreCandidates
 * → validateOperationalZone → validateHitTarget → validateVisibility
 * → validateIframe → shadowClick → executeClick → confirmClick
 *
 * PROIBIDO: fallback genérico, primeiro elemento encontrado, onclick scanning
 * OBRIGATÓRIO: cada validação registrada, bloqueio com motivo explícito
 */

const OperationalCandidatePipeline = (() => {
  const candidates = []; // {selector, operationalType, zone, context, confidence, ...}
  const validationLog = [];

  // ═══ 1. CANDIDATE COLLECTION ═══
  // Coletar candidatos APENAS de contexto operacional válido

  function collectCandidates(targetValue, operationalContext) {
    candidates.length = 0;

    // GATE 1: Betting phase must be active
    if (!OperationalZones.isBettingPhaseActive()) {
      logValidation('collect', false, 'Betting phase not active');
      return [];
    }

    // Procurar APENAS em betting zone
    const bettingZone = detectBettingZone();
    if (!bettingZone) {
      logValidation('collect', false, 'Betting zone not found');
      return [];
    }

    // Coletar candidatos ESPECÍFICOS para chip selector com valor
    const chipCandidates = collectChipCandidates(targetValue, bettingZone);
    const areaaCandidates = collectAreaCandidates(targetValue, bettingZone);

    const all = [...chipCandidates, ...areaaCandidates];
    logValidation('collect', all.length > 0, `Found ${all.length} candidates`);

    return all;
  }

  function detectBettingZone() {
    // Usar mapa operacional, não heurística
    const map = OperationalZones.buildOperationalMap();
    return map?.zones?.betting_zone?.element || null;
  }

  function collectChipCandidates(valor, bettingZone) {
    const result = [];

    // Procurar ESPECIFICAMENTE por chip com data-chip-value ou data-valor
    // NÃO procurar por class*="chip" ou heurísticas
    const chips = bettingZone.querySelectorAll('[data-chip-value], [data-valor]');

    chips.forEach(chip => {
      const chipValue = chip.getAttribute('data-chip-value') || chip.getAttribute('data-valor');
      if (parseFloat(chipValue) === valor || String(chipValue) === String(valor)) {
        result.push({
          element: chip,
          selector: getElementSelector(chip),
          operationalType: 'chip',
          zone: 'chip_selector',
          context: { targetValue: valor, foundValue: chipValue },
          confidence: 0, // será calculado
          insideBettingZone: true,
          insideOverlay: isInsideOverlay(chip),
          iframeValidated: false,
          hitTargetValidated: false,
          visibilityValidated: false,
          semanticValidated: false,
          reason: `Chip com valor ${chipValue}`
        });
      }
    });

    return result;
  }

  function collectAreaCandidates(targetValue, bettingZone) {
    const result = [];
    const areaMap = { 'RED': 'player', 'BLACK': 'banker', 'TIE': 'tie' };
    const areaType = areaMap[targetValue];

    if (!areaType) return result;

    // Procurar ESPECIFICAMENTE por área de aposta com data-position ou data-area
    const areas = bettingZone.querySelectorAll(`[data-position="${areaType}"], [data-area="${areaType}"]`);

    areas.forEach(area => {
      result.push({
        element: area,
        selector: getElementSelector(area),
        operationalType: 'betting_area',
        zone: `${areaType}_area`,
        context: { targetValue, areaType },
        confidence: 0,
        insideBettingZone: true,
        insideOverlay: isInsideOverlay(area),
        iframeValidated: false,
        hitTargetValidated: false,
        visibilityValidated: false,
        semanticValidated: false,
        reason: `Betting area para ${areaType}`
      });
    });

    return result;
  }

  // ═══ 2. OPERATIONAL CONTEXT MAPPING ═══

  function mapOperationalContext(candidates) {
    candidates.forEach(c => {
      c.context = {
        ...c.context,
        bettingPhaseActive: OperationalZones.isBettingPhaseActive(),
        currentRound: typeof Collector !== 'undefined' ? Collector.getCurrentRound?.() : null,
        timestamp: Date.now()
      };
    });

    return candidates;
  }

  // ═══ 3. CANDIDATE SCORING ═══

  function scoreCandidates(candidates) {
    candidates.forEach(c => {
      let score = 0;

      // Tipo operacional: chip mais específico que área
      if (c.operationalType === 'chip') score += 40;
      if (c.operationalType === 'betting_area') score += 30;

      // Proximidade visual: quão perto está do chip selector ou betting area
      const proximity = calculateProximity(c.element);
      score += Math.min(30, proximity);

      // Visibilidade
      const rect = c.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (rect.width >= 30 && rect.height >= 30) score += 20;
        else score += 10;
      }

      c.confidence = score / 100;
    });

    // Sort by confidence
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  function calculateProximity(element) {
    // Proximidade visual ao chip selector ou betting area
    // Quanto mais perto, maior o score
    const chipSelector = document.querySelector('[data-chip-tray], [class*="chip-selector"]');
    if (!chipSelector) return 5;

    const elementRect = element.getBoundingClientRect();
    const selectorRect = chipSelector.getBoundingClientRect();

    const dx = Math.max(0, Math.max(selectorRect.left - elementRect.right, elementRect.left - selectorRect.right));
    const dy = Math.max(0, Math.max(selectorRect.top - elementRect.bottom, elementRect.top - selectorRect.bottom));
    const distance = Math.sqrt(dx * dx + dy * dy);

    return Math.max(5, 30 - (distance / 100));
  }

  // ═══ 4. VALIDATION PIPELINE ═══

  async function validateOperationalZone(candidate) {
    const checks = {
      isInBettingZone: candidate.insideBettingZone,
      notInOverlay: !candidate.insideOverlay,
      bettingPhaseActive: OperationalZones.isBettingPhaseActive(),
      elementExists: candidate.element && candidate.element.offsetParent !== null
    };

    const passed = Object.values(checks).every(v => v);
    candidate.zoneValidated = passed;

    if (!passed) {
      logValidation('zone', false, JSON.stringify(checks));
    }

    return passed;
  }

  async function validateHitTarget(candidate) {
    if (!candidate.element) return false;

    const rect = candidate.element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Verificar que elementFromPoint retorna o elemento ou um child
    const hitElement = document.elementFromPoint(centerX, centerY);
    const isValidHit = hitElement === candidate.element || candidate.element.contains(hitElement);

    candidate.hitTargetValidated = isValidHit;

    if (!isValidHit) {
      logValidation('hitTarget', false, `elementFromPoint returned different element`);
    }

    return isValidHit;
  }

  async function validateVisibility(candidate) {
    if (!candidate.element) return false;

    const rect = candidate.element.getBoundingClientRect();
    const style = window.getComputedStyle(candidate.element);

    const checks = {
      hasSize: rect.width > 0 && rect.height > 0,
      isVisible: style.display !== 'none' && style.visibility !== 'hidden',
      isInViewport: rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0,
      isNotCovered: !isElementCovered(candidate.element)
    };

    const passed = Object.values(checks).every(v => v);
    candidate.visibilityValidated = passed;

    if (!passed) {
      logValidation('visibility', false, JSON.stringify(checks));
    }

    return passed;
  }

  function isElementCovered(element) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const topElement = document.elementFromPoint(centerX, centerY);
    return topElement !== element && !element.contains(topElement);
  }

  async function validateIframe(candidate) {
    // Verificar se elemento está em iframe
    let currentDoc = candidate.element.ownerDocument;
    let iframeCount = 0;

    while (currentDoc !== document) {
      const frame = Array.from(document.querySelectorAll('iframe')).find(f => f.contentDocument === currentDoc);
      if (!frame) break;

      iframeCount++;
      currentDoc = frame.ownerDocument;
    }

    const isInMainFrame = iframeCount === 0;
    candidate.iframeValidated = isInMainFrame;

    if (!isInMainFrame) {
      logValidation('iframe', false, `Element in ${iframeCount} iframe(s)`);
    }

    return isInMainFrame;
  }

  async function validateSemantic(candidate) {
    // Validação semântica: é realmente um chip/área de aposta?
    const element = candidate.element;
    const checks = {
      hasOperationalAttribute: element.hasAttribute('data-chip-value') || element.hasAttribute('data-area') || element.hasAttribute('data-position'),
      isClickable: element.onclick || element.hasAttribute('onclick') || element.style.cursor === 'pointer',
      hasRoleButton: element.hasAttribute('role') && (element.getAttribute('role') === 'button' || element.getAttribute('role') === 'region'),
      isNotDisabled: !element.hasAttribute('disabled') && element.offsetParent !== null
    };

    const passed = checks.hasOperationalAttribute && (checks.isClickable || checks.hasRoleButton) && checks.isNotDisabled;
    candidate.semanticValidated = passed;

    if (!passed) {
      logValidation('semantic', false, JSON.stringify(checks));
    }

    return passed;
  }

  // ═══ 5. SHADOW CLICK (ENSAIO) ═══

  async function shadowClick(candidate) {
    if (!candidate.element) return false;

    const rect = candidate.element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    try {
      // Disparar evento de mouse (sem clique real)
      const mousedownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY
      });

      candidate.element.dispatchEvent(mousedownEvent);

      logValidation('shadowClick', true, `Shadow click simulated at (${centerX}, ${centerY})`);
      return true;
    } catch (e) {
      logValidation('shadowClick', false, `Error: ${e.message}`);
      return false;
    }
  }

  // ═══ 6. FULL PIPELINE ═══

  async function executeFullPipeline(targetValue) {
    console.log(`[Pipeline] Starting for valor=${targetValue}`);

    // Step 1: Collect
    const collected = collectCandidates(targetValue, OperationalZones.getOperationalContext());
    if (collected.length === 0) {
      const blockId = OperationalZones.pushBlockReason(
        'no_candidates',
        'critical',
        'No operational candidates found for value ' + targetValue,
        'OperationalCandidatePipeline',
        'Check betting phase and betting zone visibility'
      );
      logValidation('pipeline', false, 'No candidates collected');
      return { success: false, blockId, candidate: null };
    }

    // Step 2: Map context
    mapOperationalContext(collected);

    // Step 3: Score
    const scored = scoreCandidates(collected);

    // Step 4-9: Validate best candidate
    const bestCandidate = scored[0];
    const validations = [
      ['zone', await validateOperationalZone(bestCandidate)],
      ['hitTarget', await validateHitTarget(bestCandidate)],
      ['visibility', await validateVisibility(bestCandidate)],
      ['iframe', await validateIframe(bestCandidate)],
      ['semantic', await validateSemantic(bestCandidate)]
    ];

    const allValidationsPassed = validations.every(([_, result]) => result);

    if (!allValidationsPassed) {
      const failures = validations.filter(([_, result]) => !result).map(([name]) => name);
      const blockId = OperationalZones.pushBlockReason(
        'validation_failed',
        'critical',
        `Candidate validation failed: ${failures.join(', ')}`,
        'OperationalCandidatePipeline',
        'Review validation log and retry'
      );
      logValidation('pipeline', false, `Validations failed: ${failures.join(', ')}`);
      return { success: false, blockId, candidate: bestCandidate };
    }

    // Step 10: Shadow click
    const shadowSuccess = await shadowClick(bestCandidate);
    if (!shadowSuccess) {
      const blockId = OperationalZones.pushBlockReason(
        'shadow_click_failed',
        'critical',
        'Shadow click failed',
        'OperationalCandidatePipeline',
        'Element may not be interactive'
      );
      return { success: false, blockId, candidate: bestCandidate };
    }

    console.log(`[Pipeline] SUCCESS: ${bestCandidate.reason} (confidence=${bestCandidate.confidence})`);
    logValidation('pipeline', true, 'All validations passed');

    return { success: true, candidate: bestCandidate };
  }

  // ═══ 7. VALIDATION LOG ═══

  function logValidation(stage, passed, details = '') {
    const entry = {
      stage,
      passed,
      details,
      timestamp: Date.now()
    };
    validationLog.push(entry);

    const status = passed ? '✓' : '✗';
    const color = passed ? '#0f0' : '#f00';
    console.log(`%c[${stage}] ${status}%c ${details}`, `color: ${color}; font-weight: bold;`, 'color: inherit;');

    // Keep last 100 entries
    if (validationLog.length > 100) {
      validationLog.shift();
    }
  }

  function getValidationLog(limit = 20) {
    return validationLog.slice(-limit);
  }

  // ═══ 8. PUBLIC API ═══

  return {
    // Pipeline steps
    collectCandidates,
    mapOperationalContext,
    scoreCandidates,
    validateOperationalZone,
    validateHitTarget,
    validateVisibility,
    validateIframe,
    validateSemantic,
    shadowClick,

    // Full execution
    executeFullPipeline,

    // Logging
    getValidationLog
  };
})();

window.OperationalCandidatePipeline = OperationalCandidatePipeline;
