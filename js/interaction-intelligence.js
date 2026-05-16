/**
 * Interaction Intelligence Layer
 * P1 CRÍTICA: Element Scoring + Confidence + Validation + Safe Zones + Replay + Shadow Click + DOM Drift
 */

const InteractionIntelligence = (() => {
  const elementScores = new Map(); // selector → score history
  const safeZones = []; // grid de zonas seguras
  const interactionHistory = []; // log de interações e seus resultados
  const domDriftTracker = new Map(); // selector → mudanças detectadas

  // ═══ 1. ELEMENT SCORING ═══
  // Score 0-100 indicando confiabilidade para click

  function scoreElement(element) {
    if (!element) return 0;

    let score = 0;

    // Visibilidade (20 pontos)
    const rect = element.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
    if (isVisible && isInViewport) score += 20;

    // Tamanho adequado (15 pontos)
    if (rect.width >= 20 && rect.height >= 20) score += 15;

    // Posição estável (15 pontos)
    const zIndex = window.getComputedStyle(element).zIndex;
    if (zIndex !== 'auto' && parseInt(zIndex) >= 0) score += 15;

    // Não obscurecido (20 pontos)
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (elementAtPoint === element || element.contains(elementAtPoint)) score += 20;

    // Interatividade (15 pontos)
    const isClickable = element.onclick || element.hasAttribute('data-clickable');
    const isInteractive = ['BUTTON', 'A', 'INPUT'].includes(element.tagName);
    if (isClickable || isInteractive) score += 15;

    // Padding/margin razoável (5 pontos)
    const style = window.getComputedStyle(element);
    const padding = parseInt(style.padding) || 0;
    if (padding >= 2) score += 5;

    return Math.min(score, 100);
  }

  function scoreElementBySelector(selector) {
    try {
      const element = document.querySelector(selector);
      const score = scoreElement(element);

      if (!elementScores.has(selector)) {
        elementScores.set(selector, []);
      }
      const history = elementScores.get(selector);
      history.push({ score, timestamp: Date.now() });
      if (history.length > 100) history.shift();

      return score;
    } catch (e) {
      return 0;
    }
  }

  // ═══ 2. ELEMENT CONFIDENCE ═══
  // Confiança de que é o elemento certo (baseado em histórico)

  function calculateElementConfidence(selector, recentSuccessCount = 0, totalAttempts = 0) {
    if (totalAttempts === 0) return 50; // default
    const successRate = (recentSuccessCount / totalAttempts) * 100;
    return Math.min(Math.max(successRate, 0), 100);
  }

  function getElementConfidence(selector) {
    const history = elementScores.get(selector) || [];
    if (history.length === 0) return 50;

    const recent = history.slice(-10);
    const avgScore = recent.reduce((sum, h) => sum + h.score, 0) / recent.length;

    // Decaimento temporal: mais velho = menos confiança
    const oldestTime = recent[0].timestamp;
    const newestTime = recent[recent.length - 1].timestamp;
    const ageMs = Date.now() - oldestTime;
    const decayFactor = Math.max(1 - (ageMs / 3600000), 0.5); // decay em 1h

    return Math.round(avgScore * decayFactor);
  }

  // ═══ 3. TARGET VALIDATION ═══
  // Validação pre-click: existe? é visível? não está obscurecido?

  function validateTarget(selector) {
    try {
      const element = document.querySelector(selector);

      const checks = {
        exists: !!element,
        visible: false,
        notObscured: false,
        inViewport: false,
        hasMinSize: false,
        isEnabled: true
      };

      if (!element) {
        return {
          valid: false,
          reason: 'Element does not exist',
          checks,
          score: 0
        };
      }

      const rect = element.getBoundingClientRect();

      checks.visible = rect.width > 0 && rect.height > 0;
      checks.inViewport = rect.top < window.innerHeight && rect.bottom > 0;
      checks.hasMinSize = rect.width >= 10 && rect.height >= 10;

      // Verificar se não está obscurecido
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const elementAtPoint = document.elementFromPoint(centerX, centerY);
      checks.notObscured = elementAtPoint === element || element.contains(elementAtPoint);

      // Verificar se está desabilitado
      if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
        checks.isEnabled = false;
      }

      const allChecks = Object.values(checks).every(v => v === true);

      return {
        valid: allChecks,
        reason: allChecks ? 'Target is valid' : Object.entries(checks)
          .filter(([_, v]) => v === false)
          .map(([k]) => k)
          .join(', '),
        checks,
        score: scoreElement(element)
      };
    } catch (e) {
      return {
        valid: false,
        reason: `Validation error: ${e.message}`,
        checks: {},
        score: 0
      };
    }
  }

  // ═══ 4. SAFE INTERACTION ZONES ═══
  // Grid de zonas seguras para click (evita bordas, elementos animados)

  function initializeSafeZones() {
    const cellSize = 50; // pixels
    const cols = Math.ceil(window.innerWidth / cellSize);
    const rows = Math.ceil(window.innerHeight / cellSize);

    safeZones.length = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cellSize;
        const y = row * cellSize;
        const zone = {
          x, y, width: cellSize, height: cellSize,
          col, row,
          temperature: calculateZoneTemperature(x, y, cellSize)
        };
        safeZones.push(zone);
      }
    }
  }

  function calculateZoneTemperature(x, y, size) {
    // HOT (100): centro da tela
    // WARM (70): área intermediária
    // COLD (30): perto das bordas
    // FORBIDDEN (0): muito perto das bordas

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const zoneX = x + size / 2;
    const zoneY = y + size / 2;

    const distX = Math.abs(zoneX - centerX) / centerX;
    const distY = Math.abs(zoneY - centerY) / centerY;
    const avgDist = (distX + distY) / 2;

    // Penalidades por borda
    const edgeMargin = 100;
    const isTooCloseToEdge = x < edgeMargin || y < edgeMargin ||
      (x + size) > (window.innerWidth - edgeMargin) ||
      (y + size) > (window.innerHeight - edgeMargin);

    if (isTooCloseToEdge) return 0; // FORBIDDEN
    if (avgDist < 0.3) return 100; // HOT
    if (avgDist < 0.6) return 70; // WARM
    return 30; // COLD
  }

  function getZoneTemperature(x, y) {
    const cellSize = 50;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);

    const zone = safeZones.find(z => z.col === col && z.row === row);
    return zone ? zone.temperature : 30;
  }

  function isClickSafe(rect) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const temperature = getZoneTemperature(centerX, centerY);
    return temperature > 0; // 0 = forbidden
  }

  // ═══ 5. INTERACTION REPLAY ═══
  // Replay de interações sem re-execução

  function recordInteraction(selector, element, action, result) {
    interactionHistory.push({
      selector,
      element: {
        html: element?.outerHTML?.substring(0, 500) || '',
        rect: element?.getBoundingClientRect() || {},
        classes: element?.className || ''
      },
      action, // 'click', 'hover', 'focus'
      result, // 'success', 'failed', 'timeout'
      timestamp: Date.now(),
      traceId: CONFIG.traceIdAtual || null
    });

    if (interactionHistory.length > 500) interactionHistory.shift();
  }

  function replayInteraction(index) {
    if (index < 0 || index >= interactionHistory.length) return null;
    return interactionHistory[index];
  }

  function getInteractionHistory(limit = 50) {
    return interactionHistory.slice(-limit);
  }

  // ═══ 6. SHADOW CLICK ═══
  // Click de teste (dry run) — simula sem executar

  function shadowClick(selector, options = {}) {
    try {
      const element = document.querySelector(selector);
      if (!element) return { success: false, reason: 'Element not found', duration: 0 };

      // Validar
      const validation = validateTarget(selector);
      if (!validation.valid) {
        return { success: false, reason: validation.reason, validation };
      }

      // Medir tempo de reação
      const startTime = performance.now();

      // Simular sequência de eventos (sem dispará-los)
      const rect = element.getBoundingClientRect();
      const events = [
        new PointerEvent('pointerdown', { bubbles: true }),
        new MouseEvent('mousedown', { bubbles: true }),
        new PointerEvent('pointerup', { bubbles: true }),
        new MouseEvent('mouseup', { bubbles: true }),
        new PointerEvent('pointercancel', { bubbles: true, cancelable: true }),
        new Event('click', { bubbles: true })
      ];

      // Validar que eventos podem ser despachados
      let canDispatch = true;
      try {
        element.dispatchEvent(new Event('__test__', { bubbles: true }));
      } catch (e) {
        canDispatch = false;
      }

      const duration = performance.now() - startTime;

      // Detectar mudanças no elemento
      const elementsAtPoint = [
        document.elementFromPoint(rect.left + 5, rect.top + 5),
        document.elementFromPoint(rect.left + rect.width - 5, rect.top + 5),
        document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ];

      const overlapped = elementsAtPoint.some(el => el !== element && el !== null);

      return {
        success: validation.valid && canDispatch && !overlapped,
        reason: overlapped ? 'Element would be overlapped' : 'Ready to click',
        validation,
        canDispatch,
        overlapped,
        eventCount: events.length,
        duration,
        score: scoreElement(element)
      };
    } catch (e) {
      return { success: false, reason: `Shadow click error: ${e.message}`, duration: 0 };
    }
  }

  // ═══ 7. DOM DRIFT DETECTION ═══
  // Detectar quando elementos se movem, desaparecem ou mudam

  function trackElement(selector) {
    try {
      const element = document.querySelector(selector);
      if (!element) return null;

      const snapshot = {
        selector,
        timestamp: Date.now(),
        rect: element.getBoundingClientRect(),
        html: element.outerHTML.substring(0, 200),
        className: element.className,
        parent: element.parentElement?.tagName,
        visible: element.offsetParent !== null
      };

      if (!domDriftTracker.has(selector)) {
        domDriftTracker.set(selector, []);
      }

      const history = domDriftTracker.get(selector);
      history.push(snapshot);
      if (history.length > 50) history.shift();

      return snapshot;
    } catch (e) {
      return null;
    }
  }

  function detectDrift(selector) {
    const history = domDriftTracker.get(selector);
    if (!history || history.length < 2) return null;

    const current = history[history.length - 1];
    const previous = history[history.length - 2];

    const drifts = {
      moved: false,
      disappeared: false,
      changed: false,
      driftReason: []
    };

    // Detectar movimento
    if (Math.abs(current.rect.x - previous.rect.x) > 5 ||
        Math.abs(current.rect.y - previous.rect.y) > 5) {
      drifts.moved = true;
      drifts.driftReason.push('Element moved');
    }

    // Detectar desaparecimento
    if (!current.visible && previous.visible) {
      drifts.disappeared = true;
      drifts.driftReason.push('Element became hidden');
    }

    // Detectar mudança de classe/estrutura
    if (current.className !== previous.className) {
      drifts.changed = true;
      drifts.driftReason.push('Element classes changed');
    }

    if (current.html !== previous.html) {
      drifts.changed = true;
      drifts.driftReason.push('Element HTML changed');
    }

    return {
      hasDrift: drifts.moved || drifts.disappeared || drifts.changed,
      drifts,
      comparison: { current, previous }
    };
  }

  // ═══ 8. CHIP DETECTION VIA OPERATIONAL PIPELINE ═══
  // Delegado ao OperationalCandidatePipeline (sem heurística)

  function detectChipElement(valor) {
    if (typeof OperationalCandidatePipeline === 'undefined') {
      console.warn('[InteractionIntelligence] OperationalCandidatePipeline not loaded');
      return null;
    }

    const result = OperationalCandidatePipeline.executeFullPipeline(valor);
    if (!result.success) {
      return null;
    }

    return {
      element: result.candidate.element,
      selector: result.candidate.selector,
      source: 'operational-pipeline',
      confidence: (result.candidate.confidence * 100),
      reason: `Semantic pipeline: ${result.candidate.reason}`
    };
  }

  // ═══ 9. TARGET DETECTION VIA OPERATIONAL PIPELINE ═══
  // Delegado ao OperationalCandidatePipeline (sem heurística)

  function detectTargetElement(targetType) {
    if (!['player', 'banker', 'tie', 'empate', 'red', 'black'].includes(targetType?.toLowerCase?.() || '')) {
      return null;
    }

    if (typeof OperationalCandidatePipeline === 'undefined') {
      console.warn('[InteractionIntelligence] OperationalCandidatePipeline not loaded');
      return null;
    }

    const areaMap = {
      'RED': 'player',
      'PLAYER': 'player',
      'BLACK': 'banker',
      'BANKER': 'banker',
      'TIE': 'tie',
      'EMPATE': 'tie'
    };

    const mappedTarget = areaMap[targetType.toUpperCase()] || targetType.toLowerCase();
    const result = OperationalCandidatePipeline.executeFullPipeline(null, mappedTarget);

    if (!result.success) {
      return null;
    }

    return {
      element: result.candidate.element,
      selector: result.candidate.selector,
      source: 'operational-pipeline',
      confidence: (result.candidate.confidence * 100),
      reason: `Semantic pipeline: ${result.candidate.reason}`
    };
  }

  // ═══ 10. IFRAME OWNERSHIP VALIDATION ═══
  // Validar se o elemento pertence ao frame correto

  function validateIframeOwnership(element) {
    if (!element) return { valid: false, reason: 'Element is null' };

    try {
      // Verificar se está no documento atual
      if (document.body && !document.body.contains(element)) {
        return { valid: false, reason: 'Element not in current document' };
      }

      // Se está em um iframe, verificar qual
      const ownerDoc = element.ownerDocument;
      const isInMainFrame = ownerDoc === document;
      const iframeContext = {
        isInMainFrame,
        ownerFrame: isInMainFrame ? 'main' : 'iframe',
        frameUrl: ownerDoc.URL || 'unknown'
      };

      return { valid: true, reason: 'Element ownership valid', ...iframeContext };
    } catch (e) {
      return { valid: false, reason: `Ownership check error: ${e.message}` };
    }
  }

  // ═══ 11. ORCHESTRATED INTERACTION DETECTION ═══
  // Fluxo completo: pipeline semântica → validação operacional → shadow click → log

  function detectAndValidateClick(targetType, valor, options = {}) {
    const shouldShadowClick = options.shadowClick !== false;
    const timestamp = Date.now();
    const traceId = `interaction-${timestamp}-${Math.random().toString(16).slice(2, 8)}`;

    const log = {
      traceId,
      timestamp,
      targetType,
      valor,
      chipDetected: false,
      targetDetected: false,
      chipResult: null,
      targetResult: null,
      iframeValidation: null,
      safeZoneCheck: null,
      shadowClickResult: null,
      finalDecision: 'blocked',
      decisionReason: [],
      canProceed: false
    };

    // Passo 1: Detectar chip via pipeline semântica
    let chipResult = null;
    if (typeof OperationalCandidatePipeline !== 'undefined' && valor) {
      const chipPipeline = OperationalCandidatePipeline.executeFullPipeline(valor);
      if (chipPipeline.success) {
        chipResult = {
          element: chipPipeline.candidate.element,
          selector: chipPipeline.candidate.selector,
          confidence: chipPipeline.candidate.confidence * 100,
          source: 'operational-pipeline',
          reason: chipPipeline.candidate.reason
        };
        log.chipDetected = true;
        log.chipResult = chipResult;
      } else {
        log.decisionReason.push(`Chip pipeline failed: ${chipPipeline.blockId}`);
      }
    } else if (valor) {
      chipResult = detectChipElement(valor);
      if (chipResult) {
        log.chipDetected = true;
        log.chipResult = chipResult;
      } else {
        log.decisionReason.push('Chip not detected');
      }
    }

    // Passo 2: Detectar alvo via pipeline semântica
    let targetResult = null;
    if (typeof OperationalCandidatePipeline !== 'undefined' && targetType) {
      const targetPipeline = OperationalCandidatePipeline.executeFullPipeline(null, targetType);
      if (targetPipeline.success) {
        targetResult = {
          element: targetPipeline.candidate.element,
          selector: targetPipeline.candidate.selector,
          confidence: targetPipeline.candidate.confidence * 100,
          source: 'operational-pipeline',
          reason: targetPipeline.candidate.reason
        };
        log.targetDetected = true;
        log.targetResult = targetResult;
      } else {
        log.decisionReason.push(`Target pipeline failed: ${targetPipeline.blockId}`);
      }
    } else if (targetType) {
      targetResult = detectTargetElement(targetType);
      if (targetResult) {
        log.targetDetected = true;
        log.targetResult = targetResult;
      } else {
        log.decisionReason.push('Target not detected');
      }
    }

    // Passo 3: Validar candidato alvo contra OperationalZones
    if (targetResult && typeof OperationalZones !== 'undefined') {
      const zoneValidation = OperationalZones.validateCandidate({
        element: targetResult.element,
        selector: targetResult.selector,
        confidence: targetResult.confidence / 100
      });

      if (!zoneValidation) {
        log.decisionReason.push('Candidate failed OperationalZones validation');
      }
    }

    // Passo 4: Validar iframe (usando target como referência)
    if (targetResult) {
      const iframeCheck = validateIframeOwnership(targetResult.element);
      log.iframeValidation = {
        valid: iframeCheck.valid,
        reason: iframeCheck.reason,
        frame: iframeCheck.ownerFrame || 'unknown',
        frameUrl: iframeCheck.frameUrl || 'unknown'
      };

      if (!iframeCheck.valid) {
        log.decisionReason.push(`Iframe validation failed: ${iframeCheck.reason}`);
      }
    }

    // Passo 5: Safe Zone check
    if (targetResult) {
      const rect = targetResult.element.getBoundingClientRect();
      const isSafe = isClickSafe(rect);
      const temperature = getZoneTemperature(rect.left + rect.width / 2, rect.top + rect.height / 2);
      log.safeZoneCheck = {
        safe: isSafe,
        temperature,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };

      if (!isSafe) {
        log.decisionReason.push(`Target in forbidden zone (temperature: ${temperature})`);
      }
    }

    // Passo 6: Shadow click (se tudo passou até aqui)
    if (shouldShadowClick && targetResult && log.iframeValidation?.valid && log.safeZoneCheck?.safe) {
      const shadowResult = shadowClick(targetResult.selector);
      log.shadowClickResult = {
        success: shadowResult.success,
        reason: shadowResult.reason,
        duration: shadowResult.duration,
        validation: shadowResult.validation
      };

      if (!shadowResult.success) {
        log.decisionReason.push(`Shadow click failed: ${shadowResult.reason}`);
      }
    }

    // Decisão final
    const allChecksPassed =
      (chipResult || !valor) &&
      targetResult &&
      log.iframeValidation?.valid &&
      log.safeZoneCheck?.safe &&
      (!shouldShadowClick || log.shadowClickResult?.success);

    if (allChecksPassed) {
      log.finalDecision = 'approved';
      log.canProceed = true;
    }

    // Registrar interação
    if (targetResult) {
      recordInteraction(targetResult.selector, targetResult.element, 'click-validation', log.canProceed ? 'approved' : 'blocked');
    }

    return log;
  }


  // Inicializar na carga
  window.addEventListener('resize', initializeSafeZones);
  initializeSafeZones();

  return {
    // Element Scoring
    scoreElement,
    scoreElementBySelector,
    getElementScores: () => Object.fromEntries(elementScores),

    // Element Confidence
    calculateElementConfidence,
    getElementConfidence,

    // Target Validation
    validateTarget,

    // Safe Zones
    initializeSafeZones,
    getSafeZones: () => [...safeZones],
    getZoneTemperature,
    isClickSafe,

    // Interaction Replay
    recordInteraction,
    replayInteraction,
    getInteractionHistory,

    // Shadow Click
    shadowClick,

    // DOM Drift Detection
    trackElement,
    detectDrift,
    getDriftHistory: (selector) => domDriftTracker.get(selector) || [],

    // Chip Detection
    detectChipElement,

    // Target Detection
    detectTargetElement,

    // Iframe Ownership Validation
    validateIframeOwnership,

    // Orchestrated Detection
    detectAndValidateClick
  };
})();

window.InteractionIntelligence = InteractionIntelligence;
