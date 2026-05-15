/**
 * Operational Zones & Semantic Canvas
 * Mapeamento estrutural da mesa + pipeline de candidatos com validação semântica
 *
 * PROIBIDO: querySelector heurístico, button scanning, width/height heurístico
 * OBRIGATÓRIO: contexto operacional, zona validada, semantic validation
 */

const OperationalZones = (() => {
  const zones = new Map(); // zoneId → {bounds, type, context, validated, blockedReasons}
  const operationalMap = null; // cached map of mesa structure

  // ═══ 1. OPERATIONAL ZONE TYPES ═══
  const ZONE_TYPES = {
    BETTING_ZONE: 'betting_zone',           // Área onde fichas podem ser colocadas
    CHIP_SELECTOR: 'chip_selector',         // Bandeja de fichas
    CONFIRM_BUTTON: 'confirm_button',       // Botão de confirmação
    HISTORY_ROAD: 'history_road',           // Histórico de rodadas
    VIDEO_CANVAS: 'video_canvas',           // Transmissão de vídeo
    OVERLAY_ZONE: 'overlay_zone',           // Nossa overlay
    BLOCKED_ZONE: 'blocked_zone',           // Zonas proibidas (chat, buttons)
    HUD_ZONE: 'hud_zone',                   // Controles do jogo
    PLAYER_AREA: 'player_area',             // Posição Player
    BANKER_AREA: 'banker_area',             // Posição Banker
    TIE_AREA: 'tie_area'                    // Posição Tie
  };

  // ═══ 2. OPERATIONAL CONTEXT ═══
  // Estado atual da mesa
  const operationalContext = {
    bettingPhaseActive: false,
    currentRound: null,
    activeMesa: null,
    visibleZones: [],
    blockedZones: [],
    lastValidatedAt: null,
    lastBlockedAt: null,
    blockReasons: []
  };

  // ═══ 3. OPERATIONAL MAP BUILDER ═══
  // Construir mapa semântico da mesa

  function buildOperationalMap() {
    const map = {
      timestamp: Date.now(),
      verified: false,
      zones: {},
      hierarchy: {
        mesa: null,
        hudZone: null,
        videoCanvas: null,
        bettingZone: {
          playerArea: null,
          bankerArea: null,
          tieArea: null
        },
        chipSelector: null,
        confirmButton: null,
        historyRoad: null,
        overlayZone: null,
        blockedZones: []
      }
    };

    // Detectar pela estrutura visual esperada, não por heurística
    // Procurar por elementos com rol semântico claro ou estrutura conhecida

    // EXEMPLO: Betting zone é onde fichas são renderizadas visualmente
    // Procurar por container que contém múltiplas áreas de aposta
    const bettingContainer = detectBettingContainer();
    if (bettingContainer) {
      map.hierarchy.bettingZone.playerArea = detectPlayerArea(bettingContainer);
      map.hierarchy.bettingZone.bankerArea = detectBankerArea(bettingContainer);
      map.hierarchy.bettingZone.tieArea = detectTieArea(bettingContainer);
      map.zones.betting_zone = {
        element: bettingContainer,
        bounds: bettingContainer.getBoundingClientRect(),
        type: ZONE_TYPES.BETTING_ZONE,
        children: [
          map.hierarchy.bettingZone.playerArea,
          map.hierarchy.bettingZone.bankerArea,
          map.hierarchy.bettingZone.tieArea
        ].filter(Boolean)
      };
    }

    // Chip selector
    const chipSelector = detectChipSelector();
    if (chipSelector) {
      map.hierarchy.chipSelector = chipSelector;
      map.zones.chip_selector = {
        element: chipSelector,
        bounds: chipSelector.getBoundingClientRect(),
        type: ZONE_TYPES.CHIP_SELECTOR
      };
    }

    // Confirm button
    const confirmBtn = detectConfirmButton();
    if (confirmBtn) {
      map.hierarchy.confirmButton = confirmBtn;
      map.zones.confirm_button = {
        element: confirmBtn,
        bounds: confirmBtn.getBoundingClientRect(),
        type: ZONE_TYPES.CONFIRM_BUTTON
      };
    }

    // Video canvas
    const videoCanvas = detectVideoCanvas();
    if (videoCanvas) {
      map.hierarchy.videoCanvas = videoCanvas;
      map.zones.video_canvas = {
        element: videoCanvas,
        bounds: videoCanvas.getBoundingClientRect(),
        type: ZONE_TYPES.VIDEO_CANVAS
      };
    }

    // Blocked zones (chat, menus, buttons)
    const blockedZones = detectBlockedZones();
    blockedZones.forEach(zone => {
      map.hierarchy.blockedZones.push(zone);
      const zoneId = `blocked_${Date.now()}_${Math.random()}`;
      map.zones[zoneId] = {
        element: zone,
        bounds: zone.getBoundingClientRect(),
        type: ZONE_TYPES.BLOCKED_ZONE,
        reason: 'Interactive element outside betting context'
      };
    });

    map.verified = validateOperationalMap(map);
    operationalContext.lastValidatedAt = Date.now();

    return map;
  }

  // ═══ 4. ZONE DETECTION HELPERS ═══
  // Detectar zonas por contexto visual/estrutural, não heurística

  function detectBettingContainer() {
    // Procurar por elemento que contém múltiplos subareas de aposta
    // Usar estrutura DOM conhecida da plataforma BetBoom/Evolution
    const candidates = document.querySelectorAll('[data-region], [role="main"], .mesa-container, .betting-area');

    for (const el of candidates) {
      // Verificar se contém estrutura de áreas de aposta
      if (el.querySelectorAll('[data-position], [data-area], .player-area, .banker-area').length >= 2) {
        return el;
      }
    }

    return null;
  }

  function detectPlayerArea(container) {
    const candidates = container.querySelectorAll('[data-position="player"], [class*="player-area"], .player-zone');
    return candidates.length > 0 ? candidates[0] : null;
  }

  function detectBankerArea(container) {
    const candidates = container.querySelectorAll('[data-position="banker"], [class*="banker-area"], .banker-zone');
    return candidates.length > 0 ? candidates[0] : null;
  }

  function detectTieArea(container) {
    const candidates = container.querySelectorAll('[data-position="tie"], [class*="tie-area"], .tie-zone');
    return candidates.length > 0 ? candidates[0] : null;
  }

  function detectChipSelector() {
    // Procurar por chip tray/selector por estrutura conhecida
    const candidates = document.querySelectorAll('[data-chip-tray], [class*="chip-selector"], .chip-tray, .ficha-tray');

    for (const el of candidates) {
      // Deve conter múltiplas fichas/valores
      if (el.querySelectorAll('[data-chip-value], [data-valor], .chip, .ficha').length > 0) {
        return el;
      }
    }

    return null;
  }

  function detectConfirmButton() {
    // Procurar por botão de confirmação por contexto semântico
    const candidates = document.querySelectorAll('[data-action="confirm"], [aria-label*="confirmar"], button[data-confirm], .confirm-btn');
    return candidates.length > 0 ? candidates[0] : null;
  }

  function detectVideoCanvas() {
    // Procurar por canvas de vídeo
    const candidates = document.querySelectorAll('canvas, video, [data-stream], .video-canvas, .stream-container');

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Canvas de vídeo típico é grande
      if (rect.width > 300 && rect.height > 300) {
        return el;
      }
    }

    return null;
  }

  function detectBlockedZones() {
    // Zonas que não devem ser clicadas: chat, menus, buttons fora do contexto
    const blockedSelectors = [
      '.chat-container',
      '.menu-overlay',
      '.settings-panel',
      '[role="navigation"]',
      '[role="complementary"]',
      '.sidebar',
      '#toolbar',
      'nav'
    ];

    const blocked = [];
    blockedSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (el && el.offsetParent !== null) { // Visible
          blocked.push(el);
        }
      });
    });

    return blocked;
  }

  // ═══ 5. OPERATIONAL MAP VALIDATION ═══

  function validateOperationalMap(map) {
    const checks = {
      hasBettingZone: !!map.zones.betting_zone,
      hasChipSelector: !!map.zones.chip_selector,
      hasConfirmButton: !!map.zones.confirm_button,
      bettingZoneValid: map.zones.betting_zone ? validateZoneBounds(map.zones.betting_zone) : false,
      chipSelectorValid: map.zones.chip_selector ? validateZoneBounds(map.zones.chip_selector) : false
    };

    const passed = checks.hasBettingZone && checks.hasChipSelector && checks.bettingZoneValid && checks.chipSelectorValid;

    if (!passed) {
      console.warn('[OperationalZones] Map validation FAILED:', checks);
      const failures = Object.entries(checks).filter(([_, v]) => !v).map(([k]) => k);
      operationalContext.blockReasons.push({
        blockId: `map_validation_${Date.now()}`,
        type: 'map_validation',
        severity: 'critical',
        reason: `Map failed: ${failures.join(', ')}`,
        sourceModule: 'OperationalZones',
        timestamp: Date.now(),
        recommendedAction: 'Refresh page or check mesa structure'
      });
    }

    return passed;
  }

  function validateZoneBounds(zone) {
    const b = zone.bounds;
    return b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0;
  }

  // ═══ 6. BETTING PHASE GATE ═══
  // Proibido procurar ficha fora de betting phase

  function isBettingPhaseActive() {
    // Detectar betting phase por estado visual/semântico
    // Pode verificar:
    // - Se chip selector está visível
    // - Se betting timer está ativo
    // - Se modal de aposta está aberto
    // - Se historicamente entramos em betting phase (via eventos)

    // Implementação conservadora: betting phase = chip selector visível
    if (typeof Collector !== 'undefined' && Collector.isBettingPhase?.()) {
      return true;
    }

    // Fallback
    const chipSelector = document.querySelector('[data-chip-tray], [class*="chip-selector"]');
    const isVisible = chipSelector && chipSelector.offsetParent !== null;

    return isVisible;
  }

  function blockIfNotBettingPhase(reason = 'Not in betting phase') {
    if (!isBettingPhaseActive()) {
      const blockId = `betting_phase_${Date.now()}`;
      operationalContext.blockReasons.push({
        blockId,
        type: 'betting_phase_gate',
        severity: 'critical',
        reason,
        sourceModule: 'OperationalZones',
        timestamp: Date.now(),
        recommendedAction: 'Wait for betting phase to start'
      });
      operationalContext.lastBlockedAt = Date.now();
      return false;
    }
    return true;
  }

  // ═══ 7. CANDIDATE VALIDATION PIPELINE ═══

  function validateCandidate(candidate) {
    const result = {
      candidate,
      passed: true,
      failures: [],
      evidenceMap: {}
    };

    // 1. Betting phase gate
    if (!blockIfNotBettingPhase('Candidate validation blocked by betting phase')) {
      result.failures.push('Betting phase not active');
      result.passed = false;
      return result;
    }

    // 2. Zone validation
    if (!candidate.zone || !candidate.insideBettingZone) {
      result.failures.push('Candidate not inside betting zone');
      result.passed = false;
    }

    // 3. Operational context validation
    if (candidate.insideOverlay || candidate.insideBlockedZone) {
      result.failures.push('Candidate inside overlay or blocked zone');
      result.passed = false;
    }

    // 4. Iframe validation
    if (!candidate.iframeValidated) {
      result.failures.push('Iframe not validated');
      result.passed = false;
    }

    // 5. Hit target validation
    if (!candidate.hitTargetValidated) {
      result.failures.push('Hit target not validated');
      result.passed = false;
    }

    // 6. Visibility validation
    if (!candidate.visibilityValidated) {
      result.failures.push('Visibility not validated');
      result.passed = false;
    }

    // 7. Semantic validation
    if (!candidate.semanticValidated) {
      result.failures.push('Semantic validation failed');
      result.passed = false;
    }

    // 8. Confidence threshold
    if (candidate.confidence < 0.75) {
      result.failures.push(`Confidence below threshold: ${candidate.confidence}`);
      result.passed = false;
    }

    return result;
  }

  // ═══ 8. OPERATIONAL BLOCK MANAGEMENT ═══

  function pushBlockReason(type, severity, reason, sourceModule, recommendedAction = '') {
    const blockId = `${type}_${Date.now()}`;
    const blockReason = {
      blockId,
      type,
      severity, // warning|critical|catastrophic
      reason,
      sourceModule,
      timestamp: Date.now(),
      recommendedAction
    };

    operationalContext.blockReasons.push(blockReason);
    operationalContext.lastBlockedAt = Date.now();

    if (severity === 'catastrophic') {
      showCatastrophicAlert(blockReason);
    }

    return blockId;
  }

  function showCatastrophicAlert(blockReason) {
    // Mostrar alerta gigante visual
    const alert = document.createElement('div');
    alert.id = 'bb-catastrophic-alert';
    alert.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 0, 0, 0.9);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      color: white;
      font-size: 32px;
      font-weight: bold;
      animation: pulse-alert 0.5s infinite;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-alert {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);

    alert.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 80px; margin-bottom: 20px;">🚨</div>
        <div>BLOQUEIO OPERACIONAL</div>
        <div style="font-size: 24px; margin-top: 20px;">${blockReason.reason}</div>
        <div style="font-size: 16px; margin-top: 20px;">${blockReason.recommendedAction}</div>
      </div>
    `;

    document.body.appendChild(alert);

    console.error('[OperationalZones] CATASTROPHIC ALERT:', blockReason);

    // Auto-remove após 10s se usuário não interagir
    setTimeout(() => {
      if (alert.parentNode) {
        alert.parentNode.removeChild(alert);
      }
    }, 10000);
  }

  function getBlockReasons(limit = 10) {
    return operationalContext.blockReasons.slice(-limit);
  }

  // ═══ 9. VISUAL DEBUG ═══

  function renderZonesDebug() {
    const canvas = document.createElement('div');
    canvas.id = 'bb-zones-debug';
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99998;
    `;

    // Render zones
    Object.values(operationalContext.visibleZones || []).forEach(zone => {
      const rect = zone.bounds;
      const box = document.createElement('div');
      box.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid ${getZoneColor(zone.type)};
        box-sizing: border-box;
        opacity: 0.5;
        pointer-events: none;
      `;
      canvas.appendChild(box);

      // Label
      const label = document.createElement('div');
      label.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        background: ${getZoneColor(zone.type)};
        color: white;
        padding: 2px 4px;
        font-size: 10px;
        font-weight: bold;
        pointer-events: none;
      `;
      label.textContent = zone.type;
      canvas.appendChild(label);
    });

    document.body.appendChild(canvas);
    return canvas;
  }

  function getZoneColor(type) {
    const colors = {
      [ZONE_TYPES.BETTING_ZONE]: '#00ff00',
      [ZONE_TYPES.CHIP_SELECTOR]: '#ffff00',
      [ZONE_TYPES.CONFIRM_BUTTON]: '#0088ff',
      [ZONE_TYPES.BLOCKED_ZONE]: '#ff0000',
      [ZONE_TYPES.VIDEO_CANVAS]: '#00ffff'
    };
    return colors[type] || '#888888';
  }

  // ═══ 10. PUBLIC API ═══

  return {
    // Zone types
    ZONE_TYPES,

    // Map building
    buildOperationalMap,
    validateOperationalMap,

    // Betting phase gate
    isBettingPhaseActive,
    blockIfNotBettingPhase,

    // Candidate validation
    validateCandidate,

    // Block management
    pushBlockReason,
    getBlockReasons,
    showCatastrophicAlert,

    // Visual debug
    renderZonesDebug,

    // Context access
    getOperationalContext: () => operationalContext
  };
})();

window.OperationalZones = OperationalZones;
