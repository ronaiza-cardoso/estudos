/**
 * Chave pública que confere a assinatura dos pacotes de questões.
 *
 * Vai compilada dentro do app — é o que impede alguém de forjar um pacote.
 * A **privada**, que assina, nunca entra no repositório: ela fica só na
 * máquina de quem vende. Gere o par com:
 *
 *     npm run pacote:chaves
 *
 * O comando escreve a pública aqui e a privada onde você mandar. Perder a
 * privada significa não conseguir emitir pacotes novos; trocá-la invalida
 * todos os pacotes já vendidos, então guarde com cuidado.
 *
 * Vazio é o estado de fábrica: sem chave, todo pacote é recusado.
 */
export const CHAVE_PUBLICA = process.env.ESTUDOS_CHAVE_PUBLICA ?? '';
