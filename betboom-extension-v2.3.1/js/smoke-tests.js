/**
 * BetBoom Auto Pattern — Smoke Test Utility
 * Criado para validar o ambiente e disparar simulações de clique.
 */
const SmokeTest = (() => {
  return {
    run() {
      console.log('%c🧬 [Smoke Test] Iniciando Diagnóstico Jarvis...', 'color: #00ff00; font-weight: bold; font-size: 14px;');
      
      const results = {
        'WebSocket (EventBus)': typeof EventBus !== 'undefined',
        'Motor de Decisão': typeof DecisionEngine !== 'undefined',
        'Coletor de Dados': typeof Collector !== 'undefined',
        'Executor de Cliques': typeof Executor !== 'undefined',
        'Padrões do Will': typeof PatternEngine !== 'undefined'
      };

      console.table(results);

      const elementos = Executor.verificarElementos();
      console.log('%c🔍 Verificação Visual (DOM):', 'color: #3498db; font-weight: bold;');
      console.table(elementos);

      if (elementos.mesaAceitando) {
        console.log('%c✅ MESA ABERTA: O robô enxerga a rodada ativa.', 'color: #2ecc71;');
      } else {
        console.warn('%c⚠️ MESA FECHADA: Aguarde a Evolution abrir as apostas para validar cliques.', 'color: #f1c40f;');
      }

      // Simulação de Decisão (Fake Decision)
      const fakeDecisao = {
        deveApostar: true,
        cor: 'azul',
        stake: 1.0,
        padrao: { nome: 'SMOKE TEST' },
        maxGalesPermitido: 0
      };

      console.log('%c🧪 Simulação de Fluxo (Botão Azul):', 'color: #9b59b6; font-weight: bold;');
      console.log('O robô tentará identificar o botão AZUL agora...');
      
      const btn = Executor.selecionarBotaoCor ? Executor.selecionarBotaoCor('azul') : null;
      if (btn) {
        const visual = Executor.inferirCorDoBotao(btn);
        console.log(`Alvo encontrado! Cor inferida via visão computacional: %c${visual}`, `color: ${visual === 'azul' ? 'blue' : 'gray'}; font-weight: bold;`);
        
        if (visual === 'azul') {
          console.log('%c✅ TESTE DE VISÃO OK: Robô confirmou o alvo corretamente.', 'color: #2ecc71;');
        } else {
          console.error('%c❌ ERRO DE VISÃO: O robô encontrou o botão mas não confirmou a cor!', 'color: #e74c3c;');
        }
      } else {
        console.error('%c❌ ERRO DE ALVO: Botão AZUL não encontrado no DOM.', 'color: #e74c3c;');
      }

      console.log('%c-------------------------------------------', 'color: #7f8c8d;');
      console.log('Dica: Use `Overlay.SmokeTest.run()` para rodar novamente.');
      
      return { status: 'check-completed', ready: results['WebSocket (EventBus)'] && elementos.mesaAceitando };
    }
  };
})();
