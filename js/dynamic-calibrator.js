/**
 * BetBoom Auto Pattern — Dynamic Calibrator
 * Módulo de auto-cura para seletores DOM.
 * Caso o seletor fixo falhe, busca elementos por características semânticas.
 */
const DynamicCalibrator = (() => {
  const cache = new Map();

  /**
   * Tenta encontrar um botão por texto ou atributos comuns, mesmo que o seletor mude.
   */
  function findByHeuristics(type) {
    console.log(`[Calibrator] Iniciando busca heurística para: ${type}`);
    
    // Configurações semânticas para Bac Bo
    const rules = {
      vermelho: ['banker', 'banca', 'vermelho', 'red'],
      azul: ['player', 'jogador', 'azul', 'blue'],
      empate: ['tie', 'empate']
    };

    const keywords = rules[type] || [];
    
    // Busca em todos os botões e divs clicáveis
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], div[class*="clickable"]'));
    
    for (const el of candidates) {
      const text = (el.textContent || '').toLowerCase();
      const area = (el.getAttribute('aria-label') || '').toLowerCase();
      const classes = (el.className || '').toString().toLowerCase();
      
      const content = `${text} ${area} ${classes}`;
      
      if (keywords.some(kw => content.includes(kw))) {
        // Validação adicional: Bac Bo costuma ter áreas de aposta grandes
        const rect = el.getBoundingClientRect();
        if (rect.width > 20 && rect.height > 20) {
          console.log(`[Calibrator] Alvo relocalizado: ${type} ->`, el);
          return el;
        }
      }
    }

    return null;
  }

  return {
    /**
     * Resolve um seletor. Se falhar, tenta calibração dinâmica.
     */
    resolve(type, originalSelector) {
      // 1. Tentar seletor original
      if (originalSelector) {
        const el = document.querySelector(originalSelector);
        if (el && el.offsetParent !== null) return el;
      }

      // 2. Tentar Cache
      if (cache.has(type)) {
        const cachedEl = cache.get(type);
        if (document.body.contains(cachedEl) && cachedEl.offsetParent !== null) {
          return cachedEl;
        }
      }

      // 3. Fallback Heurística
      const found = findByHeuristics(type);
      if (found) {
        cache.set(type, found);
        return found;
      }

      return null;
    },

    clearCache() {
      cache.clear();
    }
  };
})();
