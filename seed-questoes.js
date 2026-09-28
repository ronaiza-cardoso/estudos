/**
 * Questões carregadas na primeira execução, quando o banco está vazio.
 *
 * Está vazio de propósito: o app começa sem nenhuma questão. Para popular,
 * importe uma prova em PDF (`npm run import`) ou cadastre pela interface,
 * em Questões → Cadastrar questão.
 *
 * Se quiser semear questões daqui, o formato de cada item é:
 *
 *   {
 *     id: 'minha-001',                    // único
 *     materia: 'Direito Constitucional',  // criada se não existir
 *     assunto: 'Controle de Constitucionalidade',
 *     ano: 2024,
 *     banca: 'CEBRASPE',
 *     orgao: 'TRF 1ª Região',
 *     prova: 'Analista Judiciário',
 *     texto_assoc: null,                  // texto-base, quando houver
 *     enunciado: '...',
 *     alternativas: { A: '...', B: '...', C: '...', D: '...', E: '...' },
 *     gabarito: 'C',                      // null se anulada
 *     anulada: false,
 *   }
 *
 * Obrigatórios: id, materia, enunciado, alternativas, gabarito.
 */
export default [];
